const DEFAULT_TITLE_URL = 'https://comix.to/title/';

function parseComixIdFromPath(pathname, comixIdRegex) {
  if (typeof pathname !== 'string') return null;
  const match = pathname.match(/^\/title\/([a-z0-9]+)(?:-[^/?#]+)?\/?$/i);
  if (!match || !comixIdRegex.test(match[1])) return null;
  return match[1].toLowerCase();
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
      Number.isFinite(updatedAtSeconds) && updatedAtSeconds > 0 ? new Date(updatedAtSeconds * 1000).toISOString() : null,
    link: `https://comix.to${canonicalPath}`,
  };
}

async function fetchComixTitleMetadata(comixId, context) {
  const url = `https://comix.to/title/${comixId}`;
  const response = await context.axios.get(url, {
    responseType: 'text',
    transformResponse: [(data) => data],
    timeout: 15000,
    headers: { 'User-Agent': context.userAgent },
  });

  const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
  return extractComixTitleMetadata(html, comixId);
}

module.exports = {
  key: 'comix',

  validateMangaId(mangaId, context) {
    return context.COMIX_ID_REGEX.test(mangaId);
  },

  parseIdFromInput(input, context) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;

    if (context.COMIX_ID_REGEX.test(trimmed)) {
      return trimmed;
    }

    const url = context.url;
    if (!url) return null;

    return parseComixIdFromPath(url.pathname, context.COMIX_ID_REGEX);
  },

  buildTitleUrl(mangaId, context) {
    const base = context.source?.titleUrl || DEFAULT_TITLE_URL;
    return `${base}${mangaId}`;
  },

  async search(query, limit, context) {
    const response = await context.axios.get(`${context.COMIX_API_BASE}/manga`, {
      params: {
        keyword: query,
        limit,
        'order[relevance]': 'desc',
      },
      timeout: 15000,
      headers: { 'User-Agent': context.userAgent },
    });

    const items = response.data?.result?.items || [];
    return items.map((item) => ({
      source: context.source.key,
      mangaId: item.hash_id,
      title: item.title || 'Unknown Title',
      link: `https://comix.to/title/${item.hash_id}${item.slug ? `-${item.slug}` : ''}`,
    }));
  },

  async getTitle(mangaId, context) {
    const metadata = await fetchComixTitleMetadata(mangaId, context);
    return metadata?.title || null;
  },

  async getLatestChapters(mangaId, context) {
    const metadata = await fetchComixTitleMetadata(mangaId, context);
    if (!metadata || metadata.latestChapter === null) return null;

    const chapterLabel = String(metadata.latestChapter);
    return {
      id: `comix:${mangaId}:chapter:${chapterLabel}`,
      chapter: chapterLabel,
      title: null,
      readableAt: metadata.readableAt,
      link: metadata.link || this.buildTitleUrl(mangaId, context),
      total: metadata.latestChapter,
    };
  },
};
