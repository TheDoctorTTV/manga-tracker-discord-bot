const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function randomPort() {
  return 21000 + Math.floor(Math.random() * 15000);
}

async function startServerWithTempEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-dashboard-test-'));
  const envFilePath = path.join(tempDir, '.env.test');
  const port = randomPort();

  process.env.BOT_ENV_FILE = envFilePath;
  process.env.DASHBOARD_HOST = '127.0.0.1';
  process.env.DASHBOARD_PORT = String(port);

  const configPath = require.resolve('../src/config');
  const envServicePath = require.resolve('../src/services/envFileService');
  const dashboardServerPath = require.resolve('../src/web/dashboardServer');
  delete require.cache[configPath];
  delete require.cache[envServicePath];
  delete require.cache[dashboardServerPath];

  const { startDashboardServer } = require(dashboardServerPath);
  const server = startDashboardServer({
    service: {
      getAdminSummaryForGuild() {
        return { users: 0, totalTracked: 0, sources: 0, enabledSources: 0, defaultSource: 'mangadex' };
      },
    },
    updater: null,
    botController: null,
  });

  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    const onError = (error) => reject(error);
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });

  return { server, port };
}

async function requestJson(port, pathName, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathName}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

test(
  'locks non-onboarding routes with 423 until setup is complete',
  { concurrency: false },
  async (t) => {
    let server;
    let port;
    try {
      const started = await startServerWithTempEnv();
      server = started.server;
      port = started.port;
    } catch (error) {
      if (error && error.code === 'EPERM') {
        t.skip('Socket binding is not permitted in this sandbox.');
        return;
      }
      throw error;
    }
    try {
      const blocked = await requestJson(port, '/api/admin/about');
      assert.equal(blocked.status, 423);
      assert.equal(blocked.payload.onboarding.completed, false);

      const allowed = await requestJson(port, '/api/admin/env');
      assert.equal(allowed.status, 200);
      assert.equal(allowed.payload.onboarding.completed, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
);

test(
  'supports onboarding step actions and completion checks',
  { concurrency: false },
  async (t) => {
    let server;
    let port;
    try {
      const started = await startServerWithTempEnv();
      server = started.server;
      port = started.port;
    } catch (error) {
      if (error && error.code === 'EPERM') {
        t.skip('Socket binding is not permitted in this sandbox.');
        return;
      }
      throw error;
    }
    try {
      let response = await requestJson(port, '/api/admin/env', {
        method: 'PUT',
        body: JSON.stringify({
          values: {
            DISCORD_TOKEN: 'token',
          },
        }),
      });
      assert.equal(response.status, 200);

      response = await requestJson(port, '/api/admin/onboarding/step', {
        method: 'POST',
        body: JSON.stringify({ action: 'save_and_verify' }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.payload.onboarding.currentStep, 2);

      response = await requestJson(port, '/api/admin/onboarding/step', {
        method: 'POST',
        body: JSON.stringify({ action: 'confirm_external' }),
      });
      assert.equal(response.status, 400);

      response = await requestJson(port, '/api/admin/env', {
        method: 'PUT',
        body: JSON.stringify({
          values: {
            DISCORD_CLIENT_ID: '123456789012345678',
          },
        }),
      });
      assert.equal(response.status, 200);

      response = await requestJson(port, '/api/admin/onboarding/step', {
        method: 'POST',
        body: JSON.stringify({ action: 'confirm_external' }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.payload.onboarding.currentStep, 3);
      assert.equal(response.payload.onboarding.confirmations.inviteConfirmed, true);

      response = await requestJson(port, '/api/admin/env', {
        method: 'PUT',
        body: JSON.stringify({
          values: {
            DASHBOARD_PUBLIC_URL: 'https://example.com',
            DISCORD_AUTH_CLIENT_ID: '123456789012345678',
            DISCORD_AUTH_CLIENT_SECRET: 'secret',
            DASHBOARD_MANAGED_GUILD_IDS: '111111111111111111',
          },
        }),
      });
      assert.equal(response.status, 200);

      response = await requestJson(port, '/api/admin/onboarding/step', {
        method: 'POST',
        body: JSON.stringify({ action: 'confirm_external' }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.payload.onboarding.confirmations.callbackConfirmed, true);
      assert.equal(response.payload.onboarding.readyToComplete, true);

      response = await requestJson(port, '/api/admin/onboarding/complete', {
        method: 'POST',
      });
      assert.equal(response.status, 200);
      assert.equal(response.payload.onboarding.completed, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
);
