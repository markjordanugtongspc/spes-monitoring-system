import fs from 'fs';
import path from 'path';

const packagePath = path.resolve('package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const packageLockPath = path.resolve('package-lock.json');

// Parse current version (e.g. "0.3.0")
let [major, minor, patch] = pkg.version.split('.').map(Number);

patch += 1;
if (patch > 9) {
  patch = 0;
  minor += 1;
  if (minor > 9) {
    minor = 0;
    major += 1;
  }
}

const newVersion = `${major}.${minor}.${patch}`;
pkg.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

if (fs.existsSync(packageLockPath)) {
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
  packageLock.version = newVersion;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = newVersion;
  }
  fs.writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n', 'utf8');
}

console.log(`Bumped version to v${newVersion}`);
