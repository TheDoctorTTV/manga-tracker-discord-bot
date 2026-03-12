const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';

function isNumericString(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function normalizeScopes(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  if (normalized) return normalized;
  return String(fallback || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function resolveDiscordOAuthInvite(values = {}) {
  const manualUrl = String(values.OAUTH_URL || '').trim();
  if (manualUrl) {
    return { source: 'manual', url: manualUrl, reason: null };
  }

  const clientId = String(values.DISCORD_CLIENT_ID || '').trim();
  if (!isNumericString(clientId)) {
    return {
      source: 'unavailable',
      url: '',
      reason: 'DISCORD_CLIENT_ID is required to generate an invite URL.',
    };
  }

  const scopes = normalizeScopes(values.DISCORD_OAUTH_SCOPES, 'bot applications.commands');
  if (!scopes) {
    return {
      source: 'unavailable',
      url: '',
      reason: 'DISCORD_OAUTH_SCOPES must contain at least one scope.',
    };
  }

  const permissions = String(values.DISCORD_OAUTH_PERMISSIONS || '').trim();
  if (!isNumericString(permissions)) {
    return {
      source: 'unavailable',
      url: '',
      reason: 'DISCORD_OAUTH_PERMISSIONS must be a non-negative integer.',
    };
  }

  const guildId = String(values.DISCORD_OAUTH_GUILD_ID || '').trim();
  if (guildId && !isNumericString(guildId)) {
    return {
      source: 'unavailable',
      url: '',
      reason: 'DISCORD_OAUTH_GUILD_ID must be empty or a numeric guild ID.',
    };
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    permissions,
  });

  if (guildId) {
    params.set('guild_id', guildId);
    params.set('disable_guild_select', 'true');
  }

  return {
    source: 'generated',
    url: `${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`,
    reason: null,
  };
}

module.exports = {
  DISCORD_OAUTH_AUTHORIZE_URL,
  isNumericString,
  resolveDiscordOAuthInvite,
};
