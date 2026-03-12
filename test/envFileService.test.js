const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadEnvFileServiceWithTempFile() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-env-test-'));
  const envFilePath = path.join(tempDir, '.env.test');
  process.env.BOT_ENV_FILE = envFilePath;

  const servicePath = require.resolve('../src/services/envFileService');
  delete require.cache[servicePath];
  return {
    envFilePath,
    service: require(servicePath),
  };
}

test('saves and reloads new OAuth env keys', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  service.saveDashboardEnvConfig({
    DISCORD_TOKEN: 'test-token',
    DASHBOARD_PORT: '9999',
    DASHBOARD_HOST: '127.0.0.1',
    OAUTH_URL: '',
    DISCORD_CLIENT_ID: '123456789012345678',
    DISCORD_OAUTH_SCOPES: 'bot applications.commands',
    DISCORD_OAUTH_PERMISSIONS: '0',
    DISCORD_OAUTH_GUILD_ID: '987654321098765432',
  });

  const config = service.getDashboardEnvConfig();
  assert.equal(config.values.DISCORD_CLIENT_ID, '123456789012345678');
  assert.equal(config.values.DISCORD_OAUTH_SCOPES, 'bot applications.commands');
  assert.equal(config.values.DISCORD_OAUTH_PERMISSIONS, '0');
  assert.equal(config.values.DISCORD_OAUTH_GUILD_ID, '987654321098765432');
  assert.equal(config.oauthInvite.source, 'generated');
  assert.match(config.oauthInvite.url, /client_id=123456789012345678/);
  assert.match(config.oauthInvite.url, /guild_id=987654321098765432/);
});

test('rejects malformed DISCORD_CLIENT_ID', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  assert.throws(
    () =>
      service.saveDashboardEnvConfig({
        DISCORD_CLIENT_ID: 'not-a-number',
      }),
    /DISCORD_CLIENT_ID/
  );
});

test('rejects malformed DISCORD_OAUTH_PERMISSIONS', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  assert.throws(
    () =>
      service.saveDashboardEnvConfig({
        DISCORD_OAUTH_PERMISSIONS: 'abc',
      }),
    /DISCORD_OAUTH_PERMISSIONS/
  );
});

test('rejects malformed DISCORD_OAUTH_GUILD_ID', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  assert.throws(
    () =>
      service.saveDashboardEnvConfig({
        DISCORD_OAUTH_GUILD_ID: 'guild-id',
      }),
    /DISCORD_OAUTH_GUILD_ID/
  );
});

test('saves and reloads dashboard auth env keys', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  service.saveDashboardEnvConfig({
    DASHBOARD_AUTH_ENABLED: 'true',
    DASHBOARD_PUBLIC_URL: 'https://example.com',
    DISCORD_AUTH_CLIENT_ID: '123456789012345678',
    DISCORD_AUTH_CLIENT_SECRET: 'super-secret',
    DASHBOARD_AUTH_SESSION_HOURS: '12',
  });

  const config = service.getDashboardEnvConfig();
  assert.equal(config.values.DASHBOARD_AUTH_ENABLED, 'true');
  assert.equal(config.values.DASHBOARD_PUBLIC_URL, 'https://example.com');
  assert.equal(config.values.DISCORD_AUTH_CLIENT_ID, '123456789012345678');
  assert.equal(config.values.DISCORD_AUTH_CLIENT_SECRET, '********');
  assert.equal(config.dashboardAuth.enabled, true);
  assert.equal(config.dashboardAuth.configured, true);
  assert.deepEqual(config.dashboardAuth.managedGuildIds, []);
  assert.equal(config.dashboardAuth.callbackUrl, 'https://example.com/auth/discord/callback');
  assert.equal(
    config.dashboardAuth.callbackHelpText,
    'Ready. Add this exact URL to Discord Developer Portal -> OAuth2 -> Redirects.'
  );
});

test('rejects malformed DASHBOARD_MANAGED_GUILD_IDS', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  assert.throws(
    () =>
      service.saveDashboardEnvConfig({
        DASHBOARD_MANAGED_GUILD_IDS: '123,not-a-guild',
      }),
    /DASHBOARD_MANAGED_GUILD_IDS/
  );
});

