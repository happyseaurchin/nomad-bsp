# Synthesis daemon

The NOMAD synthesis daemon. **v0.0.1 — functional minimum** (no LLM call yet; dummy concatenation synthesis validates the read→write loop end-to-end).

Target deployment shape: **always-on hard crab** on a home server (e.g. the substrate author's Mac mini with a launchd plist). Per the bsp-blink-ecology agent table:

| Property | Value |
|---|---|
| Funding | user's API key |
| Uptime | 24/7 |
| Independence | independent |
| Location | home server |

## What v0.0.1 does

Watches a target beach for entity liquid in a named frame. When liquid is present:

1. Reads `frame:<scene>` for all entity sub-blocks
2. Collects each entity's liquid (at `<n>.1`)
3. Reads `canon:<scene>` if present (for skill-pack star-refs — not used yet)
4. **Synthesises** — currently dummy concatenation (`"<entity-desc>: <liquid text>"` lines joined). TBD: replace with a real Anthropic API call that uses the `canon` skill-pack as the prompt.
5. Rolls the prior `solid:<scene>` content into `history:<scene>` at the next free supernest slot
6. Writes the new synthesis as `solid:<scene>` underscore
7. Updates each entity's `<n>.2` (solid lane) with their committed text; clears `<n>.1` (liquid)

All seven steps are pure `bsp()` over HTTP. The daemon holds no privileged authority — it writes under its own passphrase (stored as `DAEMON_PASSPHRASE` env var).

## Running

### One-shot (testing)

```bash
BEACH_URL=https://beach.happyseaurchin.com \
DAEMON_PASSPHRASE="..." \
FRAME=frame:test-scene \
ONE_SHOT=1 \
node daemon/synthesis-daemon.js
```

### Polling loop (development)

```bash
BEACH_URL=https://beach.happyseaurchin.com \
DAEMON_PASSPHRASE="..." \
FRAME=frame:test-scene \
node daemon/synthesis-daemon.js
```

### Mac mini (always-on)

1. Clone this repo on the Mac mini
2. Copy `daemon/com.happyseaurchin.nomad-bsp.plist` to `~/Library/LaunchAgents/`
3. Edit the plist: set absolute paths in `ProgramArguments` and `WorkingDirectory`; set `BEACH_URL` and `DAEMON_PASSPHRASE` in `EnvironmentVariables`
4. Load: `launchctl load ~/Library/LaunchAgents/com.happyseaurchin.nomad-bsp.plist`
5. Status: `launchctl list | grep nomad-bsp`
6. Logs: `tail -F /tmp/nomad-bsp.out /tmp/nomad-bsp.err`

## Env vars

| Required | Purpose |
|---|---|
| `BEACH_URL` | beach to watch (e.g. https://beach.happyseaurchin.com) |
| `DAEMON_PASSPHRASE` | secret for daemon writes (used as both `secret` and `new_lock` on the substrate) |
| `FRAME` | frame block name to watch (e.g. `frame:test-scene`) |

| Optional | Default | Purpose |
|---|---|---|
| `SCENE` | `FRAME` minus `frame:` prefix | scene id used for `solid:` / `history:` / `canon:` siblings |
| `POLL_INTERVAL_MS` | 5000 | poll cadence in milliseconds |
| `ONE_SHOT` | unset | if `1`/`true`, runs one iteration and exits |

## Roadmap to v0.1 — LLM integration

The `dummySynthesise()` function is a placeholder. To upgrade to v0.1:

1. Add `ANTHROPIC_API_KEY` env var
2. Read `canon:<scene>:1.1` for the skill-pack star-ref → resolve to a `skill-pack:<kind>` block
3. Read the skill-pack block content as the prompt for medium-agent
4. Call `https://api.anthropic.com/v1/messages` with the prompt + assembled entity context
5. Replace the concatenation output with the LLM's synthesised text

The wire (read frame → assemble context → call LLM → write solid + history + update entity lanes) stays the same.

## Related

- bsp-mcp `docs/beach-crab-ladder.md` — agent ladder this daemon fits (rung 2: active steward)
- pscale-mcp-server `docs/protocol-grit.md` — daemon contract reference
- onen-play `docs/NOMAD-Plex0-Implementation.md` — game flow this daemon implements (steps 4-7 specifically)
- xstream-play `docs/medium-llm-coordination-spec.md` — coordination model (multi-pass convergence, future scope)
