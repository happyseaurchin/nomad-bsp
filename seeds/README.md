# Seed blocks

Source-of-truth pscale blocks for NOMAD. Seeded onto a target beach via `../scripts/init.ts`.

| Block | What it carries | Status |
|---|---|---|
| `soft-agent.json` | soft LLM prompt — character perception | v0.0.1 placeholder |
| `medium-agent.json` | medium LLM prompt — synthesis of multiple players' liquid | v0.0.1 placeholder |
| `hard-agent.json` | hard LLM prompt — world consistency, frame update | v0.0.1 placeholder |
| `character-template.json` | template for NOMAD character generation | v0.0.1 placeholder |
| `dice-config.json` | d10 exploding dice configuration | v0.0.1 placeholder |
| `nomad-rules.json` | NOMAD game rules: CF/SF/difficulty/outcome bands | v0.0.1 placeholder |

All are placeholders. Each adaptation is its own work item — see [`../CLAUDE.md`](../CLAUDE.md) build order.

## Authoring rules

Per bsp-mcp inheritance, each block must:
- Use `_` and digits 1-9 only at every level (no `_word` keys)
- Carry semantic addresses with at most ONE decimal point
- Have a substantive underscore at every level (readable without children)

## Seeding direction

`init.ts` posts each `*.json` to the target beach as `bsp(agent_id=<BEACH_URL>, block=<filename-without-.json>, content=<file-content>, secret=<DAEMON_PASSPHRASE-derived>)`. Block names match filenames. Lock is held by the operator's seeding identity.
