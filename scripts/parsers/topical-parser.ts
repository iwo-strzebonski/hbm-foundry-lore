/**
 * Topical vault-folder parser.
 *
 * Recursively walks a folder and converts every `.md` file into a
 * `JournalDoc`. Strips YAML frontmatter and Obsidian tag lines; converts the
 * remaining body to HTML pages (one per `____` separator, or a single page
 * if no separators). Empty/stub files still produce a JournalEntry with one
 * empty page so the folder layout mirrors the Obsidian vault in Foundry.
 *
 * Stable `_id` derivation: `slugify(packId + '/' + relativePathWithoutExt)`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, basename, extname, dirname } from 'node:path';
import type { JournalDoc, JournalPage } from './journal-parser';

export interface TopicalParseConfig {
  /** Absolute path to the folder to walk. */
  folderPath: string;
  /** Foundry pack id (e.g. `organizations`). */
  pack: string;
}

const SEPARATOR = /^_{3,}$/;
const FRONTMATTER_FENCE = /^---\s*$/;
const OBSIDIAN_TOC_BULLET = /^[-*]\s+\[\[#/;
// Obsidian tag lines: lines that start with `#tag` or are `#tag #tag2 …`
const TAG_LINE = /^(#[a-zA-ZżźćąśęłóńŻŹĆĄŚĘŁÓŃ_-]+\s*)+$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseTopicalFolder(cfg: TopicalParseConfig): JournalDoc[] {
  const docs: JournalDoc[] = [];
  walkDir(cfg.folderPath, cfg.folderPath, cfg.pack, docs);
  return docs;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function walkDir(
  rootPath: string,
  currentPath: string,
  pack: string,
  out: JournalDoc[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(currentPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    // Skip hidden files / system files.
    if (entry.startsWith('.')) continue;

    const fullPath = resolve(currentPath, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(rootPath, fullPath, pack, out);
    } else if (stat.isFile() && extname(entry).toLowerCase() === '.md') {
      const doc = parseTopicalFile(rootPath, fullPath, pack);
      if (doc) out.push(doc);
    }
  }
}

function parseTopicalFile(
  rootPath: string,
  filePath: string,
  pack: string,
): JournalDoc | null {
  let rawText = '';
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const rawLines = rawText.split(/\r?\n/);

  // Strip YAML frontmatter.
  const bodyStart = skipFrontmatter(rawLines);
  const bodyLines = rawLines.slice(bodyStart);

  // Derive stable id from relative path.
  const relPath = relative(rootPath, filePath);
  // e.g. "Federacja Sol-3/Diana.md" → "federacja-sol-3-diana"
  const slug = slugifyPath(relPath);
  const id = `${pack}-${slug}`;

  // Display name = filename without extension.
  const name = basename(filePath, extname(filePath));

  // Build pages from body (split on ___ separators); even stubs get one page.
  const pages = bodyToPages(bodyLines, name);

  // Source: relative path inside the repo.
  const source = {
    book: pack,
    chapter: name,
    line: bodyStart + 1,
  };

  return { id, name, pack, source, pages };
}

/** Split body into pages separated by `____`. */
function bodyToPages(lines: string[], defaultName: string): JournalPage[] {
  const segments: string[][] = [[]];
  for (const line of lines) {
    if (SEPARATOR.test(line.trim())) {
      segments.push([]);
    } else if (!OBSIDIAN_TOC_BULLET.test(line.trim())) {
      // Skip Obsidian TOC bullets from pages too.
      segments[segments.length - 1].push(line);
    }
  }

  const pages: JournalPage[] = [];
  let pageNo = 1;
  for (const seg of segments) {
    const cleaned = trimEdges(seg.filter((l) => !TAG_LINE.test(l.trim())));
    // Always emit at least one page, even if empty (placeholders for stubs).
    const html = cleaned.length > 0 ? linesToHtml(cleaned) : '';
    const name = pages.length === 0 ? (derivePageTitle(cleaned) ?? defaultName) : `Część ${pageNo}`;
    pages.push({ name, html, sort: pageNo * 100 });
    pageNo++;
    // Only the first page can be empty (stub placeholder). Subsequent empty
    // segments (trailing separators) are skipped.
    if (cleaned.length === 0 && pageNo > 2) continue;
  }
  return pages;
}

function trimEdges(arr: string[]): string[] {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi && arr[lo].trim() === '') lo++;
  while (hi > lo && arr[hi - 1].trim() === '') hi--;
  return arr.slice(lo, hi);
}

function derivePageTitle(lines: string[]): string | null {
  const first = lines.find((l) => l.trim().length > 0)?.trim() ?? '';
  if (!first) return null;
  const bare = first.replace(/^#{1,6}\s+/, '');
  if (bare.length > 0 && bare.length <= 80 && !/[.!?]$/.test(bare)) return bare;
  return null;
}

function skipFrontmatter(lines: string[]): number {
  if (lines.length === 0 || !FRONTMATTER_FENCE.test(lines[0].trim())) return 0;
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_FENCE.test(lines[i].trim())) return i + 1;
  }
  return 0;
}

function slugifyPath(relPath: string): string {
  // Remove .md extension, convert path separators to hyphens, slugify.
  const withoutExt = relPath.replace(/\.md$/i, '');
  return withoutExt
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** Conservative markdown → HTML. Reuses same logic as journal-parser. */
function linesToHtml(lines: string[]): string {
  const out: string[] = [];
  let para: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inline(para.join(' ').trim())}</p>`);
    para = [];
  };
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '' || TAG_LINE.test(trimmed)) {
      flushPara();
      flushList();
      continue;
    }

    const ulMatch = trimmed.match(/^[*\-]\s+(.+)$/);
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ulMatch) {
      flushPara();
      if (listType !== 'ul') { flushList(); listType = 'ul'; out.push('<ul>'); }
      out.push(`<li>${inline(ulMatch[1])}</li>`);
      continue;
    }
    if (olMatch) {
      flushPara();
      if (listType !== 'ol') { flushList(); listType = 'ol'; out.push('<ol>'); }
      out.push(`<li>${inline(olMatch[1])}</li>`);
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      flushPara();
      flushList();
      const lvl = Math.min(6, (trimmed.match(/^#+/)?.[0].length ?? 2) + 1);
      out.push(`<h${lvl}>${inline(trimmed.replace(/^#+\s+/, ''))}</h${lvl}>`);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}

function inline(s: string): string {
  let r = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  r = r.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) =>
    `<a class="lore-link" data-target="${target.trim()}">${(label ?? target).trim()}</a>`,
  );
  return r;
}
