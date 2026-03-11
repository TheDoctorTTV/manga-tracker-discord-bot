const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const {
  BOT_VERSION,
  BOT_CREATOR,
  BOT_GITHUB_REPO,
  DASHBOARD_HOST,
  DASHBOARD_PORT,
  MIN_AUTO_CHECK_HOURS,
  MAX_AUTO_CHECK_HOURS,
} = require('../config');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendCss(res, css) {
  res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
  res.end(css);
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const DASHBOARD_HTML_PATH = path.join(__dirname, 'dashboard.html');
const DASHBOARD_CSS_PATH = path.join(__dirname, 'dashboard.css');

let dashboardHtmlTemplate = null;
let dashboardCss = null;

function loadDashboardAssets() {
  if (dashboardHtmlTemplate === null) {
    dashboardHtmlTemplate = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');
  }

  if (dashboardCss === null) {
    dashboardCss = fs.readFileSync(DASHBOARD_CSS_PATH, 'utf8');
  }
}

function getDashboardHtml() {
  loadDashboardAssets();
  return dashboardHtmlTemplate
    .replace(/\$\{MIN_AUTO_CHECK_HOURS\}/g, String(MIN_AUTO_CHECK_HOURS))
    .replace(/\$\{MAX_AUTO_CHECK_HOURS\}/g, String(MAX_AUTO_CHECK_HOURS));
}

function getDashboardCss() {
  loadDashboardAssets();
  return dashboardCss;
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function startDashboardServer({ service, updater }) {
  const updaterState = {
    checking: false,
    applying: false,
    lastCheck: null,
    lastApply: null,
    lastError: null,
    availableReleases: [],
    releaseMode: 'release',
  };

  function getUpdaterStatus() {
    return {
      ...updaterState,
      updaterState: updater ? updater.getState() : null,
    };
  }

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${DASHBOARD_HOST}:${DASHBOARD_PORT}`}`);
    const pathName = requestUrl.pathname;

    if (req.method === 'GET' && pathName === '/') {
      sendHtml(res, getDashboardHtml());
      return;
    }

    if (req.method === 'GET' && pathName === '/dashboard.css') {
      sendCss(res, getDashboardCss());
      return;
    }

    if (req.method === 'GET' && pathName === '/status') {
      sendJson(res, 200, { status: 'ok', service: 'admin-dashboard' });
      return;
    }

    if (!pathName.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    try {
      if (req.method === 'GET' && pathName === '/api/admin/home') {
        const summary = service.getAdminSummary();
        const memoryRssMb = Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
        sendJson(res, 200, {
          botStatus: 'running',
          users: summary.users,
          totalTracked: summary.totalTracked,
          sources: summary.sources,
          enabledSources: summary.enabledSources,
          defaultSource: summary.defaultSource,
          pid: process.pid,
          uptimeHuman: formatUptime(process.uptime()),
          memoryRssMb,
        });
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/about') {
        sendJson(res, 200, {
          creator: BOT_CREATOR,
          version: BOT_VERSION,
          repo: BOT_GITHUB_REPO,
          updateSystem: 'Built-in updater uses the public GitHub Releases feed and a detached worker process to replace/restart the bot binary.',
        });
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/updater/status') {
        sendJson(res, 200, getUpdaterStatus());
        return;
      }

      if (req.method === 'POST' && pathName === '/api/admin/updater/check') {
        if (!updater) {
          sendJson(res, 400, { error: 'Updater is not configured' });
          return;
        }
        if (updaterState.checking) {
          sendJson(res, 409, { error: 'Updater check already in progress' });
          return;
        }

        const body = await getRequestBody(req);
        const releaseModeRaw = typeof body.releaseMode === 'string' ? body.releaseMode.trim().toLowerCase() : '';
        const releaseMode = releaseModeRaw === 'prerelease' ? 'prerelease' : 'release';
        const tagName = typeof body.tagName === 'string' ? body.tagName.trim() : '';

        updaterState.checking = true;
        updaterState.lastError = null;
        updaterState.releaseMode = releaseMode;
        try {
          updaterState.lastCheck = await updater.checkForUpdate({ releaseMode, tagName });
          updaterState.availableReleases = Array.isArray(updaterState.lastCheck.releases) ? updaterState.lastCheck.releases : [];
        } catch (error) {
          updaterState.lastError = error.message;
          throw error;
        } finally {
          updaterState.checking = false;
        }

        sendJson(res, 200, getUpdaterStatus());
        return;
      }

      if (req.method === 'POST' && pathName === '/api/admin/updater/apply') {
        if (!updater) {
          sendJson(res, 400, { error: 'Updater is not configured' });
          return;
        }
        if (updaterState.applying) {
          sendJson(res, 409, { error: 'Updater apply already in progress' });
          return;
        }

        const body = await getRequestBody(req);
        const assetName = typeof body.assetName === 'string' ? body.assetName.trim() : '';
        const releaseModeRaw = typeof body.releaseMode === 'string' ? body.releaseMode.trim().toLowerCase() : '';
        const releaseMode = releaseModeRaw === 'prerelease' ? 'prerelease' : 'release';
        const tagName = typeof body.tagName === 'string' ? body.tagName.trim() : '';

        updaterState.applying = true;
        updaterState.lastError = null;
        updaterState.releaseMode = releaseMode;
        try {
          updaterState.lastApply = await updater.applyUpdate({ assetName, releaseMode, tagName });
          updaterState.lastCheck = {
            currentVersion: updaterState.lastApply.fromVersion,
            latestVersion: updaterState.lastApply.toVersion,
            updateAvailable: true,
            release: updaterState.lastApply.release,
          };
          updaterState.availableReleases = Array.isArray(updaterState.lastApply.releases)
            ? updaterState.lastApply.releases
            : updaterState.availableReleases;
        } catch (error) {
          updaterState.lastError = error.message;
          throw error;
        } finally {
          updaterState.applying = false;
        }

        sendJson(res, 200, getUpdaterStatus());
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/sources') {
        sendJson(res, 200, service.getSources());
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/source-adapters') {
        sendJson(res, 200, { adapters: service.getSourceAdapterCatalog() });
        return;
      }

      if (req.method === 'PUT' && pathName === '/api/admin/sources') {
        const body = await getRequestBody(req);
        sendJson(res, 200, service.saveSourcesConfig(body));
        return;
      }

      if (req.method === 'GET' && pathName === '/api/users') {
        sendJson(res, 200, { users: service.listUsers() });
        return;
      }

      const userMatch = pathName.match(/^\/api\/users\/(\d+)$/);
      if (req.method === 'GET' && userMatch) {
        const userId = userMatch[1];
        sendJson(res, 200, { user: service.getUserData(userId) });
        return;
      }

      if (req.method === 'DELETE' && userMatch) {
        const userId = userMatch[1];
        const deleted = service.deleteUser(userId);
        if (!deleted) {
          sendJson(res, 404, { error: 'User not found' });
          return;
        }
        sendJson(res, 200, { deleted: true });
        return;
      }

      const settingsMatch = pathName.match(/^\/api\/users\/(\d+)\/settings$/);
      if (req.method === 'PUT' && settingsMatch) {
        const userId = settingsMatch[1];
        const body = await getRequestBody(req);
        const updated = service.setUserSettings(userId, {
          preferredSource: body.preferredSource,
          autoCheckIntervalHours: body.autoCheckIntervalHours,
        });
        sendJson(res, 200, { user: updated });
        return;
      }

      const trackedMatch = pathName.match(/^\/api\/users\/(\d+)\/tracked$/);
      if (req.method === 'POST' && trackedMatch) {
        const userId = trackedMatch[1];
        const body = await getRequestBody(req);
        const result = await service.addTrackedByInput(userId, body.input, body.sourceHint);

        if (result.status === 'already_tracked') {
          sendJson(res, 200, { status: result.status, message: 'This manga is already tracked.' });
          return;
        }

        if (result.status === 'not_found') {
          sendJson(res, 404, { error: 'Could not resolve manga from input.' });
          return;
        }

        sendJson(res, 200, {
          status: result.status,
          message: `Now tracking ${result.title} (${result.source}).`,
        });
        return;
      }

      if (req.method === 'DELETE' && trackedMatch) {
        const userId = trackedMatch[1];
        const source = (requestUrl.searchParams.get('source') || '').trim().toLowerCase();
        const mangaId = (requestUrl.searchParams.get('mangaId') || '').trim();

        if (!source || !mangaId) {
          sendJson(res, 400, { error: 'source and mangaId query params are required.' });
          return;
        }

        const removed = service.removeTrackedByTarget(userId, { source, mangaId });
        if (!removed) {
          sendJson(res, 404, { error: 'Tracked manga entry not found.' });
          return;
        }

        sendJson(res, 200, { removed });
        return;
      }

      sendJson(res, 404, { error: 'Route not found' });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Request failed' });
    }
  });

  server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
    console.log(`Admin dashboard running at http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`);
    console.warn('Dashboard auth is intentionally disabled for now. Restrict network exposure at the host/firewall level.');
  });

  return server;
}

module.exports = {
  startDashboardServer,
};
