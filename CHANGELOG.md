# Changelog — hbm-rpg-v3-lore

All notable changes to the **HbM RPG v3 — Lore** Foundry VTT module.

## [1.1.0] — 2026-04-30

Version bump to track the companion system release. No content changes.

## [1.0.0] — 2026-04-29

First production release.

### Added

- 7 `JournalEntry` compendia generated from `_books/*.md` (36 entries total):
  - `core-rules-lore` — Podręcznik Gry (5)
  - `magic-book-lore` — Księga Magii (7)
  - `bestiary-lore` — Bestiariusz (1)
  - `blood-magic-history` — Arcanum Sanguinis (4)
  - `crimson-cult` — Chwała Szkarłatnemu Kultowi (5)
  - `abyss` — Klątwa Otchłani (5)
  - `economy` — Złoto, Stal i Magia (9)
- Build pipeline: `scripts/parsers/journal-parser.ts` walks
  `Rozdział [IVX]+ [:.\-] Title`, deduplicates TOC vs. body, splits chapters by
  `____` separators into pages, converts markdown → HTML
  (paragraphs / lists / headings / bold / italic / `[[wikilink]]` →
  `<a class="lore-link">` for downstream UUID rewriting).
- `scripts/build-journal-packs.ts` writes per-pack JSON and compiles to LevelDB.
- `scripts/package.ts` produces `hbm-rpg-v3-lore-vX.Y.Z.zip`.
- `scripts/lint-uuid-refs.ts` framework for cross-link validation.
- Declares `relationships.systems[hbm-rpg-v3 ≥1.0.0]`.

### Deferred

- Przewodnik Ludzkości po Magicznym Świecie packs (`world-overview`, `deities`,
  `universe`, `sol3-society`, `afterlife`, `documents`) — book not yet in
  `_books/`. Will land in v1.1.0.
- Automatic UUID cross-link injection (parser emits `lore-link` placeholders
  ready for a follow-up rewrite pass).
- Reverse cross-links from system NPC actors to lore journal pages.
- Asset bundling from vault `_assets/`.
