const path = require('path');

const BOT_VERSION = '1.0.0';
const MANGADEX_API = 'https://api.mangadex.org';
const COMIX_API_BASE = 'https://comix.to/api/v2';
const MANGA_DIR = path.resolve(process.env.MANGA_DATA_DIR || './manga_data');
const MANGA_SOURCES_FILE = path.resolve(process.env.MANGA_SOURCES_FILE || './manga-sources.json');
const REQUIRED_ENV_VARS = ['DISCORD_TOKEN'];
const STATUS_PORT = Number.parseInt(process.env.STATUS_PORT || '25589', 10);
const DASHBOARD_PORT = Number.parseInt(process.env.DASHBOARD_PORT || '9898', 10);
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const BOT_CREATOR = process.env.BOT_CREATOR || 'TheDoctorTTV';
const BOT_GITHUB_REPO = process.env.BOT_GITHUB_REPO || 'https://github.com/TheDoctorTTV/manga-tracker-discord-bot';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMIX_ID_REGEX = /^[a-z0-9]{4,}$/i;
const MIN_AUTO_CHECK_HOURS = 6;
const MAX_AUTO_CHECK_HOURS = 24 * 7;
const DEFAULT_AUTO_CHECK_HOURS = 24;
const PENDING_ACTION_TTL_MS = 5 * 60 * 1000;

module.exports = {
  BOT_VERSION,
  MANGADEX_API,
  COMIX_API_BASE,
  MANGA_DIR,
  MANGA_SOURCES_FILE,
  REQUIRED_ENV_VARS,
  STATUS_PORT,
  DASHBOARD_PORT,
  DASHBOARD_HOST,
  BOT_CREATOR,
  BOT_GITHUB_REPO,
  UUID_REGEX,
  COMIX_ID_REGEX,
  MIN_AUTO_CHECK_HOURS,
  MAX_AUTO_CHECK_HOURS,
  DEFAULT_AUTO_CHECK_HOURS,
  PENDING_ACTION_TTL_MS,
};
