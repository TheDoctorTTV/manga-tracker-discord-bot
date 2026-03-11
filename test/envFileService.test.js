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
