require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const schedule = require('node-schedule');
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    EmbedBuilder,
    AttachmentBuilder,
    MessageFlags,
    ActivityType,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], partials: ['CHANNEL'] });
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const BOT_VERSION = 'v3.1.0';
const MANGADEX_API = 'https://api.mangadex.org';
const MANGA_DIR = './manga_data';
const MANGA_SOURCES_FILE = './manga-sources.json';
const REQUIRED_ENV_VARS = ['DISCORD_TOKEN'];
const STATUS_PORT = 25589;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMIX_ID_REGEX = /^[a-z0-9]{4,}$/i;
const MIN_AUTO_CHECK_HOURS = 6;
const MAX_AUTO_CHECK_HOURS = 24 * 7;
const DEFAULT_AUTO_CHECK_HOURS = 24;

if (!fs.existsSync(MANGA_DIR)) fs.mkdirSync(MANGA_DIR);

function loadMangaSourcesConfig() {
    const fallback = {
        defaultSource: 'mangadex',
        sources: [
            {
                key: 'mangadex',
                displayName: 'MangaDex',
                hosts: ['mangadex.org', 'www.mangadex.org'],
                titleUrl: 'https://mangadex.org/title/',
            },
            {
                key: 'comix',
                displayName: 'Comix',
                hosts: ['comix.to', 'www.comix.to'],
                titleUrl: 'https://comix.to/title/',
            },
        ],
    };

    try {
        if (!fs.existsSync(MANGA_SOURCES_FILE)) return fallback;

        const parsed = JSON.parse(fs.readFileSync(MANGA_SOURCES_FILE, 'utf8'));
        if (!parsed || !Array.isArray(parsed.sources) || parsed.sources.length === 0) return fallback;

        const normalized = {
            defaultSource: typeof parsed.defaultSource === 'string' ? parsed.defaultSource : fallback.defaultSource,
            sources: parsed.sources
                .map((source) => {
                    if (!source || typeof source !== 'object') return null;
                    if (typeof source.key !== 'string' || !source.key.trim()) return null;
                    const hosts = Array.isArray(source.hosts)
                        ? source.hosts.filter((host) => typeof host === 'string' && host.trim())
                        : [];
                    if (hosts.length === 0) return null;

                    return {
                        key: source.key.trim().toLowerCase(),
                        displayName:
                            typeof source.displayName === 'string' && source.displayName.trim()
                                ? source.displayName.trim()
                                : source.key.trim(),
                        hosts: hosts.map((host) => host.trim().toLowerCase()),
                        titleUrl:
                            typeof source.titleUrl === 'string' && source.titleUrl.trim()
                                ? source.titleUrl.trim()
                                : null,
                    };
                })
                .filter(Boolean),
        };

        if (normalized.sources.length === 0) return fallback;
        if (!normalized.sources.some((source) => source.key === normalized.defaultSource)) {
            normalized.defaultSource = normalized.sources[0].key;
        }

        return normalized;
    } catch (error) {
        console.error(`Unable to read ${MANGA_SOURCES_FILE}, using defaults:`, error.message);
        return fallback;
    }
}

const MANGA_SOURCES = loadMangaSourcesConfig();
const MANGA_SOURCE_MAP = new Map(MANGA_SOURCES.sources.map((source) => [source.key, source]));
const SUPPORTED_SOURCES_LABEL = MANGA_SOURCES.sources.map((source) => source.displayName).join(', ');
const COMIX_API_BASE = 'https://comix.to/api/v2';
const PENDING_ACTION_TTL_MS = 5 * 60 * 1000;
const pendingFallbackActions = new Map();

