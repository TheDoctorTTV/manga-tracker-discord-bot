const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FALLBACK_TAB,
  VALID_TABS,
  resolveDashboardTab,
} = require('../src/web/dashboardTabState');

test('restores a valid stored tab after onboarding is complete', () => {
  assert.equal(resolveDashboardTab('users', { onboardingCompleted: true }), 'users');
  assert.deepEqual(VALID_TABS, ['home', 'users', 'settings', 'about']);
});

test('falls back to settings for invalid stored tabs', () => {
  assert.equal(resolveDashboardTab('not-a-tab', { onboardingCompleted: true }), FALLBACK_TAB);
  assert.equal(resolveDashboardTab('', { onboardingCompleted: true }), FALLBACK_TAB);
});

test('forces settings while onboarding is incomplete', () => {
  assert.equal(resolveDashboardTab('home', { onboardingCompleted: false }), FALLBACK_TAB);
  assert.equal(resolveDashboardTab('settings', { onboardingCompleted: false }), 'settings');
});
