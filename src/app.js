require('dotenv').config();

const { REQUIRED_ENV_VARS, MANGA_SOURCES_FILE, BOT_VERSION, BOT_GITHUB_REPO } = require('./config');
const { MangaTrackerService } = require('./services/mangaTrackerService');
const { GitHubReleaseUpdater } = require('./services/githubReleaseUpdater');
const { createDiscordBot } = require('./bot/discordBot');
const { startStatusServer } = require('./web/statusServer');
const { startDashboardServer } = require('./web/dashboardServer');

function requireEnvVars() {
  const missingVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }
}

async function start() {
  requireEnvVars();

  const service = new MangaTrackerService({ mangaSourcesFile: MANGA_SOURCES_FILE });
  const updater = new GitHubReleaseUpdater({
    repoUrl: process.env.BOT_GITHUB_REPO || BOT_GITHUB_REPO,
    currentVersion: BOT_VERSION,
  });

  startStatusServer();
  startDashboardServer({ service, updater });

  const bot = createDiscordBot({ service, discordToken: process.env.DISCORD_TOKEN });
  await bot.start();
}

start().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