test('computes onboarding readiness from bot, invite, and auth state', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  service.saveDashboardEnvConfig({
    DISCORD_TOKEN: '',
    DISCORD_CLIENT_ID: '',
    DASHBOARD_PUBLIC_URL: '',
    DISCORD_AUTH_CLIENT_ID: '',
    DISCORD_AUTH_CLIENT_SECRET: '',
    DASHBOARD_SETUP_COMPLETED: 'false',
  });

  const config = service.getDashboardEnvConfig();
  assert.equal(config.onboarding.completed, false);
  assert.equal(config.onboarding.readiness.botConfigured, false);
  assert.equal(config.onboarding.readiness.botInviteReady, false);
  assert.equal(config.onboarding.readiness.dashboardAuthReady, false);
  assert.equal(config.onboarding.currentStep, 1);
  assert.equal(config.onboarding.confirmations.inviteConfirmed, false);
  assert.equal(config.onboarding.confirmations.callbackConfirmed, false);
  assert.equal(config.onboarding.steps.length, 3);
  assert.equal(config.onboarding.steps[0].complete, false);
  assert.equal(config.onboarding.steps[1].blockedReason, 'Complete Step 1 first.');
  assert.equal(config.onboarding.steps[2].blockedReason, 'Complete Step 2 first.');
  assert.equal(config.onboarding.readyToComplete, false);
  assert.deepEqual(config.onboarding.missing, ['DISCORD_TOKEN', 'BOT_INVITE_READY', 'DASHBOARD_AUTH_READY']);
  assert.equal(
    config.onboarding.display.summary,
    'Completed: no • Current step: 1 • Ready to complete: no'
  );
  assert.equal(config.onboarding.display.checklistItems.length, 3);
  assert.match(config.onboarding.display.warningMessage, /Setup is not complete/);
});

test('persists onboarding completed flag and supports drift state', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  service.saveDashboardEnvConfig({
    DISCORD_TOKEN: 'token',
    DISCORD_CLIENT_ID: '123456789012345678',
    DASHBOARD_PUBLIC_URL: 'https://example.com',
    DISCORD_AUTH_CLIENT_ID: '123456789012345678',
    DISCORD_AUTH_CLIENT_SECRET: 'secret',
    DASHBOARD_ONBOARDING_INVITE_CONFIRMED: 'true',
    DASHBOARD_ONBOARDING_CALLBACK_CONFIRMED: 'true',
    DASHBOARD_ONBOARDING_STEP: '3',
    DASHBOARD_SETUP_COMPLETED: 'true',
  });

  let config = service.getDashboardEnvConfig();
  assert.equal(config.onboarding.completed, true);
  assert.equal(config.onboarding.readyToComplete, true);
  assert.equal(config.onboarding.currentStep, 3);
  assert.equal(config.onboarding.steps[1].complete, true);
  assert.equal(config.onboarding.steps[2].complete, true);

  service.saveDashboardEnvConfig({
    DASHBOARD_SETUP_COMPLETED: 'true',
    DASHBOARD_PUBLIC_URL: '',
  });

  config = service.getDashboardEnvConfig();
  assert.equal(config.onboarding.completed, true);
  assert.equal(config.onboarding.readyToComplete, false);
  assert.equal(config.onboarding.readiness.dashboardAuthReady, false);
  assert.equal(config.onboarding.steps[2].complete, false);
});

test('rejects malformed DASHBOARD_ONBOARDING_STEP', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  assert.throws(
    () =>
      service.saveDashboardEnvConfig({
        DASHBOARD_ONBOARDING_STEP: '4',
      }),
    /DASHBOARD_ONBOARDING_STEP/
  );
});

test('computes step completion with external confirmations', () => {
  const { service } = loadEnvFileServiceWithTempFile();
  service.saveDashboardEnvConfig({
    DISCORD_TOKEN: 'token',
    DISCORD_CLIENT_ID: '123456789012345678',
    DASHBOARD_PUBLIC_URL: 'https://example.com',
    DISCORD_AUTH_CLIENT_ID: '123456789012345678',
    DISCORD_AUTH_CLIENT_SECRET: 'secret',
    DASHBOARD_ONBOARDING_STEP: '2',
    DASHBOARD_ONBOARDING_INVITE_CONFIRMED: 'true',
    DASHBOARD_ONBOARDING_CALLBACK_CONFIRMED: 'false',
    DASHBOARD_SETUP_COMPLETED: 'false',
  });

  const config = service.getDashboardEnvConfig();
  assert.equal(config.onboarding.steps[0].complete, true);
  assert.equal(config.onboarding.steps[1].complete, true);
  assert.equal(config.onboarding.steps[2].complete, false);
  assert.equal(config.onboarding.steps[2].blockedReason, 'Confirm callback URL was added in Discord OAuth2 Redirects.');
  assert.equal(config.onboarding.readyToComplete, false);
});
