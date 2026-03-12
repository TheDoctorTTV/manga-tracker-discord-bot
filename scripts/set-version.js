#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const versionArg = String(process.argv[2] || '').trim();
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!versionArg) {
  console.error('Usage: node scripts/set-version.js <version>');
  process.exit(1);
}

if (!semverPattern.test(versionArg)) {
  console.error(`Invalid version "${versionArg}". Expected semver format (for example: 1.0.1 or 1.1.0-beta.1).`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const versionFilePath = path.join(rootDir, 'version.json');
const packageFilePath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');

const versionJson = readJson(versionFilePath);
versionJson.version = versionArg;
writeJson(versionFilePath, versionJson);

const packageJson = readJson(packageFilePath);
packageJson.version = versionArg;
writeJson(packageFilePath, packageJson);

if (fs.existsSync(packageLockPath)) {
  const packageLockJson = readJson(packageLockPath);
  packageLockJson.version = versionArg;
  if (packageLockJson.packages && packageLockJson.packages['']) {
    packageLockJson.packages[''].version = versionArg;
  }
  writeJson(packageLockPath, packageLockJson);
}

console.log(`Version updated to ${versionArg}`);
console.log('Updated: version.json, package.json, package-lock.json');
