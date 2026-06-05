#!/usr/bin/env node
//
// synthesis-daemon.js — NOMAD GRIT resolver (the "crab"), v0.2.1 (subjective, liquid-window).
//
// A persistent non-contributor that resolves staged player intentions off the
// players' stage, so every player turn stays pure-soft (perception in, intention
// out). Medium resolution (3) + hard consolidation (1).
//
// SUBJECTIVE + PER-AUTHOR model (conforms to function:<game>/2 and /3):
//   - Players STAGE intentions in the OPEN liquid buffer (liquid:pool:<name>),
//     one slot each, with their own identity and NO secret. They never touch the
//     game's accumulator/table secret. (Was: players committed to the locked pool.)
//   - The crab reads liquid as the window — ALL currently-staged intentions, which
//     is also what makes multi-actor resolution natural (the window is everyone
//     who has staged, resolved together).
//   - Outcomes are written to each actor's OWN spine witnessed:<handle>, tick-
//     stamped; NO shared solid.
//   - After resolving the crab appends a resolution breadcrumb to the pool
//     (face=resolution, field 5 = tick:<n>) — the chronicle a puller sees — and
//     CLEARS the resolved liquid slots so the staging surface is free for the next
//     beat. The crab holds the table secret (SECRET env) for the pool + spine
//     writes; the liquid is open so the clear needs no secret.
//   - Dice are DETERMINISTIC: exploding-d10 luck (rules:nomad:2) sha256-seeded by
//     the window, fed to the LLM (reproducible; no RNG). The LLM does the
//     interpretive CF/SF/difficulty + narrative. (A fully no-LLM SIMPLE path needs
//     rule-encoded difficulty — TODO.)
//
// The discipline is NOT hardcoded: the crab loads the MEDIUM directive from
// function:<game>/2 as the LLM system prompt. Edit the substrate, not this file.
//
// Required env: BEACH_URL, ANTHROPIC_API_KEY.
// Optional env: GAMES_CONFIG, LLM_MODEL, POLL_INTERVAL_MS, SECRET (table secret
//   for pool + spine writes), DRY_RUN ("1" = compute + log, write nothing),
//   ONE_SHOT ("1" = single tick then exit).

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
      if (!process.env[m[1]]) process.env[m[1]] = v;
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

