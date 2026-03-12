const crypto = require('crypto');
const axios = require('axios');

const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_OAUTH_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_ADMINISTRATOR_PERMISSION = 0x8n;

function hasAdministratorPermission(rawPermissions) {
  try {
    const permissions = BigInt(String(rawPermissions || '0'));
    return (permissions & DISCORD_ADMINISTRATOR_PERMISSION) === DISCORD_ADMINISTRATOR_PERMISSION;
  } catch {
    return false;
  }
}

function randomToken(size = 32) {
  return crypto.randomBytes(size).toString('hex');
}

function buildDiscordLoginUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify guilds',
    prompt: 'none',
    state,
  });
  return `${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeDiscordCode({ code, clientId, clientSecret, redirectUri }) {
  const payload = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const response = await axios.post(DISCORD_OAUTH_TOKEN_URL, payload.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  return response.data;
}

async function fetchDiscordIdentity(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [userResp, guildsResp] = await Promise.all([
    axios.get(`${DISCORD_API_BASE_URL}/users/@me`, { headers, timeout: 15000 }),
    axios.get(`${DISCORD_API_BASE_URL}/users/@me/guilds`, { headers, timeout: 15000 }),
  ]);

  return {
    user: userResp.data || null,
    guilds: Array.isArray(guildsResp.data) ? guildsResp.data : [],
  };
}

function computeAllowedGuildIds({ guilds, managedGuildIds }) {
  return computeAllowedGuilds({ guilds, managedGuildIds }).map((guild) => guild.id);
}

function computeAdminGuilds(guilds) {
  return (Array.isArray(guilds) ? guilds : [])
    .filter((guild) => hasAdministratorPermission(guild.permissions))
    .map((guild) => ({
      id: String(guild.id || '').trim(),
      name: String(guild.name || '').trim() || String(guild.id || '').trim(),
    }))
    .filter((guild) => guild.id);
}

function computeAllowedGuilds({ guilds, managedGuildIds }) {
  const adminGuilds = computeAdminGuilds(guilds);
  if (!Array.isArray(managedGuildIds) || managedGuildIds.length === 0) return adminGuilds;
  const managed = new Set(managedGuildIds);
  return adminGuilds.filter((guild) => managed.has(guild.id));
}

module.exports = {
  DISCORD_ADMINISTRATOR_PERMISSION,
  hasAdministratorPermission,
  randomToken,
  buildDiscordLoginUrl,
  exchangeDiscordCode,
  fetchDiscordIdentity,
  computeAdminGuilds,
  computeAllowedGuilds,
  computeAllowedGuildIds,
};
