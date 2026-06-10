/**
 * Journal parser for HbM RPG v3 books.
 *
 * Strategy
 * ────────
 * Supports two file formats:
 *
 * A. Legacy Google-Docs export (`_books/`):
 *    - No frontmatter.
 *    - TOC is a plain-text block that reuses the same `Rozdział X - Title`
 *      headings. The parser deduplicates: the SECOND occurrence of each
 *      heading is the real body.
 *
 * B. Native Obsidian/repo files (`rules/`, `lore/`):
 *    - Has YAML frontmatter (--- ... ---), stripped before parsing.
 *    - TOC is Obsidian bullet-links (`- [[#Anchor|Label]]`), not bare
 *      `Rozdział X` headings, so no duplicates exist and dedup is skipped.
 *    - Chapters may be prefixed with markdown heading markers (`## `).
 *    - An optional `prefaceTitle` captures content before the first chapter
 *      as a synthetic "Wstęp" entry.
 *
 * Output: `JournalDoc[]` consumed by `build-journal-packs.ts`.
 */

import { readFileSync } from 'node:fs';

export interface JournalDoc {
  /** Stable kebab-case slug. */
  id: string;
  /** Display title (Polish, as in book). */
  name: string;
  /** Pack id this entry belongs to (e.g. `abyss`). */
  pack: string;
  /** Source provenance for traceability. */
  source: { book: string; chapter: string; line: number };
  /** Pages - each becomes a `JournalEntryPage`. */
  pages: JournalPage[];
}

export interface JournalPage {
  name: string;
  /** Content as HTML (paragraph-split markdown, basic conversion). */
  html: string;
  /** Hint for sort order. */
  sort: number;
}

export interface JournalParseConfig {
  /** Absolute path to the markdown book. */
  bookPath: string;
  /** Pack id to assign (e.g. `abyss`). */
  pack: string;
  /** Source-book id for `source.book`. */
  sourceBook: string;
  /** Optional: only emit chapters whose title matches this regex. */
  chapterFilter?: RegExp;
  /** Optional: skip chapters whose title matches this regex (e.g. spell tables). */
  chapterSkip?: RegExp;
  /**
   * If set, content between the frontmatter/start and the first chapter is
   * collected and emitted as a synthetic entry with this title (e.g. "Wstęp").
   * Useful for the intro paragraphs of split `rules/` files.
   */
  prefaceTitle?: string;
}