// Positional write — replaces the subtree at `spindle` with `content`. Used to
// CLEAR a resolved liquid slot (write an empty underscore tombstone).
async function writeAt(beach, name, spindle, content, secret) {
  const body = { spindle, content };
  if (secret) body.secret = secret;
  const r = await fetch(wkUrl(beach, name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${name}@${spindle} → ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// Atomic accumulator append (beach allocates the next free slot, supernests on
// rollover). THE write for spines and the pool resolution breadcrumb.
async function appendBlock(beach, name, content, secret) {
  const body = { append: true, content };
  if (secret) body.secret = secret;
  const r = await fetch(wkUrl(beach, name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`APPEND ${name} → ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// ── Slot helpers ──

// Walk all digit-paths, collecting contribution slots (a node with string _ AND
// string field 1). Captures face (field 4) and field 5.
function collectContributions(block) {
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
          slot, agent_id: child['1'], ts: child['3'] || '', text: child._,
          face: typeof child['4'] === 'string' ? child['4'] : '', f5: typeof child['5'] === 'string' ? child['5'] : '',
        });
      } else {
        walk(child, slot);
      }
    }
  })(block, '');
  return out.sort((a, b) => Number(a.slot) - Number(b.slot));
}

// The room's tick lives in the pool's last resolution breadcrumb (field 5
// 'tick:<n>'). No markers yet → 0.
function lastTick(poolContribs) {
  let t = 0;
  for (const c of poolContribs) {
    if (c.face !== 'resolution') continue;
    const m = /tick:\s*(\d+)/.exec(c.f5);
    if (m) t = Math.max(t, Number(m[1]));
  }
  return t;
}

// ── Deterministic dice (rules:nomad:2 — exploding d10 luck) ──

function deterministicLuck(seed) {
  let h = createHash('sha256').update(String(seed)).digest();
  let i = 0;
  const byte = () => { if (i >= h.length) { h = createHash('sha256').update(h).digest(); i = 0; } return h[i++]; };
  const d10 = () => (byte() % 10) + 1;
  const explode = () => { let total = 0, roll; do { roll = d10(); total += roll; } while (roll === 10); return total; };
  const pos = explode(), neg = explode();
  return { pos, neg, luck: pos - neg };
}

// ── LLM ──

async function callLLM(model, system, user) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`Anthropic → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
}

function parseJSON(text) {
  let t = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('no JSON object in LLM output');
  return JSON.parse(t.slice(a, b + 1));
}

// ── Medium pass: resolve the staged window into the subjects' spines ──

async function resolveWindow(beach, game) {
  const dry = ['1', 'true', 'yes'].includes((process.env.DRY_RUN || '').toLowerCase());
  const liquidName = `liquid:${game.pool}`; // liquid:pool:<name>

  const fn = game.function ? await readBlock(beach, game.function) : null;
  const directive = fn && fn['2'];
  if (typeof directive !== 'string') return { acted: false, reason: `no medium directive at ${game.function}/2` };

  const liquid = await readBlock(beach, liquidName);
  if (!liquid) return { acted: false, reason: 'no-liquid' };
  const rows = collectContributions(liquid).filter(c => c.face !== 'resolution' && c.text && c.text.trim() !== '');
  if (rows.length === 0) return { acted: false, reason: 'no-staged-intentions' };

  const windowStart = new Date(rows[0].ts || Date.now()).getTime();
  if (Date.now() - windowStart < (game.window_seconds ?? 60) * 1000) {
    return { acted: false, reason: 'window-open' };
  }

  const pool = await readBlock(beach, game.pool);
  const newTick = lastTick(collectContributions(pool || {})) + 1;
  const seed = `${game.name}:${rows[0].ts || ''}:tick${newTick}`;
  const luck = deterministicLuck(seed);

  const actors = [...new Set(rows.map(r => r.agent_id))];
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
    { "handle": "<player-character agent_id who perceived this beat>", "perceives": "<what THIS subject now perceives — their own framing, earned depth; include any name learned>", "is_actor": <true if acting>, "resolution": "<only on the actor's entry: CF, SF, dice, band audit>" }
  ],
  "marker_note": "<ONE neutral line summarising the beat for the pool breadcrumb>"
}
One spine_writes entry per co-present player character who could perceive the beat (use ${game.spatial || 'the room'} for who is present). Scope each to what that subject perceived — the fog of war is the asymmetry. NPCs have no spine.

── LIVE CONTEXT (read-only) ──
${JSON.stringify(ctx, null, 1)}`;

  const user = `Resolve this window together (the currently-staged intentions):

${rows.map(r => `${r.agent_id}: ${r.text}`).join('\n\n')}

Return the JSON now.`;

  const raw = await callLLM(game.llm_model || process.env.LLM_MODEL || 'claude-sonnet-4-6', system, user);
  let parsed;
  try { parsed = parseJSON(raw); } catch (e) { return { acted: false, reason: `bad-llm-json: ${e.message}` }; }

  const now = new Date().toISOString();
  const spineWrites = (parsed.spine_writes || []).filter(s => s && s.handle && s.perceives);

  if (dry) {
    console.log(`  [DRY] tick ${newTick}, dice ${luck.pos}/${luck.neg}=${luck.luck}, window of ${rows.length} (${actors.join(', ')}), would write ${spineWrites.length} spine(s):`);
    for (const s of spineWrites) console.log(`    witnessed:${s.handle} ← ${String(s.perceives).slice(0, 140)}`);
    console.log(`    pool breadcrumb ← "${String(parsed.marker_note || '').slice(0, 80)}" (tick:${newTick}); would clear liquid slots ${rows.map(r => r.slot).join(',')}`);
    return { acted: false, reason: 'dry-run', tick: newTick, spines: spineWrites.length };
  }

  // Race tolerance: re-read liquid; if it's been cleared since, stand down.
  const liquidNow = await readBlock(beach, liquidName);
  const stillStaged = collectContributions(liquidNow || {}).filter(c => c.text && c.text.trim() !== '' && c.face !== 'resolution');
  if (stillStaged.length === 0) return { acted: false, reason: 'already-resolved' };

  let written = 0;
  for (const s of spineWrites) {
    const entry = { _: String(s.perceives).trim(), 1: String(s.handle), 3: now, 6: newTick };
    if (s.is_actor && s.resolution) entry['5'] = String(s.resolution);
    await appendBlock(beach, `witnessed:${s.handle}`, entry, game.secret);
    written++;
  }

  await appendBlock(beach, game.pool, {
    _: String(parsed.marker_note || 'resolved').trim(),
    1: game.resolver_id || 'nomad-crab',
    3: now, 4: 'resolution', 5: `tick:${newTick}`,
  }, game.secret);

  // Clear the resolved liquid slots (open buffer; empty underscore = withdrawn).
  let cleared = 0;
  for (const r of rows) {
    try { await writeAt(beach, liquidName, r.slot, { _: '' }, game.secret); cleared++; }
    catch (e) { console.warn(`  liquid clear ${r.slot} skipped: ${e.message}`); }
  }

  return { acted: true, spines: written, tick: newTick, cleared };
}

// ── Hard pass: consolidate (subjective consensus/observer digest) — TODO ──

async function consolidate(_beach, _game) {
  // The durable digest is the AGREEMENT across spines folded into spatial +
  // history (function:<game>/3) — the Observer projection. Spine-based consensus
  // consolidation is the next build; no-op for now.
  return { acted: false, reason: 'subjective-consolidation-TODO' };
}

// ── Loop ──

async function tick(beach, games) {
  for (const game of games) {
    try {
      const r = await resolveWindow(beach, game);
      if (r.acted) console.log(`[${game.name}] resolved: ${r.spines} spine(s), tick→${r.tick}, cleared ${r.cleared} liquid slot(s)`);
      else if (!['no-liquid', 'no-staged-intentions', 'window-open', 'already-resolved', 'dry-run'].includes(r.reason)) console.log(`[${game.name}] ${r.reason}`);
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
  for (const g of games) if (!g.secret && process.env.SECRET) g.secret = process.env.SECRET;
  const oneShot = ['1', 'true', 'yes'].includes((process.env.ONE_SHOT || '').toLowerCase());
  const dry = ['1', 'true', 'yes'].includes((process.env.DRY_RUN || '').toLowerCase());
  const pollMs = Number(process.env.POLL_INTERVAL_MS || 15000);

  console.log(`▸ NOMAD GRIT resolver (crab) v0.2.1 — subjective, liquid-window`);
  console.log(`  beach: ${beach}`);
  console.log(`  games: ${games.map(g => g.name).join(', ')}`);
  console.log(`  model: ${process.env.LLM_MODEL || 'claude-sonnet-4-6'}`);
  console.log(`  mode:  ${dry ? 'DRY-RUN (no writes) · ' : ''}${oneShot ? 'one-shot' : `poll every ${pollMs}ms`}`);

  if (oneShot) { await tick(beach, games); return; }
  while (true) { await tick(beach, games); await new Promise(r => setTimeout(r, pollMs)); }
}

main().catch(e => { console.error(`✗ fatal: ${e.message}`); process.exit(1); });
