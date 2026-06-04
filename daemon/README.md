# Synthesis daemon — the GRIT resolver ("crab")

**v0.1.** A persistent non-contributor that resolves pool windows off the players' stage, so every player turn stays pure-soft (perception in, intention out). This is the `{1,3,4}` systemic agent: **medium** resolution + **hard** consolidation, with the **identity** layer as learned-name propagation.

Target deployment: **always-on hard crab** on a home server (the Mac mini, via the launchd plist). Funding: the operator's Anthropic API key. Uptime: 24/7. Independent; home-located.

## The topology (GRIT — `pscale-mcp-server/docs/protocol-grit.md`)

- The crab **never contributes intentions** → it is always a valid resolver (GRIT fairness: only non-contributors resolve).
- **Window** = pool contributions newer than the last-resolved marker (`solid:<name>/9.1`).
- **Lazy-on-touch**: a window closes only once `window_seconds` have passed since its first contribution *and* the crab next polls.
- **Race-tolerant**: re-reads the marker just before writing; defers if another resolver advanced it.

It improves on the original GRIT in two ways (carried from the bsp-mcp build): the synthesis lands in a **separate `solid:` block** (never back in the voice-preserved pool, per `block-conventions:4.26`), and each beat carries **`visible_to`** for per-inquirer perception (GRIT had no fog-of-war).

## The discipline is in the substrate, not this file

The crab loads the room's **MEDIUM directive from `pool:<name>/9.2`** and uses it verbatim as the LLM system prompt, with the live `rules:*`, `spatial:*`, `passport:*`, and `witnessed:*` blocks appended as read-only context. The **HARD directive at `9.3`** drives consolidation. To change how resolution or consolidation behaves, **edit the substrate (9.2 / 9.3), not this code.** The crab is thin pipe.

## What it does each tick (per game in `games.json`)

1. **Resolve** — read the pool, find the closeable window, load context, call the LLM with the `9.2` directive, write each resolved beat to `solid:<name>` at the next free position (1–8): `{ _: fact, 1: actor, 3: ts, 4: visible_to, 5: resolution }`. Advance the marker at `9.1`. Propagate any names learned this window into `witnessed:<learner>`.
2. **Consolidate** — when `solid:` reaches `SOLID_CONSOLIDATE_AT` beats, fold the settled (older) beats into one `history:<name>` entry and into the room's description (`spatial:<world>:<room>._._`), then trim `solid:` to the two most recent. Keeps the accumulator shallow and the world remembering.

All writes target **OPEN** blocks (solid/witnessed/history/spatial-body), so no secret is needed. Set `SECRET` only if you lock a target.

## Config — `daemon/games.json`

```json
{ "games": [ {
  "name": "beaten-drum",
  "pool": "pool:beaten-drum-main",
  "solid": "solid:beaten-drum-main",
  "history": "history:beaten-drum-main",
  "spatial": "spatial:thornwood",
  "room_spindle": "111",
  "rules": ["rules:nomad", "rules:thornwood"],
  "window_seconds": 60
} ] }
```

Add a game object per room/pool the crab serves. One crab can serve many.

## Running

Put `ANTHROPIC_API_KEY` in `nomad-bsp/.env.local` (gitignored), or pass it inline.

### One-shot (test against the live window)
```bash
BEACH_URL=https://beach.happyseaurchin.com ONE_SHOT=1 node daemon/synthesis-daemon.js
```
With the two pending Beaten-Drum contributions present, this resolves that window into `solid:beaten-drum-main` and exits — inspect the result, then run the loop.

### Polling loop
```bash
BEACH_URL=https://beach.happyseaurchin.com node daemon/synthesis-daemon.js
```

### Mac mini (always-on)
1. Clone this repo; put `ANTHROPIC_API_KEY` in `.env.local`.
2. Copy `daemon/com.happyseaurchin.nomad-bsp.plist` to `~/Library/LaunchAgents/`.
3. Edit absolute paths in `ProgramArguments` / `WorkingDirectory`; fill `ANTHROPIC_API_KEY`.
4. `launchctl load ~/Library/LaunchAgents/com.happyseaurchin.nomad-bsp.plist`
5. Status: `launchctl list | grep nomad-bsp` · Logs: `tail -F /tmp/nomad-bsp.out /tmp/nomad-bsp.err`

## Env vars

| Required | Purpose |
|---|---|
| `BEACH_URL` | beach to serve (e.g. https://beach.happyseaurchin.com) |
| `ANTHROPIC_API_KEY` | resolution + consolidation LLM calls |

| Optional | Default | Purpose |
|---|---|---|
| `GAMES_CONFIG` | `daemon/games.json` | path to the games list |
| `LLM_MODEL` | `claude-sonnet-4-6` | resolution model (drop to `claude-haiku-4-5-20251001` for cost) |
| `POLL_INTERVAL_MS` | 15000 | poll cadence |
| `SOLID_CONSOLIDATE_AT` | 7 | beats present before a hard pass runs |
| `SECRET` | unset | only if a target block is locked |
| `ONE_SHOT` | unset | run one tick across all games and exit |

## Economics (chosen 2026-05-30: both)

Free tier is **reciprocal player resolution** — a player keeps the table alive by resolving a window they didn't act in (soft for self, medium for others). This crab is the **availability guarantee** when players are too few. A **paywall** tier (`bsp-mcp protocol-paywall`) to fund guaranteed resolution comes later. The crab and reciprocal players are interchangeable non-contributors; first valid resolution wins.

## Related

- `pscale-mcp-server/docs/protocol-grit.md` — the GRIT precedent
- `pscale-mcp-server/scripts/grit-resolver.ts` — the original resolver this ports
- bsp-mcp `docs/beach-crab-ladder.md` — rung 2 (active steward), where this sits
- The medium/hard discipline lives at `pool:<name>/9.2` and `9.3` on the beach
