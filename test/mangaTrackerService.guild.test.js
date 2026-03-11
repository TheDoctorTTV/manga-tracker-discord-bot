const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MangaTrackerService } = require('../src/services/mangaTrackerService');

function createService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-guild-test-'));
  const mangaDir = path.join(root, 'data');
  const mangaSourcesFile = path.resolve(__dirname, '..', 'manga-sources.json');
  return new MangaTrackerService({ mangaDir, mangaSourcesFile });
}

test('stores user data independently per guild id', () => {
  const service = createService();

  service.saveGuildUserData('111', '42', {
    preferredSource: 'mangadex',
    autoCheckIntervalHours: 12,
    tracked: [{ source: 'mangadex', mangaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'A' }],
  });
  service.saveGuildUserData('222', '42', {
    preferredSource: 'comix',
    autoCheckIntervalHours: 24,
    tracked: [{ source: 'comix', mangaId: 'naruto', title: 'Naruto' }],
  });

  const g1 = service.getGuildUserData('111', '42');
  const g2 = service.getGuildUserData('222', '42');
  assert.equal(g1.preferredSource, 'mangadex');
  assert.equal(g1.tracked.length, 1);
  assert.equal(g1.tracked[0].source, 'mangadex');
  assert.equal(g2.preferredSource, 'comix');
  assert.equal(g2.tracked.length, 1);
  assert.equal(g2.tracked[0].source, 'comix');
});

test('reads legacy global user as fallback when guild record does not exist', () => {
  const service = createService();
  service.saveUserData('99', {
    preferredSource: 'mangadex',
    autoCheckIntervalHours: 24,
    tracked: [{ source: 'mangadex', mangaId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Legacy' }],
  });

  const data = service.getGuildUserData('123', '99', { allowLegacyFallback: true });
  assert.equal(data.isLegacy, true);
  assert.equal(data.tracked.length, 1);

  const users = service.listGuildUsers('123');
  assert.equal(users.length, 1);
  assert.equal(users[0].isLegacy, true);
});
