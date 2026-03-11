const http = require('http');
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
  padding: 16px 20px;
  border-bottom: 1px solid #2b4257;
}
h1, h2, h3 { margin: 0 0 8px; }
small, .muted { color: var(--muted); }
main { padding: 14px; }
.tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.tab-btn {
  width: auto;
  min-width: 100px;
  border-radius: 10px;
  border: 1px solid #3d607f;
  background: #14334a;
  color: var(--text);
  padding: 8px 12px;
  cursor: pointer;
}
.tab-btn.active { background: #1d5c85; border-color: #5ca4d6; }
.panel {
  background: linear-gradient(180deg, var(--panel) 0%, var(--panel-alt) 100%);
  border: 1px solid #2c4760;
  border-radius: 12px;
  padding: 12px;
}
.grid { display: grid; gap: 10px; }
.grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.card {
  background: #112738;
  border: 1px solid #32546f;
  border-radius: 10px;
  padding: 10px;
}
.value { font-size: 24px; font-weight: 700; color: var(--accent); }
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
button.success { background: #245b41; border-color: #347a58; }
button.success:hover { background: #2f7655; }
.row { display: flex; gap: 8px; }
.row > * { flex: 1; }
.user-layout { display: grid; grid-template-columns: 320px 1fr; gap: 12px; }
.list { max-height: 62vh; overflow: auto; border: 1px solid #36536e; border-radius: 8px; }
.user-item { padding: 10px; border-bottom: 1px solid #2c4358; cursor: pointer; }
.user-item:hover { background: #1f3b52; }
.user-item.active { background: #295678; }
.badge { background: #2a4f6f; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.tracked-row, .source-row { border: 1px solid #355069; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
.hidden { display: none; }
.status.ok { color: var(--ok); }
.status.err { color: var(--danger); }
pre {
  margin: 0;
  background: #0d1e2c;
  border: 1px solid #28425a;
  border-radius: 8px;
  padding: 10px;
  white-space: pre-wrap;
}
@media (max-width: 1100px) {
  .grid.two, .user-layout { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<header>
  <h1>Manga Tracker Admin Dashboard</h1>
  <small>Admin-only management surface. End users still use Discord slash commands.</small>
</header>
<main>
  <div class="tabs">
    <button class="tab-btn active" data-tab="home">Home</button>
    <button class="tab-btn" data-tab="users">Users</button>
    <button class="tab-btn" data-tab="settings">Settings</button>
    <button class="tab-btn" data-tab="about">About</button>
  </div>

  <section id="tab-home" class="panel tab-panel">
    <h2>Home</h2>
    <div class="grid two" id="homeCards"></div>
    <div id="homeMeta" class="muted"></div>
  </section>

  <section id="tab-users" class="panel tab-panel hidden">
    <h2>Users</h2>
    <div class="user-layout">
      <div>
        <input id="userSearch" placeholder="Search by user id" />
        <button id="refreshUsers">Refresh</button>
        <div id="users" class="list"></div>
      </div>
      <div>
        <h3 id="selectedUserTitle">Select a user</h3>
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
      </div>
    </div>
  </section>

  <section id="tab-settings" class="panel tab-panel hidden">
    <h2>Settings</h2>
    <h3>Sources</h3>
    <small>Add or remove sources used by the bot.</small>

    <div class="source-row">
      <label>Default Source</label>
      <select id="defaultSource"></select>
    </div>

    <div id="sourcesList"></div>
    <button id="addSource">Add Source</button>
    <button id="saveSources">Save Sources</button>
  </section>

  <section id="tab-about" class="panel tab-panel hidden">
    <h2>About</h2>
    <div class="grid">
      <div class="card"><strong>Creator</strong><div id="aboutCreator"></div></div>
      <div class="card"><strong>Version</strong><div id="aboutVersion"></div></div>
      <div class="card"><strong>GitHub Repo</strong><div id="aboutRepo"></div></div>
      <div class="card"><strong>Update System</strong><div id="aboutUpdater"></div></div>
    </div>

    <h3 style="margin-top:12px;">Updater</h3>
    <small>Checks GitHub Releases and applies binary updates in-place.</small>
    <div class="row">
      <button id="checkUpdate">Check For Updates</button>
      <button id="applyUpdate" class="success">Apply Latest Update</button>
    </div>
    <input id="assetName" placeholder="Optional asset name override (leave blank for auto)" />
    <pre id="updaterOutput">No updater action yet.</pre>
  </section>

  <div id="statusLine" class="status"></div>
</main>

<script>
const state = {
  home: null,
  users: [],
  sources: null,
  selectedUserId: null,
  selectedUserData: null,
  sourceDraft: null,
  userSearch: '',
  about: null,
  updater: null,
};

function setStatus(message, ok = true) {
  const el = document.getElementById('statusLine');
  el.textContent = message;
  el.className = ok ? 'status ok' : 'status err';
}

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

function switchTab(tabKey) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));
  document.getElementById('tab-' + tabKey).classList.remove('hidden');
}

function renderHome() {
  const container = document.getElementById('homeCards');
  container.innerHTML = '';
  if (!state.home) {
    container.innerHTML = '<div class="card">No data</div>';
    return;
  }

  const cards = [
    ['Bot Status', state.home.botStatus],
    ['Users', String(state.home.users)],
    ['Manga Lists', String(state.home.totalTracked)],
    ['Sources', String(state.home.sources)],
    ['Default Source', state.home.defaultSource],
    ['PID', String(state.home.pid)],
  ];

  for (const card of cards) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = '<div>' + card[0] + '</div><div class="value">' + card[1] + '</div>';
    container.appendChild(el);
  }

  document.getElementById('homeMeta').textContent =
    'Uptime: ' + state.home.uptimeHuman + ' • Memory RSS: ' + state.home.memoryRssMb + ' MB';
}

function renderUsers() {
  const list = document.getElementById('users');
  list.innerHTML = '';

  const search = state.userSearch.trim().toLowerCase();
  const users = search ? state.users.filter((user) => user.userId.toLowerCase().includes(search)) : state.users;

  if (!users.length) {
    list.innerHTML = '<div class="user-item">No users found.</div>';
    return;
  }

  for (const user of users) {
    const row = document.createElement('div');
    row.className = 'user-item' + (state.selectedUserId === user.userId ? ' active' : '');
    row.innerHTML =
      '<div><strong>' + user.userId + '</strong> <span class="badge">' + user.trackedCount + ' tracked</span></div>' +
      '<small>' + user.preferredSource + ' • every ' + user.autoCheckIntervalHours + 'h</small>';
    row.addEventListener('click', () => selectUser(user.userId));
    list.appendChild(row);
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
        await refreshAll();
      } catch (error) {
        setStatus(error.message, false);
      }
    });

    card.appendChild(removeBtn);
    trackedList.appendChild(card);
  }
}

function renderSourcesSettings() {
  const defaultSelect = document.getElementById('defaultSource');
  const list = document.getElementById('sourcesList');

  defaultSelect.innerHTML = '';
  list.innerHTML = '';

  if (!state.sourceDraft || !Array.isArray(state.sourceDraft.sources)) return;

  for (const source of state.sourceDraft.sources) {
    const option = document.createElement('option');
    option.value = source.key;
    option.textContent = source.displayName + ' (' + source.key + ')';
    defaultSelect.appendChild(option);
  }

  if (state.sourceDraft.sources.length > 0) {
    defaultSelect.value = state.sourceDraft.defaultSource || state.sourceDraft.sources[0].key;
  }

  state.sourceDraft.sources.forEach((source, index) => {
    const row = document.createElement('div');
    row.className = 'source-row';
    row.innerHTML =
      '<label>Key</label><input data-field="key" data-index="' + index + '" value="' + (source.key || '') + '" />' +
      '<label>Display Name</label><input data-field="displayName" data-index="' + index + '" value="' + (source.displayName || '') + '" />' +
      '<label>Title URL</label><input data-field="titleUrl" data-index="' + index + '" value="' + (source.titleUrl || '') + '" />' +
      '<label>Hosts (comma separated)</label><input data-field="hosts" data-index="' + index + '" value="' + (Array.isArray(source.hosts) ? source.hosts.join(', ') : '') + '" />';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'warn';
    removeBtn.textContent = 'Remove Source';
    removeBtn.addEventListener('click', () => {
      state.sourceDraft.sources.splice(index, 1);
      if (state.sourceDraft.sources.length === 0) {
        state.sourceDraft.defaultSource = '';
      } else if (!state.sourceDraft.sources.some((item) => item.key === state.sourceDraft.defaultSource)) {
        state.sourceDraft.defaultSource = state.sourceDraft.sources[0].key;
      }
      renderSourcesSettings();
    });

    row.appendChild(removeBtn);
    list.appendChild(row);
  });

  list.querySelectorAll('input[data-field]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const idx = Number(event.target.dataset.index);
      const field = event.target.dataset.field;
      const value = event.target.value;

      if (!state.sourceDraft.sources[idx]) return;

      if (field === 'hosts') {
        state.sourceDraft.sources[idx].hosts = value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      } else {
        state.sourceDraft.sources[idx][field] = value;
      }

      if (field === 'key' && state.sourceDraft.defaultSource === '') {
        state.sourceDraft.defaultSource = value.trim().toLowerCase();
      }
    });
  });

  defaultSelect.onchange = () => {
    state.sourceDraft.defaultSource = defaultSelect.value;
  };
}

