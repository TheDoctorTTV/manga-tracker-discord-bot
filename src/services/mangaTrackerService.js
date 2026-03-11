const fs = require('fs');
const path = require('path');
const axios = require('axios');

const {
  BOT_VERSION,
  MANGADEX_API,
  COMIX_API_BASE,
  MANGA_DIR,
  UUID_REGEX,
  COMIX_ID_REGEX,
  MIN_AUTO_CHECK_HOURS,
  MAX_AUTO_CHECK_HOURS,
  DEFAULT_AUTO_CHECK_HOURS,
} = require('../config');
const { loadMangaSourcesConfig } = require('../sources/sourceConfig');

class MangaTrackerService {
  constructor({ mangaDir = MANGA_DIR, mangaSourcesFile }) {
    this.mangaDir = mangaDir;
    this.mangaSourcesFile = mangaSourcesFile;
    this.applySourcesConfig(loadMangaSourcesConfig(this.mangaSourcesFile));

    if (!fs.existsSync(this.mangaDir)) {
      fs.mkdirSync(this.mangaDir, { recursive: true });
    }
  }

  applySourcesConfig(config) {
    this.mangaSources = config;
    this.mangaSourceMap = new Map(this.mangaSources.sources.map((source) => [source.key, source]));
  }

  reloadSourcesConfig() {
    this.applySourcesConfig(loadMangaSourcesConfig(this.mangaSourcesFile));
    return this.mangaSources;
  }

  normalizeSourceConfigPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid source config payload');
    }

    if (!Array.isArray(payload.sources) || payload.sources.length === 0) {
      throw new Error('sources must be a non-empty array');
    }

    const normalizedSources = [];
    const seenKeys = new Set();

    for (const rawSource of payload.sources) {
      if (!rawSource || typeof rawSource !== 'object') {
        throw new Error('Each source must be an object');
      }

      const key = typeof rawSource.key === 'string' ? rawSource.key.trim().toLowerCase() : '';
      if (!key) throw new Error('Each source requires a key');
      if (seenKeys.has(key)) throw new Error(`Duplicate source key: ${key}`);
      seenKeys.add(key);

      const hosts = Array.isArray(rawSource.hosts)
        ? rawSource.hosts
            .map((host) => (typeof host === 'string' ? host.trim().toLowerCase() : ''))
            .filter(Boolean)
        : [];
      if (hosts.length === 0) throw new Error(`Source ${key} must include at least one host`);

      normalizedSources.push({
        key,
        displayName:
          typeof rawSource.displayName === 'string' && rawSource.displayName.trim()
            ? rawSource.displayName.trim()
            : key,
        hosts,
        titleUrl:
          typeof rawSource.titleUrl === 'string' && rawSource.titleUrl.trim()
            ? rawSource.titleUrl.trim()
            : null,
      });
    }

    const requestedDefault =
      typeof payload.defaultSource === 'string' ? payload.defaultSource.trim().toLowerCase() : normalizedSources[0].key;
    const defaultSource = seenKeys.has(requestedDefault) ? requestedDefault : normalizedSources[0].key;

    return { defaultSource, sources: normalizedSources };
  }

  saveSourcesConfig(payload) {
    const normalized = this.normalizeSourceConfigPayload(payload);
    fs.writeFileSync(this.mangaSourcesFile, JSON.stringify(normalized, null, 2));
    this.applySourcesConfig(normalized);
    return normalized;
  }

  getSources() {
    return this.mangaSources;
  }

  getSupportedSourcesLabel() {
    return this.mangaSources.sources.map((source) => source.displayName).join(', ');
  }

  sanitizeUsername(username) {
    return username.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  getUserFilePath(userId) {
    return path.join(this.mangaDir, `${userId}.json`);
  }

  getLegacyUserFilePath(username) {
    const sanitizedUsername = this.sanitizeUsername(username);
    return path.join(this.mangaDir, `${sanitizedUsername}.json`);
  }

  migrateLegacyUsernameFile(userId, username) {
    const userFilePath = this.getUserFilePath(userId);
    const legacyFilePath = this.getLegacyUserFilePath(username);

    if (!fs.existsSync(legacyFilePath) || fs.existsSync(userFilePath)) {
      return;
    }

    fs.renameSync(legacyFilePath, userFilePath);
  }

  normalizeTrackedEntry(entry) {
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

    const implicitSource = UUID_REGEX.test(mangaId) ? 'mangadex' : this.mangaSources.defaultSource;
    const sourceKeyRaw = typeof entry.source === 'string' ? entry.source.trim().toLowerCase() : implicitSource;
    const sourceKey = this.mangaSourceMap.has(sourceKeyRaw) ? sourceKeyRaw : implicitSource;

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

  normalizeUserData(rawData) {
    const rawPreferredSource =
      rawData && typeof rawData.preferredSource === 'string' ? rawData.preferredSource.trim().toLowerCase() : null;
    const preferredSource = this.mangaSourceMap.has(rawPreferredSource) ? rawPreferredSource : this.mangaSources.defaultSource;

    if (Array.isArray(rawData)) {
      const tracked = rawData.map((entry) => this.normalizeTrackedEntry(entry)).filter(Boolean);
      return {
        version: 3,
        autoCheckIntervalHours: DEFAULT_AUTO_CHECK_HOURS,
        lastAutoCheckAt: null,
        preferredSource,
        tracked,
      };
    }

    if (rawData && Array.isArray(rawData.tracked)) {
      const tracked = rawData.tracked.map((entry) => this.normalizeTrackedEntry(entry)).filter(Boolean);
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

  getUserData(userId) {
    const filePath = this.getUserFilePath(userId);
    if (!fs.existsSync(filePath)) {
      return this.normalizeUserData(null);
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return this.normalizeUserData(parsed);
    } catch (error) {
      console.error(`Error parsing user data for ${userId}:`, error.message);
      return this.normalizeUserData(null);
    }
  }

  saveUserData(userId, data) {
    const filePath = this.getUserFilePath(userId);
    const normalized = this.normalizeUserData(data);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
  }

  listUsers() {
    const files = fs.readdirSync(this.mangaDir).filter((name) => name.endsWith('.json'));
    const users = [];

    for (const file of files) {
      const userId = file.replace('.json', '');
      if (!/^\d+$/.test(userId)) continue;
      const data = this.getUserData(userId);
      users.push({
        userId,
        preferredSource: this.getPreferredSource(data),
        trackedCount: data.tracked.length,
        autoCheckIntervalHours: data.autoCheckIntervalHours,
        lastAutoCheckAt: data.lastAutoCheckAt,
      });
    }

    return users.sort((a, b) => a.userId.localeCompare(b.userId));
  }

  getAdminSummary() {
    const users = this.listUsers();
    const totalTracked = users.reduce((sum, user) => sum + user.trackedCount, 0);
    return {
      users: users.length,
      totalTracked,
      defaultSource: this.mangaSources.defaultSource,
      sources: this.mangaSources.sources.length,
    };
  }

  deleteUser(userId) {
    const filePath = this.getUserFilePath(userId);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  pickMangaTitle(attributes = {}) {
    const titleMap = attributes.title || {};
    if (titleMap.en) return titleMap.en;

    const altTitles = Array.isArray(attributes.altTitles) ? attributes.altTitles : [];
    for (const altTitle of altTitles) {
      if (altTitle.en) return altTitle.en;
    }

    const firstTitle = Object.values(titleMap)[0];
    return firstTitle || 'Unknown Title';
  }

  getSourceDisplayName(sourceKey) {
    return this.mangaSourceMap.get(sourceKey)?.displayName || sourceKey;
  }

  getPreferredSource(userData) {
    const sourceKey = typeof userData?.preferredSource === 'string' ? userData.preferredSource.trim().toLowerCase() : '';
    return this.mangaSourceMap.has(sourceKey) ? sourceKey : this.mangaSources.defaultSource;
  }

  getOtherSources(sourceKey) {
    return this.mangaSources.sources.map((source) => source.key).filter((key) => key !== sourceKey);
  }

  getTitleUrlForSource(sourceKey, mangaId) {
    const source = this.mangaSourceMap.get(sourceKey);
    if (!source || !source.titleUrl) return null;
    return `${source.titleUrl}${mangaId}`;
  }

  parseComixIdFromPath(pathname) {
    if (typeof pathname !== 'string') return null;
    const match = pathname.match(/^\/title\/([a-z0-9]+)(?:-[^/?#]+)?\/?$/i);
    if (!match || !COMIX_ID_REGEX.test(match[1])) return null;
    return match[1].toLowerCase();
  }

  resolveSourceFromHostname(hostname) {
    const normalizedHost = hostname.toLowerCase();
    return this.mangaSources.sources.find((source) => source.hosts.includes(normalizedHost)) || null;
  }

  extractMangaTarget(value) {
    if (!value || typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    if (UUID_REGEX.test(trimmed)) {
      return { source: 'mangadex', mangaId: trimmed };
    }

    let url;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }

    const source = this.resolveSourceFromHostname(url.hostname);
    if (!source) return null;

    if (source.key === 'mangadex') {
      const match = url.pathname.match(/\/title\/([0-9a-f-]{36})/i);
      if (match && UUID_REGEX.test(match[1])) {
        return { source: 'mangadex', mangaId: match[1] };
      }
      return null;
    }

    if (source.key === 'comix') {
      const comixId = this.parseComixIdFromPath(url.pathname);
      if (comixId) {
        return { source: 'comix', mangaId: comixId };
      }
      return null;
    }

    return null;
  }

  escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  extractComixTitleMetadata(html, comixId) {
    if (typeof html !== 'string') return null;

    const escapedId = this.escapeRegExp(comixId.toLowerCase());
    const metadataPattern = new RegExp(
      `"hash_id":"${escapedId}"[\\s\\S]*?"title":"((?:\\\\.|[^"\\\\])*)"[\\s\\S]*?"latest_chapter":(\\d+)[\\s\\S]*?"chapter_updated_at":(\\d+)`,
      'i'
    );
    const metadataMatch = html.match(metadataPattern);
    if (!metadataMatch) return null;

    const title = (() => {
      try {
        return JSON.parse(`"${metadataMatch[1]}"`);
      } catch {
        return metadataMatch[1];
      }
    })();

    const chapter = Number.parseInt(metadataMatch[2], 10);
    const updatedAtSeconds = Number.parseInt(metadataMatch[3], 10);
    const canonicalPathMatch = html.match(new RegExp(`"_link":"(\\/title\\/${escapedId}[^"]*)"`, 'i'));
    const canonicalPath = canonicalPathMatch ? canonicalPathMatch[1].replace(/\\\//g, '/') : `/title/${comixId}`;

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

  async fetchMangaById(mangaId) {
    const response = await axios.get(`${MANGADEX_API}/manga/${mangaId}`);
    return response.data?.data || null;
  }

  async fetchComixTitleMetadata(comixId) {
    const url = `https://comix.to/title/${comixId}`;
    const response = await axios.get(url, {
      responseType: 'text',
      transformResponse: [(data) => data],
      timeout: 15000,
      headers: { 'User-Agent': `MangaTrackerBot/${BOT_VERSION}` },
    });

    const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    return this.extractComixTitleMetadata(html, comixId);
  }

  async fetchMangaTitleForTarget(target) {
    if (target.source === 'comix') {
      const metadata = await this.fetchComixTitleMetadata(target.mangaId);
      return metadata?.title || null;
    }

    const manga = await this.fetchMangaById(target.mangaId);
    return manga ? this.pickMangaTitle(manga.attributes) : null;
  }

  async searchMangadex(query, limit = 5) {
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
      title: this.pickMangaTitle(manga.attributes),
      link: `https://mangadex.org/title/${manga.id}`,
    }));
  }

  async searchComix(query, limit = 5) {
    const response = await axios.get(`${COMIX_API_BASE}/manga`, {
      params: {
        keyword: query,
        limit,
        'order[relevance]': 'desc',
      },
      timeout: 15000,
      headers: { 'User-Agent': `MangaTrackerBot/${BOT_VERSION}` },
    });

    const items = response.data?.result?.items || [];
    return items.map((item) => ({
      source: 'comix',
      mangaId: item.hash_id,
      title: item.title || 'Unknown Title',
      link: `https://comix.to/title/${item.hash_id}${item.slug ? `-${item.slug}` : ''}`,
    }));
  }

  async searchMangaOnSource(sourceKey, query, limit = 5) {
    if (sourceKey === 'comix') return this.searchComix(query, limit);
    return this.searchMangadex(query, limit);
  }

  async findMangaTargetOnSource(sourceKey, input) {
    const directTarget = this.extractMangaTarget(input);
    if (directTarget && directTarget.source === sourceKey) {
      const title = await this.fetchMangaTitleForTarget(directTarget);
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

    const results = await this.searchMangaOnSource(sourceKey, query, 1);
    if (results.length === 0) return null;

    return {
      source: sourceKey,
      mangaId: results[0].mangaId,
      title: results[0].title,
    };
  }

  async fetchChapterSnapshot(mangaId) {
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

  async fetchChapterSnapshotForEntry(entry) {
    if (entry.source === 'comix') {
      const metadata = await this.fetchComixTitleMetadata(entry.mangaId);
      if (!metadata || metadata.latestChapter === null) return null;

      const chapterLabel = String(metadata.latestChapter);
      return {
        id: `comix:${entry.mangaId}:chapter:${chapterLabel}`,
        chapter: chapterLabel,
        title: null,
        readableAt: metadata.readableAt,
        link: metadata.link || this.getTitleUrlForSource('comix', entry.mangaId),
        total: metadata.latestChapter,
      };
    }

    return this.fetchChapterSnapshot(entry.mangaId);
  }

  parseChapterNumber(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  getTrackedEntryKey(entry) {
    const source = entry?.source || this.mangaSources.defaultSource;
    return `${source}:${entry?.mangaId || ''}`;
  }

  isSameTrackedTarget(entry, target) {
    return entry.source === target.source && entry.mangaId === target.mangaId;
  }

  async resolveTrackedMangaTitle(entry) {
    if (entry.title) return entry.title;

    try {
      let title = 'Unknown Title';

      if (entry.source === 'comix') {
        const metadata = await this.fetchComixTitleMetadata(entry.mangaId);
        title = metadata?.title || 'Unknown Title';
      } else {
        const manga = await this.fetchMangaById(entry.mangaId);
        title = this.pickMangaTitle(manga?.attributes);
      }

      entry.title = title;
      return title;
    } catch (error) {
      console.error(`Error resolving manga title for ${entry.source}:${entry.mangaId}:`, error.message);
      return 'Unknown Title';
    }
  }

  async buildUserUpdates(userId, options = {}) {
    const userData = this.getUserData(userId);
    const updates = [];
    let changed = false;
    const sourceFilter = Array.isArray(options.sources) ? new Set(options.sources) : null;

    for (const entry of userData.tracked) {
      if (sourceFilter && !sourceFilter.has(entry.source)) {
        continue;
      }

      try {
        const mangaTitle = await this.resolveTrackedMangaTitle(entry);
        const snapshot = await this.fetchChapterSnapshotForEntry(entry);
        if (!snapshot) continue;

        const oldCount = Number.isInteger(entry.lastSeenChapterCount) ? entry.lastSeenChapterCount : null;
        const newCount = Number.isInteger(snapshot.total) ? snapshot.total : null;
        const oldChapterRaw = entry.lastSeenChapterNumber;
        const newChapterRaw = typeof snapshot.chapter === 'string' ? snapshot.chapter : null;
        const oldChapterNumeric = this.parseChapterNumber(oldChapterRaw);
        const newChapterNumeric = this.parseChapterNumber(newChapterRaw);

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
      this.saveUserData(userId, userData);
    }

    return updates;
  }

  async addTrackedTarget(userId, target) {
    const userData = this.getUserData(userId);
    if (userData.tracked.some((entry) => this.isSameTrackedTarget(entry, target))) {
      return { status: 'already_tracked' };
    }

    const title = target.title || (await this.fetchMangaTitleForTarget(target));
    if (!title) {
      return { status: 'not_found' };
    }

    let latestChapterId = null;
    let latestChapterNumber = null;
    let latestChapterCount = null;

    try {
      const snapshot = await this.fetchChapterSnapshotForEntry({ source: target.source, mangaId: target.mangaId });
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
    this.saveUserData(userId, userData);

    return { status: 'added', title, source: target.source };
  }

  findTrackedEntryByInput(userData, input, sourceKey) {
    const target = this.extractMangaTarget(input);
    if (target && target.source === sourceKey) {
      return userData.tracked.find((entry) => this.isSameTrackedTarget(entry, target)) || null;
    }

    if (typeof input !== 'string') return null;
    const query = input.trim().toLowerCase();
    if (!query) return null;

    const candidates = userData.tracked.filter((entry) => entry.source === sourceKey);
    const exact = candidates.find((entry) => (entry.title || '').trim().toLowerCase() === query);
    if (exact) return exact;

    return candidates.find((entry) => (entry.title || '').trim().toLowerCase().includes(query)) || null;
  }

  removeTrackedByTarget(userId, target) {
    const userData = this.getUserData(userId);
    const found = userData.tracked.find((entry) => this.isSameTrackedTarget(entry, target));
    if (!found) return null;

    userData.tracked = userData.tracked.filter((entry) => !this.isSameTrackedTarget(entry, target));
    this.saveUserData(userId, userData);
    return found;
  }

  normalizeTitleForMatch(value) {
    if (typeof value !== 'string') return '';
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  pickBestSearchMatchByTitle(title, results) {
    if (!Array.isArray(results) || results.length === 0) return null;
    const normalizedTitle = this.normalizeTitleForMatch(title);
    if (!normalizedTitle) return results[0];

    const exact = results.find((item) => this.normalizeTitleForMatch(item.title) === normalizedTitle);
    if (exact) return exact;

    const startsWith = results.find((item) => this.normalizeTitleForMatch(item.title).startsWith(normalizedTitle));
    if (startsWith) return startsWith;

    const contains = results.find((item) => this.normalizeTitleForMatch(item.title).includes(normalizedTitle));
    if (contains) return contains;

    return results[0];
  }

  async migrateTrackedEntriesToSource(userId, selectedSource) {
    const userData = this.getUserData(userId);
    const previousSource = this.getPreferredSource(userData);
    const tracked = Array.isArray(userData.tracked) ? userData.tracked : [];
    const otherEntriesCount = tracked.filter((entry) => entry.source !== selectedSource).length;

    if (previousSource === selectedSource && otherEntriesCount === 0) {
      return {
        changed: false,
        previousSource,
        selectedSource,
        migratedCount: 0,
        failedCount: 0,
        dedupedCount: 0,
        totalConsidered: 0,
      };
    }

    const keptEntries = [];
    const existingTargetKeys = new Set(
      tracked.filter((entry) => entry.source === selectedSource).map((entry) => this.getTrackedEntryKey(entry))
    );

    let changed = previousSource !== selectedSource;
    let migratedCount = 0;
    let failedCount = 0;
    let dedupedCount = 0;
    let totalConsidered = 0;

    for (const entry of tracked) {
      if (entry.source === selectedSource) {
        keptEntries.push(entry);
        continue;
      }

      totalConsidered += 1;

      const title = await this.resolveTrackedMangaTitle(entry);
      if (!title || title === 'Unknown Title') {
        keptEntries.push(entry);
        failedCount += 1;
        continue;
      }

      let results = [];
      try {
        results = await this.searchMangaOnSource(selectedSource, title, 5);
      } catch (error) {
        console.error(`Error searching ${selectedSource} during migration for "${title}":`, error.message);
      }

      const match = this.pickBestSearchMatchByTitle(title, results);
      if (!match || !match.mangaId) {
        keptEntries.push(entry);
        failedCount += 1;
        continue;
      }

      const target = { source: selectedSource, mangaId: match.mangaId };
      const targetKey = this.getTrackedEntryKey(target);
      if (existingTargetKeys.has(targetKey)) {
        dedupedCount += 1;
        changed = true;
        continue;
      }

      let latestChapterId = null;
      let latestChapterNumber = null;
      let latestChapterCount = null;
      try {
        const snapshot = await this.fetchChapterSnapshotForEntry(target);
        latestChapterId = snapshot?.id || null;
        latestChapterNumber = snapshot?.chapter || null;
        latestChapterCount = Number.isInteger(snapshot?.total) ? snapshot.total : null;
      } catch (error) {
        console.error(`Unable to fetch baseline chapter for ${target.source}:${target.mangaId}:`, error.message);
      }

      keptEntries.push({
        source: selectedSource,
        mangaId: match.mangaId,
        title: match.title || title,
        lastNotifiedChapterId: latestChapterId,
        lastSeenChapterNumber: latestChapterNumber,
        lastSeenChapterCount: latestChapterCount,
      });
      existingTargetKeys.add(targetKey);
      migratedCount += 1;
      changed = true;
    }

    userData.preferredSource = selectedSource;
    userData.tracked = keptEntries;

    if (changed) {
      this.saveUserData(userId, userData);
    }

    return {
      changed,
      previousSource,
      selectedSource,
      migratedCount,
      failedCount,
      dedupedCount,
      totalConsidered,
    };
  }

  shouldRunAutoCheck(userData, nowMs) {
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

  async runAutoCheckSweep(onUserUpdates) {
    const files = fs.readdirSync(this.mangaDir).filter((name) => name.endsWith('.json'));
    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    for (const file of files) {
      const userId = file.replace('.json', '');
      if (!/^\d+$/.test(userId)) continue;

      try {
        const userData = this.getUserData(userId);
        if (!this.shouldRunAutoCheck(userData, nowMs)) continue;

        const updates = await this.buildUserUpdates(userId);
        const refreshedData = this.getUserData(userId);
        refreshedData.lastAutoCheckAt = nowIso;
        this.saveUserData(userId, refreshedData);

        if (updates.length === 0) continue;

        await onUserUpdates(userId, updates);
      } catch (error) {
        console.error(`Error sending auto updates to user ${userId}:`, error.message);
      }
    }
  }

  setUserSettings(userId, settings) {
    const userData = this.getUserData(userId);

    if (Object.prototype.hasOwnProperty.call(settings, 'preferredSource')) {
      const preferredSource = String(settings.preferredSource || '').trim().toLowerCase();
      if (!this.mangaSourceMap.has(preferredSource)) {
        throw new Error('Invalid preferredSource');
      }
      userData.preferredSource = preferredSource;
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'autoCheckIntervalHours')) {
      const value = Number.parseInt(settings.autoCheckIntervalHours, 10);
      if (!Number.isInteger(value) || value < MIN_AUTO_CHECK_HOURS || value > MAX_AUTO_CHECK_HOURS) {
        throw new Error(`autoCheckIntervalHours must be between ${MIN_AUTO_CHECK_HOURS} and ${MAX_AUTO_CHECK_HOURS}`);
      }
      userData.autoCheckIntervalHours = value;
    }

    this.saveUserData(userId, userData);
    return this.getUserData(userId);
  }

  async addTrackedByInput(userId, input, sourceHint) {
    const userData = this.getUserData(userId);
    const preferredSource = this.getPreferredSource(userData);
    const sourceToUse = this.mangaSourceMap.has(sourceHint) ? sourceHint : preferredSource;

    let target = this.extractMangaTarget(input);
    if (!target) {
      target = await this.findMangaTargetOnSource(sourceToUse, input);
    }

    if (!target) return { status: 'not_found' };
    return this.addTrackedTarget(userId, target);
  }

  async downloadImportedJson(attachment) {
    const urls = Array.from(new Set([attachment?.url, attachment?.proxyURL].filter(Boolean)));
    let lastError = null;

    for (const url of urls) {
      try {
        const response = await axios.get(url, {
          responseType: 'text',
          transformResponse: [(data) => data],
          timeout: 15000,
          headers: { 'User-Agent': `MangaTrackerBot/${BOT_VERSION}` },
        });

        const raw = typeof response.data === 'string' ? response.data : String(response.data ?? '');
        return JSON.parse(raw);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Unable to download JSON attachment.');
  }
}

module.exports = {
  MangaTrackerService,
};
