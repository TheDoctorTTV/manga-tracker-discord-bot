const fs = require('fs');

function buildFallbackSources() {
  return {
    defaultSource: 'mangadex',
    sources: [
      {
        key: 'mangadex',
        adapter: 'mangadex',
        enabled: true,
        displayName: 'MangaDex',
        hosts: ['mangadex.org', 'www.mangadex.org'],
        titleUrl: 'https://mangadex.org/title/',
      },
      {
        key: 'comix',
        adapter: 'comix',
        enabled: true,
        displayName: 'Comix',
        hosts: ['comix.to', 'www.comix.to'],
        titleUrl: 'https://comix.to/title/',
      },
    ],
  };
}

function normalizeSource(rawSource) {
  if (!rawSource || typeof rawSource !== 'object') return null;
  if (typeof rawSource.key !== 'string' || !rawSource.key.trim()) return null;

  const hosts = Array.isArray(rawSource.hosts)
    ? rawSource.hosts.filter((host) => typeof host === 'string' && host.trim())
    : [];

  if (hosts.length === 0) return null;

  return {
    key: rawSource.key.trim().toLowerCase(),
    adapter:
      typeof rawSource.adapter === 'string' && rawSource.adapter.trim()
        ? rawSource.adapter.trim().toLowerCase()
        : rawSource.key.trim().toLowerCase(),
    enabled: rawSource.enabled !== false,
    displayName:
      typeof rawSource.displayName === 'string' && rawSource.displayName.trim()
        ? rawSource.displayName.trim()
        : rawSource.key.trim(),
    hosts: hosts.map((host) => host.trim().toLowerCase()),
    titleUrl:
      typeof rawSource.titleUrl === 'string' && rawSource.titleUrl.trim()
        ? rawSource.titleUrl.trim()
        : null,
  };
}

function loadMangaSourcesConfig(sourceFilePath) {
  const fallback = buildFallbackSources();

  try {
    if (!fs.existsSync(sourceFilePath)) return fallback;

    const parsed = JSON.parse(fs.readFileSync(sourceFilePath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.sources) || parsed.sources.length === 0) return fallback;

    const normalized = {
      defaultSource: typeof parsed.defaultSource === 'string' ? parsed.defaultSource.trim().toLowerCase() : fallback.defaultSource,
      sources: parsed.sources.map(normalizeSource).filter(Boolean),
    };

    if (normalized.sources.length === 0) return fallback;
    const enabledSources = normalized.sources.filter((source) => source.enabled);
    const defaultPool = enabledSources.length > 0 ? enabledSources : normalized.sources;
    if (!defaultPool.some((source) => source.key === normalized.defaultSource)) {
      normalized.defaultSource = defaultPool[0].key;
    }

    return normalized;
  } catch (error) {
    console.error(`Unable to read ${sourceFilePath}, using defaults:`, error.message);
    return fallback;
  }
}

module.exports = {
  loadMangaSourcesConfig,
};
