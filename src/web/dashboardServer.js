const http = require('http');
const { URL } = require('url');

const {
  DASHBOARD_HOST,
  DASHBOARD_PORT,
  DASHBOARD_ADMIN_TOKEN,
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

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isAuthorized(req) {
  if (!DASHBOARD_ADMIN_TOKEN) return true;

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  const headerToken = (req.headers['x-admin-token'] || '').trim();
  return bearerToken === DASHBOARD_ADMIN_TOKEN || headerToken === DASHBOARD_ADMIN_TOKEN;
}

function getDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Manga Tracker Dashboard</title>
<style>
:root {
  --bg: #0f1b26;
  --panel: #132636;
  --panel-alt: #1b3348;
  --text: #e8f0f7;
  --muted: #9bb0c3;
  --accent: #46b3ff;
  --danger: #ff6e6e;
  --ok: #53d389;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  background: radial-gradient(circle at top left, #1a2f45 0%, var(--bg) 50%);
  color: var(--text);
}
header {
  padding: 20px;
  border-bottom: 1px solid #2a4258;
}
main {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 16px;
  padding: 16px;
}
.panel {
  background: linear-gradient(180deg, var(--panel) 0%, var(--panel-alt) 100%);
  border: 1px solid #2d455d;
  border-radius: 12px;
  padding: 14px;
}
h1, h2, h3 { margin: 0 0 10px; }
input, select, button {
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid #38546f;
  background: #102536;
  color: var(--text);
  margin-bottom: 8px;
}
button { cursor: pointer; background: #1d425f; }
button:hover { background: #26587d; }
.row { display: flex; gap: 8px; }
.row > * { flex: 1; }
.list {
  max-height: 65vh;
  overflow: auto;
  border: 1px solid #355069;
  border-radius: 8px;
}
.user-item {
  padding: 10px;
  border-bottom: 1px solid #2c4357;
  cursor: pointer;
}
.user-item:hover { background: #1f3a52; }
.user-item.active { background: #275174; }
small, .muted { color: var(--muted); }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: #2a506f;
}
.tracked-row {
  border: 1px solid #355069;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
}
.danger { background: #642d2d; border-color: #8c4343; }
.status.ok { color: var(--ok); }
.status.err { color: var(--danger); }
@media (max-width: 980px) {
  main { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<header>
  <h1>Manga Tracker Dashboard</h1>
  <div class="row">
    <input id="adminToken" type="password" placeholder="Dashboard admin token (if enabled)" />
    <button id="saveToken">Save Token</button>
  </div>
  <small>API auth uses header <code>x-admin-token</code>. Leave blank if token auth is disabled.</small>
</header>
<main>
  <section class="panel">
    <h2>Users</h2>
    <button id="refreshUsers">Refresh Users</button>
    <div id="users" class="list"></div>
  </section>
  <section class="panel">
    <h2 id="selectedUserTitle">Select a user</h2>
    <div id="userMeta" class="muted"></div>
    <h3>Settings</h3>
    <label>Preferred Source</label>
    <select id="preferredSource"></select>
    <label>Auto-check Interval (hours)</label>
    <input id="autoHours" type="number" min="${MIN_AUTO_CHECK_HOURS}" max="${MAX_AUTO_CHECK_HOURS}" />
    <button id="saveSettings">Save Settings</button>
    <h3>Tracked Manga</h3>
    <div class="row">
      <input id="addInput" placeholder="Manga URL, ID, or title" />
      <select id="addSourceHint"></select>
    </div>
    <button id="addTracked">Add Manga</button>
    <div id="trackedList"></div>
    <div id="statusLine" class="status"></div>
  </section>
</main>
<script>
const state = {
  users: [],
  sources: null,
  selectedUserId: null,
  selectedUserData: null,
};

const adminTokenInput = document.getElementById('adminToken');
adminTokenInput.value = localStorage.getItem('dashboardAdminToken') || '';

document.getElementById('saveToken').addEventListener('click', () => {
  localStorage.setItem('dashboardAdminToken', adminTokenInput.value.trim());
  setStatus('Token saved locally.', true);
});

function authHeaders() {
  const token = (localStorage.getItem('dashboardAdminToken') || '').trim();
  return token ? { 'x-admin-token': token } : {};
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}), ...authHeaders() };
  const response = await fetch(path, { ...options, headers });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const errorPayload = await response.json();
      message = errorPayload.error || message;
    } catch {}
    throw new Error(message);
  }

  return response.json();
}

function setStatus(message, ok = true) {
  const el = document.getElementById('statusLine');
  el.textContent = message;
  el.className = ok ? 'status ok' : 'status err';
}

function renderUsers() {
  const container = document.getElementById('users');
  container.innerHTML = '';

  if (!state.users.length) {
    container.innerHTML = '<div class="user-item">No users found.</div>';
    return;
  }

  for (const user of state.users) {
    const row = document.createElement('div');
    row.className = 'user-item' + (state.selectedUserId === user.userId ? ' active' : '');
    row.innerHTML = '<div><strong>' + user.userId + '</strong> <span class="badge">' + user.trackedCount + ' tracked</span></div>' +
      '<small>' + user.preferredSource + ' • every ' + user.autoCheckIntervalHours + 'h</small>';
    row.addEventListener('click', () => selectUser(user.userId));
    container.appendChild(row);
  }
}

function populateSourceOptions() {
  const preferred = document.getElementById('preferredSource');
  const addHint = document.getElementById('addSourceHint');
  preferred.innerHTML = '';
  addHint.innerHTML = '<option value="">Use preferred source</option>';

  for (const source of state.sources.sources) {
    const option = document.createElement('option');
    option.value = source.key;
    option.textContent = source.displayName + ' (' + source.key + ')';
    preferred.appendChild(option);

    const hint = option.cloneNode(true);
    addHint.appendChild(hint);
  }
}

function renderTracked() {
  const trackedList = document.getElementById('trackedList');
  trackedList.innerHTML = '';

  if (!state.selectedUserData || !state.selectedUserData.tracked.length) {
    trackedList.innerHTML = '<p class="muted">No tracked manga for this user.</p>';
    return;
  }

  for (const entry of state.selectedUserData.tracked) {
    const card = document.createElement('div');
    card.className = 'tracked-row';
    card.innerHTML =
      '<div><strong>' + (entry.title || entry.mangaId) + '</strong></div>' +
      '<small>' + entry.source + ' • ' + entry.mangaId + '</small>';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      try {
        await api('/api/users/' + state.selectedUserId + '/tracked?source=' + encodeURIComponent(entry.source) + '&mangaId=' + encodeURIComponent(entry.mangaId), {
          method: 'DELETE',
        });
        setStatus('Removed tracked manga.', true);
        await selectUser(state.selectedUserId);
        await refreshUsers();
      } catch (error) {
        setStatus(error.message, false);
      }
    });

    card.appendChild(removeBtn);
    trackedList.appendChild(card);
  }
}

