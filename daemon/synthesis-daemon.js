#!/usr/bin/env node
//
// synthesis-daemon.js — NOMAD GRIT resolver (the "crab"), v0.2 (subjective).
//
// A persistent non-contributor that resolves pool windows off the players'
// stage, so every player turn stays pure-soft (perception in, intention out).
// This is the {1,3,4} systemic agent: medium resolution (3) + hard
// consolidation (1), with the identity layer (4) folded into the spine writes.
//
// SUBJECTIVE MODEL (conforms to function:<game>/2 and /3, Phase 1, 2026-06-04):
//   - There is NO shared solid. Each subject's outcome is written to their OWN
//     spine witnessed:<handle>, tick-stamped, at their earned depth.
//   - Window detection is the SPOOL-WITH-RESOLUTIONS: the resolution cursor is
//     the last entry in the POOL whose field 4 is 'resolution', carrying
//     'resolved-through:<slot>;tick:<n>' at field 5. The window is the run of
//     INTENTIONS (face != 'resolution') with slot > resolved-through.
//   - After resolving, the crab appends ONE resolution marker to the pool
//     (face=resolution) — a coordination breadcrumb, not canon; a puller sees it
//     in their since-marker slice alongside the unresolved intentions.
//   - The dice are DETERMINISTIC: exploding-d10 luck (rules:nomad:2) seeded by
//     sha256 of the window, so a re-run yields the same roll (auditable, no RNG).
//     The LLM does the interpretive CF/SF/difficulty + narrative and uses THESE
//     dice. (A fully LLM-free SIMPLE path needs rule-encoded difficulty — TODO.)
//
// Topology (GRIT): the crab NEVER contributes intentions → always a valid
// resolver. Lazy-on-touch: a window closes only when window_seconds have passed
// since its first contribution AND the crab next polls. Race-tolerant: re-read
// the pool cursor just before writing; defer if advanced.
//
// The discipline is NOT hardcoded here. The crab loads the MEDIUM directive from
// function:<game>/2 and uses it as the LLM system prompt, with the live
// rules / world / passports / witnessed blocks appended as context. Edit the
// substrate (function:<game>/2, /3), not this file, to change how resolution
// behaves.
//
// What the crab writes (all to OPEN blocks unless SECRET is set):
//   - witnessed:<handle> — each perceiving subject's outcome appended at the next
//     free slot: { _: perceives, 1: handle, 3: ts, 5: resolution(actor), 6: tick }
//   - pool:<name>        — one resolution marker per window (face=resolution)
//
// Required env:
//   BEACH_URL          e.g. https://beach.happyseaurchin.com
//   ANTHROPIC_API_KEY  for the resolution LLM call (interpretive CF/SF/narrative)
// Optional env:
//   GAMES_CONFIG       path to games.json (default: ./games.json beside this file)
//   LLM_MODEL          default claude-sonnet-4-6
//   POLL_INTERVAL_MS   default 15000
//   SECRET             write-lock proof, applied to every game lacking its own
//   DRY_RUN            "1" → compute + log intended writes, write NOTHING
//   ONE_SHOT           "1" → run a single tick across all games and exit

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Env ──

function loadEnv() {
  const envPath = resolve(HERE, '..', '.env.local');
  try {
    const txt = readFileSync(envPath, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v; // file fills a missing OR empty env var
    }
  } catch { /* rely on process.env */ }
}

function requireEnv(name, hint) {
  const v = process.env[name];
  if (!v) { console.error(`✗ ${name} required — ${hint}`); process.exit(2); }
  return v;
}

// ── Beach HTTP ──

function wkUrl(beach, name, spindle) {
  return `${beach}/.well-known/pscale-beach?block=${encodeURIComponent(name)}${spindle ? `&spindle=${encodeURIComponent(spindle)}` : ''}`;
}

