const fs = require('fs');
const path = require('path');
const { isNumericString, resolveDiscordOAuthInvite } = require('./discordOAuthService');

const REDACTED_TOKEN_PLACEHOLDER = '********';
const MANAGED_ENV_DEFAULTS = {
  DISCORD_TOKEN: '',
  DASHBOARD_PORT: '9898',
  DASHBOARD_HOST: '0.0.0.0',
  OAUTH_URL: '',
  DISCORD_CLIENT_ID: '',
  DISCORD_OAUTH_SCOPES: 'bot applications.commands',
  DISCORD_OAUTH_PERMISSIONS: '0',
  DISCORD_OAUTH_GUILD_ID: '',
};

const DEFAULT_ENV_FILE_PATH = path.resolve(process.cwd(), '.env');
const ENV_FILE_PATH = process.env.BOT_ENV_FILE ? path.resolve(process.env.BOT_ENV_FILE) : DEFAULT_ENV_FILE_PATH;

function parseEnvFile(content) {
  const lines = String(content || '').split(/\r?\n/);
  const entries = [];
  const valuesByKey = new Map();

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      entries.push({ type: 'raw', line });
      continue;
    }

    const key = match[1];
    const rawValue = match[2];
    const value = rawValue
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1');

    entries.push({ type: 'entry', key, value });
    valuesByKey.set(key, value);
  }

  return { entries, valuesByKey };
}

function serializeEnvFile(entries) {
  return `${entries
    .map((entry) => {
      if (entry.type === 'entry') return `${entry.key}=${entry.value}`;
      return entry.line;
    })
    .join('\n')
    .replace(/\n+$/g, '')}\n`;
}

function ensureEnvFile() {
  if (fs.existsSync(ENV_FILE_PATH)) return ENV_FILE_PATH;

  const lines = [
    '# Manga Tracker environment',
    ...Object.entries(MANAGED_ENV_DEFAULTS).map(([key, value]) => `${key}=${value}`),
  ];
  fs.writeFileSync(ENV_FILE_PATH, `${lines.join('\n')}\n`, 'utf8');
  return ENV_FILE_PATH;
}

function readManagedEnvValues() {
  ensureEnvFile();
  const content = fs.readFileSync(ENV_FILE_PATH, 'utf8');
  const parsed = parseEnvFile(content);
  const values = {};

  for (const [key, defaultValue] of Object.entries(MANAGED_ENV_DEFAULTS)) {
    values[key] = parsed.valuesByKey.has(key) ? parsed.valuesByKey.get(key) : defaultValue;
  }

  return values;
}

function getDashboardEnvConfig() {
  const values = readManagedEnvValues();
  const hasDiscordToken = Boolean(String(values.DISCORD_TOKEN || '').trim());
  const oauthInvite = resolveDiscordOAuthInvite(values);

  return {
    envFilePath: ENV_FILE_PATH,
    restartRequired: true,
    oauthInvite,
    values: {
      ...values,
      DISCORD_TOKEN: hasDiscordToken ? REDACTED_TOKEN_PLACEHOLDER : '',
    },
    redactedFields: ['DISCORD_TOKEN'],
  };
}

function saveDashboardEnvConfig(nextValues) {
  ensureEnvFile();
  const content = fs.readFileSync(ENV_FILE_PATH, 'utf8');
  const parsed = parseEnvFile(content);
  const incoming = nextValues && typeof nextValues === 'object' ? nextValues : {};

  for (const [key, defaultValue] of Object.entries(MANAGED_ENV_DEFAULTS)) {
    const existingValue = parsed.valuesByKey.has(key) ? parsed.valuesByKey.get(key) : defaultValue;
    const incomingRaw = Object.prototype.hasOwnProperty.call(incoming, key) ? incoming[key] : existingValue;
    const incomingValue = String(incomingRaw == null ? '' : incomingRaw).trim();
    const resolvedValue =
      key === 'DISCORD_TOKEN' && incomingValue === REDACTED_TOKEN_PLACEHOLDER
        ? String(existingValue || '').trim()
        : incomingValue;

    if (resolvedValue.includes('\n') || resolvedValue.includes('\r')) {
      throw new Error(`${key} cannot contain newlines`);
    }
    if (key === 'DASHBOARD_PORT' && resolvedValue) {
      const port = Number.parseInt(resolvedValue, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('DASHBOARD_PORT must be a number between 1 and 65535');
      }
    }
    if (key === 'DISCORD_CLIENT_ID' && resolvedValue && !isNumericString(resolvedValue)) {
      throw new Error('DISCORD_CLIENT_ID must be a numeric Discord application ID');
    }
    if (key === 'DISCORD_OAUTH_PERMISSIONS' && !isNumericString(resolvedValue)) {
      throw new Error('DISCORD_OAUTH_PERMISSIONS must be a non-negative integer');
    }
    if (key === 'DISCORD_OAUTH_GUILD_ID' && resolvedValue && !isNumericString(resolvedValue)) {
      throw new Error('DISCORD_OAUTH_GUILD_ID must be empty or a numeric guild ID');
    }

    parsed.valuesByKey.set(key, resolvedValue);
    process.env[key] = resolvedValue;
  }

  const keysInFile = new Set();
  for (const entry of parsed.entries) {
    if (entry.type !== 'entry') continue;
    if (!parsed.valuesByKey.has(entry.key)) continue;

    const value = parsed.valuesByKey.get(entry.key);
    entry.value = value;
    keysInFile.add(entry.key);
  }

  for (const key of Object.keys(MANAGED_ENV_DEFAULTS)) {
    if (keysInFile.has(key)) continue;
    parsed.entries.push({ type: 'entry', key, value: parsed.valuesByKey.get(key) || '' });
  }

  fs.writeFileSync(ENV_FILE_PATH, serializeEnvFile(parsed.entries), 'utf8');
  return getDashboardEnvConfig();
}

module.exports = {
  ENV_FILE_PATH,
  REDACTED_TOKEN_PLACEHOLDER,
  ensureEnvFile,
  getDashboardEnvConfig,
  saveDashboardEnvConfig,
};
