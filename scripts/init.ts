/**
 * init.ts — seed nomad-bsp blocks onto a target federated beach.
 *
 * v0.0.1 — PLACEHOLDER. Implementation in stage 4.
 *
 * Planned usage:
 *   BEACH_URL=https://beach.happyseaurchin.com \
 *   DAEMON_PASSPHRASE=... \
 *   npm run init
 *
 * Planned behaviour:
 *   1. Read every *.json in ../seeds/
 *   2. For each, POST to <BEACH_URL>/.well-known/pscale-beach?block=<basename>
 *      with the file content as block body, locked under DAEMON_PASSPHRASE
 *   3. Verify the write landed (GET back, compare)
 *   4. Log success/failure per block
 *
 * Reference shape: pscale-beach's init script (https://github.com/pscale-commons/pscale-beach)
 * which performs the same operation for library/manifest blocks.
 *
 * Design intent:
 * - Idempotent (re-running updates existing blocks if passphrase matches)
 * - Pure bsp() over the wire — no special MCP tools required
 * - Operator-controlled (whoever runs init holds the lock)
 */

console.error('TBD v0.0.1: init script not yet implemented.');
console.error('See README.md and CLAUDE.md for design intent.');
console.error('Reference: https://github.com/pscale-commons/pscale-beach for the seeding pattern.');
process.exit(1);