// Matches both plain-text (`Rozdział IV - Title`) and heading-prefixed
// (`## Rozdział IV - Title`) chapter lines. Optional trailing page number.
const CHAPTER_RE = /^(?:#{1,6}\s+)?Rozdzia[łl]\s+([IVXLC]+)\s*[:.\-–]\s*(.+?)(?:\s+\d+)?$/;
const SEPARATOR = /^_{3,}$/;
const FRONTMATTER_FENCE = /^---\s*$/;
// Obsidian TOC bullets: `- [[#Anchor|Label]]` - skip in body content too
const OBSIDIAN_TOC_BULLET = /^[-*]\s+\[\[#/;

/** Returns the first non-frontmatter line index (skips `--- ... ---` block). */
function skipFrontmatter(lines: string[]): number {
  if (lines.length === 0 || !FRONTMATTER_FENCE.test(lines[0].trim())) return 0;
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_FENCE.test(lines[i].trim())) return i + 1;
  }
  return 0;
}

export function parseJournalBook(cfg: JournalParseConfig): JournalDoc[] {
  const text = readFileSync(cfg.bookPath, 'utf8');
  const rawLines = text.split(/\r?\n/);
  const startIdx = skipFrontmatter(rawLines);
  const lines = rawLines.slice(startIdx);

  // Pass 1: find every chapter occurrence.
  const occurrences: Array<{ idx: number; roman: string; title: string; raw: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(CHAPTER_RE);
    if (m) occurrences.push({ idx: i, roman: m[1], title: m[2].trim(), raw: lines[i].trim() });
  }
  if (occurrences.length === 0) {
    // No chapters found - if there's a prefaceTitle, still try to emit preface.
    if (cfg.prefaceTitle) {
      const pages = bodyToPages(lines);
      if (pages.length > 0) {
        const slug = slugify(cfg.prefaceTitle);
        return [{ id: `${cfg.pack}-${slug}`, name: cfg.prefaceTitle, pack: cfg.pack, source: { book: cfg.sourceBook, chapter: cfg.prefaceTitle, line: startIdx + 1 }, pages }];
      }
    }
    return [];
  }

  // Identify TOC entries: a chapter occurrence is part of the TOC if the
  // SAME (roman, title) pair occurs again later in the file.
  const seen = new Map<string, number>();
  const bodyChapters: typeof occurrences = [];
  for (const occ of occurrences) {
    const key = `${occ.roman}|${occ.title}`;
    if (!seen.has(key)) {
      seen.set(key, occ.idx);
      continue;
    }
    bodyChapters.push(occ);
  }
  // If no duplicates were found (no plain-text TOC - typical of native files),
  // treat the entire list as body chapters.
  const chapters = bodyChapters.length > 0 ? bodyChapters : occurrences;

  const docs: JournalDoc[] = [];

  // Emit preface entry (content before first chapter heading).
  if (cfg.prefaceTitle && chapters.length > 0) {
    const prefaceBody = lines.slice(0, chapters[0].idx);
    // Filter out Obsidian TOC bullets so they don't become page content.
    const prefaceClean = prefaceBody.filter((l) => !OBSIDIAN_TOC_BULLET.test(l.trim()));
    const pages = bodyToPages(prefaceClean);
    if (pages.length > 0) {
      const slug = slugify(cfg.prefaceTitle);
      docs.push({
        id: `${cfg.pack}-${slug}`,
        name: cfg.prefaceTitle,
        pack: cfg.pack,
        source: { book: cfg.sourceBook, chapter: cfg.prefaceTitle, line: startIdx + 1 },
        pages,
      });
    }
  }

  for (let c = 0; c < chapters.length; c++) {
    const ch = chapters[c];
    if (cfg.chapterSkip && cfg.chapterSkip.test(ch.title)) continue;
    if (cfg.chapterFilter && !cfg.chapterFilter.test(ch.title)) continue;

    const start = ch.idx + 1;
    const end = c + 1 < chapters.length ? chapters[c + 1].idx : lines.length;
    const bodyRaw = lines.slice(start, end);
    // Filter out Obsidian TOC bullets.
    const body = bodyRaw.filter((l) => !OBSIDIAN_TOC_BULLET.test(l.trim()));

    const pages = bodyToPages(body);
    if (pages.length === 0) continue;

    const slug = slugify(`${ch.roman}-${ch.title}`);
    docs.push({
      id: `${cfg.pack}-${slug}`,
      name: `Rozdział ${ch.roman} - ${ch.title}`,
      pack: cfg.pack,
      source: { book: cfg.sourceBook, chapter: ch.title, line: startIdx + ch.idx + 1 },
      pages,
    });
  }
  return docs;
}

/** Split a chapter body by `____` separators into pages, converting each to HTML. */
function bodyToPages(body: string[]): JournalPage[] {
  const segments: string[][] = [[]];
  for (const line of body) {
    if (SEPARATOR.test(line.trim())) {
      if (segments[segments.length - 1].length > 0) segments.push([]);
    } else {
      segments[segments.length - 1].push(line);
    }
  }
  const pages: JournalPage[] = [];
  let pageNo = 1;
  for (const seg of segments) {
    const cleaned = trimEdges(seg);
    if (cleaned.length === 0) continue;
    const name = derivePageTitle(cleaned, pageNo);
    pages.push({ name, html: linesToHtml(cleaned), sort: pageNo * 100 });
    pageNo++;
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

/** First non-empty line if it looks short and title-like, else "Część N". */
function derivePageTitle(lines: string[], pageNo: number): string {
  const first = lines.find((l) => l.trim().length > 0)?.trim() ?? '';
  if (first.length > 0 && first.length <= 80 && !/[.!?]$/.test(first)) {
    return first;
  }
  return `Część ${pageNo}`;
}

/** Conservative markdown → HTML conversion. Paragraphs, bold, italic, lists. */
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

    if (trimmed === '') {
      flushPara();
      flushList();
      continue;
    }

    const ulMatch = trimmed.match(/^[*\-]\s+(.+)$/);
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ulMatch) {
      flushPara();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
        out.push('<ul>');
      }
      out.push(`<li>${inline(ulMatch[1])}</li>`);
      continue;
    }
    if (olMatch) {
      flushPara();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
        out.push('<ol>');
      }
      out.push(`<li>${inline(olMatch[1])}</li>`);
      continue;
    }

    // Sub-heading: stand-alone short bold-ish line
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
  // Order matters: escape first, then markup.
  let r = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  r = r.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) => {
    return `<a class="lore-link" data-target="${target.trim()}">${(label ?? target).trim()}</a>`;
  });
  return r;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
