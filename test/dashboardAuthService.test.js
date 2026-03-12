const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasAdministratorPermission,
  computeAdminGuilds,
  computeAllowedGuildIds,
  computeAllowedGuilds,
} = require('../src/services/dashboardAuthService');

test('detects administrator permission bit', () => {
  assert.equal(hasAdministratorPermission('8'), true);
  assert.equal(hasAdministratorPermission('0'), false);
});

test('filters allowed guild ids by managed list and admin permission', () => {
  const allowed = computeAllowedGuildIds({
    guilds: [
      { id: '111', permissions: '8' },
      { id: '222', permissions: '32' },
      { id: '333', permissions: '8' },
    ],
    managedGuildIds: ['333', '999'],
  });

  assert.deepEqual(allowed, ['333']);
});

test('returns allowed guild metadata for dashboard display', () => {
  const allowed = computeAllowedGuilds({
    guilds: [
      { id: '111', name: 'Alpha', permissions: '8' },
      { id: '222', name: 'Beta', permissions: '32' },
      { id: '333', name: 'Gamma', permissions: '8' },
    ],
    managedGuildIds: ['333', '999'],
  });

  assert.deepEqual(allowed, [{ id: '333', name: 'Gamma' }]);
});

test('returns all administrator guilds for guild selection', () => {
  const adminGuilds = computeAdminGuilds([
    { id: '111', name: 'Alpha', permissions: '8' },
    { id: '222', name: 'Beta', permissions: '32' },
    { id: '333', name: 'Gamma', permissions: '8' },
  ]);

  assert.deepEqual(adminGuilds, [
    { id: '111', name: 'Alpha' },
    { id: '333', name: 'Gamma' },
  ]);
});