async function refreshUsers() {
  const payload = await api('/api/users');
  state.users = payload.users;
  renderUsers();
}

async function selectUser(userId) {
  state.selectedUserId = userId;
  const payload = await api('/api/users/' + userId);
  state.selectedUserData = payload.user;

  document.getElementById('selectedUserTitle').textContent = 'User ' + userId;
  document.getElementById('userMeta').textContent = 'Tracked: ' + payload.user.tracked.length + ' • Last auto-check: ' + (payload.user.lastAutoCheckAt || 'never');
  document.getElementById('preferredSource').value = payload.user.preferredSource;
  document.getElementById('autoHours').value = payload.user.autoCheckIntervalHours;
  renderUsers();
  renderTracked();
}

async function saveSettings() {
  if (!state.selectedUserId) {
    setStatus('Select a user first.', false);
    return;
  }

  try {
    await api('/api/users/' + state.selectedUserId + '/settings', {
      method: 'PUT',
      body: JSON.stringify({
        preferredSource: document.getElementById('preferredSource').value,
        autoCheckIntervalHours: Number(document.getElementById('autoHours').value),
      }),
    });
    setStatus('Settings updated.', true);
    await selectUser(state.selectedUserId);
    await refreshUsers();
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function addTracked() {
  if (!state.selectedUserId) {
    setStatus('Select a user first.', false);
    return;
  }

  const input = document.getElementById('addInput').value.trim();
  if (!input) {
    setStatus('Provide manga input.', false);
    return;
  }

  try {
    const payload = await api('/api/users/' + state.selectedUserId + '/tracked', {
      method: 'POST',
      body: JSON.stringify({
        input,
        sourceHint: document.getElementById('addSourceHint').value || null,
      }),
    });

    setStatus(payload.message || 'Tracked manga updated.', true);
    document.getElementById('addInput').value = '';
    await selectUser(state.selectedUserId);
    await refreshUsers();
  } catch (error) {
    setStatus(error.message, false);
  }
}

document.getElementById('refreshUsers').addEventListener('click', async () => {
  try {
    await refreshUsers();
    setStatus('User list refreshed.', true);
  } catch (error) {
    setStatus(error.message, false);
  }
});

document.getElementById('saveSettings').addEventListener('click', saveSettings);
document.getElementById('addTracked').addEventListener('click', addTracked);

(async () => {
  try {
    state.sources = await api('/api/sources');
    populateSourceOptions();
    await refreshUsers();
    setStatus('Dashboard ready.', true);
  } catch (error) {
    setStatus(error.message, false);
  }
})();
</script>
</body>
</html>`;
}

function startDashboardServer({ service }) {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${DASHBOARD_HOST}:${DASHBOARD_PORT}`}`);
    const pathName = requestUrl.pathname;

    if (req.method === 'GET' && pathName === '/') {
      sendHtml(res, getDashboardHtml());
      return;
    }

    if (req.method === 'GET' && pathName === '/status') {
      sendJson(res, 200, { status: 'ok', service: 'dashboard' });
      return;
    }

    if (pathName.startsWith('/api/')) {
      if (!isAuthorized(req)) {
        sendJson(res, 401, { error: 'Unauthorized. Set DASHBOARD_ADMIN_TOKEN and provide x-admin-token.' });
        return;
      }

      try {
        if (req.method === 'GET' && pathName === '/api/sources') {
          sendJson(res, 200, service.getSources());
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
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  });

  server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
    console.log(`Dashboard running at http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`);
    if (!DASHBOARD_ADMIN_TOKEN) {
      console.warn('Dashboard auth is disabled (DASHBOARD_ADMIN_TOKEN not set).');
    }
  });

  return server;
}

module.exports = {
  startDashboardServer,
};
