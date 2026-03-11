const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

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
    githubToken = process.env.GITHUB_TOKEN || '',
  }) {
    this.repoUrl = repoUrl;
    this.repoSlug = parseRepoSlug(repoUrl);
    this.currentVersion = currentVersion;
    this.binaryPath = path.resolve(binaryPath);
    this.assetName = assetName.trim();
    this.githubToken = githubToken.trim();
  }

  getHeaders() {
    if (!this.githubToken) return {};
    return { Authorization: `Bearer ${this.githubToken}` };
  }

  getState() {
    return {
      repoSlug: this.repoSlug,
      currentVersion: this.currentVersion,
      binaryPath: this.binaryPath,
      runningAsBinary: path.basename(this.binaryPath).toLowerCase() !== 'node',
    };
  }

  async fetchLatestRelease() {
    if (!this.repoSlug) {
      throw new Error('Invalid GitHub repo URL/slug configuration');
    }

    const url = `https://api.github.com/repos/${this.repoSlug}/releases/latest`;
    const release = await httpRequestJson(url, this.getHeaders());

    return {
      tagName: release.tag_name,
      name: release.name,
      htmlUrl: release.html_url,
      publishedAt: release.published_at,
      body: release.body || '',
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

  async checkForUpdate() {
    const release = await this.fetchLatestRelease();
    const latestVersion = normalizeVersion(release.tagName);
    const currentVersion = normalizeVersion(this.currentVersion);

    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      release,
      updaterState: this.getState(),
    };
  }

  async applyUpdate({ assetName = '' } = {}) {
    const stats = fs.statSync(this.binaryPath);
    if (!stats.isFile()) {
      throw new Error(`Binary path is not a file: ${this.binaryPath}`);
    }

    fs.accessSync(this.binaryPath, fs.constants.W_OK);

    const check = await this.checkForUpdate();
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

    const download = await downloadFile(asset.browserDownloadUrl, tempPath, this.getHeaders());
    if (!download.bytes) {
      throw new Error('Downloaded asset is empty');
    }

    fs.copyFileSync(this.binaryPath, backupPath);
    fs.chmodSync(tempPath, stats.mode);
    fs.renameSync(tempPath, this.binaryPath);

    return {
      applied: true,
      updateAvailable: true,
      release: check.release,
      fromVersion: check.currentVersion,
      toVersion: check.latestVersion,
      asset: {
        name: asset.name,
        size: asset.size,
      },
      backupPath,
      download,
    };
  }
}

module.exports = {
  GitHubReleaseUpdater,
};
