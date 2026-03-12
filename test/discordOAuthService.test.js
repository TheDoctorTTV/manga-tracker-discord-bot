const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDiscordOAuthInvite } = require('../src/services/discordOAuthService');

test('uses manual OAUTH_URL override when provided', () => {
  const result = resolveDiscordOAuthInvite({
    OAUTH_URL: 'https://example.com/custom-invite',
    DISCORD_CLIENT_ID: '123456789012345678',
  });

  assert.equal(result.source, 'manual');
  assert.equal(result.url, 'https://example.com/custom-invite');
  assert.equal(result.reason, null);
});

test('generates invite URL using defaults', () => {
  const result = resolveDiscordOAuthInvite({
    DISCORD_CLIENT_ID: '123456789012345678',
    DISCORD_OAUTH_SCOPES: 'bot applications.commands',
    DISCORD_OAUTH_PERMISSIONS: '0',
  });

  assert.equal(result.source, 'generated');
  assert.match(result.url, /^https:\/\/discord\.com\/oauth2\/authorize\?/);
  assert.match(result.url, /client_id=123456789012345678/);
  assert.match(result.url, /scope=bot\+applications\.commands/);
  assert.match(result.url, /permissions=0/);
  assert.equal(result.reason, null);
});

test('generates invite URL with custom scopes and permissions', () => {
  const result = resolveDiscordOAuthInvite({
    DISCORD_CLIENT_ID: '123456789012345678',
    DISCORD_OAUTH_SCOPES: 'bot applications.commands guilds',
    DISCORD_OAUTH_PERMISSIONS: '8',
  });

  assert.equal(result.source, 'generated');
  assert.match(result.url, /scope=bot\+applications\.commands\+guilds/);
  assert.match(result.url, /permissions=8/);
});

test('includes guild lock params when guild id is provided', () => {
  const result = resolveDiscordOAuthInvite({
    DISCORD_CLIENT_ID: '123456789012345678',
    DISCORD_OAUTH_SCOPES: 'bot applications.commands',
    DISCORD_OAUTH_PERMISSIONS: '0',
    DISCORD_OAUTH_GUILD_ID: '987654321098765432',
  });

  assert.equal(result.source, 'generated');
  assert.match(result.url, /guild_id=987654321098765432/);
  assert.match(result.url, /disable_guild_select=true/);
});

test('returns unavailable state when DISCORD_CLIENT_ID is missing', () => {
  const result = resolveDiscordOAuthInvite({
    OAUTH_URL: '',
    DISCORD_CLIENT_ID: '',
    DISCORD_OAUTH_SCOPES: 'bot applications.commands',
    DISCORD_OAUTH_PERMISSIONS: '0',
  });

  assert.equal(result.source, 'unavailable');
  assert.equal(result.url, '');
  assert.match(result.reason, /DISCORD_CLIENT_ID/i);
});
