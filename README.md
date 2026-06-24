# nomad-bsp — DEPRECATED (2026-06-24)

> **This repo is deprecated and is no longer the home of the RPG engine.** It was the
> June-2026 **GRIT-as-daemon** extraction — a central synthesis daemon plus seedable NOMAD
> blocks, in a **one-tier** model ("the game system is NOMAD; D&D would be a separate repo").
> The live engine has since moved to a **daemonless, in-loop, two-tier** model:
>
> - **GRIT** — the play-loop — is now a bsp-mcp **sentinel**, `pscale://grit` (canonical,
>   always-available). Resolution is in-loop in each participant's LLM, gated by the beach's
>   atomic single-resolution claim (`resolves_window`) — there is **no resolver/compressor daemon**.
> - **NOMAD** — the resolution rules — is the **swappable** `rules:nomad` block (the live
>   Thornwood cartridge realizes it; a D&D-style system would be a sibling rules block).
> - **World** — `spatial:<world>` + `rules:<world>` + cast — is a cartridge (see
>   `pscale-beach/packs/thornwood`).
>
> **Canonical sources now:** `pscale://grit` (the loop) · bsp-mcp
> `proposals/2026-06-23-grit-extraction.md` (the extraction) · `pscale-beach/packs/thornwood`
> (the reference world) · `pscale-beach/seeds/library/{grit,rpg}.json` (the library pointers).
> **Salvaged from here:** `seeds/character-template.json` feeds the parked character-creation
> work. The `daemon/` and the soft/medium/hard agent prompts are superseded (in-loop play + the
> character-shell convention replaced them).
>
> Everything below is historical — kept for the record, not current.

---

NOMAD tabletop RPG game system as pscale blocks for the **bsp-mcp + federated beach** substrate.

## What this is

NOMAD is a game system. This repo holds it as a **bundle of pscale blocks** plus a synthesis daemon, designed to seed onto any federated beach via bsp-mcp.

Once seeded, players engage NOMAD scenes through any MCP client (Claude.app, claude-app, etc.) — no specialised UI required. xstream and other clients add reflexive presentation when ready; functional play does not depend on them.

## Where this fits

In the pscale sublayer model (see [bsp-mcp engagement framing](https://github.com/pscale-commons/bsp-mcp-server/blob/main/proposals/2026-05-18-engagement-framing.md)):

- Pscale sublayer 0 — pscale format (block + spindle + supernest + hidden dirs)
- Pscale sublayer 1 — substrate convention (passport, shell, pool, frame, spatial coord block, etc.)
- **Pscale sublayer 2 — game system ← THIS REPO**
- Pscale sublayer 3 — world content (Thornkeep, Middle-Earth, ...)

NOMAD is one game system. Others (D&D-bsp, FATE-bsp) could be authored as separate repos at the same sublayer; each seeds independently onto a beach.

## How to use (TBD — implementation in stage 3+)

```bash
git clone https://github.com/happyseaurchin/nomad-bsp.git
cd nomad-bsp
npm install
export BEACH_URL=https://beach.happyseaurchin.com
export BEACH_PASSPHRASE=...
npm run init   # seeds NOMAD blocks onto your target beach
```

Players then connect via bsp-mcp to your beach and play.

## What's in this repo

- `seeds/` — source-of-truth pscale blocks (soft/medium/hard agent, character template, dice config, rules)
- `daemon/` — synthesis daemon code (target deployment: always-on hard crab on a home server)
- `scripts/init.ts` — seeds the contents of `seeds/` onto a target beach
- `docs/ARCHITECTURE.md` — design overview

## Related

- [bsp-mcp](https://github.com/pscale-commons/bsp-mcp-server) — substrate (router + sentinels)
- [pscale-beach](https://github.com/pscale-commons/pscale-beach) — habitat package (deploy a beach)
- [happyseaurchin's beach](https://beach.happyseaurchin.com) — reference deployment

## Status

v0.0.1 — scaffolding only. Game system content TBD. See [`CLAUDE.md`](CLAUDE.md) for the build order.

## License

MIT.
