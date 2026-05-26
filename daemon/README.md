# Synthesis daemon

The NOMAD synthesis daemon. **v0.0.1 — README only**. Implementation in stage 5 of the build (see [`../CLAUDE.md`](../CLAUDE.md)).

Target deployment shape: **always-on hard crab** on a home server (e.g. the substrate author's Mac mini with a launchd plist). Per the bsp-blink-ecology agent table:

| Property | Value |
|---|---|
| Funding | user's API key |
| Uptime | 24/7 |
| Independence | independent |
| Location | home server |

This is the canonical hard-crab shape — user-funded, always-on, owner-controlled.

## What it does

Watches a target beach for pool/frame activity. When a frame's commit conditions trigger (round window expired, all participants committed, GM push, etc.):

1. Reads `frame:<scene>` for all entity liquid
2. Reads `canon:<scene>` for skill-pack star-refs
3. Reads `spatial:<world>` for spatial context
4. Reads `passport:<character>` / `shell:<character>` for stats + location
5. Reads `witnessed:<character>` for each entity's perception scope
6. Calls medium-agent (with NOMAD rules applied) on the assembled context
7. Writes `solid:<scene>` with canonical narration
8. Rolls previous `solid:<scene>` content into `history:<scene>` (next free supernest slot)
9. Updates each entity's `frame:<n>,2` (solid lane), clears `<n>,1` (liquid)
10. Updates `witnessed:<character>` for each entity present

All ten steps are bsp() calls. The daemon holds no privileged authority — it writes under its own agent identity, which must be registered in `sed:<game>-daemons` for the writes to be accepted.

## Deployment shape

- Node.js or Python (TBD per stage 5)
- launchd plist on Mac mini (or systemd on Linux)
- env vars: `BEACH_URL`, `ANTHROPIC_API_KEY`, `DAEMON_PASSPHRASE`
- polling interval configurable (default 30s); per-frame trigger thresholds in `canon:<scene>`

## Related

- bsp-mcp `docs/beach-crab-ladder.md` — agent ladder this daemon fits (rung 2: active steward)
- pscale-mcp-server `docs/protocol-grit.md` — daemon contract reference (synthesis-on-pool pattern)
- onen-play `docs/NOMAD-Plex0-Implementation.md` — reference for the resolution flow
- xstream-play `docs/medium-llm-coordination-spec.md` — coordination model (multi-pass convergence)

## Why a daemon, not a primitive

Synthesis is application-specific behaviour, not substrate. The substrate (bsp() + sed: + grain + faces) provides the storage and authority machinery; the daemon decides when and how to synthesise. Different game systems can have different daemons.
