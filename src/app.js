const { ensureEnvFile, ENV_FILE_PATH } = require('./services/envFileService');

ensureEnvFile();
require('dotenv').config({ path: ENV_FILE_PATH });

const { MANGA_SOURCES_FILE, BOT_VERSION, BOT_GITHUB_REPO } = require('./config');
const { MangaTrackerService } = require('./services/mangaTrackerService');
const { GitHubReleaseUpdater } = require('./services/githubReleaseUpdater');
const { createDiscordBot } = require('./bot/discordBot');
const { startStatusServer } = require('./web/statusServer');
const { startDashboardServer } = require('./web/dashboardServer');

function makeBotRuntimeController({ service }) {
  let bot = null;
  const state = {
    status: 'stopped',
    startedAt: null,
    stoppedAt: null,
    lastError: null,
  };

  function getStatus() {
    return {
      status: state.status,
      startedAt: state.startedAt,
      stoppedAt: state.stoppedAt,
      lastError: state.lastError,
    };
  }

  async function start() {
    if (state.status === 'running') return getStatus();
    if (state.status === 'starting') throw new Error('Bot start already in progress');
    if (state.status === 'stopping') throw new Error('Bot stop is in progress');

    const token = String(process.env.DISCORD_TOKEN || '').trim();
    if (!token) {
      state.lastError = 'DISCORD_TOKEN is not configured.';
      throw new Error(state.lastError);
    }

    state.status = 'starting';
    state.lastError = null;

    try {
      bot = createDiscordBot({ service, discordToken: token });
      await bot.start();
      state.status = 'running';
      state.startedAt = new Date().toISOString();
      return getStatus();
    } catch (error) {
      state.status = 'stopped';
      state.lastError = error.message || 'Bot failed to start';
      bot = null;
      throw error;
    }
  }

  async function stop() {
    if (state.status === 'stopped') return getStatus();
    if (state.status === 'stopping') throw new Error('Bot stop already in progress');
    if (state.status === 'starting') throw new Error('Bot start is in progress');

    state.status = 'stopping';
    state.lastError = null;

    try {
      if (bot) {
        await bot.stop();
      }
      bot = null;
      state.status = 'stopped';
      state.stoppedAt = new Date().toISOString();
      return getStatus();
    } catch (error) {
      state.status = 'stopped';
      state.lastError = error.message || 'Bot failed to stop';
      bot = null;
      throw error;
    }
  }

  async function restart() {
    if (state.status === 'starting' || state.status === 'stopping') {
      throw new Error(`Bot is currently ${state.status}`);
    }
    await stop();
    return start();
  }

  return {
    getStatus,
    start,
    stop,
    restart,
  };
}

async function start() {
  const service = new MangaTrackerService({ mangaSourcesFile: MANGA_SOURCES_FILE });
  const updater = new GitHubReleaseUpdater({
    repoUrl: BOT_GITHUB_REPO,
    currentVersion: BOT_VERSION,
  });
  const botController = makeBotRuntimeController({ service });

  startStatusServer();
  startDashboardServer({ service, updater, botController });

  if (String(process.env.DISCORD_TOKEN || '').trim()) {
    try {
      await botController.start();
    } catch (error) {
      console.error('Bot failed to start automatically:', error.message || error);
    }
  } else {
    console.warn('DISCORD_TOKEN not set. Dashboard is running; start the bot from Settings after saving a token.');
  }
}

start().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
