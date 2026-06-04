import fs from 'fs';
import path from 'path';

// Read version from package.json
const pkgPath = path.resolve('package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

// Update login/index.html
const loginPath = path.resolve('src/frontend/login/index.html');
if (fs.existsSync(loginPath)) {
  let content = fs.readFileSync(loginPath, 'utf8');
  content = content.replace(/(<p id="app-version"[^>]*>\s*)v\d+\.\d+\.\d+(\s*<\/p>)/, `$1v${version}$2`);
  fs.writeFileSync(loginPath, content, 'utf8');
  console.log(`\x1b[32m✔ Synced version to v${version} in login/index.html\x1b[0m`);
}
