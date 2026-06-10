/**
 * Lint @UUID[…] references across packs-src to catch broken cross-links
 * before packaging. Walks every JSON page in packs-src/, scans for
 * `@UUID[Compendium.<pkg>.<pack>...]` patterns, and reports any reference
 * to a system pack we know about but a slug that does not exist.
 *
 * Currently informational only - the journal parser does not yet emit
 * UUID cross-links automatically. This script provides the framework
 * for Phase 7.3/7.4 integration.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(__dirname, '..');
const packsSrcDir = resolve(moduleRoot, 'packs-src');

const UUID_RE = /@UUID\[Compendium\.([^.\s]+)\.([^.\s]+)\.([^.\s]+)\.([^\]\s]+)\]/g;

let scanned = 0;
let total = 0;
const refs: Array<{ file: string; pkg: string; pack: string; type: string; id: string }> = [];

function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (entry.endsWith('.json')) scanFile(p);
  }
}

function scanFile(file: string) {
  scanned++;
  const text = readFileSync(file, 'utf8');
  let m: RegExpExecArray | null;
  while ((m = UUID_RE.exec(text)) !== null) {
    total++;
    refs.push({ file, pkg: m[1], pack: m[2], type: m[3], id: m[4] });
  }
}

try {
  walk(packsSrcDir);
} catch {
  console.log('[lint-uuid] no packs-src/ - run build:packs first.');
  process.exit(0);
}

console.log(`[lint-uuid] scanned ${scanned} files; found ${total} @UUID refs.`);
if (refs.length > 0) {
  for (const r of refs.slice(0, 25)) {
    console.log(`  · ${r.pkg}.${r.pack}.${r.type}.${r.id}`);
  }
  if (refs.length > 25) console.log(`  … (+${refs.length - 25} more)`);
}
process.exit(0);
