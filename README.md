# HbM RPG v3 - Lore (Foundry VTT module)

Companion lore module for the [HbM RPG v3 system](https://github.com/iwo-strzebonski/hbm-foundry-system). Ships JournalEntry compendia for setting, history, and narrative chapters from the official books.

## Build

```bash
bun install
bun run build:packs   # parse _books/*.md → packs/ (LevelDB)
bun run package       # zip into hbm-rpg-v3-lore-vX.Y.Z.zip
```

Requires the `_books/` folder at the repo root (synced via the parent CLI).

## Packs

| Pack | Source book |
|------|-------------|
| `core-rules-lore` | Podręcznik Gry |
| `magic-book-lore` | Księga Magii |
| `bestiary-lore` | Bestiariusz |
| `blood-magic-history` | Arcanum Sanguinis |
| `crimson-cult` | Chwała Szkarłatnemu Kultowi |
| `abyss` | Klątwa Otchłani |
| `economy` | Złoto, Stal i Magia |
