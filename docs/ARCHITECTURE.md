# Architecture

## Three sublayers (recap)

NOMAD-on-bsp sits at **pscale sublayer 2** in the substrate's layer model. See [bsp-mcp engagement framing](https://github.com/pscale-commons/bsp-mcp-server/blob/main/proposals/2026-05-18-engagement-framing.md) for the full layer breakdown.

| Sublayer | Lives in | What this repo contributes |
|---|---|---|
| 0 — pscale format | bsp-mcp walker | (nothing — substrate truth) |
| 1 — substrate conventions | bsp-mcp `src/block-conventions.json` | (uses, doesn't contribute) |
| **2 — game system** | **THIS REPO** + seeded blocks at a beach | **all of NOMAD** |
| 3 — world content | blocks at a beach (e.g. happyseaurchin) | (separate repos, e.g. thornkeep-world) |

## How NOMAD's flow maps onto substrate

NOMAD's resolution flow (from `onen-play/docs/NOMAD-Plex0-Implementation.md`):

| NOMAD step | Substrate operation |
|---|---|
| 1. Player intention | Character writes vapour (out-of-band) → liquid at `frame:<scene>:<entity-pos>,1` |
| 2. Soft evaluation | Soft-agent reads character stats + spatial context; classifies action; estimates CF/SF |
| 3. Skill determination | Soft-agent reads `character.stats`; generates new stats on-the-fly if needed |
| 4. Dice | Dice simulator (in daemon) generates roll per `dice-config` |
| 5. Interpretation | Medium-agent computes outcome = CF + SF + dice − difficulty |
| 6. Consequences | Daemon writes damage to `character.health`; rolls character status |
| 7. Narrative | Medium-agent writes `solid:<scene>` + `history:<scene>`; updates `witnessed:<character>` |

All seven steps are `bsp()` reads and writes. The daemon orchestrates; the substrate stores.

## Block bundle at a complete game venue

A beach hosting a NOMAD game has roughly:

```
beach (e.g. beach.happyseaurchin.com)
├── spatial:<world>            # geographic map (substrate convention 4.7)
├── events:<region-name>       # events at spatial positions
├── rules:<region-name>        # designer-authored constraints
├── frame:<scene>              # per-round entity lanes (substrate convention 5)
├── solid:<scene>              # canonical synthesis (overwritten per round)
├── history:<scene>            # accumulated prior solids (supernests at root)
├── canon:<scene>              # skills star-refs, NPCs, secrets
├── passport:<character>       # character public sheet
├── shell:<character>          # character private state
├── witnessed:<character>      # per-character I-primitive
├── sed:<game>-authors         # author collective
├── sed:<game>-characters      # character collective
├── sed:<game>-daemons         # daemon collective (synthesis runners)
│
└── seeded from nomad-bsp:
    ├── soft-agent             # NOMAD soft LLM prompt
    ├── medium-agent           # NOMAD medium LLM prompt
    ├── hard-agent             # NOMAD hard LLM prompt
    ├── character-template     # character generation rules
    ├── dice-config            # d10 exploding
    └── nomad-rules            # CF + SF + outcome bands
```

The first group (spatial through sed:) is per-game-instance world content (sublayer 3) — authored by world designers and players. The seeded group is NOMAD itself (sublayer 2) — what this repo provides.

## What's NOT here

- **UI**: any MCP client (Claude.app, claude-app, mcp-remote, custom SDK) renders the gameplay
- **World content**: separate repos (e.g. `thornkeep-world`) author specific scenes/places
- **Substrate primitives**: those live in bsp-mcp
- **Beach infrastructure**: that's `pscale-beach`

## Build status

v0.0.1 — scaffolding. See [`../CLAUDE.md`](../CLAUDE.md) build order for the path to v0.1 (first playtest).
