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
  const [main, prereleaseRaw = ''] = cleaned.split('-', 2);
  const [major, minor, patch] = main.split('.').map((part) => Number.parseInt(part, 10));
  if (![major, minor, patch].every(Number.isInteger)) return null;
  const prerelease = prereleaseRaw
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part.toLowerCase()));
  return { major, minor, patch, prerelease };
}

function comparePrerelease(a, b) {
  const aPre = Array.isArray(a.prerelease) ? a.prerelease : [];
  const bPre = Array.isArray(b.prerelease) ? b.prerelease : [];

  // Stable versions rank higher than prereleases with same major/minor/patch.
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const max = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < max; i += 1) {
    const ai = aPre[i];
    const bi = bPre[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (ai === bi) continue;

    const aIsNum = typeof ai === 'number';
    const bIsNum = typeof bi === 'number';
    if (aIsNum && bIsNum) return ai - bi;
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;
    return String(ai).localeCompare(String(bi));
  }

  return 0;
}

function compareVersions(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (!va || !vb) return 0;

  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  if (va.patch !== vb.patch) return va.patch - vb.patch;
  return comparePrerelease(va, vb);
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
    systemdService = process.env.BOT_UPDATE_SYSTEMD_SERVICE || 'manga-tracker-discord-bot',
  }) {
    this.repoUrl = repoUrl;
    this.repoSlug = parseRepoSlug(repoUrl);
    this.currentVersion = currentVersion;
    this.binaryPath = path.resolve(binaryPath);
    this.assetName = assetName.trim();
    this.systemdService = String(systemdService || '').trim();
  }

  getState() {
    return {
      repoSlug: this.repoSlug,
      releasesPageUrl: this.repoSlug ? `https://github.com/${this.repoSlug}/releases` : null,
      currentVersion: this.currentVersion,
      binaryPath: this.binaryPath,
      runningAsBinary: path.basename(this.binaryPath).toLowerCase() !== 'node',
      systemdService: this.systemdService || null,
    };
  }

  async fetchLatestRelease() {
    const releases = await this.fetchReleases({ releaseMode: 'release', limit: 1 });
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

  async fetchReleases({ releaseMode = 'release', limit = 30 } = {}) {
    if (!this.repoSlug) {
      throw new Error('Invalid GitHub repo URL/slug configuration');
    }

    const perPage = Math.min(100, Math.max(1, limit));
    const url = `https://api.github.com/repos/${this.repoSlug}/releases?per_page=${perPage}`;
    const payload = await httpRequestJson(url);
    const releases = Array.isArray(payload) ? payload : [];

    return releases
      .filter((release) => release && release.draft !== true)
      .filter((release) => {
        if (releaseMode === 'prerelease') return release.prerelease === true;
        return release.prerelease !== true;
      })
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

  pickDashboardPackageAsset(release, selectedBinaryAsset = null) {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    if (assets.length === 0) return null;

    const runningName = path.basename(this.binaryPath).toLowerCase();
    const preferred = assets.find((asset) => {
      const name = String(asset.name || '').toLowerCase();
      return (
        name.endsWith('.tar.gz') &&
        name.includes('manga-tracker') &&
        !name.endsWith(`${runningName}.tar.gz`)
      );
    });
    if (preferred) return preferred;

    return assets.find((asset) => {
      const name = String(asset.name || '').toLowerCase();
      if (!name.endsWith('.tar.gz')) return false;
      if (selectedBinaryAsset && asset.name === selectedBinaryAsset.name) return false;
      return name.includes('manga-tracker');
    }) || null;
  }

  async checkForUpdate({ releaseMode = 'release', tagName = '' } = {}) {
    const normalizedMode = releaseMode === 'prerelease' ? 'prerelease' : 'release';
    const releases = await this.fetchReleases({ releaseMode: normalizedMode, limit: 30 });
    const currentVersion = normalizeVersion(this.currentVersion);
    const release = tagName ? await this.fetchReleaseByTag(tagName) : releases[0] || null;
    const latestVersion = release ? normalizeVersion(release.tagName) : currentVersion;

    let warning = '';
    if (!release) {
      if (tagName) {
        throw new Error(`No matching release found for tag "${tagName}" in channel "${normalizedMode}"`);
      }
      if (normalizedMode === 'release') {
        const prereleases = await this.fetchReleases({ releaseMode: 'prerelease', limit: 1 });
        if (prereleases.length > 0) {
          warning = 'No stable releases found. Switch Release Channel to Prerelease.';
        } else {
          warning = 'No releases found.';
        }
      } else {
        warning = 'No prereleases found.';
      }
    }

    return {
      currentVersion,
      latestVersion,
      updateAvailable: release ? compareVersions(latestVersion, currentVersion) > 0 : false,
      release,
      releases: releases.map((item) => ({
        tagName: item.tagName,
        name: item.name,
        prerelease: item.prerelease,
        publishedAt: item.publishedAt,
      })),
      warning,
      releaseMode: normalizedMode,
      updaterState: this.getState(),
    };
  }

  async applyUpdate({ assetName = '', releaseMode = 'release', tagName = '' } = {}) {
    if (!this.getState().runningAsBinary) {
      throw new Error('Updater requires BOT_UPDATE_BINARY_PATH pointing to the bot binary when not running as a binary.');
    }

    const stats = fs.statSync(this.binaryPath);
    if (!stats.isFile()) {
      throw new Error(`Binary path is not a file: ${this.binaryPath}`);
    }

    fs.accessSync(this.binaryPath, fs.constants.W_OK);

    const check = await this.checkForUpdate({ releaseMode, tagName });
    if (!check.release) {
      return {
        applied: false,
        updateAvailable: false,
        reason: check.warning || 'No matching release found',
        ...check,
      };
    }

    if (!check.updateAvailable) {
      return {
        applied: false,
        updateAvailable: false,
        reason: 'Already on latest version',
        ...check,
      };
    }

    const asset = this.pickReleaseAsset(check.release, assetName);
    const packageAsset = this.pickDashboardPackageAsset(check.release, asset);
    const binaryDir = path.dirname(this.binaryPath);
    const tempPath = path.join(binaryDir, `${path.basename(this.binaryPath)}.download-${Date.now()}`);
    const backupPath = `${this.binaryPath}.bak`;
    const packagePath = packageAsset
      ? path.join(binaryDir, `${packageAsset.name}.download-${Date.now()}.tar.gz`)
      : '';

    const download = await downloadFile(asset.browserDownloadUrl, tempPath);
    if (!download.bytes) {
      throw new Error('Downloaded asset is empty');
    }

    let packageDownload = null;
    if (packageAsset && packageAsset.browserDownloadUrl) {
      packageDownload = await downloadFile(packageAsset.browserDownloadUrl, packagePath);
      if (!packageDownload.bytes) {
        throw new Error('Downloaded dashboard package asset is empty');
      }
    }

    const worker = this.launchDetachedReplaceWorker({
      targetBinaryPath: this.binaryPath,
      downloadedBinaryPath: tempPath,
      backupPath,
      downloadedPackagePath: packageDownload ? packagePath : '',
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
      packageAsset: packageAsset ? { name: packageAsset.name, size: packageAsset.size } : null,
      packageDownload,
      worker,
    };
  }

  launchDetachedReplaceWorker({ targetBinaryPath, downloadedBinaryPath, backupPath, downloadedPackagePath, originalMode, targetPid }) {
    const scriptPath = path.join(os.tmpdir(), `manga-tracker-updater-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);
    const logPath = path.join(os.tmpdir(), `manga-tracker-updater-${Date.now()}-${Math.random().toString(16).slice(2)}.log`);
    const scriptBody = `#!/usr/bin/env bash
set -euo pipefail
TARGET_BINARY="$1"
NEW_BINARY="$2"
BACKUP_BINARY="$3"
PACKAGE_ARCHIVE="$4"
MODE_OCTAL="$5"
OLD_PID="$6"
SCRIPT_SELF="$7"
SYSTEMD_SERVICE="$8"
LOG_FILE="$9"

touch "$LOG_FILE" 2>/dev/null || true
{
echo "[$(date -Is)] updater worker started"
echo "target=$TARGET_BINARY new=$NEW_BINARY service=$SYSTEMD_SERVICE old_pid=$OLD_PID"

if [[ -f "$TARGET_BINARY" ]]; then
  cp "$TARGET_BINARY" "$BACKUP_BINARY" 2>/dev/null || true
fi

chmod "$MODE_OCTAL" "$NEW_BINARY" 2>/dev/null || chmod +x "$NEW_BINARY"
mv -f "$NEW_BINARY" "$TARGET_BINARY"
chmod "$MODE_OCTAL" "$TARGET_BINARY" 2>/dev/null || chmod +x "$TARGET_BINARY"

if [[ -n "$PACKAGE_ARCHIVE" && -f "$PACKAGE_ARCHIVE" ]]; then
  INSTALL_DIR="$(dirname "$TARGET_BINARY")"
  EXTRACT_DIR="$(mktemp -d "\${TMPDIR:-/tmp}/manga-tracker-assets.XXXXXX")"
  if tar -xzf "$PACKAGE_ARCHIVE" -C "$EXTRACT_DIR"; then
    PACKAGE_ROOT="$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    if [[ -n "$PACKAGE_ROOT" && -d "$PACKAGE_ROOT" ]]; then
      for asset_file in dashboard.html login.html onboarding.html dashboard.css dashboardTabState.js WebsiteLogo.ico; do
        if [[ -f "$PACKAGE_ROOT/$asset_file" ]]; then
          install -m 644 "$PACKAGE_ROOT/$asset_file" "$INSTALL_DIR/$asset_file"
        fi
      done
      echo "[$(date -Is)] dashboard assets refreshed from package archive"
    fi
  else
    echo "[$(date -Is)] failed to extract package archive $PACKAGE_ARCHIVE" >&2
  fi
  rm -rf "$EXTRACT_DIR" 2>/dev/null || true
  rm -f "$PACKAGE_ARCHIVE" 2>/dev/null || true
fi

if [[ -z "$SYSTEMD_SERVICE" ]]; then
  echo "Missing systemd service name for update restart" >&2
  exit 1
fi

RESTART_OK=0
if command -v systemctl >/dev/null 2>&1; then
  if systemctl restart "$SYSTEMD_SERVICE"; then
    RESTART_OK=1
    echo "[$(date -Is)] systemctl restart succeeded"
  else
    echo "[$(date -Is)] systemctl restart failed; falling back to SIGKILL" >&2
  fi
else
  echo "systemctl not found; falling back to SIGKILL" >&2
fi

if [[ "$RESTART_OK" -ne 1 ]]; then
  if kill -0 "$OLD_PID" 2>/dev/null; then
    kill -KILL "$OLD_PID" 2>/dev/null || true
    echo "[$(date -Is)] sent SIGKILL to old process to trigger Restart=on-failure"
  else
    echo "[$(date -Is)] old process already exited before fallback signal"
  fi
fi

rm -f "$SCRIPT_SELF" 2>/dev/null || true
echo "[$(date -Is)] updater worker finished"
} >> "$LOG_FILE" 2>&1
`;

    fs.writeFileSync(scriptPath, scriptBody, { mode: 0o700 });
    const modeOctal = (originalMode & 0o777).toString(8);

    const child = spawn(
      '/bin/bash',
      [
        scriptPath,
        targetBinaryPath,
        downloadedBinaryPath,
        backupPath,
        downloadedPackagePath || '',
        modeOctal,
        String(targetPid),
        scriptPath,
        this.systemdService,
        logPath,
      ],
      {
        detached: true,
        stdio: 'ignore',
      }
    );
    child.unref();

    return {
      pid: child.pid,
      scriptPath,
      logPath,
      modeOctal,
    };
  }
}

module.exports = {
  GitHubReleaseUpdater,
  compareVersions,
};