async function readBlock(beach, name) {
  const r = await fetch(wkUrl(beach, name));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${name} → ${r.status}`);
  return r.json();
}

// Atomic accumulator append (the beach allocates the next free zero-free slot and
// supernests when the floor fills). THE write for spines and the pool marker.
async function appendBlock(beach, name, content, secret) {
  const body = { append: true, content };
  if (secret) body.secret = secret;
  const r = await fetch(wkUrl(beach, name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`APPEND ${name} → ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// ── Pool helpers ──

// A contribution slot holds a string _ AND a string field 1 (agent_id). Pure
// nesting parents (digit-path interior) do not. Walk all digit-paths, collecting
// contributions keyed by their flat slot number (11, 12, ...). Captures field 4
// (face — 'resolution' marks a resolution breadcrumb) and field 5 (audit/cursor).
function collectContributions(pool) {
  const out = [];
  (function walk(node, prefix) {
    if (!node || typeof node !== 'object') return;
    for (let d = 1; d <= 9; d++) {
      const child = node[String(d)];
      if (!child || typeof child !== 'object') continue;
      const slot = prefix + String(d);
      const isContribution = typeof child._ === 'string' && typeof child['1'] === 'string';
      if (isContribution) {
        out.push({
          slot: Number(slot), agent_id: child['1'], ts: child['3'] || '', text: child._,
          face: typeof child['4'] === 'string' ? child['4'] : '', f5: typeof child['5'] === 'string' ? child['5'] : '',
        });
      } else {
        walk(child, slot);
      }
    }
  })(pool, '');
  return out.sort((a, b) => a.slot - b.slot);
}

// The resolution cursor: scan the pool's resolution markers (field 4 ==
// 'resolution') for the highest 'resolved-through:<slot>' and its 'tick:<n>'.
// No markers yet → { throughSlot: 0, tick: 0 } (everything is unresolved).
function lastResolution(contribs) {
  let best = { throughSlot: 0, tick: 0 };
  for (const c of contribs) {
    if (c.face !== 'resolution') continue;
    const mt = /resolved-through:\s*(\d+)/.exec(c.f5);
    const mk = /tick:\s*(\d+)/.exec(c.f5);
    const through = mt ? Number(mt[1]) : c.slot;
    const tick = mk ? Number(mk[1]) : best.tick;
    if (through >= best.throughSlot) best = { throughSlot: through, tick };
  }
  return best;
}

// ── Deterministic dice (rules:nomad:2 — exploding d10 luck) ──

// sha256-seeded so a window's roll is reproducible/auditable — no RNG. Positive
// and negative d10; a 10 explodes (roll again, add). Luck = positive - negative.
function deterministicLuck(seed) {
  let h = createHash('sha256').update(String(seed)).digest();
  let i = 0;
  const byte = () => { if (i >= h.length) { h = createHash('sha256').update(h).digest(); i = 0; } return h[i++]; };
  const d10 = () => (byte() % 10) + 1;
  const explode = () => { let total = 0, roll; do { roll = d10(); total += roll; } while (roll === 10); return total; };
  const pos = explode(), neg = explode();
  return { pos, neg, luck: pos - neg };
}

// ── LLM (raw Anthropic Messages API; no SDK dependency) ──

async function callLLM(model, system, user) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`Anthropic → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return text.trim();
}

function parseJSON(text) {
  // Tolerate markdown fences / surrounding prose: take the outermost {...}.
  let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('no JSON object in LLM output');
  return JSON.parse(t.slice(a, b + 1));
}

// ── Medium pass: resolve one closeable window into the subjects' spines ──

async function resolveWindow(beach, game) {
  const dry = ['1', 'true', 'yes'].includes((process.env.DRY_RUN || '').toLowerCase());

  const pool = await readBlock(beach, game.pool);
  if (!pool) return { acted: false, reason: 'pool-missing' };

  // The MEDIUM directive (function:<game>/2) is the resolver's system prompt.
  const fn = game.function ? await readBlock(beach, game.function) : null;
  const directive = fn && fn['2'];
  if (typeof directive !== 'string') return { acted: false, reason: `no medium directive at ${game.function}/2` };

  const all = collectContributions(pool);
  const { throughSlot, tick: lastTick } = lastResolution(all);
  const windowRows = all.filter(c => c.face !== 'resolution' && c.slot > throughSlot);
  if (windowRows.length === 0) return { acted: false, reason: 'no-new-liquid' };

  const windowStart = new Date(windowRows[0].ts || Date.now()).getTime();
  if (Date.now() - windowStart < (game.window_seconds ?? 60) * 1000) {
    return { acted: false, reason: 'window-open' };
  }

  const newTick = lastTick + 1;
  const seed = `${game.name}:${windowRows[0].ts || ''}:tick${newTick}`;
  const luck = deterministicLuck(seed);

  // Live context (the directive names these; we feed them read-only).
  const actors = [...new Set(windowRows.map(r => r.agent_id))];
  const ctx = {};
  for (const name of game.rules || []) ctx[name] = await readBlock(beach, name);
  if (game.spatial) ctx[game.spatial] = await readBlock(beach, game.spatial);
  for (const a of actors) {
    ctx[`passport:${a}`] = await readBlock(beach, `passport:${a}`);
    ctx[`witnessed:${a}`] = await readBlock(beach, `witnessed:${a}`);
  }

  const system = `${directive}

── DETERMINISTIC DICE FOR THIS WINDOW (use these; do NOT invent dice) ──
Exploding-d10 luck (rules:nomad:2): positive d10 = ${luck.pos}, negative d10 = ${luck.neg}, luck = ${luck.luck}. Apply only where a roll is called for; SIMPLE/auto-success uses no dice.

── RETURN FORMAT ──
You are an automated resolver. Do everything the directive above says, then return ONLY a JSON object (no prose, no fences):
{
  "spine_writes": [
    { "handle": "<player-character agent_id who perceived this beat>", "perceives": "<what THIS subject now perceives — written in their own framing, at their earned depth; include any name they learned>", "is_actor": <true if this is the acting character, else false>, "resolution": "<only on the actor's entry: CF, SF, dice, band audit>" }
  ],
  "marker_note": "<ONE neutral line summarising the beat for the pool breadcrumb — a cursor, not canon>"
}
One spine_writes entry per co-present PLAYER CHARACTER who could perceive the beat (use ${game.spatial || 'the room'} to know who is present). Scope each strictly to what that subject perceived — the fog of war is the asymmetry between spines. NPCs have no spine. If only the actor perceives, return one entry.

── LIVE CONTEXT (read-only) ──
${JSON.stringify(ctx, null, 1)}`;

  const user = `Resolve this window together (chronological intentions):

${windowRows.map(r => `[slot ${r.slot}] ${r.agent_id}: ${r.text}`).join('\n\n')}

Return the JSON now.`;

  const raw = await callLLM(game.llm_model || process.env.LLM_MODEL || 'claude-sonnet-4-6', system, user);
  let parsed;
  try { parsed = parseJSON(raw); }
  catch (e) { return { acted: false, reason: `bad-llm-json: ${e.message}` }; }

  const highest = windowRows[windowRows.length - 1].slot;
  const now = new Date().toISOString();
  const spineWrites = (parsed.spine_writes || []).filter(s => s && s.handle && s.perceives);

  if (dry) {
    console.log(`  [DRY] tick ${newTick}, dice ${luck.pos}/${luck.neg}=${luck.luck}, would write ${spineWrites.length} spine(s):`);
    for (const s of spineWrites) console.log(`    witnessed:${s.handle} ← ${String(s.perceives).slice(0, 140)}`);
    console.log(`    pool marker ← "${String(parsed.marker_note || '').slice(0, 80)}" (resolved-through:${highest};tick:${newTick})`);
    return { acted: false, reason: 'dry-run', tick: newTick, spines: spineWrites.length };
  }

  // Race tolerance: re-read the pool cursor just before writing.
  const poolNow = await readBlock(beach, game.pool);
  if (lastResolution(collectContributions(poolNow || pool)).throughSlot >= highest) {
    return { acted: false, reason: 'already-resolved' };
  }

  // Subjective write: each perceiving subject's outcome → their OWN spine, ticked.
  let written = 0;
  for (const s of spineWrites) {
    const entry = { _: String(s.perceives).trim(), 1: String(s.handle), 3: now, 6: newTick };
    if (s.is_actor && s.resolution) entry['5'] = String(s.resolution);
    await appendBlock(beach, `witnessed:${s.handle}`, entry, game.secret);
    written++;
  }

  // The spool-with-resolutions: one resolution marker into the pool.
  await appendBlock(beach, game.pool, {
    _: String(parsed.marker_note || 'resolved').trim(),
    1: game.resolver_id || 'nomad-crab',
    3: now, 4: 'resolution', 5: `resolved-through:${highest};tick:${newTick}`,
  }, game.secret);

  return { acted: true, spines: written, marker: highest, tick: newTick };
}

// ── Hard pass: consolidate (subjective consensus/observer digest) ──

async function consolidate(_beach, _game) {
  // Under the subjective model (function:<game>/3) the durable digest is the
  // AGREEMENT across spines folded into spatial + history — NOT a solid: fold
  // (solid: is deprecated). That spine-based consensus/observer consolidation is
  // the next piece; until it lands the crab keeps spines shallow only via the
  // medium's per-window appends. No-op for now (never touch deprecated solid:).
  return { acted: false, reason: 'subjective-consolidation-TODO' };
}

// ── Loop ──

async function tick(beach, games) {
  for (const game of games) {
    try {
      const r = await resolveWindow(beach, game);
      if (r.acted) console.log(`[${game.name}] resolved: ${r.spines} spine(s), tick→${r.tick}, marker→${r.marker}`);
      else if (!['no-new-liquid', 'window-open', 'already-resolved', 'dry-run'].includes(r.reason)) console.log(`[${game.name}] ${r.reason}`);
      const c = await consolidate(beach, game);
      if (c.acted) console.log(`[${game.name}] consolidated: ${JSON.stringify(c)}`);
    } catch (e) { console.error(`[${game.name}] tick error: ${e.message}`); }
  }
}

async function main() {
  loadEnv();
  const beach = requireEnv('BEACH_URL', 'e.g. https://beach.happyseaurchin.com').replace(/\/$/, '');
  requireEnv('ANTHROPIC_API_KEY', 'for resolution synthesis (interpretive CF/SF/narrative)');
  const cfgPath = process.env.GAMES_CONFIG || resolve(HERE, 'games.json');
  const games = JSON.parse(readFileSync(cfgPath, 'utf8')).games;
  // Apply a shared SECRET to any game that lacks its own (open blocks ignore it).
  for (const g of games) if (!g.secret && process.env.SECRET) g.secret = process.env.SECRET;
  const oneShot = ['1', 'true', 'yes'].includes((process.env.ONE_SHOT || '').toLowerCase());
  const dry = ['1', 'true', 'yes'].includes((process.env.DRY_RUN || '').toLowerCase());
  const pollMs = Number(process.env.POLL_INTERVAL_MS || 15000);

  console.log(`▸ NOMAD GRIT resolver (crab) v0.2 — subjective`);
  console.log(`  beach: ${beach}`);
  console.log(`  games: ${games.map(g => g.name).join(', ')}`);
  console.log(`  model: ${process.env.LLM_MODEL || 'claude-sonnet-4-6'}`);
  console.log(`  mode:  ${dry ? 'DRY-RUN (no writes) · ' : ''}${oneShot ? 'one-shot' : `poll every ${pollMs}ms`}`);

  if (oneShot) { await tick(beach, games); return; }
  while (true) { await tick(beach, games); await new Promise(r => setTimeout(r, pollMs)); }
}

main().catch(e => { console.error(`✗ fatal: ${e.message}`); process.exit(1); });
