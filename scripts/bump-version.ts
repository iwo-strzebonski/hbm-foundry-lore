/**
 * Bumps the patch version in package.json and module.json in lock-step.
 * Run automatically as part of `bun run package`.
 *
 * Usage:
 *   bun scripts/bump-version.ts          # patch bump  (0.1.0 → 0.1.1)
 *   bun scripts/bump-version.ts minor    # minor bump  (0.1.0 → 0.2.0)
 *   bun scripts/bump-version.ts major    # major bump  (0.1.0 → 1.0.0)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

type BumpType = 'major' | 'minor' | 'patch';
const bump = (process.argv[2] ?? 'patch') as BumpType;

function bumpVersion(version: string, type: BumpType): string {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// --- package.json ---
const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
const oldVersion = pkg.version;
const newVersion = bumpVersion(oldVersion, bump);
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// --- module.json ---
const modPath = resolve(root, 'module.json');
const mod = JSON.parse(readFileSync(modPath, 'utf8')) as { version: string; download: string };
mod.version = newVersion;
// Update the versioned filename in the download URL if it follows the vX.Y.Z pattern
mod.download = mod.download.replace(/-v[\d.]+\.zip$/, `-v${newVersion}.zip`);
writeFileSync(modPath, JSON.stringify(mod, null, 2) + '\n');

console.log(`✓ Version bumped ${oldVersion} → ${newVersion}`);
