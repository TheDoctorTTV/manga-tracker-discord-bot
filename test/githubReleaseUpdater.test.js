const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, GitHubReleaseUpdater } = require('../src/services/githubReleaseUpdater');

test('treats prerelease increments as newer within same base version', () => {
  assert.equal(compareVersions('1.0.0-pr4', '1.0.0-pr3') > 0, true);
  assert.equal(compareVersions('1.0.0-pr3', '1.0.0-pr4') < 0, true);
});

test('treats stable version as newer than prerelease with same base version', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0-pr4') > 0, true);
  assert.equal(compareVersions('1.0.0-pr4', '1.0.0') < 0, true);
});

test('keeps normal semver ordering for major/minor/patch', () => {
  assert.equal(compareVersions('1.1.0', '1.0.9') > 0, true);
  assert.equal(compareVersions('2.0.0', '1.9.9') > 0, true);
});

test('prefers release archive for dashboard asset refresh during binary updates', () => {
  const updater = new GitHubReleaseUpdater({
    repoUrl: 'TheDoctorTTV/manga-tracker-discord-bot',
    currentVersion: '1.0.0-pr15',
    binaryPath: '/opt/manga-tracker-discord-bot/manga-tracker',
  });

  const release = {
    assets: [
      { name: 'manga-tracker', browserDownloadUrl: 'https://example.test/binary' },
      { name: 'manga-tracker-linux.tar.gz', browserDownloadUrl: 'https://example.test/archive' },
    ],
  };

  const binaryAsset = updater.pickReleaseAsset(release);
  const packageAsset = updater.pickDashboardPackageAsset(release, binaryAsset);

  assert.equal(binaryAsset.name, 'manga-tracker');
  assert.equal(packageAsset.name, 'manga-tracker-linux.tar.gz');
});