function sanitizeUsername(username) {
    return username.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function requireEnvVars() {
    const missingVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
    if (missingVars.length > 0) {
        console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
        process.exit(1);
    }
}

function getUserFilePath(userId) {
    return path.join(MANGA_DIR, `${userId}.json`);
}

function getLegacyUserFilePath(username) {
    const sanitizedUsername = sanitizeUsername(username);
    return path.join(MANGA_DIR, `${sanitizedUsername}.json`);
}

function migrateLegacyUsernameFile(userId, username) {
    const userFilePath = getUserFilePath(userId);
    const legacyFilePath = getLegacyUserFilePath(username);

    if (!fs.existsSync(legacyFilePath) || fs.existsSync(userFilePath)) {
        return;
    }

    fs.renameSync(legacyFilePath, userFilePath);
}

function normalizeTrackedEntry(entry) {
    if (typeof entry === 'string' && UUID_REGEX.test(entry)) {
        return {
            source: 'mangadex',
            mangaId: entry,
            title: null,
            lastNotifiedChapterId: null,
            lastSeenChapterNumber: null,
            lastSeenChapterCount: null,
        };
    }

    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const mangaId = typeof (entry.mangaId || entry.id) === 'string' ? (entry.mangaId || entry.id).trim() : null;
    if (!mangaId) {
        return null;
    }
    const implicitSource = UUID_REGEX.test(mangaId) ? 'mangadex' : MANGA_SOURCES.defaultSource;
    const sourceKeyRaw = typeof entry.source === 'string' ? entry.source.trim().toLowerCase() : implicitSource;
    const sourceKey = MANGA_SOURCE_MAP.has(sourceKeyRaw) ? sourceKeyRaw : implicitSource;

    const isMangadex = sourceKey === 'mangadex';
    const isValidId = isMangadex ? UUID_REGEX.test(mangaId) : COMIX_ID_REGEX.test(mangaId);
    if (!isValidId) {
        return null;
    }

    return {
        source: sourceKey,
        mangaId,
        title: typeof entry.title === 'string' ? entry.title : null,
        lastNotifiedChapterId: typeof entry.lastNotifiedChapterId === 'string' ? entry.lastNotifiedChapterId : null,
        lastSeenChapterNumber: typeof entry.lastSeenChapterNumber === 'string' ? entry.lastSeenChapterNumber : null,
        lastSeenChapterCount: Number.isInteger(entry.lastSeenChapterCount) ? entry.lastSeenChapterCount : null,
    };
}

function normalizeUserData(rawData) {
    const rawPreferredSource =
        rawData && typeof rawData.preferredSource === 'string' ? rawData.preferredSource.trim().toLowerCase() : null;
    const preferredSource = MANGA_SOURCE_MAP.has(rawPreferredSource) ? rawPreferredSource : MANGA_SOURCES.defaultSource;

    if (Array.isArray(rawData)) {
        const tracked = rawData.map(normalizeTrackedEntry).filter(Boolean);
        return {
            version: 3,
            autoCheckIntervalHours: DEFAULT_AUTO_CHECK_HOURS,
            lastAutoCheckAt: null,
            preferredSource,
            tracked,
        };
    }

    if (rawData && Array.isArray(rawData.tracked)) {
        const tracked = rawData.tracked.map(normalizeTrackedEntry).filter(Boolean);
        const interval = Number.isInteger(rawData.autoCheckIntervalHours)
            ? rawData.autoCheckIntervalHours
            : DEFAULT_AUTO_CHECK_HOURS;
        const autoCheckIntervalHours = Math.min(MAX_AUTO_CHECK_HOURS, Math.max(MIN_AUTO_CHECK_HOURS, interval));
        const lastAutoCheckAt =
            typeof rawData.lastAutoCheckAt === 'string' && !Number.isNaN(Date.parse(rawData.lastAutoCheckAt))
                ? rawData.lastAutoCheckAt
                : null;

        return { version: 3, autoCheckIntervalHours, lastAutoCheckAt, preferredSource, tracked };
    }

    return {
        version: 3,
        autoCheckIntervalHours: DEFAULT_AUTO_CHECK_HOURS,
        lastAutoCheckAt: null,
        preferredSource,
        tracked: [],
    };
}

function getUserData(userId) {
    const filePath = getUserFilePath(userId);
    if (!fs.existsSync(filePath)) {
        return normalizeUserData(null);
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return normalizeUserData(parsed);
    } catch (error) {
        console.error(`Error parsing user data for ${userId}:`, error.message);
        return normalizeUserData(null);
    }
}

function saveUserData(userId, data) {
    const filePath = getUserFilePath(userId);
    const normalized = normalizeUserData(data);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
}

function pickMangaTitle(attributes = {}) {
    const titleMap = attributes.title || {};
    if (titleMap.en) return titleMap.en;

    const altTitles = Array.isArray(attributes.altTitles) ? attributes.altTitles : [];
    for (const altTitle of altTitles) {
        if (altTitle.en) return altTitle.en;
    }

    const firstTitle = Object.values(titleMap)[0];
    return firstTitle || 'Unknown Title';
}

function getSourceDisplayName(sourceKey) {
    return MANGA_SOURCE_MAP.get(sourceKey)?.displayName || sourceKey;
}

function getPreferredSource(userData) {
    const sourceKey = typeof userData?.preferredSource === 'string' ? userData.preferredSource.trim().toLowerCase() : '';
    return MANGA_SOURCE_MAP.has(sourceKey) ? sourceKey : MANGA_SOURCES.defaultSource;
}

function getOtherSources(sourceKey) {
    return MANGA_SOURCES.sources.map((source) => source.key).filter((key) => key !== sourceKey);
}

function getTitleUrlForSource(sourceKey, mangaId) {
    const source = MANGA_SOURCE_MAP.get(sourceKey);
    if (!source || !source.titleUrl) return null;
    return `${source.titleUrl}${mangaId}`;
}

function findTrackedEntryByInput(userData, input, sourceKey) {
    const target = extractMangaTarget(input);
    if (target && target.source === sourceKey) {
        return userData.tracked.find((entry) => isSameTrackedTarget(entry, target)) || null;
    }

    if (typeof input !== 'string') return null;
    const query = input.trim().toLowerCase();
    if (!query) return null;

    const candidates = userData.tracked.filter((entry) => entry.source === sourceKey);
    const exact = candidates.find((entry) => (entry.title || '').trim().toLowerCase() === query);
    if (exact) return exact;

    return candidates.find((entry) => (entry.title || '').trim().toLowerCase().includes(query)) || null;
}

function parseComixIdFromPath(pathname) {
    if (typeof pathname !== 'string') return null;
    const match = pathname.match(/^\/title\/([a-z0-9]+)(?:-[^/?#]+)?\/?$/i);
    if (!match || !COMIX_ID_REGEX.test(match[1])) return null;
    return match[1].toLowerCase();
}

function resolveSourceFromHostname(hostname) {
    const normalizedHost = hostname.toLowerCase();
    return MANGA_SOURCES.sources.find((source) => source.hosts.includes(normalizedHost)) || null;
}

function extractMangaTarget(value) {
    if (!value || typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    if (UUID_REGEX.test(trimmed)) {
        return { source: 'mangadex', mangaId: trimmed };
    }

    let url;
    try {
        url = new URL(trimmed);
    } catch (error) {
        return null;
    }

    const source = resolveSourceFromHostname(url.hostname);
    if (!source) return null;

    if (source.key === 'mangadex') {
        const match = url.pathname.match(/\/title\/([0-9a-f-]{36})/i);
        if (match && UUID_REGEX.test(match[1])) {
            return { source: 'mangadex', mangaId: match[1] };
        }
        return null;
    }

    if (source.key === 'comix') {
        const comixId = parseComixIdFromPath(url.pathname);
        if (comixId) {
            return { source: 'comix', mangaId: comixId };
        }
        return null;
    }

    return null;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractComixTitleMetadata(html, comixId) {
    if (typeof html !== 'string') return null;

    const escapedId = escapeRegExp(comixId.toLowerCase());
    const metadataPattern = new RegExp(
        `"hash_id":"${escapedId}"[\\s\\S]*?"title":"((?:\\\\.|[^"\\\\])*)"[\\s\\S]*?"latest_chapter":(\\d+)[\\s\\S]*?"chapter_updated_at":(\\d+)`,
        'i'
    );
    const metadataMatch = html.match(metadataPattern);
    if (!metadataMatch) return null;

    const title = (() => {
        try {
            return JSON.parse(`"${metadataMatch[1]}"`);
        } catch (error) {
            return metadataMatch[1];
        }
    })();

    const chapter = Number.parseInt(metadataMatch[2], 10);
    const updatedAtSeconds = Number.parseInt(metadataMatch[3], 10);
    const canonicalPathMatch = html.match(new RegExp(`"_link":"(\\/title\\/${escapedId}[^"]*)"`, 'i'));
    const canonicalPath = canonicalPathMatch
        ? canonicalPathMatch[1].replace(/\\\//g, '/')
        : `/title/${comixId}`;

    return {
        title: title || 'Unknown Title',
        latestChapter: Number.isFinite(chapter) ? chapter : null,
        readableAt:
            Number.isFinite(updatedAtSeconds) && updatedAtSeconds > 0
                ? new Date(updatedAtSeconds * 1000).toISOString()
                : null,
        link: `https://comix.to${canonicalPath}`,
    };
}

async function fetchMangaById(mangaId) {
    const response = await axios.get(`${MANGADEX_API}/manga/${mangaId}`);
    return response.data?.data || null;
}

async function fetchComixTitleMetadata(comixId) {
    const url = `https://comix.to/title/${comixId}`;
    const response = await axios.get(url, {
        responseType: 'text',
        transformResponse: [(data) => data],
        timeout: 15000,
        headers: { 'User-Agent': 'MangaTrackerBot/3.1.0' },
    });

    const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    return extractComixTitleMetadata(html, comixId);
}

async function fetchMangaTitleForTarget(target) {
    if (target.source === 'comix') {
        const metadata = await fetchComixTitleMetadata(target.mangaId);
        return metadata?.title || null;
    }

    const manga = await fetchMangaById(target.mangaId);
    return manga ? pickMangaTitle(manga.attributes) : null;
}

async function searchMangadex(query, limit = 5) {
    const response = await axios.get(`${MANGADEX_API}/manga`, {
        params: {
            title: query,
            limit,
            'order[relevance]': 'desc',
        },
    });

    const results = response.data?.data || [];
    return results.map((manga) => ({
        source: 'mangadex',
        mangaId: manga.id,
        title: pickMangaTitle(manga.attributes),
        link: `https://mangadex.org/title/${manga.id}`,
    }));
}

async function searchComix(query, limit = 5) {
    const response = await axios.get(`${COMIX_API_BASE}/manga`, {
        params: {
            keyword: query,
            limit,
            'order[relevance]': 'desc',
        },
        timeout: 15000,
        headers: { 'User-Agent': 'MangaTrackerBot/3.1.0' },
    });

    const items = response.data?.result?.items || [];
    return items.map((item) => ({
        source: 'comix',
        mangaId: item.hash_id,
        title: item.title || 'Unknown Title',
        link: `https://comix.to/title/${item.hash_id}${item.slug ? `-${item.slug}` : ''}`,
    }));
}

async function searchMangaOnSource(sourceKey, query, limit = 5) {
    if (sourceKey === 'comix') {
        return searchComix(query, limit);
    }

    return searchMangadex(query, limit);
}

async function findMangaTargetOnSource(sourceKey, input) {
    const directTarget = extractMangaTarget(input);
    if (directTarget && directTarget.source === sourceKey) {
        const title = await fetchMangaTitleForTarget(directTarget);
        return title
            ? {
                  source: sourceKey,
                  mangaId: directTarget.mangaId,
                  title,
              }
            : null;
    }

    const query = typeof input === 'string' ? input.trim() : '';
    if (!query) return null;

    const results = await searchMangaOnSource(sourceKey, query, 1);
    if (results.length === 0) return null;

    return {
        source: sourceKey,
        mangaId: results[0].mangaId,
        title: results[0].title,
    };
}

function buildSearchResultsEmbed(query, sourceKey, results) {
    const sourceLabel = getSourceDisplayName(sourceKey);
    const lines = results.map(
        (manga, index) => `**${index + 1}.** ${manga.title}\nID: \`${manga.mangaId}\`\n${manga.link}`
    );

    return new EmbedBuilder()
        .setTitle(`Search Results (${sourceLabel}): ${query}`)
        .setDescription(lines.join('\n\n'))
        .setColor(0x3498db);
}

async function fetchChapterSnapshot(mangaId) {
    const commonParams = {
        limit: 1,
        'manga[]': mangaId,
        'order[readableAt]': 'desc',
    };

    const withEnglish = await axios.get(`${MANGADEX_API}/chapter`, {
        params: {
            ...commonParams,
            'translatedLanguage[]': 'en',
        },
    });

    let latestChapter = withEnglish.data?.data?.[0];
    let chapterTotal = Number.isInteger(withEnglish.data?.total) ? withEnglish.data.total : null;

    if (!latestChapter) {
        const withoutLanguage = await axios.get(`${MANGADEX_API}/chapter`, { params: commonParams });
        latestChapter = withoutLanguage.data?.data?.[0];
        chapterTotal = Number.isInteger(withoutLanguage.data?.total) ? withoutLanguage.data.total : null;
    }

    if (!latestChapter) {
        return null;
    }

    return {
        id: latestChapter.id,
        chapter: latestChapter.attributes?.chapter || '?',
        title: latestChapter.attributes?.title || null,
        readableAt: latestChapter.attributes?.readableAt || null,
        link: `https://mangadex.org/chapter/${latestChapter.id}`,
        total: chapterTotal,
    };
}

async function fetchChapterSnapshotForEntry(entry) {
    if (entry.source === 'comix') {
        const metadata = await fetchComixTitleMetadata(entry.mangaId);
        if (!metadata || metadata.latestChapter === null) return null;

        const chapterLabel = String(metadata.latestChapter);
        return {
            id: `comix:${entry.mangaId}:chapter:${chapterLabel}`,
            chapter: chapterLabel,
            title: null,
            readableAt: metadata.readableAt,
            link: metadata.link || getTitleUrlForSource('comix', entry.mangaId),
            total: metadata.latestChapter,
        };
    }

    const snapshot = await fetchChapterSnapshot(entry.mangaId);
    return snapshot;
}

function parseChapterNumber(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function getTrackedEntryKey(entry) {
    const source = entry?.source || MANGA_SOURCES.defaultSource;
    return `${source}:${entry?.mangaId || ''}`;
}

function isSameTrackedTarget(entry, target) {
    return entry.source === target.source && entry.mangaId === target.mangaId;
}

function pruneExpiredPendingFallbacks() {
    const now = Date.now();
    for (const [token, action] of pendingFallbackActions.entries()) {
        if (now - action.createdAt > PENDING_ACTION_TTL_MS) {
            pendingFallbackActions.delete(token);
        }
    }
}

function storePendingFallbackAction(action) {
    pruneExpiredPendingFallbacks();
    const token = randomUUID();
    pendingFallbackActions.set(token, { ...action, createdAt: Date.now() });
    return token;
}

function getPendingFallbackAction(token) {
    pruneExpiredPendingFallbacks();
    return pendingFallbackActions.get(token) || null;
}

function clearPendingFallbackAction(token) {
    pendingFallbackActions.delete(token);
}

function buildFallbackActionRow(token) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fallback_yes:${token}`).setLabel('Search Other Sources').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fallback_no:${token}`).setLabel('No').setStyle(ButtonStyle.Secondary)
    );
}

function buildPreferredSourceSelectRow(userId, preferredSource) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`preferred_source_select:${userId}`)
        .setPlaceholder('Select your preferred source')
        .addOptions(
            MANGA_SOURCES.sources.map((source) => ({
                label: source.displayName,
                value: source.key,
                default: source.key === preferredSource,
            }))
        );

    return new ActionRowBuilder().addComponents(menu);
}

async function downloadImportedJson(attachment) {
    const urls = Array.from(new Set([attachment?.url, attachment?.proxyURL].filter(Boolean)));
    let lastError = null;

    for (const url of urls) {
        try {
            const response = await axios.get(url, {
                responseType: 'text',
                transformResponse: [(data) => data],
                timeout: 15000,
                headers: { 'User-Agent': 'MangaTrackerBot/3.1.0' },
            });

            const raw = typeof response.data === 'string' ? response.data : String(response.data ?? '');
            return JSON.parse(raw);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Unable to download JSON attachment.');
}

async function resolveTrackedMangaTitle(entry) {
    if (entry.title) return entry.title;

    try {
        let title = 'Unknown Title';

        if (entry.source === 'comix') {
            const metadata = await fetchComixTitleMetadata(entry.mangaId);
            title = metadata?.title || 'Unknown Title';
        } else {
            const manga = await fetchMangaById(entry.mangaId);
            title = pickMangaTitle(manga?.attributes);
        }

        entry.title = title;
        return title;
    } catch (error) {
        console.error(`Error resolving manga title for ${entry.source}:${entry.mangaId}:`, error.message);
        return 'Unknown Title';
    }
}

async function buildUserUpdates(userId, options = {}) {
    const userData = getUserData(userId);
    const updates = [];
    let changed = false;
    const sourceFilter = Array.isArray(options.sources) ? new Set(options.sources) : null;

    for (const entry of userData.tracked) {
        if (sourceFilter && !sourceFilter.has(entry.source)) {
            continue;
        }

        try {
            const mangaTitle = await resolveTrackedMangaTitle(entry);
            const snapshot = await fetchChapterSnapshotForEntry(entry);
            if (!snapshot) continue;

            const oldCount = Number.isInteger(entry.lastSeenChapterCount) ? entry.lastSeenChapterCount : null;
            const newCount = Number.isInteger(snapshot.total) ? snapshot.total : null;
            const oldChapterRaw = entry.lastSeenChapterNumber;
            const newChapterRaw = typeof snapshot.chapter === 'string' ? snapshot.chapter : null;
            const oldChapterNumeric = parseChapterNumber(oldChapterRaw);
            const newChapterNumeric = parseChapterNumber(newChapterRaw);

            // First scan only stores baseline and sends no notifications.
            if (!entry.lastNotifiedChapterId && oldCount === null && oldChapterRaw === null) {
                entry.lastNotifiedChapterId = snapshot.id;
                entry.lastSeenChapterNumber = newChapterRaw;
                entry.lastSeenChapterCount = newCount;
                changed = true;
                continue;
            }

            const hasMoreChapters = oldCount !== null && newCount !== null && newCount > oldCount;
            const chapterNumberIncreased =
                oldChapterNumeric !== null && newChapterNumeric !== null && newChapterNumeric > oldChapterNumeric;
            const chapterIdChanged = entry.lastNotifiedChapterId && entry.lastNotifiedChapterId !== snapshot.id;
            const chapterLabelChanged = oldChapterRaw !== newChapterRaw;

            const hasNewContent =
                hasMoreChapters ||
                chapterNumberIncreased ||
                (chapterIdChanged && chapterLabelChanged) ||
                (chapterIdChanged && oldChapterRaw === null && newChapterRaw === null);

            if (hasNewContent) {
                updates.push({
                    source: entry.source,
                    mangaId: entry.mangaId,
                    title: mangaTitle,
                    chapter: snapshot.chapter,
                    chapterTitle: snapshot.title,
                    link: snapshot.link,
                    readableAt: snapshot.readableAt,
                    latestChapterId: snapshot.id,
                });
            }

            if (
                entry.lastNotifiedChapterId !== snapshot.id ||
                entry.lastSeenChapterNumber !== newChapterRaw ||
                entry.lastSeenChapterCount !== newCount
            ) {
                entry.lastNotifiedChapterId = snapshot.id;
                entry.lastSeenChapterNumber = newChapterRaw;
                entry.lastSeenChapterCount = newCount;
                changed = true;
            }
        } catch (error) {
            console.error(`Error fetching updates for ${entry.source}:${entry.mangaId}:`, error.message);
        }
    }

    if (changed) {
        saveUserData(userId, userData);
    }

    return updates;
}

async function addTrackedTarget(userId, target) {
    const userData = getUserData(userId);
    if (userData.tracked.some((entry) => isSameTrackedTarget(entry, target))) {
        return { status: 'already_tracked' };
    }

    const title = target.title || (await fetchMangaTitleForTarget(target));
    if (!title) {
        return { status: 'not_found' };
    }

    let latestChapterId = null;
    let latestChapterNumber = null;
    let latestChapterCount = null;
    try {
        const snapshot = await fetchChapterSnapshotForEntry({ source: target.source, mangaId: target.mangaId });
        latestChapterId = snapshot?.id || null;
        latestChapterNumber = snapshot?.chapter || null;
        latestChapterCount = Number.isInteger(snapshot?.total) ? snapshot.total : null;
    } catch (error) {
        console.error(`Unable to fetch baseline chapter for ${target.source}:${target.mangaId}:`, error.message);
    }

    userData.tracked.push({
        source: target.source,
        mangaId: target.mangaId,
        title,
        lastNotifiedChapterId: latestChapterId,
        lastSeenChapterNumber: latestChapterNumber,
        lastSeenChapterCount: latestChapterCount,
    });
    saveUserData(userId, userData);

    return { status: 'added', title, source: target.source };
}

function formatUpdateLine(update, index) {
    const chapterSuffix = update.chapterTitle ? ` - ${update.chapterTitle}` : '';
    const sourceSuffix = update.source ? ` (${getSourceDisplayName(update.source)})` : '';
    return `**${index + 1}. [${update.title}](<${update.link}>)**${sourceSuffix} - Chapter ${update.chapter}${chapterSuffix}`;
}

function buildUpdatesEmbed(updates, title = '📖 Manga Updates') {
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(0x3498db)
        .setDescription(updates.map(formatUpdateLine).join('\n'))
        .setFooter({ text: `Total updates: ${updates.length}` });
}

function buildNoUpdatesEmbed() {
    return new EmbedBuilder()
        .setTitle('No Updates Found')
        .setDescription('No new chapters.')
        .setColor(0xff0000)
        .setFooter({ text: 'Check back later for updates!' });
}

function shouldRunAutoCheck(userData, nowMs) {
    if (!userData.tracked || userData.tracked.length === 0) {
        return false;
    }

    const intervalMs = userData.autoCheckIntervalHours * 60 * 60 * 1000;
    if (!userData.lastAutoCheckAt) {
        return true;
    }

    const lastRunMs = Date.parse(userData.lastAutoCheckAt);
    if (Number.isNaN(lastRunMs)) {
        return true;
    }

    return nowMs - lastRunMs >= intervalMs;
}

async function runAutoCheckSweep() {
    const files = fs.readdirSync(MANGA_DIR).filter((name) => name.endsWith('.json'));
    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    for (const file of files) {
        const userId = file.replace('.json', '');
        if (!/^\d+$/.test(userId)) continue;

        try {
            const userData = getUserData(userId);
            if (!shouldRunAutoCheck(userData, nowMs)) continue;

            const updates = await buildUserUpdates(userId);
            const refreshedData = getUserData(userId);
            refreshedData.lastAutoCheckAt = nowIso;
            saveUserData(userId, refreshedData);

            if (updates.length === 0) continue;

            const user = await client.users.fetch(userId);
            const embed = buildUpdatesEmbed(updates, '📬 Auto Manga Updates');
            await user.send({ embeds: [embed] });
        } catch (error) {
            console.error(`Error sending auto updates to user ${userId}:`, error.message);
        }
    }
}

async function executeFallbackAction(action) {
    if (action.type === 'search') {
        for (const sourceKey of action.sourceKeys) {
            const results = await searchMangaOnSource(sourceKey, action.query, 5);
            if (results.length > 0) {
                return {
                    content: `Showing results from ${getSourceDisplayName(sourceKey)}.`,
                    embeds: [buildSearchResultsEmbed(action.query, sourceKey, results)],
                };
            }
        }

        return { content: `No results found for "${action.query}" in other sources.` };
    }

    if (action.type === 'add') {
        for (const sourceKey of action.sourceKeys) {
            const target = await findMangaTargetOnSource(sourceKey, action.input);
            if (!target) continue;

            const result = await addTrackedTarget(action.userId, target);
            if (result.status === 'already_tracked') {
                return { content: `This manga is already being tracked on ${getSourceDisplayName(sourceKey)}.` };
            }
            if (result.status === 'added') {
                return { content: `Now tracking **${result.title}** from ${getSourceDisplayName(result.source)}.` };
            }
        }

        return { content: `No results found for "${action.input}" in other sources.` };
    }

    if (action.type === 'remove') {
        const userData = getUserData(action.userId);
        for (const sourceKey of action.sourceKeys) {
            const entry = findTrackedEntryByInput(userData, action.input, sourceKey);
            if (!entry) continue;

            userData.tracked = userData.tracked.filter((candidate) => !isSameTrackedTarget(candidate, entry));
            saveUserData(action.userId, userData);
            return { content: `Removed **${entry.title || entry.mangaId}** from ${getSourceDisplayName(entry.source)}.` };
        }

        return { content: 'This manga is not currently tracked in other sources.' };
    }

    if (action.type === 'checkupdates') {
        const updates = await buildUserUpdates(action.userId, { sources: action.sourceKeys });
        if (updates.length === 0) {
            return { embeds: [buildNoUpdatesEmbed()], content: 'No updates found in other sources.' };
        }

        return { embeds: [buildUpdatesEmbed(updates, '📖 Manga Updates (Other Sources)')] };
    }

    return { content: 'Unsupported fallback action.' };
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setPresence({
        activities: [{ name: 'Reading manga', type: ActivityType.Playing }],
        status: 'online',
    });

    const commands = [
        { name: 'checkupdates', description: 'Check for new chapters across your tracked manga.' },
        {
            name: 'setautocheck',
            description: 'Set auto-check interval in hours (6 to 168).',
            options: [{ name: 'hours', type: 4, description: 'Hours between auto checks', required: true }],
        },
        { name: 'preferredsource', description: 'Choose your preferred manga source for searches and fallbacks.' },
        { name: 'version', description: 'Display the current version of the bot.' },
        {
            name: 'searchmanga',
            description: 'Search manga using your preferred source.',
            options: [{ name: 'query', type: 3, description: 'Manga title to search for', required: true }],
        },
        {
            name: 'addmanga',
            description: `Add a manga URL/ID from ${SUPPORTED_SOURCES_LABEL}.`,
            options: [{ name: 'url_or_id', type: 3, description: 'Manga URL or MangaDex UUID', required: true }],
        },
        {
            name: 'removemanga',
            description: `Remove a tracked manga from ${SUPPORTED_SOURCES_LABEL}.`,
            options: [{ name: 'url_or_id', type: 3, description: 'Manga URL or MangaDex UUID', required: true }],
        },
        { name: 'listmanga', description: 'List all manga you are currently tracking.' },
        { name: 'exportmanga', description: 'Export your manga tracking list as JSON.' },
        {
            name: 'importmanga',
            description: 'Import your manga tracking list from a JSON file.',
            options: [{ name: 'file', type: 11, description: 'JSON file to import', required: true }],
        },
    ];

    try {
        console.log('Refreshing application (/) commands...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error.message);
    }

    schedule.scheduleJob('*/30 * * * *', async () => {
        console.log('Running scheduled auto-check sweep...');
        await runAutoCheckSweep();
    });
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('preferred_source_select:')) {
        const targetUserId = interaction.customId.split(':')[1];
        if (interaction.user.id !== targetUserId) {
            await interaction.reply({
                content: 'This source picker belongs to another user.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const selectedSource = interaction.values?.[0];
        if (!MANGA_SOURCE_MAP.has(selectedSource)) {
            await interaction.update({
                content: 'Invalid source selection.',
                components: [],
            });
            return;
        }

        const userData = getUserData(interaction.user.id);
        userData.preferredSource = selectedSource;
        saveUserData(interaction.user.id, userData);

        await interaction.update({
            content: `Preferred source set to **${getSourceDisplayName(selectedSource)}**.`,
            components: [buildPreferredSourceSelectRow(interaction.user.id, selectedSource)],
        });
        return;
    }

    if (interaction.isButton() && (interaction.customId.startsWith('fallback_yes:') || interaction.customId.startsWith('fallback_no:'))) {
        const [decision, token] = interaction.customId.split(':');
        const pendingAction = getPendingFallbackAction(token);
        if (!pendingAction) {
            await interaction.update({
                content: 'This fallback prompt has expired. Run the command again.',
                components: [],
            });
            return;
        }

        if (pendingAction.userId !== interaction.user.id) {
            await interaction.reply({
                content: 'This fallback prompt belongs to another user.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        clearPendingFallbackAction(token);

        if (decision === 'fallback_no') {
            await interaction.update({
                content: 'Okay, keeping the search limited to your preferred source.',
                components: [],
            });
            return;
        }

        await interaction.deferUpdate();
        try {
            const result = await executeFallbackAction(pendingAction);
            await interaction.editReply({
                content: result.content || null,
                embeds: result.embeds || [],
                components: [],
            });
        } catch (error) {
            console.error('Error executing fallback action:', error.message);
            await interaction.editReply({
                content: 'Could not search other sources right now. Please try again.',
                components: [],
            });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const username = interaction.user.username;
    migrateLegacyUsernameFile(userId, username);

    if (interaction.commandName === 'checkupdates') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const userData = getUserData(userId);
            const preferredSource = getPreferredSource(userData);
            const otherSources = getOtherSources(preferredSource).filter((sourceKey) =>
                userData.tracked.some((entry) => entry.source === sourceKey)
            );
            const updates = await buildUserUpdates(userId, { sources: [preferredSource] });
            if (updates.length === 0) {
                if (otherSources.length > 0) {
                    const token = storePendingFallbackAction({
                        type: 'checkupdates',
                        userId,
                        sourceKeys: otherSources,
                    });
                    await interaction.followUp({
                        content: `No updates found in your preferred source (${getSourceDisplayName(preferredSource)}). Search other sources?`,
                        components: [buildFallbackActionRow(token)],
                    });
                    return;
                }

                await interaction.followUp({ embeds: [buildNoUpdatesEmbed()] });
                return;
            }

            await interaction.followUp({ embeds: [buildUpdatesEmbed(updates)] });
        } catch (error) {
            console.error('Error checking updates:', error.message);
            await interaction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Error')
                        .setDescription('An error occurred while checking updates. Please try again later.')
                        .setColor(0xff0000),
                ],
            });
        }
        return;
    }

    if (interaction.commandName === 'setautocheck') {
        const hours = interaction.options.getInteger('hours', true);
        if (hours < MIN_AUTO_CHECK_HOURS || hours > MAX_AUTO_CHECK_HOURS) {
            await interaction.reply({
                content: `Please choose a value between ${MIN_AUTO_CHECK_HOURS} and ${MAX_AUTO_CHECK_HOURS} hours.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const userData = getUserData(userId);
        userData.autoCheckIntervalHours = hours;
        userData.lastAutoCheckAt = new Date().toISOString();
        saveUserData(userId, userData);

        await interaction.reply({
            content: `Auto-check interval set to every **${hours} hour(s)**.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.commandName === 'preferredsource') {
        const userData = getUserData(userId);
        const preferredSource = getPreferredSource(userData);
        await interaction.reply({
            content: `Your current preferred source is **${getSourceDisplayName(preferredSource)}**. Choose a new one:`,
            components: [buildPreferredSourceSelectRow(userId, preferredSource)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.commandName === 'version') {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('Manga Tracker')
                    .setDescription(`**${BOT_VERSION}**`)
                    .setColor(0x3498db),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.commandName === 'searchmanga') {
        const query = interaction.options.getString('query', true).trim();
        const userData = getUserData(userId);
        const preferredSource = getPreferredSource(userData);
        const otherSources = getOtherSources(preferredSource);

        try {
            const results = await searchMangaOnSource(preferredSource, query, 5);
            if (results.length === 0) {
                const token = storePendingFallbackAction({
                    type: 'search',
                    userId,
                    query,
                    sourceKeys: otherSources,
                });
                await interaction.reply({
                    content: `No results found in ${getSourceDisplayName(preferredSource)} for "${query}". Search other sources?`,
                    components: [buildFallbackActionRow(token)],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            await interaction.reply({
                embeds: [buildSearchResultsEmbed(query, preferredSource, results)],
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error('Error searching manga:', error.message);
            await interaction.reply({
                content: `Unable to search ${getSourceDisplayName(preferredSource)} right now. Please try again later.`,
                flags: MessageFlags.Ephemeral,
            });
        }
        return;
    }

    if (interaction.commandName === 'addmanga') {
        const input = interaction.options.getString('url_or_id', true);
        const userData = getUserData(userId);
        const preferredSource = getPreferredSource(userData);
        const otherSources = getOtherSources(preferredSource);

        try {
            let target = extractMangaTarget(input);
            if (!target) {
                target = await findMangaTargetOnSource(preferredSource, input);
            }

            if (!target) {
                const token = storePendingFallbackAction({
                    type: 'add',
                    userId,
                    input,
                    sourceKeys: otherSources,
                });
                await interaction.reply({
                    content: `No results found in ${getSourceDisplayName(preferredSource)}. Search other sources?`,
                    components: [buildFallbackActionRow(token)],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const result = await addTrackedTarget(userId, target);
            if (result.status === 'already_tracked') {
                await interaction.reply({ content: 'This manga is already being tracked.', flags: MessageFlags.Ephemeral });
                return;
            }
            if (result.status === 'not_found') {
                const token = storePendingFallbackAction({
                    type: 'add',
                    userId,
                    input,
                    sourceKeys: otherSources,
                });
                await interaction.reply({
                    content: `No results found in ${getSourceDisplayName(preferredSource)}. Search other sources?`,
                    components: [buildFallbackActionRow(token)],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            await interaction.reply({
                content: `Now tracking **${result.title}** from ${getSourceDisplayName(result.source)}.`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error('Error adding manga:', error.message);
            await interaction.reply({
                content: 'Could not add this manga right now. Please try again later.',
                flags: MessageFlags.Ephemeral,
            });
        }
        return;
    }

    if (interaction.commandName === 'removemanga') {
        const input = interaction.options.getString('url_or_id', true);
        const userData = getUserData(userId);
        const preferredSource = getPreferredSource(userData);
        const otherSources = getOtherSources(preferredSource).filter((sourceKey) =>
            userData.tracked.some((entry) => entry.source === sourceKey)
        );
        let entry = findTrackedEntryByInput(userData, input, preferredSource);
        if (!entry) {
            const directTarget = extractMangaTarget(input);
            if (directTarget) {
                entry = userData.tracked.find((candidate) => isSameTrackedTarget(candidate, directTarget)) || null;
            }
        }

        if (!entry) {
            if (otherSources.length > 0) {
                const token = storePendingFallbackAction({
                    type: 'remove',
                    userId,
                    input,
                    sourceKeys: otherSources,
                });
                await interaction.reply({
                    content: `No tracked match found in ${getSourceDisplayName(preferredSource)}. Search other sources?`,
                    components: [buildFallbackActionRow(token)],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            await interaction.reply({ content: 'This manga is not currently tracked.', flags: MessageFlags.Ephemeral });
            return;
        }

        userData.tracked = userData.tracked.filter((candidate) => !isSameTrackedTarget(candidate, entry));
        saveUserData(userId, userData);

        await interaction.reply({
            content: `Removed **${entry.title || entry.mangaId}** from ${getSourceDisplayName(entry.source)}.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.commandName === 'listmanga') {
        const userData = getUserData(userId);

        if (userData.tracked.length === 0) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Tracked Manga')
                        .setDescription('You are not tracking any manga.')
                        .setColor(0xff0000)
                        .setFooter({ text: 'Use /addmanga to start tracking.' }),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        let changed = false;
        const names = [];
        for (const entry of userData.tracked) {
            const hadTitle = Boolean(entry.title);
            const title = await resolveTrackedMangaTitle(entry);
            if (!hadTitle && entry.title) changed = true;
            names.push(title);
        }

        if (changed) {
            saveUserData(userId, userData);
        }

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('📚 Your Tracked Manga List')
                    .setColor(0x3498db)
                    .setDescription(
                        userData.tracked
                            .map((entry, index) => `**${index + 1}.** ${names[index]} (${getSourceDisplayName(entry.source)})`)
                            .join('\n')
                    )
                    .setFooter({ text: `Total manga: ${names.length}` }),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.commandName === 'exportmanga') {
        const userData = getUserData(userId);

        if (userData.tracked.length === 0) {
            await interaction.reply({
                content: 'Your manga tracking list is empty. Nothing to export.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const fileName = `${sanitizeUsername(username)}_manga.json`;
        fs.writeFileSync(fileName, JSON.stringify(userData, null, 2));

        const attachment = new AttachmentBuilder(fileName, { name: fileName });
        await interaction.user.send({ files: [attachment] });
        fs.unlinkSync(fileName);

        await interaction.reply({
            content: 'Your manga tracking list has been exported and sent via DM.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.commandName === 'importmanga') {
        const file = interaction.options.getAttachment('file');

        if (!file || !file.name.toLowerCase().endsWith('.json')) {
            await interaction.reply({
                content: 'Please provide a valid JSON file with a .json extension.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            const importedRaw = await downloadImportedJson(file);
            const imported = normalizeUserData(importedRaw);

            if (!Array.isArray(imported.tracked)) {
                await interaction.reply({
                    content: 'Invalid format. File must contain manga IDs or a tracked object.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const existing = getUserData(userId);
            const map = new Map();

            for (const entry of existing.tracked) {
                map.set(getTrackedEntryKey(entry), entry);
            }

            for (const entry of imported.tracked) {
                const key = getTrackedEntryKey(entry);
                if (!map.has(key)) {
                    map.set(key, entry);
                }
            }

            saveUserData(userId, {
                version: 3,
                autoCheckIntervalHours: existing.autoCheckIntervalHours,
                lastAutoCheckAt: existing.lastAutoCheckAt,
                preferredSource: existing.preferredSource,
                tracked: Array.from(map.values()),
            });
            await interaction.reply({
                content: 'Your manga tracking list has been successfully imported.',
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error('Error importing file:', error.message);
            await interaction.reply({
                content: 'Could not import that file. Please re-upload the JSON and try again.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
});

requireEnvVars();

const statusServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Bot is running!');
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

statusServer.listen(STATUS_PORT, '0.0.0.0', () => {
    console.log(`Health check endpoint running at http://0.0.0.0:${STATUS_PORT}/status`);
});

client.login(process.env.DISCORD_TOKEN);