function renderAbout() {
  if (!state.about) return;
  document.getElementById('aboutCreator').textContent = state.about.creator;
  document.getElementById('aboutVersion').textContent = state.about.version;

  const repo = document.getElementById('aboutRepo');
  repo.innerHTML = '<a href="' + state.about.repo + '" target="_blank" rel="noreferrer">' + state.about.repo + '</a>';

  document.getElementById('aboutUpdater').textContent = state.about.updateSystem;
}

function renderUpdater() {
  const out = document.getElementById('updaterOutput');
  if (!state.updater) {
    out.textContent = 'No updater action yet.';
    return;
  }

  const lines = [];
  if (state.updater.lastCheck) {
    const check = state.updater.lastCheck;
    lines.push('Last check:');
    lines.push('  Current version: ' + check.currentVersion);
    lines.push('  Latest version:  ' + check.latestVersion);
    lines.push('  Update available: ' + (check.updateAvailable ? 'yes' : 'no'));
    if (check.release && check.release.htmlUrl) lines.push('  Release URL: ' + check.release.htmlUrl);
  }

  if (state.updater.lastApply) {
    lines.push('');
    lines.push('Last apply:');
    lines.push('  Applied: ' + (state.updater.lastApply.applied ? 'yes' : 'no'));
    if (state.updater.lastApply.fromVersion && state.updater.lastApply.toVersion) {
      lines.push('  Version: ' + state.updater.lastApply.fromVersion + ' -> ' + state.updater.lastApply.toVersion);
    }
    if (state.updater.lastApply.asset && state.updater.lastApply.asset.name) {
      lines.push('  Asset: ' + state.updater.lastApply.asset.name);
    }
  }

  if (state.updater.lastError) {
    lines.push('');
    lines.push('Last error:');
    lines.push('  ' + state.updater.lastError);
  }

  lines.push('');
  lines.push('Updater state:');
  lines.push('  Checking: ' + (state.updater.checking ? 'yes' : 'no'));
  lines.push('  Applying: ' + (state.updater.applying ? 'yes' : 'no'));
  lines.push('  Binary path: ' + (state.updater.updaterState ? state.updater.updaterState.binaryPath : 'n/a'));

  out.textContent = lines.join('\\n');
}

