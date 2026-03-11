const http = require('http');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

const {
  BOT_VERSION,
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

function getDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Manga Tracker Admin Dashboard</title>
<style>
:root {
  --bg: #0e1923;
  --panel: #122433;
  --panel-alt: #193549;
  --text: #e6edf4;
  --muted: #9eb0c1;
  --accent: #4ab8ff;
  --danger: #e67e7e;
  --ok: #65d99a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  background: radial-gradient(circle at top left, #1b3145 0%, var(--bg) 55%);
  color: var(--text);
}
header {
  padding: 18px 20px;
  border-bottom: 1px solid #2b4257;
}
main {
  display: grid;
  grid-template-columns: 320px 1fr 1fr;
  gap: 14px;
  padding: 14px;
}
.panel {
  background: linear-gradient(180deg, var(--panel) 0%, var(--panel-alt) 100%);
  border: 1px solid #2c4760;
  border-radius: 12px;
  padding: 12px;
}
h1, h2, h3 { margin: 0 0 8px; }
small, .muted { color: var(--muted); }
input, select, button, textarea {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #395776;
  background: #102738;
  color: var(--text);
  padding: 8px;
  margin-bottom: 8px;
}
button { cursor: pointer; background: #1f4768; }
button:hover { background: #285c86; }
button.warn { background: #6a3434; border-color: #8d4a4a; }
button.warn:hover { background: #834242; }
.row { display: flex; gap: 8px; }
.row > * { flex: 1; }
.list { max-height: 70vh; overflow: auto; border: 1px solid #36536e; border-radius: 8px; }
.user-item { padding: 10px; border-bottom: 1px solid #2c4358; cursor: pointer; }
.user-item:hover { background: #1f3b52; }
.user-item.active { background: #295678; }
.badge { background: #2a4f6f; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.tracked-row { border: 1px solid #355069; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
code, pre { background: #0d1e2c; border: 1px solid #28425a; border-radius: 8px; }
pre { padding: 8px; max-height: 230px; overflow: auto; white-space: pre-wrap; }
.status.ok { color: var(--ok); }
.status.err { color: var(--danger); }
@media (max-width: 1260px) { main { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Manga Tracker Admin Dashboard</h1>
  <small>Admin-only controls. Discord users continue using slash commands.</small>
</header>
<main>
  <section class="panel">
    <h2>Users</h2>
    <button id="refreshUsers">Refresh</button>
    <div id="users" class="list"></div>
  </section>

  <section class="panel">
    <h2 id="selectedUserTitle">Select a user</h2>
    <div id="userMeta" class="muted"></div>

    <h3>User Settings</h3>
    <label>Preferred Source</label>
    <select id="preferredSource"></select>
    <label>Auto-check Interval (hours)</label>
    <input id="autoHours" type="number" min="${MIN_AUTO_CHECK_HOURS}" max="${MAX_AUTO_CHECK_HOURS}" />
    <div class="row">
      <button id="saveSettings">Save Settings</button>
      <button id="deleteUser" class="warn">Delete User</button>
    </div>

    <h3>Tracked Manga</h3>
    <div class="row">
      <input id="addInput" placeholder="Manga URL, ID, or title" />
      <select id="addSourceHint"></select>
    </div>
    <button id="addTracked">Add Manga</button>
    <div id="trackedList"></div>
    <div id="statusLine" class="status"></div>
  </section>

  <section class="panel">
    <h2>Admin Controls</h2>

    <h3>Summary</h3>
    <div id="summary" class="muted">Loading...</div>

    <h3>Sources Config</h3>
    <small>Edit JSON and save. This updates <code>manga-sources.json</code> immediately.</small>
    <textarea id="sourcesConfig" rows="12" spellcheck="false"></textarea>
    <div class="row">
      <button id="reloadSources">Reload File</button>
      <button id="saveSources">Save Sources</button>
    </div>

    <h3>Maintenance</h3>
    <input id="updateRef" placeholder="Optional ref (branch/tag), blank = current" />
    <button id="runUpdate">Run scripts/update.sh</button>
    <small id="updateMeta" class="muted">No update task started yet.</small>
    <pre id="updateLog"></pre>
  </section>
</main>
<script>
const state = {
  users: [],
  sources: null,
  selectedUserId: null,
  selectedUserData: null,
};

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload.error || message;
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
    row.innerHTML =
      '<div><strong>' + user.userId + '</strong> <span class="badge">' + user.trackedCount + ' tracked</span></div>' +
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

    const option2 = option.cloneNode(true);
    addHint.appendChild(option2);
  }

  document.getElementById('sourcesConfig').value = JSON.stringify(state.sources, null, 2);
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
    removeBtn.className = 'warn';
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

async function refreshSummary() {
  const payload = await api('/api/admin/summary');
  const s = payload.summary;
  document.getElementById('summary').textContent =
    'Version ' + payload.version + ' • Users: ' + s.users + ' • Tracked: ' + s.totalTracked + ' • Sources: ' + s.sources + ' • Default: ' + s.defaultSource;
}

async function refreshUsers() {
  const payload = await api('/api/users');
  state.users = payload.users;
  renderUsers();
}

async function refreshSources() {
  state.sources = await api('/api/admin/sources');
  populateSourceOptions();
}

async function selectUser(userId) {
  state.selectedUserId = userId;
  const payload = await api('/api/users/' + userId);
  state.selectedUserData = payload.user;

  document.getElementById('selectedUserTitle').textContent = 'User ' + userId;
  document.getElementById('userMeta').textContent =
    'Tracked: ' + payload.user.tracked.length + ' • Last auto-check: ' + (payload.user.lastAutoCheckAt || 'never');
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

async function deleteUser() {
  if (!state.selectedUserId) {
    setStatus('Select a user first.', false);
    return;
  }

  const confirmed = window.confirm('Delete user ' + state.selectedUserId + ' and all tracked data?');
  if (!confirmed) return;

  try {
    await api('/api/users/' + state.selectedUserId, { method: 'DELETE' });
    setStatus('User deleted.', true);
    state.selectedUserId = null;
    state.selectedUserData = null;
    document.getElementById('selectedUserTitle').textContent = 'Select a user';
    document.getElementById('userMeta').textContent = '';
    document.getElementById('trackedList').innerHTML = '';
    await refreshUsers();
    await refreshSummary();
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
    await refreshSummary();
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function saveSources() {
  try {
    const payload = JSON.parse(document.getElementById('sourcesConfig').value);
    const updated = await api('/api/admin/sources', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    state.sources = updated;
    populateSourceOptions();
    setStatus('Sources config saved and reloaded.', true);
    await refreshSummary();
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function reloadSources() {
  try {
    state.sources = await api('/api/admin/sources/reload', { method: 'POST' });
    populateSourceOptions();
    setStatus('Sources reloaded from file.', true);
    await refreshSummary();
  } catch (error) {
    setStatus(error.message, false);
  }
}

function renderUpdateTask(task) {
  const meta = document.getElementById('updateMeta');
  const log = document.getElementById('updateLog');

  if (!task) {
    meta.textContent = 'No update task started yet.';
    log.textContent = '';
    return;
  }

  const status = task.running ? 'running' : (task.exitCode === 0 ? 'success' : 'failed');
  meta.textContent =
    'Task ' + task.id + ' • ' + status + ' • started ' + task.startedAt + (task.finishedAt ? ' • finished ' + task.finishedAt : '');
  log.textContent = (task.output || []).join('');
}

async function refreshUpdateTask() {
  try {
    const payload = await api('/api/admin/update');
    renderUpdateTask(payload.task);
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function runUpdate() {
  const ref = document.getElementById('updateRef').value.trim();
  try {
    const payload = await api('/api/admin/update', {
      method: 'POST',
      body: JSON.stringify({ ref: ref || null }),
    });
    renderUpdateTask(payload.task);
    setStatus('Update script started.', true);
  } catch (error) {
    setStatus(error.message, false);
  }
}

document.getElementById('refreshUsers').addEventListener('click', async () => {
  try {
    await refreshUsers();
    await refreshSummary();
    setStatus('User list refreshed.', true);
  } catch (error) {
    setStatus(error.message, false);
  }
});

document.getElementById('saveSettings').addEventListener('click', saveSettings);
document.getElementById('deleteUser').addEventListener('click', deleteUser);
document.getElementById('addTracked').addEventListener('click', addTracked);
document.getElementById('saveSources').addEventListener('click', saveSources);
document.getElementById('reloadSources').addEventListener('click', reloadSources);
document.getElementById('runUpdate').addEventListener('click', runUpdate);

setInterval(refreshUpdateTask, 3000);

(async () => {
  try {
    await Promise.all([refreshSources(), refreshUsers(), refreshSummary(), refreshUpdateTask()]);
    setStatus('Admin dashboard ready.', true);
  } catch (error) {
    setStatus(error.message, false);
  }
})();
</script>
</body>
</html>`;
}

function startDashboardServer({ service }) {
  let activeUpdateTask = null;
  let updateCounter = 0;

  const rootDir = process.cwd();
  const updateScriptPath = path.join(rootDir, 'scripts', 'update.sh');

  function appendTaskOutput(task, chunk) {
    const text = String(chunk || '');
    if (!text) return;
    task.output.push(text);
    if (task.output.length > 400) {
      task.output = task.output.slice(task.output.length - 400);
    }
  }

  function runUpdateTask(ref) {
    if (activeUpdateTask && activeUpdateTask.running) {
      throw new Error('An update task is already running');
    }

    updateCounter += 1;
    const task = {
      id: updateCounter,
      ref: ref || null,
      running: true,
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      output: [],
    };

    const args = [];
    if (ref) args.push(ref);

    const child = spawn(updateScriptPath, args, {
      cwd: rootDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => appendTaskOutput(task, chunk));
    child.stderr.on('data', (chunk) => appendTaskOutput(task, chunk));

    child.on('error', (error) => {
      appendTaskOutput(task, `\n[error] ${error.message}\n`);
      task.running = false;
      task.exitCode = -1;
      task.finishedAt = new Date().toISOString();
    });

    child.on('close', (code) => {
      task.running = false;
      task.exitCode = Number.isInteger(code) ? code : -1;
      task.finishedAt = new Date().toISOString();
    });

    activeUpdateTask = task;
    return task;
  }

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${DASHBOARD_HOST}:${DASHBOARD_PORT}`}`);
    const pathName = requestUrl.pathname;

    if (req.method === 'GET' && pathName === '/') {
      sendHtml(res, getDashboardHtml());
      return;
    }

    if (req.method === 'GET' && pathName === '/status') {
      sendJson(res, 200, { status: 'ok', service: 'admin-dashboard' });
      return;
    }

    if (pathName.startsWith('/api/')) {
      try {
        if (req.method === 'GET' && pathName === '/api/admin/summary') {
          sendJson(res, 200, { version: BOT_VERSION, summary: service.getAdminSummary() });
          return;
        }

        if (req.method === 'GET' && pathName === '/api/admin/sources') {
          sendJson(res, 200, service.getSources());
          return;
        }

        if (req.method === 'PUT' && pathName === '/api/admin/sources') {
          const body = await getRequestBody(req);
          sendJson(res, 200, service.saveSourcesConfig(body));
          return;
        }

        if (req.method === 'POST' && pathName === '/api/admin/sources/reload') {
          sendJson(res, 200, service.reloadSourcesConfig());
          return;
        }

        if (req.method === 'GET' && pathName === '/api/admin/update') {
          sendJson(res, 200, { task: activeUpdateTask });
          return;
        }

        if (req.method === 'POST' && pathName === '/api/admin/update') {
          const body = await getRequestBody(req);
          const ref = typeof body.ref === 'string' ? body.ref.trim() : '';
          sendJson(res, 202, { task: runUpdateTask(ref || null) });
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
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
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
