const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

function normalizeVersion(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '');
}

function parseSemver(version) {
  const cleaned = normalizeVersion(version);
  const [main] = cleaned.split('-');
  const [major, minor, patch] = main.split('.').map((part) => Number.parseInt(part, 10));
  if (![major, minor, patch].every(Number.isInteger)) return null;
  return { major, minor, patch };
}

function compareVersions(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (!va || !vb) return 0;

  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
}

function parseRepoSlug(repoUrl) {
  const trimmed = String(repoUrl || '').trim();

  const direct = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (direct) {
    return `${direct[1]}/${direct[2].replace(/\.git$/i, '')}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname.includes('github.com')) return null;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`;
  } catch {
    return null;
  }
}

function httpRequestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'manga-tracker-updater',
          Accept: 'application/vnd.github+json',
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(httpRequestJson(res.headers.location, headers));
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 240)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${error.message}`));
          }
        });
      }
    );

    request.on('error', reject);
  });
}

function downloadFile(url, destinationPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'manga-tracker-updater',
          Accept: 'application/octet-stream',
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(downloadFile(res.headers.location, destinationPath, headers));
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(destinationPath, { mode: 0o755 });
        const hash = crypto.createHash('sha256');
        let bytes = 0;

        res.on('data', (chunk) => {
          hash.update(chunk);
          bytes += chunk.length;
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            resolve({
              bytes,
              sha256: hash.digest('hex'),
            });
          });
        });

        file.on('error', (error) => {
          fs.unlink(destinationPath, () => reject(error));
        });
      }
    );

    request.on('error', (error) => {
      fs.unlink(destinationPath, () => reject(error));
    });
  });
}

class GitHubReleaseUpdater {
  constructor({
    repoUrl,
    currentVersion,
    binaryPath = process.env.BOT_UPDATE_BINARY_PATH || process.execPath,
    assetName = process.env.BOT_UPDATE_ASSET_NAME || '',
  }) {
    this.repoUrl = repoUrl;
    this.repoSlug = parseRepoSlug(repoUrl);
    this.currentVersion = currentVersion;
    this.binaryPath = path.resolve(binaryPath);
    this.assetName = assetName.trim();
  }

  getState() {
    return {
      repoSlug: this.repoSlug,
      releasesPageUrl: this.repoSlug ? `https://github.com/${this.repoSlug}/releases` : null,
      currentVersion: this.currentVersion,
      binaryPath: this.binaryPath,
      runningAsBinary: path.basename(this.binaryPath).toLowerCase() !== 'node',
    };
  }

  async fetchLatestRelease() {
    const releases = await this.fetchReleases({ includePrerelease: false, limit: 1 });
    if (releases.length === 0) {
      throw new Error('No releases found');
    }
    return releases[0];
  }

  mapRelease(release) {
    return {
      tagName: release.tag_name,
      name: release.name,
      htmlUrl: release.html_url,
      publishedAt: release.published_at,
      body: release.body || '',
      prerelease: release.prerelease === true,
      draft: release.draft === true,
      assets: Array.isArray(release.assets)
        ? release.assets.map((asset) => ({
            id: asset.id,
            name: asset.name,
            size: asset.size,
            browserDownloadUrl: asset.browser_download_url,
            contentType: asset.content_type,
          }))
        : [],
    };
  }

  async fetchReleases({ includePrerelease = false, limit = 30 } = {}) {
    if (!this.repoSlug) {
      throw new Error('Invalid GitHub repo URL/slug configuration');
    }

    const perPage = Math.min(100, Math.max(1, limit));
    const url = `https://api.github.com/repos/${this.repoSlug}/releases?per_page=${perPage}`;
    const payload = await httpRequestJson(url);
    const releases = Array.isArray(payload) ? payload : [];

    return releases
      .filter((release) => release && release.draft !== true)
      .filter((release) => includePrerelease || release.prerelease !== true)
      .map((release) => this.mapRelease(release));
  }

  async fetchReleaseByTag(tagName) {
    if (!this.repoSlug) {
      throw new Error('Invalid GitHub repo URL/slug configuration');
    }
    const encodedTag = encodeURIComponent(tagName);
    const url = `https://api.github.com/repos/${this.repoSlug}/releases/tags/${encodedTag}`;
    const release = await httpRequestJson(url);
    if (!release || release.draft === true) {
      throw new Error(`Release not found for tag: ${tagName}`);
    }
    return this.mapRelease(release);
  }

  pickReleaseAsset(release, requestedAssetName = '') {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    if (assets.length === 0) {
      throw new Error('Latest release has no assets');
    }

    const desiredName = requestedAssetName.trim() || this.assetName;
    if (desiredName) {
      const exact = assets.find((asset) => asset.name === desiredName);
      if (!exact) throw new Error(`Requested asset not found: ${desiredName}`);
      return exact;
    }

    const runningName = path.basename(this.binaryPath);
    const sameName = assets.find((asset) => asset.name === runningName);
    if (sameName) return sameName;

    const platform = process.platform;
    const arch = process.arch;
    const fuzzy = assets.find((asset) => {
      const n = asset.name.toLowerCase();
      return n.includes('manga-tracker') && n.includes(platform) && n.includes(arch);
    });
    if (fuzzy) return fuzzy;

    const generic = assets.find((asset) => asset.name.toLowerCase().includes('manga-tracker'));
    if (generic) return generic;

    return assets[0];
  }

  async checkForUpdate({ includePrerelease = false, tagName = '' } = {}) {
    const release = tagName ? await this.fetchReleaseByTag(tagName) : (await this.fetchReleases({ includePrerelease, limit: 1 }))[0];
    if (!release) {
      throw new Error('No matching release found');
    }

    const releases = await this.fetchReleases({ includePrerelease, limit: 30 });
    const latestVersion = normalizeVersion(release.tagName);
    const currentVersion = normalizeVersion(this.currentVersion);

    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      release,
      releases: releases.map((item) => ({
        tagName: item.tagName,
        name: item.name,
        prerelease: item.prerelease,
        publishedAt: item.publishedAt,
      })),
      releaseMode: includePrerelease ? 'prerelease' : 'release',
      updaterState: this.getState(),
    };
  }

  async applyUpdate({ assetName = '', includePrerelease = false, tagName = '' } = {}) {
    if (!this.getState().runningAsBinary) {
      throw new Error('Updater requires BOT_UPDATE_BINARY_PATH pointing to the bot binary when not running as a binary.');
    }

    const stats = fs.statSync(this.binaryPath);
    if (!stats.isFile()) {
      throw new Error(`Binary path is not a file: ${this.binaryPath}`);
    }

    fs.accessSync(this.binaryPath, fs.constants.W_OK);

    const check = await this.checkForUpdate({ includePrerelease, tagName });
    if (!check.updateAvailable) {
      return {
        applied: false,
        updateAvailable: false,
        reason: 'Already on latest version',
        ...check,
      };
    }

    const asset = this.pickReleaseAsset(check.release, assetName);
    const binaryDir = path.dirname(this.binaryPath);
    const tempPath = path.join(binaryDir, `${path.basename(this.binaryPath)}.download-${Date.now()}`);
    const backupPath = `${this.binaryPath}.bak`;

    const download = await downloadFile(asset.browserDownloadUrl, tempPath);
    if (!download.bytes) {
      throw new Error('Downloaded asset is empty');
    }

    const worker = this.launchDetachedReplaceWorker({
      targetBinaryPath: this.binaryPath,
      downloadedBinaryPath: tempPath,
      backupPath,
      originalMode: stats.mode,
      targetPid: process.pid,
    });

    return {
      applied: true,
      updateAvailable: true,
      release: check.release,
      releases: check.releases,
      releaseMode: check.releaseMode,
      fromVersion: check.currentVersion,
      toVersion: check.latestVersion,
      asset: {
        name: asset.name,
        size: asset.size,
      },
      backupPath,
      download,
      worker,
    };
  }

  launchDetachedReplaceWorker({ targetBinaryPath, downloadedBinaryPath, backupPath, originalMode, targetPid }) {
    const scriptPath = path.join(os.tmpdir(), `manga-tracker-updater-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);
    const scriptBody = `#!/usr/bin/env bash
set -euo pipefail
TARGET_BINARY="$1"
NEW_BINARY="$2"
BACKUP_BINARY="$3"
MODE_OCTAL="$4"
OLD_PID="$5"
SCRIPT_SELF="$6"

sleep 1
if kill -0 "$OLD_PID" 2>/dev/null; then
  kill -TERM "$OLD_PID" 2>/dev/null || true
fi

for _ in $(seq 1 120); do
  if ! kill -0 "$OLD_PID" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

if kill -0 "$OLD_PID" 2>/dev/null; then
  kill -KILL "$OLD_PID" 2>/dev/null || true
fi

if [[ -f "$TARGET_BINARY" ]]; then
  cp "$TARGET_BINARY" "$BACKUP_BINARY" 2>/dev/null || true
fi

chmod "$MODE_OCTAL" "$NEW_BINARY" 2>/dev/null || chmod +x "$NEW_BINARY"
mv -f "$NEW_BINARY" "$TARGET_BINARY"
chmod "$MODE_OCTAL" "$TARGET_BINARY" 2>/dev/null || chmod +x "$TARGET_BINARY"

nohup "$TARGET_BINARY" >/dev/null 2>&1 &

rm -f "$SCRIPT_SELF" 2>/dev/null || true
`;

    fs.writeFileSync(scriptPath, scriptBody, { mode: 0o700 });
    const modeOctal = (originalMode & 0o777).toString(8);

    const child = spawn(
      '/bin/bash',
      [scriptPath, targetBinaryPath, downloadedBinaryPath, backupPath, modeOctal, String(targetPid), scriptPath],
      {
        detached: true,
        stdio: 'ignore',
      }
    );
    child.unref();

    return {
      pid: child.pid,
      scriptPath,
      modeOctal,
    };
  }
}

module.exports = {
  GitHubReleaseUpdater,
};
