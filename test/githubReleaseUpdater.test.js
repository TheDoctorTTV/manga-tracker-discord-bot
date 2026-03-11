const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions } = require('../src/services/githubReleaseUpdater');

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
