const test = require('node:test');
const assert = require('node:assert/strict');
const { hasAdministratorPermission, computeAllowedGuildIds } = require('../src/services/dashboardAuthService');

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
