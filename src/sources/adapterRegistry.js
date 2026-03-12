const mangadexAdapter = require('./adapters/mangadex');
const comixAdapter = require('./adapters/comix');

class SourceAdapterRegistry {
  constructor(adapters = []) {
    this.adapterMap = new Map();
    for (const adapter of adapters) {
      if (!adapter || typeof adapter !== 'object') continue;
      if (typeof adapter.key !== 'string' || !adapter.key.trim()) continue;
      this.adapterMap.set(adapter.key.trim().toLowerCase(), adapter);
    }
  }

  get(adapterKey) {
    if (typeof adapterKey !== 'string') return null;
    return this.adapterMap.get(adapterKey.trim().toLowerCase()) || null;
  }

  list() {
    return Array.from(this.adapterMap.keys()).sort();
  }
}

function createDefaultSourceAdapterRegistry() {
  return new SourceAdapterRegistry([mangadexAdapter, comixAdapter]);
}

module.exports = {
  SourceAdapterRegistry,
  createDefaultSourceAdapterRegistry,
};
