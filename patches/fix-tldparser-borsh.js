#!/usr/bin/env node
// @onsol/tldparser (used by UsersService.getSkrDomain for .skr domain lookups) declares
// "borsh": "^2.0.0", but in this workspace npm keeps hoisting it to the root borsh@0.7.0 that
// @coral-xyz/anchor needs elsewhere, instead of nesting tldparser's own copy — reproduced even
// after a full `rm -rf node_modules package-lock.json && npm install`, so it isn't a stale-lockfile
// issue. Without this, tldparser's borsh calls throw "schema.get is not a function" at runtime and
// getSkrDomain silently falls back to null. This vendors borsh@2.0.0 (zero runtime deps, so no
// transitive-dependency risk) straight into the one nested spot tldparser actually reads it from.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tldparserDir = path.join(root, 'node_modules', '@onsol', 'tldparser');
const target = path.join(tldparserDir, 'node_modules', 'borsh');
const source = path.join(__dirname, 'vendor', 'borsh-2.0.0');

if (!fs.existsSync(tldparserDir)) {
  process.exit(0); // @onsol/tldparser not installed in this environment — nothing to fix
}

function installedVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

if (installedVersion() === '2.0.0') {
  process.exit(0);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log('[fix-tldparser-borsh] vendored borsh@2.0.0 into @onsol/tldparser/node_modules/borsh');
