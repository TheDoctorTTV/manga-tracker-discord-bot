const http = require('http');
const fs = require('fs');
const path = require('path');
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
const {
  getDashboardEnvConfig,
  getDashboardRuntimeConfig,
  getNextOnboardingStep,
  saveDashboardEnvConfig,
} = require('../services/envFileService');
const {
  randomToken,
  buildDiscordLoginUrl,
  exchangeDiscordCode,
  fetchDiscordIdentity,
  computeAllowedGuildIds,
} = require('../services/dashboardAuthService');

const DASHBOARD_SESSION_COOKIE = 'dashboard_session';
const DASHBOARD_OAUTH_STATE_COOKIE = 'dashboard_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendCss(res, css) {
  res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
  res.end(css);
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
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

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.split('=');
    const key = (rawKey || '').trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(rawValue.join('=').trim());
  }
  return cookies;
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Number.parseInt(options.maxAge, 10) || 0)}`);
  if (options.secure) parts.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const nextCookie = parts.join('; ');
  if (!existing) {
    res.setHeader('Set-Cookie', nextCookie);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, nextCookie]);
    return;
  }
  res.setHeader('Set-Cookie', [existing, nextCookie]);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0, httpOnly: true, sameSite: 'Lax' });
}

function isLocalRequest(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const host = String(req.headers.host || '').split(':')[0].trim().toLowerCase();
  const remote = String(req.socket?.remoteAddress || '').trim();
  const candidates = [forwarded, remote, host].filter(Boolean);
  return candidates.some((value) => {
    const normalized = value.replace(/^::ffff:/, '').toLowerCase();
    return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
  });
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

const DASHBOARD_HTML_PATH = path.join(__dirname, 'dashboard.html');
const ONBOARDING_HTML_PATH = path.join(__dirname, 'onboarding.html');
const LOGIN_HTML_PATH = path.join(__dirname, 'login.html');
const DASHBOARD_CSS_PATH = path.join(__dirname, 'dashboard.css');
const DASHBOARD_ICON_CANDIDATES = [
  path.resolve(process.cwd(), 'WebsiteLogo.ico'),
  path.resolve(process.cwd(), 'favicon.ico'),
  path.join(__dirname, 'WebsiteLogo.ico'),
  path.join(__dirname, 'favicon.ico'),
];

let dashboardHtmlTemplate = null;
let onboardingHtmlTemplate = null;
let loginHtmlTemplate = null;
let dashboardCss = null;
let dashboardIcon = undefined;

function loadDashboardAssets() {
  if (dashboardHtmlTemplate === null) {
    dashboardHtmlTemplate = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');
  }

  if (dashboardCss === null) {
    dashboardCss = fs.readFileSync(DASHBOARD_CSS_PATH, 'utf8');
  }

  if (onboardingHtmlTemplate === null) {
    onboardingHtmlTemplate = fs.readFileSync(ONBOARDING_HTML_PATH, 'utf8');
  }

  if (loginHtmlTemplate === null) {
    loginHtmlTemplate = fs.readFileSync(LOGIN_HTML_PATH, 'utf8');
  }

  if (dashboardIcon === undefined) {
    const iconPath = DASHBOARD_ICON_CANDIDATES.find((candidate) => fs.existsSync(candidate));
    dashboardIcon = iconPath ? fs.readFileSync(iconPath) : null;
  }
}

function getDashboardHtml() {
  loadDashboardAssets();
  return dashboardHtmlTemplate
    .replace(/\$\{MIN_AUTO_CHECK_HOURS\}/g, String(MIN_AUTO_CHECK_HOURS))
    .replace(/\$\{MAX_AUTO_CHECK_HOURS\}/g, String(MAX_AUTO_CHECK_HOURS));
}

function getOnboardingHtml() {
  loadDashboardAssets();
  return onboardingHtmlTemplate;
}

function getLoginHtml() {
  loadDashboardAssets();
  return loginHtmlTemplate;
}

function getDashboardCss() {
  loadDashboardAssets();
  return dashboardCss;
}

function getDashboardIcon() {
  loadDashboardAssets();
  return dashboardIcon;
}

function startDashboardServer({ service, updater, botController }) {
  const updaterState = {
    checking: false,
    applying: false,
    lastCheck: null,
    lastApply: null,
    lastError: null,
    availableReleases: [],
    releaseMode: 'release',
  };
  const sessions = new Map();

  function pruneSessions() {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
      if (!session || session.expiresAt <= now) {
        sessions.delete(token);
      }
    }
  }

  function getSession(req) {
    pruneSessions();
    const cookies = parseCookies(req);
    const token = cookies[DASHBOARD_SESSION_COOKIE];
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    return { token, ...session };
  }

  function getUpdaterStatus() {
    return {
      ...updaterState,
      updaterState: updater ? updater.getState() : null,
    };
  }

  function getAccessContext(req) {
    const runtime = getDashboardRuntimeConfig();
    const local = isLocalRequest(req);
    const session = getSession(req);

    if (!runtime.onboarding.completed) {
      return {
        runtime,
        local,
        session: null,
        authenticated: true,
        allowed: true,
        bootstrapMode: true,
        reason: null,
      };
    }

    if (!runtime.dashboardAuth.enabled || !runtime.dashboardAuth.configured) {
      if (local) {
        return {
          runtime,
          local,
          session: null,
          authenticated: true,
          allowed: true,
          bootstrapMode: true,
          reason: null,
        };
      }

      return {
        runtime,
        local,
        session: null,
        authenticated: false,
        allowed: false,
        bootstrapMode: true,
        reason: 'Dashboard auth is not configured. Access is limited to localhost during setup.',
      };
    }

    if (!session) {
      return {
        runtime,
        local,
        session: null,
        authenticated: false,
        allowed: false,
        bootstrapMode: false,
        reason: 'Authentication required.',
      };
    }

    return {
      runtime,
      local,
      session,
      authenticated: true,
      allowed: true,
      bootstrapMode: false,
      reason: null,
    };
  }

  function resolveGuildContext(requestUrl, access) {
    const guildId = String(requestUrl.searchParams.get('guildId') || '').trim();
    if (!/^\d+$/.test(guildId)) {
      throw new Error('guildId query parameter is required and must be numeric');
    }

    const managedGuildIds = access.runtime.dashboardAuth.managedGuildIds;
    if (!managedGuildIds.includes(guildId)) {
      throw new Error('guildId is not in DASHBOARD_MANAGED_GUILD_IDS');
    }

    if (access.session && Array.isArray(access.session.allowedGuildIds) && !access.session.allowedGuildIds.includes(guildId)) {
      const error = new Error('You do not have admin permission for this guild');
      error.statusCode = 403;
      throw error;
    }

    return guildId;
  }

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${DASHBOARD_HOST}:${DASHBOARD_PORT}`}`);
    const pathName = requestUrl.pathname;
    const access = getAccessContext(req);

    if (req.method === 'GET' && pathName === '/') {
      if (!access.runtime.onboarding.completed) {
        sendRedirect(res, '/onboarding');
        return;
      }
      if (!access.allowed) {
        sendRedirect(res, '/login');
        return;
      }
      sendHtml(res, getDashboardHtml());
      return;
    }

    if (req.method === 'GET' && pathName === '/onboarding') {
      if (access.runtime.onboarding.completed) {
        sendRedirect(res, '/');
        return;
      }
      if (!access.allowed) {
        sendRedirect(res, '/login');
        return;
      }
      sendHtml(res, getOnboardingHtml());
      return;
    }

    if (req.method === 'GET' && pathName === '/login') {
      if (access.allowed) {
        if (!access.runtime.onboarding.completed) {
          sendRedirect(res, '/onboarding');
          return;
        }
        sendRedirect(res, '/');
        return;
      }
      sendHtml(res, getLoginHtml());
      return;
    }

    if (req.method === 'GET' && pathName === '/dashboard.css') {
      sendCss(res, getDashboardCss());
      return;
    }

    if (req.method === 'GET' && pathName === '/favicon.ico') {
      const icon = getDashboardIcon();
      if (!icon) {
        sendJson(res, 404, { error: 'Favicon not found' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=86400' });
      res.end(icon);
      return;
    }

    if (req.method === 'GET' && pathName === '/status') {
      sendJson(res, 200, { status: 'ok', service: 'admin-dashboard' });
      return;
    }

    if (req.method === 'GET' && pathName === '/auth/discord/login') {
      const runtime = getDashboardRuntimeConfig();
      if (!runtime.dashboardAuth.configured) {
        sendJson(res, 400, { error: 'Dashboard auth is not configured yet.' });
        return;
      }

      const state = randomToken(24);
      const loginUrl = buildDiscordLoginUrl({
        clientId: runtime.values.DISCORD_AUTH_CLIENT_ID,
        redirectUri: runtime.dashboardAuth.callbackUrl,
        state,
      });

      setCookie(res, DASHBOARD_OAUTH_STATE_COOKIE, state, {
        maxAge: OAUTH_STATE_TTL_SECONDS,
        httpOnly: true,
        sameSite: 'Lax',
        secure: runtime.dashboardAuth.publicUrl.startsWith('https://'),
      });
      sendRedirect(res, loginUrl);
      return;
    }

    if (req.method === 'GET' && pathName === '/auth/discord/callback') {
      const runtime = getDashboardRuntimeConfig();
      if (!runtime.dashboardAuth.configured) {
        sendJson(res, 400, { error: 'Dashboard auth is not configured yet.' });
        return;
      }

      const code = String(requestUrl.searchParams.get('code') || '').trim();
      const state = String(requestUrl.searchParams.get('state') || '').trim();
      const cookies = parseCookies(req);
      const expectedState = String(cookies[DASHBOARD_OAUTH_STATE_COOKIE] || '').trim();

      if (!code || !state || !expectedState || state !== expectedState) {
        clearCookie(res, DASHBOARD_OAUTH_STATE_COOKIE);
        sendJson(res, 400, { error: 'Invalid OAuth callback state or code.' });
        return;
      }

      try {
        const tokenResult = await exchangeDiscordCode({
          code,
          clientId: runtime.values.DISCORD_AUTH_CLIENT_ID,
          clientSecret: runtime.values.DISCORD_AUTH_CLIENT_SECRET,
          redirectUri: runtime.dashboardAuth.callbackUrl,
        });

        const accessToken = String(tokenResult?.access_token || '').trim();
        if (!accessToken) throw new Error('Discord token exchange failed');

        const identity = await fetchDiscordIdentity(accessToken);
        const allowedGuildIds = computeAllowedGuildIds({
          guilds: identity.guilds,
          managedGuildIds: runtime.dashboardAuth.managedGuildIds,
        });

        if (allowedGuildIds.length === 0) {
          clearCookie(res, DASHBOARD_OAUTH_STATE_COOKIE);
          sendHtml(
            res,
            '<!doctype html><html><body><h2>Access denied</h2><p>Your Discord account is not an administrator in any managed guild.</p></body></html>'
          );
          return;
        }

        const sessionToken = randomToken(24);
        const now = Date.now();
        const maxAgeSeconds = runtime.dashboardAuth.sessionHours * 60 * 60;
        sessions.set(sessionToken, {
          user: {
            id: identity.user?.id || '',
            username: identity.user?.username || '',
            globalName: identity.user?.global_name || null,
            avatar: identity.user?.avatar || null,
          },
          allowedGuildIds,
          createdAt: now,
          expiresAt: now + maxAgeSeconds * 1000,
        });

        setCookie(res, DASHBOARD_SESSION_COOKIE, sessionToken, {
          maxAge: maxAgeSeconds,
          httpOnly: true,
          sameSite: 'Lax',
          secure: runtime.dashboardAuth.publicUrl.startsWith('https://'),
        });
        clearCookie(res, DASHBOARD_OAUTH_STATE_COOKIE);
        sendRedirect(res, '/');
      } catch (error) {
        clearCookie(res, DASHBOARD_OAUTH_STATE_COOKIE);
        sendJson(res, 400, { error: error.message || 'Discord auth failed' });
      }
      return;
    }

    if ((req.method === 'POST' || req.method === 'GET') && pathName === '/auth/logout') {
      const cookies = parseCookies(req);
      const sessionToken = cookies[DASHBOARD_SESSION_COOKIE];
      if (sessionToken) {
        sessions.delete(sessionToken);
      }
      clearCookie(res, DASHBOARD_SESSION_COOKIE);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!pathName.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    if (req.method === 'GET' && pathName === '/api/admin/auth/me') {
      sendJson(res, 200, {
        authenticated: access.authenticated,
        authEnabled: access.runtime.dashboardAuth.enabled,
        authConfigured: access.runtime.dashboardAuth.configured,
        onboarding: access.runtime.onboarding,
        bootstrapMode: access.bootstrapMode,
        reason: access.reason,
        user: access.session ? access.session.user : null,
        allowedGuildIds: access.session ? access.session.allowedGuildIds : access.runtime.dashboardAuth.managedGuildIds,
        managedGuildIds: access.runtime.dashboardAuth.managedGuildIds,
        defaultGuildId: access.runtime.dashboardAuth.managedGuildIds[0] || null,
      });
      return;
    }

    if (!access.allowed) {
      sendJson(res, access.runtime.dashboardAuth.configured ? 401 : 403, { error: access.reason });
      return;
    }

    try {
      const envConfig = getDashboardEnvConfig();
      const onboarding = envConfig.onboarding;
      const onboardingUnlocked =
        (req.method === 'GET' && pathName === '/api/admin/env') ||
        (req.method === 'PUT' && pathName === '/api/admin/env') ||
        (req.method === 'GET' && pathName === '/api/admin/onboarding/status') ||
        (req.method === 'POST' && pathName === '/api/admin/onboarding/step') ||
        (req.method === 'POST' && pathName === '/api/admin/onboarding/complete') ||
        (req.method === 'POST' && pathName === '/api/admin/onboarding/reset');
      if (!onboarding.completed && !onboardingUnlocked) {
        sendJson(res, 423, {
          error: 'Onboarding is incomplete. Complete setup in Settings before using other dashboard features.',
          onboarding,
        });
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/home') {
        const guildId = resolveGuildContext(requestUrl, access);
        const summary = service.getAdminSummaryForGuild(guildId);
        const memoryRssMb = Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
        const botRuntime = botController ? botController.getStatus() : { status: 'unknown' };
        sendJson(res, 200, {
          botStatus: botRuntime.status || 'unknown',
          botRuntime,
          users: summary.users,
          totalTracked: summary.totalTracked,
          sources: summary.sources,
          enabledSources: summary.enabledSources,
          defaultSource: summary.defaultSource,
          activeGuildId: guildId,
          pid: process.pid,
          uptimeHuman: formatUptime(process.uptime()),
          memoryRssMb,
          oauthInvite: envConfig.oauthInvite,
        });
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/guilds') {
        const guildIds = access.session ? access.session.allowedGuildIds : access.runtime.dashboardAuth.managedGuildIds;
        sendJson(res, 200, {
          guildIds,
          defaultGuildId: guildIds[0] || null,
        });
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/bot/status') {
        if (!botController) {
          sendJson(res, 400, { error: 'Bot controller is not configured' });
          return;
        }
        sendJson(res, 200, botController.getStatus());
        return;
      }

      if (req.method === 'POST' && pathName === '/api/admin/bot/start') {
        if (!botController) {
          sendJson(res, 400, { error: 'Bot controller is not configured' });
          return;
        }
        sendJson(res, 200, await botController.start());
        return;
      }

      if (req.method === 'POST' && pathName === '/api/admin/bot/stop') {
        if (!botController) {
          sendJson(res, 400, { error: 'Bot controller is not configured' });
          return;
        }
        sendJson(res, 200, await botController.stop());
        return;
      }

      if (req.method === 'POST' && pathName === '/api/admin/bot/restart') {
        if (!botController) {
          sendJson(res, 400, { error: 'Bot controller is not configured' });
          return;
        }
        sendJson(res, 200, await botController.restart());
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/about') {
        sendJson(res, 200, {
          creator: BOT_CREATOR,
          version: BOT_VERSION,
          repo: BOT_GITHUB_REPO,
          updateSystem:
            'Built-in updater uses the public GitHub Releases feed and a detached worker process to replace the bot binary and restart the configured systemd service.',
        });
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/env') {
        sendJson(res, 200, envConfig);
        return;
      }

      if (req.method === 'PUT' && pathName === '/api/admin/env') {
        const body = await getRequestBody(req);
        const values = body && typeof body.values === 'object' ? body.values : {};
        sendJson(res, 200, saveDashboardEnvConfig(values));
        return;
      }

      if (req.method === 'GET' && pathName === '/api/admin/onboarding/status') {
        sendJson(res, 200, { onboarding: envConfig.onboarding });
        return;
      }

      if (req.method === 'POST' && pathName === '/api/admin/onboarding/step') {
        const body = await getRequestBody(req);
        const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
        let updates = {};
        const current = envConfig.onboarding;
        const stepIndex = current.currentStep;
        const activeStep = Array.isArray(current.steps) ? current.steps.find((step) => step.index === stepIndex) : null;

        if (action === 'reset') {
          updates = {
            DASHBOARD_SETUP_COMPLETED: 'false',
            DASHBOARD_ONBOARDING_STEP: '1',
            DASHBOARD_ONBOARDING_INVITE_CONFIRMED: 'false',
            DASHBOARD_ONBOARDING_CALLBACK_CONFIRMED: 'false',
          };
        } else if (action === 'prev') {
          updates = {
            DASHBOARD_SETUP_COMPLETED: 'false',
            DASHBOARD_ONBOARDING_STEP: String(Math.max(1, stepIndex - 1)),
          };
        } else if (action === 'confirm_external') {
          if (!activeStep || (stepIndex !== 2 && stepIndex !== 3)) {
            sendJson(res, 400, {
              error: 'External confirmation is only valid for Step 2 or Step 3.',
              onboarding: current,
            });
            return;
          }
          if (!activeStep.ready) {
            sendJson(res, 400, { error: activeStep.blockedReason || 'Step requirements are incomplete.', onboarding: current });
            return;
          }
          updates = {
            DASHBOARD_SETUP_COMPLETED: 'false',
            ...(stepIndex === 2
              ? { DASHBOARD_ONBOARDING_INVITE_CONFIRMED: 'true' }
              : { DASHBOARD_ONBOARDING_CALLBACK_CONFIRMED: 'true' }),
          };
          const postConfirm = saveDashboardEnvConfig(updates);
          const nextOnboarding = postConfirm.onboarding;
          const activePostConfirm = Array.isArray(nextOnboarding.steps)
            ? nextOnboarding.steps.find((step) => step.index === nextOnboarding.currentStep)
            : null;
          if (activePostConfirm && activePostConfirm.complete && nextOnboarding.currentStep < 3) {
            const advanced = saveDashboardEnvConfig({
              DASHBOARD_ONBOARDING_STEP: String(Math.min(3, nextOnboarding.currentStep + 1)),
            });
            sendJson(res, 200, { onboarding: advanced.onboarding });
            return;
          }
          sendJson(res, 200, { onboarding: nextOnboarding });
          return;
        } else if (action === 'save_and_verify') {
          if (!activeStep) {
            sendJson(res, 400, { error: 'Invalid onboarding step.', onboarding: current });
            return;
          }
          if (!activeStep.complete) {
            sendJson(res, 400, { error: activeStep.blockedReason || 'Step requirements are incomplete.', onboarding: current });
            return;
          }
          updates = {
            DASHBOARD_SETUP_COMPLETED: 'false',
            DASHBOARD_ONBOARDING_STEP: String(Math.min(3, Math.max(getNextOnboardingStep(current), stepIndex + 1))),
          };
        } else {
          sendJson(res, 400, { error: 'Invalid onboarding action.', onboarding: current });
          return;
        }

        const updated = saveDashboardEnvConfig(updates);
        sendJson(res, 200, { onboarding: updated.onboarding });
        return;
      }

      if (req.method === 'POST' && pathName === '/api/admin/onboarding/complete') {
        if (!envConfig.onboarding.readyToComplete) {
          sendJson(res, 400, {
            error: 'Setup requirements are incomplete.',
            onboarding: envConfig.onboarding,
          });
          return;
        }
        const updated = saveDashboardEnvConfig({
          DASHBOARD_SETUP_COMPLETED: 'true',
          DASHBOARD_AUTH_ENABLED: 'true',
          DASHBOARD_ONBOARDING_STEP: '3',
        });
        sendJson(res, 200, { onboarding: updated.onboarding });
        return;
      }

      if (req.method === 'POST' && pathName === '/api/admin/onboarding/reset') {
        const updated = saveDashboardEnvConfig({
          DASHBOARD_SETUP_COMPLETED: 'false',
          DASHBOARD_ONBOARDING_STEP: '1',
          DASHBOARD_ONBOARDING_INVITE_CONFIRMED: 'false',
          DASHBOARD_ONBOARDING_CALLBACK_CONFIRMED: 'false',
        });
        sendJson(res, 200, { onboarding: updated.onboarding });
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

        const body = await getRequestBody(req);
        const releaseModeRaw = typeof body.releaseMode === 'string' ? body.releaseMode.trim().toLowerCase() : '';
        const releaseMode = releaseModeRaw === 'prerelease' ? 'prerelease' : 'release';
        const tagName = typeof body.tagName === 'string' ? body.tagName.trim() : '';

        updaterState.checking = true;
        updaterState.lastError = null;
        updaterState.releaseMode = releaseMode;
        try {
          updaterState.lastCheck = await updater.checkForUpdate({ releaseMode, tagName });
          updaterState.availableReleases = Array.isArray(updaterState.lastCheck.releases) ? updaterState.lastCheck.releases : [];
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
        const releaseModeRaw = typeof body.releaseMode === 'string' ? body.releaseMode.trim().toLowerCase() : '';
        const releaseMode = releaseModeRaw === 'prerelease' ? 'prerelease' : 'release';
        const tagName = typeof body.tagName === 'string' ? body.tagName.trim() : '';

        updaterState.applying = true;
        updaterState.lastError = null;
        updaterState.releaseMode = releaseMode;
        try {
          updaterState.lastApply = await updater.applyUpdate({ assetName, releaseMode, tagName });
          updaterState.lastCheck = {
            currentVersion:
              updaterState.lastApply.currentVersion ||
              updaterState.lastApply.fromVersion ||
              (updaterState.lastCheck ? updaterState.lastCheck.currentVersion : null),
            latestVersion:
              updaterState.lastApply.latestVersion ||
              updaterState.lastApply.toVersion ||
              (updaterState.lastCheck ? updaterState.lastCheck.latestVersion : null),
            updateAvailable: Boolean(updaterState.lastApply.updateAvailable),
            release: updaterState.lastApply.release || null,
            warning: updaterState.lastApply.warning || updaterState.lastApply.reason || null,
          };
          updaterState.availableReleases = Array.isArray(updaterState.lastApply.releases)
            ? updaterState.lastApply.releases
            : updaterState.availableReleases;
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

      if (req.method === 'GET' && pathName === '/api/admin/source-adapters') {
        sendJson(res, 200, { adapters: service.getSourceAdapterCatalog() });
        return;
      }

      if (req.method === 'PUT' && pathName === '/api/admin/sources') {
        const body = await getRequestBody(req);
        sendJson(res, 200, service.saveSourcesConfig(body));
        return;
      }

      if (req.method === 'GET' && pathName === '/api/users') {
        const guildId = resolveGuildContext(requestUrl, access);
        sendJson(res, 200, { users: service.listGuildUsers(guildId) });
        return;
      }

      const userMatch = pathName.match(/^\/api\/users\/(\d+)$/);
      if (req.method === 'GET' && userMatch) {
        const guildId = resolveGuildContext(requestUrl, access);
        const userId = userMatch[1];
        sendJson(res, 200, { user: service.getGuildUserData(guildId, userId, { allowLegacyFallback: true }) });
        return;
      }

      if (req.method === 'DELETE' && userMatch) {
        const guildId = resolveGuildContext(requestUrl, access);
        const userId = userMatch[1];
        const deleted = service.deleteGuildUser(guildId, userId);
        if (!deleted) {
          sendJson(res, 404, { error: 'User not found' });
          return;
        }
        sendJson(res, 200, { deleted: true });
        return;
      }

      const settingsMatch = pathName.match(/^\/api\/users\/(\d+)\/settings$/);
      if (req.method === 'PUT' && settingsMatch) {
        const guildId = resolveGuildContext(requestUrl, access);
        const userId = settingsMatch[1];
        const body = await getRequestBody(req);
        const updated = service.setGuildUserSettings(guildId, userId, {
          preferredSource: body.preferredSource,
          autoCheckIntervalHours: body.autoCheckIntervalHours,
        });
        sendJson(res, 200, { user: updated });
        return;
      }

      const trackedMatch = pathName.match(/^\/api\/users\/(\d+)\/tracked$/);
      if (req.method === 'POST' && trackedMatch) {
        const guildId = resolveGuildContext(requestUrl, access);
        const userId = trackedMatch[1];
        const body = await getRequestBody(req);
        const result = await service.addTrackedByInputForGuild(guildId, userId, body.input, body.sourceHint);

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
        const guildId = resolveGuildContext(requestUrl, access);
        const userId = trackedMatch[1];
        const source = (requestUrl.searchParams.get('source') || '').trim().toLowerCase();
        const mangaId = (requestUrl.searchParams.get('mangaId') || '').trim();

        if (!source || !mangaId) {
          sendJson(res, 400, { error: 'source and mangaId query params are required.' });
          return;
        }

        const removed = service.removeTrackedByTargetForGuild(guildId, userId, { source, mangaId });
        if (!removed) {
          sendJson(res, 404, { error: 'Tracked manga entry not found.' });
          return;
        }

        sendJson(res, 200, { removed });
        return;
      }

      sendJson(res, 404, { error: 'Route not found' });
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 400;
      sendJson(res, statusCode, { error: error.message || 'Request failed' });
    }
  });

  server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
    console.log(`Admin dashboard running at http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`);
  });

  return server;
}

module.exports = {
  startDashboardServer,
};
