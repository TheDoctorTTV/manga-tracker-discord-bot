const fs = require('fs');
const path = require('path');
const { isNumericString, resolveDiscordOAuthInvite } = require('./discordOAuthService');

const REDACTED_TOKEN_PLACEHOLDER = '********';
const REDACTED_SECRET_PLACEHOLDER = '********';
const MANAGED_ENV_DEFAULTS = {
  DISCORD_TOKEN: '',
  DASHBOARD_PORT: '9898',
  DASHBOARD_HOST: '0.0.0.0',
  OAUTH_URL: '',
  DISCORD_CLIENT_ID: '',
  DISCORD_OAUTH_SCOPES: 'bot applications.commands',
  DISCORD_OAUTH_PERMISSIONS: '0',
  DISCORD_OAUTH_GUILD_ID: '',
  DASHBOARD_AUTH_ENABLED: 'false',
  DASHBOARD_PUBLIC_URL: '',
  DISCORD_AUTH_CLIENT_ID: '',
  DISCORD_AUTH_CLIENT_SECRET: '',
  DASHBOARD_MANAGED_GUILD_IDS: '',
  DASHBOARD_AUTH_SESSION_HOURS: '12',
  DASHBOARD_ONBOARDING_STEP: '1',
  DASHBOARD_ONBOARDING_INVITE_CONFIRMED: 'false',
  DASHBOARD_ONBOARDING_CALLBACK_CONFIRMED: 'false',
  DASHBOARD_SETUP_COMPLETED: 'false',
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

function parseGuildIdList(value) {
  const seen = new Set();
  const ids = [];

  for (const part of String(value || '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!isNumericString(trimmed)) {
      throw new Error('DASHBOARD_MANAGED_GUILD_IDS must be a comma-separated list of numeric guild IDs');
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }

  return ids;
}

function parseBooleanEnv(value, fallback = false) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getDashboardAuthConfig(values) {
  const sessionHoursRaw = String(values.DASHBOARD_AUTH_SESSION_HOURS || '12').trim();
  const sessionHoursParsed = Number.parseInt(sessionHoursRaw || '12', 10);
  const sessionHours = Number.isInteger(sessionHoursParsed) ? sessionHoursParsed : 12;
  const managedGuildIds = parseGuildIdList(values.DASHBOARD_MANAGED_GUILD_IDS);
  const enabled = parseBooleanEnv(values.DASHBOARD_AUTH_ENABLED, false);
  const publicUrl = String(values.DASHBOARD_PUBLIC_URL || '').trim().replace(/\/+$/g, '');
  const clientId = String(values.DISCORD_AUTH_CLIENT_ID || '').trim();
  const clientSecret = String(values.DISCORD_AUTH_CLIENT_SECRET || '').trim();
  const missing = [];

  if (!publicUrl) missing.push('DASHBOARD_PUBLIC_URL');
  if (!clientId) missing.push('DISCORD_AUTH_CLIENT_ID');
  if (!clientSecret) missing.push('DISCORD_AUTH_CLIENT_SECRET');
  if (managedGuildIds.length === 0) missing.push('DASHBOARD_MANAGED_GUILD_IDS');

  return {
    enabled,
    configured: missing.length === 0,
    publicUrl,
    callbackUrl: publicUrl ? `${publicUrl}/auth/discord/callback` : '',
    managedGuildIds,
    sessionHours,
    missing,
  };
}

function getDashboardOnboardingConfig(values, oauthInvite, dashboardAuth) {
  const botConfigured = Boolean(String(values.DISCORD_TOKEN || '').trim());
  const botInviteReady = oauthInvite && oauthInvite.source !== 'unavailable';
  const dashboardAuthReady = Boolean(dashboardAuth && dashboardAuth.configured);
  const inviteConfirmed = parseBooleanEnv(values.DASHBOARD_ONBOARDING_INVITE_CONFIRMED, false);
  const callbackConfirmed = parseBooleanEnv(values.DASHBOARD_ONBOARDING_CALLBACK_CONFIRMED, false);
  const completed = parseBooleanEnv(values.DASHBOARD_SETUP_COMPLETED, false);
  const stepRaw = Number.parseInt(String(values.DASHBOARD_ONBOARDING_STEP || '1').trim(), 10);
  const currentStep = Number.isInteger(stepRaw) ? Math.max(1, Math.min(3, stepRaw)) : 1;
  const missing = [];
  const hints = [];

  if (!botConfigured) {
    missing.push('DISCORD_TOKEN');
    hints.push('Add DISCORD_TOKEN in Settings -> Environment so the bot can run.');
  }
  if (!botInviteReady) {
    missing.push('BOT_INVITE_READY');
    hints.push('Set bot invite fields (DISCORD_CLIENT_ID or OAUTH_URL) until Bot Invite URL is available.');
  }
  if (!dashboardAuthReady) {
    missing.push('DASHBOARD_AUTH_READY');
    hints.push(
      'Set DASHBOARD_PUBLIC_URL, DISCORD_AUTH_CLIENT_ID, DISCORD_AUTH_CLIENT_SECRET, and DASHBOARD_MANAGED_GUILD_IDS.'
    );
  }

  const steps = [
    {
      index: 1,
      key: 'bot_token',
      title: 'Step 1 of 3 • Bot Token',
      body: 'Set DISCORD_TOKEN in Settings -> Environment and save.',
      ready: botConfigured,
      confirmed: true,
      complete: botConfigured,
      blockedReason: botConfigured ? '' : 'DISCORD_TOKEN is required.',
    },
    {
      index: 2,
      key: 'bot_invite',
      title: 'Step 2 of 3 • Bot Invite',
      body: 'Ensure Bot Invite URL is available in Home, invite the bot, then confirm this step.',
      ready: botInviteReady,
      confirmed: inviteConfirmed,
      complete: botInviteReady && inviteConfirmed,
      blockedReason: botInviteReady ? (inviteConfirmed ? '' : 'Confirm that you invited the bot.') : 'Bot Invite URL is not ready yet.',
    },
    {
      index: 3,
      key: 'dashboard_auth',
      title: 'Step 3 of 3 • Dashboard Auth',
      body:
        'Set DASHBOARD_PUBLIC_URL, DISCORD_AUTH_CLIENT_ID, DISCORD_AUTH_CLIENT_SECRET, and DASHBOARD_MANAGED_GUILD_IDS. Add the computed callback URL in Discord OAuth2 Redirects, then confirm.',
      ready: dashboardAuthReady,
      confirmed: callbackConfirmed,
      complete: dashboardAuthReady && callbackConfirmed,
      blockedReason: dashboardAuthReady
        ? callbackConfirmed
          ? ''
          : 'Confirm callback URL was added in Discord OAuth2 Redirects.'
        : 'Dashboard auth fields are incomplete.',
    },
  ];

  for (const step of steps) {
    step.canAdvance = step.complete;
  }

  const step2BlockedByStep1 = !steps[0].complete;
  const step3BlockedByStep2 = !steps[1].complete;
  if (step2BlockedByStep1) {
    steps[1].canAdvance = false;
    steps[1].blockedReason = 'Complete Step 1 first.';
  }
  if (step3BlockedByStep2) {
    steps[2].canAdvance = false;
    steps[2].blockedReason = 'Complete Step 2 first.';
  }

  const readyToComplete = steps.every((step) => step.complete);

  return {
    completed,
    currentStep,
    confirmations: {
      inviteConfirmed,
      callbackConfirmed,
    },
    steps,
    readiness: {
      botConfigured,
      botInviteReady,
      dashboardAuthReady,
    },
    readyToComplete,
    missing,
    hints,
  };
}

function getNextOnboardingStep(onboarding) {
  const steps = Array.isArray(onboarding?.steps) ? onboarding.steps : [];
  for (const step of steps) {
    if (!step.complete) return step.index;
  }
  return 3;
}

function getDashboardEnvConfig() {
  const values = readManagedEnvValues();
  const hasDiscordToken = Boolean(String(values.DISCORD_TOKEN || '').trim());
  const hasDiscordAuthSecret = Boolean(String(values.DISCORD_AUTH_CLIENT_SECRET || '').trim());
  const oauthInvite = resolveDiscordOAuthInvite(values);
  const dashboardAuth = getDashboardAuthConfig(values);
  const onboarding = getDashboardOnboardingConfig(values, oauthInvite, dashboardAuth);

  return {
    envFilePath: ENV_FILE_PATH,
    restartRequired: true,
    oauthInvite,
    dashboardAuth,
    onboarding,
    values: {
      ...values,
      DISCORD_TOKEN: hasDiscordToken ? REDACTED_TOKEN_PLACEHOLDER : '',
      DISCORD_AUTH_CLIENT_SECRET: hasDiscordAuthSecret ? REDACTED_SECRET_PLACEHOLDER : '',
    },
    redactedFields: ['DISCORD_TOKEN', 'DISCORD_AUTH_CLIENT_SECRET'],
  };
}

function getDashboardRuntimeConfig() {
  const values = readManagedEnvValues();
  const oauthInvite = resolveDiscordOAuthInvite(values);
  const dashboardAuth = getDashboardAuthConfig(values);
  return {
    values,
    oauthInvite,
    dashboardAuth,
    onboarding: getDashboardOnboardingConfig(values, oauthInvite, dashboardAuth),
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
      (key === 'DISCORD_TOKEN' && incomingValue === REDACTED_TOKEN_PLACEHOLDER) ||
      (key === 'DISCORD_AUTH_CLIENT_SECRET' && incomingValue === REDACTED_SECRET_PLACEHOLDER)
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
    if (
      key === 'DASHBOARD_AUTH_ENABLED' ||
      key === 'DASHBOARD_SETUP_COMPLETED' ||
      key === 'DASHBOARD_ONBOARDING_INVITE_CONFIRMED' ||
      key === 'DASHBOARD_ONBOARDING_CALLBACK_CONFIRMED'
    ) {
      const normalized = resolvedValue.toLowerCase();
      if (resolvedValue && !['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'].includes(normalized)) {
        throw new Error(`${key} must be true or false`);
      }
    }
    if (key === 'DASHBOARD_ONBOARDING_STEP') {
      const step = Number.parseInt(resolvedValue || '1', 10);
      if (!Number.isInteger(step) || step < 1 || step > 3) {
        throw new Error('DASHBOARD_ONBOARDING_STEP must be an integer between 1 and 3');
      }
    }
    if (key === 'DASHBOARD_PUBLIC_URL' && resolvedValue) {
      let parsed;
      try {
        parsed = new URL(resolvedValue);
      } catch {
        throw new Error('DASHBOARD_PUBLIC_URL must be a valid URL');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('DASHBOARD_PUBLIC_URL must use http or https');
      }
    }
    if (key === 'DISCORD_AUTH_CLIENT_ID' && resolvedValue && !isNumericString(resolvedValue)) {
      throw new Error('DISCORD_AUTH_CLIENT_ID must be a numeric Discord application ID');
    }
    if (key === 'DASHBOARD_MANAGED_GUILD_IDS') {
      parseGuildIdList(resolvedValue);
    }
    if (key === 'DASHBOARD_AUTH_SESSION_HOURS' && resolvedValue) {
      const hours = Number.parseInt(resolvedValue, 10);
      if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
        throw new Error('DASHBOARD_AUTH_SESSION_HOURS must be an integer between 1 and 168');
      }
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
  REDACTED_SECRET_PLACEHOLDER,
  parseGuildIdList,
  getDashboardAuthConfig,
  getDashboardOnboardingConfig,
  ensureEnvFile,
  getDashboardEnvConfig,
  getDashboardRuntimeConfig,
  getNextOnboardingStep,
  saveDashboardEnvConfig,
};