async function refreshHome() {
  state.home = await api('/api/admin/home');
  renderHome();
}

async function refreshUsers() {
  const payload = await api('/api/users');
  state.users = payload.users;
  renderUsers();
}

async function refreshSources() {
  state.sources = await api('/api/admin/sources');
  state.sourceDraft = JSON.parse(JSON.stringify(state.sources));
  populateSourceOptions();
  renderSourcesSettings();
}

async function refreshAbout() {
  state.about = await api('/api/admin/about');
  renderAbout();
}

async function refreshUpdater() {
  state.updater = await api('/api/admin/updater/status');
  renderUpdater();
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
  if (!state.selectedUserId) return setStatus('Select a user first.', false);
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
    await refreshHome();
    await refreshUsers();
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function deleteUser() {
  if (!state.selectedUserId) return setStatus('Select a user first.', false);

  if (!window.confirm('Delete user ' + state.selectedUserId + ' and all tracked data?')) return;

  try {
    await api('/api/users/' + state.selectedUserId, { method: 'DELETE' });
    setStatus('User deleted.', true);
    state.selectedUserId = null;
    state.selectedUserData = null;
    document.getElementById('selectedUserTitle').textContent = 'Select a user';
    document.getElementById('userMeta').textContent = '';
    document.getElementById('trackedList').innerHTML = '';
    await refreshAll();
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function addTracked() {
  if (!state.selectedUserId) return setStatus('Select a user first.', false);

  const input = document.getElementById('addInput').value.trim();
  if (!input) return setStatus('Provide manga input.', false);

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
    await refreshAll();
  } catch (error) {
    setStatus(error.message, false);
  }
}

function addSourceDraft() {
  if (!state.sourceDraft || !Array.isArray(state.sourceDraft.sources)) return;
  state.sourceDraft.sources.push({ key: '', displayName: '', hosts: [], titleUrl: '' });
  renderSourcesSettings();
}

async function saveSources() {
  try {
    const payload = {
      defaultSource: state.sourceDraft.defaultSource,
      sources: state.sourceDraft.sources.map((source) => ({
        key: (source.key || '').trim().toLowerCase(),
        displayName: (source.displayName || '').trim(),
        hosts: Array.isArray(source.hosts)
          ? source.hosts.map((host) => String(host || '').trim().toLowerCase()).filter(Boolean)
          : [],
        titleUrl: (source.titleUrl || '').trim(),
      })),
    };

    state.sources = await api('/api/admin/sources', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    state.sourceDraft = JSON.parse(JSON.stringify(state.sources));
    populateSourceOptions();
    renderSourcesSettings();
    setStatus('Sources updated.', true);
    await refreshHome();
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function checkForUpdates() {
  try {
    state.updater = await api('/api/admin/updater/check', { method: 'POST', body: '{}' });
    renderUpdater();
    const updateAvailable = state.updater.lastCheck && state.updater.lastCheck.updateAvailable;
    setStatus(updateAvailable ? 'Update available.' : 'No update available.', true);
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function applyUpdate() {
  const assetName = document.getElementById('assetName').value.trim();
  if (!window.confirm('Apply latest binary update now? The process will restart.')) return;

  try {
    state.updater = await api('/api/admin/updater/apply', {
      method: 'POST',
      body: JSON.stringify({ assetName: assetName || null }),
    });
    renderUpdater();
    setStatus('Update applied. Service restart requested.', true);
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function refreshAll() {
  await Promise.all([refreshHome(), refreshUsers(), refreshSources(), refreshAbout(), refreshUpdater()]);
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('refreshUsers').addEventListener('click', async () => {
  try {
    await refreshUsers();
    await refreshHome();
    setStatus('Users refreshed.', true);
  } catch (error) {
    setStatus(error.message, false);
  }
});

document.getElementById('userSearch').addEventListener('input', (event) => {
  state.userSearch = event.target.value || '';
  renderUsers();
});

document.getElementById('saveSettings').addEventListener('click', saveSettings);
document.getElementById('deleteUser').addEventListener('click', deleteUser);
document.getElementById('addTracked').addEventListener('click', addTracked);
document.getElementById('addSource').addEventListener('click', addSourceDraft);
document.getElementById('saveSources').addEventListener('click', saveSources);
document.getElementById('checkUpdate').addEventListener('click', checkForUpdates);
document.getElementById('applyUpdate').addEventListener('click', applyUpdate);

(async () => {
  try {
    await refreshAll();
    setStatus('Admin dashboard ready.', true);
  } catch (error) {
    setStatus(error.message, false);
  }
})();
</script>
</body>
</html>`;
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
          updateSystem: 'Built-in updater uses a detached worker process to replace and restart the bot binary.',
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

        updaterState.checking = true;
        updaterState.lastError = null;
        try {
          updaterState.lastCheck = await updater.checkForUpdate();
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

        updaterState.applying = true;
        updaterState.lastError = null;
        try {
          updaterState.lastApply = await updater.applyUpdate({ assetName });
          updaterState.lastCheck = {
            currentVersion: updaterState.lastApply.fromVersion,
            latestVersion: updaterState.lastApply.toVersion,
            updateAvailable: true,
            release: updaterState.lastApply.release,
          };
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
