# nomad-bsp

## To the next instance

This is the **NOMAD game system as pscale blocks** for bsp-mcp + federated beach. It sits at **pscale sublayer 2** in the substrate's layer model (sublayer 1 = substrate convention in bsp-mcp; sublayer 3 = world content authored at a beach).

## Read first

- [bsp-mcp engagement framing](https://github.com/pscale-commons/bsp-mcp-server/blob/main/proposals/2026-05-18-engagement-framing.md) — substrate-up architecture
- [spatial coord block convention](https://github.com/pscale-commons/bsp-mcp-server/blob/main/proposals/2026-05-18-spatial-coord-convention.md) — the substrate convention this game system uses
- bsp-mcp's `src/sunstone.json` and `src/whetstone.json` — pscale geometry and bsp() operational reference
- onen-play `docs/NOMAD-Plex0-Implementation.md` and `docs/core-gameplay-v9.md` — the badly-coded predecessor; reference for game-design intent only, NOT for code patterns

## What this repo is and isn't

**Is:** a bundle of pscale blocks (`seeds/`) + a synthesis daemon (`daemon/`), designed to seed onto a federated beach. The blocks are the game system; players engage them via bsp-mcp from any MCP client.

**Isn't:**
- a UI (Claude.app + bsp-mcp + this beach is the minimum playable client)
- a game world (Thornkeep, Middle-Earth, etc. are sublayer 3 content authored separately)
- a substrate convention (those live in bsp-mcp)
- a Supabase-style central state machine (the substrate IS the state)

## Authoring rules (inherited from bsp-mcp)

- Semantic addresses carry ONE decimal point — `block:4.71` not `block:4.7.1`; tree walks use commas: `block:4,7,1`
- Underscores stand alone — substantive sentences readable without children
- No `_word` sibling keys — the bsp walker only handles `_` and digits 1-9
- One concern per block; cross-refs via star (`*:beach:block`)

## What lives where

- `seeds/` — source-of-truth JSON blocks. Seeded onto a target beach via `scripts/init.ts`. Same pattern as `pscale-beach`'s seed library.
- `daemon/` — synthesis daemon code. Target deployment: always-on hard crab on a home server (e.g. Mac mini with launchd plist). Reads pool/frame/character locations; writes solid + history; updates witnessed.
- `scripts/init.ts` — seeds `seeds/` contents onto a target beach.
- `docs/ARCHITECTURE.md` — design overview.

## Build order (incremental)

1. **Repo bootstrap** — this commit. Scaffolding, placeholders, layered explanation.
2. **Adapt soft/medium/hard agent prompts** from xstream-play `blocks/xstream/` (the existing `soft-agent.json`, `medium-agent.json`, `hard-agent.json` are the reference design) for bsp-mcp wire. NOT a copy — re-author with bsp-mcp's substrate access pattern.
3. **NOMAD dice + stats + character generation** as pscale blocks. Port from onen-play docs (not code); refactor for substrate-native storage.
4. **Init script** — implement the seeding flow. Reference: pscale-beach's `init.ts` shape.
5. **Synthesis daemon** — Node or Python; ~200 lines; runs on always-on hard crab. Reference: pscale-mcp-server `docs/protocol-grit.md` daemon contract.
6. **First playtest** — solo via Claude.app + bsp-mcp, then with a friend. Iterate.

## What NOT to import

- xstream-play implementation TypeScript (Supabase patterns baked in)
- onen-play Lovable code (badly coded by the substrate author's own assessment)
- pscale-mcp-server Thornkeep scripts (proof-of-process, not definitive design)

Use these only as design intent references. Re-author for bsp-mcp + federated beach.

## Status

v0.0.1 — scaffolding only. Game system content TBD.

## License

MIT.
