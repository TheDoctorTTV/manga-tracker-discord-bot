const DEFAULT_TITLE_URL = 'https://mangadex.org/title/';

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

module.exports = {
  key: 'mangadex',

  validateMangaId(mangaId, context) {
    return context.UUID_REGEX.test(mangaId);
  },

  parseIdFromInput(input, context) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;

    if (context.UUID_REGEX.test(trimmed)) {
      return trimmed;
    }

    const url = context.url;
    if (!url) return null;

    const match = url.pathname.match(/\/title\/([0-9a-f-]{36})/i);
    if (!match || !context.UUID_REGEX.test(match[1])) return null;
    return match[1];
  },

  buildTitleUrl(mangaId, context) {
    const base = context.source?.titleUrl || DEFAULT_TITLE_URL;
    return `${base}${mangaId}`;
  },

  async search(query, limit, context) {
    const response = await context.axios.get(`${context.MANGADEX_API}/manga`, {
      params: {
        title: query,
        limit,
        'order[relevance]': 'desc',
      },
    });

    const results = response.data?.data || [];
    return results.map((manga) => ({
      source: context.source.key,
      mangaId: manga.id,
      title: pickMangaTitle(manga.attributes),
      link: `https://mangadex.org/title/${manga.id}`,
    }));
  },

  async getTitle(mangaId, context) {
    const response = await context.axios.get(`${context.MANGADEX_API}/manga/${mangaId}`);
    const manga = response.data?.data || null;
    if (!manga) return null;
    return pickMangaTitle(manga.attributes);
  },

  async getLatestChapters(mangaId, context) {
    const commonParams = {
      limit: 1,
      'manga[]': mangaId,
      'order[readableAt]': 'desc',
    };

    const withEnglish = await context.axios.get(`${context.MANGADEX_API}/chapter`, {
      params: {
        ...commonParams,
        'translatedLanguage[]': 'en',
      },
    });

    let latestChapter = withEnglish.data?.data?.[0];
    let chapterTotal = Number.isInteger(withEnglish.data?.total) ? withEnglish.data.total : null;

    if (!latestChapter) {
      const withoutLanguage = await context.axios.get(`${context.MANGADEX_API}/chapter`, { params: commonParams });
      latestChapter = withoutLanguage.data?.data?.[0];
      chapterTotal = Number.isInteger(withoutLanguage.data?.total) ? withoutLanguage.data.total : null;
    }

    if (!latestChapter) return null;

    return {
      id: latestChapter.id,
      chapter: latestChapter.attributes?.chapter || '?',
      title: latestChapter.attributes?.title || null,
      readableAt: latestChapter.attributes?.readableAt || null,
      link: `https://mangadex.org/chapter/${latestChapter.id}`,
      total: chapterTotal,
    };
  },
};
