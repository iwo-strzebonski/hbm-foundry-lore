/**
 * Build LevelDB JournalEntry packs from book chapters.
 *
 * One pack per book / topic (mapped via PACK_CONFIGS + TOPICAL_CONFIGS).
 *
 * Split-book packs accept multiple source files: a list of `SourceFile`
 * entries each pointing at a `rules/` or `lore/` markdown file (instead of a
 * single monolithic `_books/` file). An optional `prefaceTitle` per source
 * captures the introductory content before the first chapter heading.
 *
 * Run: `bun scripts/build-journal-packs.ts` from `.src/foundry-lore/`.
 */

import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePack } from '@foundryvtt/foundryvtt-cli';
import { parseJournalBook, type JournalDoc, type JournalPage } from './parsers/journal-parser';
import { parseTopicalFolder } from './parsers/topical-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(__dirname, '..');
const repoRoot = resolve(moduleRoot, '..', '..');
const booksDir = resolve(repoRoot, '_books');
const packsSrcDir = resolve(moduleRoot, 'packs-src');
const packsOutDir = resolve(moduleRoot, 'packs');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceFile {
  /** Path relative to repoRoot. */
  path: string;
  /**
   * If set, lines before the first chapter heading are collected and emitted
   * as a synthetic journal entry with this title (e.g. "Wstęp").
   */
  prefaceTitle?: string;
}

interface PackConfig {
  pack: string;
  /** For provenance / flags. */
  sourceBook: string;
  /** One or more source files that together make up this pack. */
  sources: SourceFile[];
  /** Skip chapters whose title matches this regex. */
  skip?: RegExp;
}

// ---------------------------------------------------------------------------
// Pack configurations
// ---------------------------------------------------------------------------

const PACK_CONFIGS: PackConfig[] = [
  {
    pack: 'core-rules-lore',
    sourceBook: 'core-rules',
    sources: [{ path: 'ObsidianNotes/rules/00. Podręcznik Gry.md' }],
    skip: /^(Talenty|Zaklęcia|Atrybuty|Umiejętności|Wyposażenie)/i,
  },
  {
    pack: 'bestiary-lore',
    sourceBook: 'bestiary',
    sources: [{ path: 'ObsidianNotes/rules/06. Bestiariusz.md' }],
    skip: /^Talenty/i,
  },

  // ── Split books: combine lore/ chapters + Wstęp intro from rules/ ──
  {
    pack: 'magic-book-lore',
    sourceBook: 'magic-book',
    sources: [
      // Lore intro lives inside the rules file (no dedicated lore/ file).
      { path: 'ObsidianNotes/rules/01. Księga Magii.md', prefaceTitle: 'Wstęp' },
    ],
    skip: /^(Zaklęcia|Lista zaklęć|Rozdział V)/i,
  },
  {
    pack: 'abyss',
    sourceBook: 'abyss-curse',
    sources: [
      // Pure lore narrative.
      { path: 'ObsidianNotes/lore/02. Otchłań i Magia.md' },
      // Rules intro (Wstęp only - mechanics chapters are skipped).
      { path: 'ObsidianNotes/rules/02. Klątwa Otchłani.md', prefaceTitle: 'Wstęp' },
    ],
    skip: /^(Rozdział II - Talenty|Rozdział III - Dary|Rozdział IV - Choroby|Rozdział V - Zaklęcia|Rozdział X - Artefakty)/i,
  },
  {
    pack: 'blood-magic-history',
    sourceBook: 'arcanum-sanguinis',
    sources: [
      { path: 'ObsidianNotes/rules/04. Arcanum Sanguinis.md', prefaceTitle: 'Wstęp' },
    ],
    skip: /^Rozdział IV - Talenty/i,
  },
  {
    pack: 'crimson-cult',
    sourceBook: 'crimson-cult',
    sources: [
      // Lore narrative (former Chwała Szkarłatnemu Kultowi lore section).
      { path: 'ObsidianNotes/lore/05. Szkarłatny Kult.md' },
      // Rules intro only (spells/artifacts skipped).
      { path: 'ObsidianNotes/rules/05. Vivat Patriarcha coccineus!.md', prefaceTitle: 'Wstęp' },
    ],
    skip: /^(Rozdział I - Zaklęcia|Rozdział II - Artefakty)/i,
  },
  {
    pack: 'economy',
    sourceBook: 'gold-steel-magic',
    sources: [
      { path: 'ObsidianNotes/lore/03. Ekonomia Magicznego Świata.md' },
      { path: 'ObsidianNotes/rules/03. Złoto, Stal i Magia.md', prefaceTitle: 'Wstęp' },
    ],
    skip: /^(Aneks A - Nowe Talenty|Aneks B - Przedmioty)/i,
  },

  // ── New: Humanity Guide ──
  {
    pack: 'humanity-guide',
    sourceBook: 'humanity-guide',
    sources: [{ path: 'ObsidianNotes/lore/10. Przewodnik Ludzkości po Magicznym Świecie.md' }],
  },
];

// ---------------------------------------------------------------------------
// Topical vault-folder configurations
// ---------------------------------------------------------------------------

interface TopicalConfig {
  /** Folder path relative to repoRoot. */
  folder: string;
  /** Foundry pack id. */
  pack: string;
}

