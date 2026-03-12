(function initDashboardTabState(globalScope) {
  const VALID_TABS = ['home', 'users', 'settings', 'about'];
  const FALLBACK_TAB = 'settings';

  function normalizeTab(tabKey) {
    const normalized = String(tabKey || '').trim().toLowerCase();
    return VALID_TABS.includes(normalized) ? normalized : '';
  }

  function resolveDashboardTab(tabKey, options = {}) {
    const normalized = normalizeTab(tabKey);
    const onboardingCompleted = options.onboardingCompleted === true;
    if (!normalized) return FALLBACK_TAB;
    if (!onboardingCompleted && normalized !== FALLBACK_TAB) return FALLBACK_TAB;
    return normalized;
  }

  const api = {
    VALID_TABS,
    FALLBACK_TAB,
    normalizeTab,
    resolveDashboardTab,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope && typeof globalScope === 'object') {
    globalScope.DashboardTabState = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