const TOPICAL_CONFIGS: TopicalConfig[] = [
  { folder: 'ObsidianNotes/disciplines', pack: 'disciplines-lore' },
  { folder: 'ObsidianNotes/organizations', pack: 'organizations' },
  { folder: 'ObsidianNotes/races', pack: 'races-lore' },
  { folder: 'ObsidianNotes/classes', pack: 'classes' },
  { folder: 'ObsidianNotes/concepts', pack: 'concepts' },
  { folder: 'ObsidianNotes/locations', pack: 'locations' },
  { folder: 'ObsidianNotes/npcs', pack: 'npcs' },
  { folder: 'ObsidianNotes/conflicts', pack: 'conflicts' },
  { folder: 'ObsidianNotes/player-characters', pack: 'player-characters' },
  { folder: 'ObsidianNotes/adventures', pack: 'adventures' },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`[lore] repo root: ${repoRoot}`);

const allDocs: JournalDoc[] = [];

// ── Book packs ──
for (const cfg of PACK_CONFIGS) {
  let packDocs: JournalDoc[] = [];
  for (const src of cfg.sources) {
    const bookPath = resolve(repoRoot, src.path);
    if (!existsSync(bookPath)) {
      console.warn(`  · skip source ${src.path}: file not found`);
      continue;
    }
    const docs = parseJournalBook({
      bookPath,
      pack: cfg.pack,
      sourceBook: cfg.sourceBook,
      chapterSkip: cfg.skip,
      prefaceTitle: src.prefaceTitle,
    });

    packDocs.push(...docs);
  }
  console.log(`  · ${cfg.pack}: ${packDocs.length} entries`);
  allDocs.push(...packDocs);
}

// ── Topical packs ──
for (const top of TOPICAL_CONFIGS) {
  const folderPath = resolve(repoRoot, top.folder);
  if (!existsSync(folderPath)) {
    console.warn(`  · skip topical ${top.pack}: folder not found (${top.folder})`);
    continue;
  }
  const docs = parseTopicalFolder({ folderPath, pack: top.pack });
  console.log(`  · ${top.pack}: ${docs.length} entries`);
  allDocs.push(...docs);
}

console.log(`[lore] parsed ${allDocs.length} journal entries total`);

if (existsSync(packsSrcDir)) rmSync(packsSrcDir, { recursive: true });
const byPack = new Map<string, JournalDoc[]>();
for (const doc of allDocs) {
  const list = byPack.get(doc.pack) ?? [];
  list.push(doc);
  byPack.set(doc.pack, list);
}

for (const [pack, docs] of byPack) {
  const dir = resolve(packsSrcDir, pack);
  mkdirSync(dir, { recursive: true });
  let sort = 0;
  for (const doc of docs) {
    sort += 100;
    const foundryDoc = toFoundryJournal(doc, sort);
    writeFileSync(resolve(dir, `${doc.id}.json`), `${JSON.stringify(foundryDoc, null, 2)}\n`, 'utf8');
  }
  console.log(`  · wrote ${pack}: ${docs.length} entries`);
}

if (existsSync(packsOutDir)) rmSync(packsOutDir, { recursive: true });
for (const pack of byPack.keys()) {
  const src = resolve(packsSrcDir, pack);
  const dest = resolve(packsOutDir, pack);
  await compilePack(src, dest, {
    recursive: false,
    log: false,
    transformEntry: (doc: any, context: any) => {
      if (!doc._key) {
        console.error(`[build-journal-packs] ERROR: Document missing _key! Name: ${doc.name}, ID: ${doc._id}`);
      }
      if (doc.pages) {
        for (const page of doc.pages) {
          if (!page._key) {
            console.error(`[build-journal-packs] ERROR: Page missing _key! Journal: ${doc.name}, Page: ${page.name}, Page ID: ${page._id}`);
          }
        }
      }
      return true;
    }
  });
  console.log(`  ✓ compiled ${pack}`);
}

console.log(`[lore] done - ${byPack.size} packs in packs/`);

function toFoundryJournal(doc: JournalDoc, sort: number): Record<string, unknown> {
  const fId = makeFoundryId(doc.id);
  return {
    _key: `!journal!${fId}`,
    _id: fId,
    name: doc.name,
    folder: null,
    sort,
    pages: doc.pages.map((page, i) => {
      const pageFId = makeFoundryId(`${doc.id}-page-${i}`);
      return {
        _key: `!journal.pages!${fId}.${pageFId}`,
        _id: pageFId,
        name: page.name,
        type: 'text',
        title: { show: true, level: 1 },
        text: { content: page.html, format: 1 /* HTML */ },
        sort: page.sort,
      };
    }),
    flags: {
      'hbm-rpg-v3-lore': {
        slug: doc.id,
        sourceBook: doc.source.book,
        sourceChapter: doc.source.chapter,
        sourceLine: doc.source.line,
      },
    },
    _stats: {},
  };
}

/**
 * Derive a stable 12-character Foundry document ID from a slug.
 * Uses two independent FNV-1a 32-bit hashes to spread entropy across the
 * *entire* slug (not just the first 12 bytes), avoiding collisions between
 * slugs that share a long common prefix (e.g. page-0 vs page-1).
 */
function makeFoundryId(slug: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  // FNV-1a 32-bit, two independent passes with different offsets
  let h1 = 0x811c9dc5;
  let h2 = 0x4b9ace3f;
  for (let i = 0; i < slug.length; i++) {
    const c = slug.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i + 1), 0x01000193) >>> 0;
  }
  // Encode 64 bits (two 32-bit hashes) into 12 base-62 chars
  let out = '';
  let lo = h1;
  let hi = h2;
  for (let i = 0; i < 12; i++) {
    // Combine both halves cycling
    const combined = (i % 2 === 0 ? lo : hi) >>> 0;
    out += alphabet[combined % alphabet.length];
    lo = Math.imul(lo, 1664525) + 1013904223 >>> 0;
    hi = Math.imul(hi, 22695477) + 1013904223 >>> 0;
  }
  return out;
}
