#!/usr/bin/env node
//
// synthesis-daemon.js — NOMAD GRIT resolver (the "crab"), v0.1.
//
// A persistent non-contributor that resolves pool windows off the players'
// stage, so every player turn stays pure-soft (perception in, intention out).
// This is the {1,3,4} systemic agent: medium resolution (3) + hard
// consolidation (1), with the identity layer (4) as learned-name propagation.
//
// Topology (GRIT — see pscale-mcp-server/docs/protocol-grit.md):
//   - The crab NEVER contributes intentions → it is always a valid resolver.
//   - Window = pool contributions newer than the last-resolved marker.
//   - Lazy-on-touch: a window closes only when WINDOW_SECONDS have passed
//     since its first contribution AND the crab next polls.
//   - Race-tolerant: re-read the marker just before writing; defer if advanced.
//
// The discipline is NOT hardcoded here. The crab loads the room's MEDIUM
// directive from pool:<name>/9.2 and uses it as the LLM system prompt, with
// the live rules / world / passports / witnessed blocks appended as context.
// Edit the substrate (9.2), not this file, to change how resolution behaves.
//
// What the crab writes (all to OPEN blocks — no secret needed):
//   - solid:<name>   — each resolved beat at the next free position 1..8:
//                      { _: fact, 1: actor, 3: ts, 4: visible_to, 5: resolution }
//                      marker (last-resolved pool slot) at 9.1
//   - witnessed:<handle> — names a character learned this window, appended
//   - spatial / history  — consolidation when solid fills (hard tier, 9.3)
//
// Required env:
//   BEACH_URL          e.g. https://beach.happyseaurchin.com
//   ANTHROPIC_API_KEY  for the resolution LLM call
// Optional env:
//   GAMES_CONFIG       path to games.json (default: ./games.json beside this file)
//   LLM_MODEL          default claude-sonnet-4-6
//   POLL_INTERVAL_MS   default 15000
//   SOLID_CONSOLIDATE_AT  default 7 (beats present → run a hard pass)
//   SECRET             only if a target block is locked (default: none — our
//                      solid/witnessed/history/spatial-body are open)
//   ONE_SHOT           "1" → run a single tick across all games and exit
//
// Reference: pscale-mcp-server/scripts/grit-resolver.ts (the precedent).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

async function writeAt(beach, name, spindle, content, secret) {
  const body = { spindle, content };
  if (secret) body.secret = secret;
  const r = await fetch(wkUrl(beach, name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${name}@${spindle} → ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

async function replaceBlock(beach, name, content, secret) {
  const body = { spindle: '', content, confirm: true };
  if (secret) body.secret = secret;
  const r = await fetch(wkUrl(beach, name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`REPLACE ${name} → ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// ── Pool / solid helpers ──

// A contribution slot holds a string _ AND a string field 1 (agent_id).
// Pure nesting parents (digit-path interior) do not. Walk all digit-paths,
// collecting contributions keyed by their flat slot number (11, 12, ...).
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
        out.push({ slot: Number(slot), agent_id: child['1'], ts: child['3'] || '', text: child._ });
      } else {
        walk(child, slot);
      }
    }
  })(pool, '');
  return out.sort((a, b) => a.slot - b.slot);
}

function lastResolvedMarker(solid) {
  const v = solid && solid['9'] && solid['9']['1'];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nextSolidPosition(solid) {
  // Beats live at 1..8; 9 is reserved for the marker. Return the first free.
  for (let d = 1; d <= 8; d++) if (solid[String(d)] === undefined) return String(d);
  return null; // full — caller triggers consolidation
}

function countBeats(solid) {
  let n = 0;
  for (let d = 1; d <= 8; d++) if (solid[String(d)] !== undefined) n++;
  return n;
}

function nextWitnessedNameSlot(known) {
  for (let d = 1; d <= 9; d++) if (known[String(d)] === undefined) return String(d);
  return null;
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
  let t = text.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('no JSON object in LLM output');
  return JSON.parse(t.slice(a, b + 1));
}

// ── Medium pass: resolve one closeable window ──

async function resolveWindow(beach, game) {
  const pool = await readBlock(beach, game.pool);
  if (!pool) return { acted: false, reason: 'pool-missing' };

  const directive = pool['9'] && pool['9']['2'];
  if (typeof directive !== 'string') return { acted: false, reason: 'no-9.2-medium-directive' };

  const solid = (await readBlock(beach, game.solid)) || { _: `Resolved beats for ${game.name}.` };
  const marker = lastResolvedMarker(solid);
  const all = collectContributions(pool);
  const windowRows = all.filter(c => c.slot > marker);
  if (windowRows.length === 0) return { acted: false, reason: 'no-new-liquid' };

  const windowStart = new Date(windowRows[0].ts || Date.now()).getTime();
  if (Date.now() - windowStart < (game.window_seconds ?? 60) * 1000) {
    return { acted: false, reason: 'window-open' };
  }

  // Load live context for the LLM (the directive names these; we feed them in).
  const actors = [...new Set(windowRows.map(r => r.agent_id))];
  const ctx = {};
  for (const name of game.rules || []) ctx[name] = await readBlock(beach, name);
  if (game.spatial) ctx[game.spatial] = await readBlock(beach, game.spatial);
  for (const a of actors) {
    ctx[`passport:${a}`] = await readBlock(beach, `passport:${a}`);
    ctx[`witnessed:${a}`] = await readBlock(beach, `witnessed:${a}`);
  }

  const system = `${directive}

── RETURN FORMAT ──
You are called as an automated resolver. Do everything the directive above says, then return ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "beats": [
    { "fact": "<the resolved fact, no narrative flourish>", "actor": "<agent_id of the acting character, or 'gm' for environment/NPC>", "visible_to": "<which characters could perceive this; name them or say 'all'>", "resolution": "<CF, SF, dice, band — the audit trail>" }
  ],
  "learned_names": [ { "learner": "<agent_id>", "name": "<the name/term learned>", "how": "<introduction / overheard / told>" } ]
}
If a character learned no names, return an empty learned_names array.

── LIVE CONTEXT (read-only) ──
${JSON.stringify(ctx, null, 1)}`;

  const user = `Resolve this window together (chronological pool contributions):

${windowRows.map(r => `[slot ${r.slot}] ${r.agent_id}: ${r.text}`).join('\n\n')}

Return the JSON now.`;

  const raw = await callLLM(game.llm_model || process.env.LLM_MODEL || 'claude-sonnet-4-6', system, user);
  let parsed;
  try { parsed = parseJSON(raw); }
  catch (e) { return { acted: false, reason: `bad-llm-json: ${e.message}` }; }

  // Race tolerance: re-read marker just before writing.
  const solidNow = (await readBlock(beach, game.solid)) || solid;
  if (lastResolvedMarker(solidNow) >= windowRows[windowRows.length - 1].slot) {
    return { acted: false, reason: 'already-resolved' };
  }

  const now = new Date().toISOString();
  let written = 0;
  for (const beat of (parsed.beats || [])) {
    const pos = nextSolidPosition(solidNow);
    if (pos === null) break; // solid full — consolidation will run after
    const node = {
      _: String(beat.fact || '').trim(),
      1: String(beat.actor || 'gm'),
      3: now,
      4: String(beat.visible_to || 'all'),
      5: String(beat.resolution || ''),
    };
    await writeAt(beach, game.solid, pos, node, game.secret);
    solidNow[pos] = node;
    written++;
  }

  // Identity layer (4): propagate learned names into witnessed:<learner>.
  for (const ln of (parsed.learned_names || [])) {
    try {
      const w = (await readBlock(beach, `witnessed:${ln.learner}`)) || { _: `What ${ln.learner} has come to know.`, 1: { _: 'People known by name.' } };
      if (!w['1'] || typeof w['1'] !== 'object') w['1'] = { _: 'People known by name.' };
      const slot = nextWitnessedNameSlot(w['1']);
      if (slot) await writeAt(beach, `witnessed:${ln.learner}`, `1${slot}`, `${ln.name} (${ln.how || 'learned in play'}).`, game.secret);
    } catch (e) { console.warn(`  witnessed:${ln.learner} update skipped: ${e.message}`); }
  }

  // Advance the marker (solid 9.1).
  const highest = windowRows[windowRows.length - 1].slot;
  await writeAt(beach, game.solid, '91', String(highest), game.secret);

  return { acted: true, beats: written, marker: highest };
}

// ── Hard pass: consolidate when solid fills (directive at pool 9.3) ──

async function consolidate(beach, game) {
  const pool = await readBlock(beach, game.pool);
  const hardDirective = pool && pool['9'] && pool['9']['3'];
  const solid = await readBlock(beach, game.solid);
  if (!solid || countBeats(solid) < (Number(process.env.SOLID_CONSOLIDATE_AT) || 7)) return { acted: false };

  // Fold the older beats (keep the two most recent live) into one history
  // entry, and weave them into the room description. Then trim solid.
  const beats = [];
  for (let d = 1; d <= 8; d++) if (solid[String(d)]) beats.push({ pos: d, beat: solid[String(d)] });
  const keep = beats.slice(-2);
  const fold = beats.slice(0, -2);
  if (fold.length === 0) return { acted: false };

  // Read the room NODE (the RMW target + LLM context). The room description
  // lives at <room>._._ inside the hidden directory. It is NOT point-writable
  // (a pure-underscore leaf: "111.00" strips trailing zeros → "111", which
  // clobbers the whole node). The safe write is read-modify-write of the WHOLE
  // node at the room spindle: change only ._._, preserve the hidden directory
  // (knowledge/refs) and the fixtures, write the node back. Position is open.
  let roomNode = null, roomDesc = '';
  if (game.spatial && game.room_spindle) {
    const sp = await readBlock(beach, game.spatial);
    let n = sp;
    for (const ch of String(game.room_spindle)) n = (n && typeof n === 'object') ? n[ch] : undefined;
    if (n && typeof n === 'object' && n._ && typeof n._ === 'object' && typeof n._._ === 'string') {
      roomNode = n; roomDesc = n._._;
    }
  }

  const system = `${typeof hardDirective === 'string' ? hardDirective : 'You are the hard tier. Consolidate settled beats into memory.'}

── RETURN FORMAT ──
Return ONLY JSON (no prose):
{ "room_description": "<the room's description rewritten to absorb the settled beats as lived history — prose, present tense, what is now TRUE here; keep the physical layout (hearth, bar, settle, door) since perception depends on it>", "history_summary": "<one paragraph for the archive: what these settled beats add up to>" }`;

  const user = `Current room description:
${roomDesc || '(none available)'}

Settled beats to fold in (oldest first):
${fold.map(f => `- ${f.beat._}`).join('\n')}

Return the JSON now.`;

  let parsed;
  try { parsed = parseJSON(await callLLM(game.llm_model || process.env.LLM_MODEL || 'claude-sonnet-4-6', system, user)); }
  catch (e) { console.warn(`  consolidation LLM failed: ${e.message}`); return { acted: false }; }

  // Append to history (open, append at next free top-level slot 1..9).
  try {
    const hist = (await readBlock(beach, game.history)) || { _: `Accumulated record of ${game.name}.` };
    let slot = 1; while (hist[String(slot)] !== undefined && slot < 9) slot++;
    await writeAt(beach, game.history, String(slot), { _: String(parsed.history_summary || ''), 3: new Date().toISOString() }, game.secret);
  } catch (e) { console.warn(`  history append skipped: ${e.message}`); }

  // Room-description fold — guarded RMW of the whole room node (open position).
  // Only proceed when the node is the expected shape (hidden dir with a string
  // description); change ONLY ._._, preserve _.1/_.2/_.3 and the fixtures; write
  // the full node back. This cannot clobber: we never write a bare string.
  if (roomNode && parsed.room_description && typeof parsed.room_description === 'string' && parsed.room_description.trim()) {
    try {
      const edited = { ...roomNode, _: { ...roomNode._, _: parsed.room_description.trim() } };
      // sanity: still a hidden dir with a string description + at least one fixture
      const ok = typeof edited._ === 'object' && typeof edited._._ === 'string'
        && Object.keys(edited).some(k => /^[1-9]$/.test(k));
      if (ok) { await writeAt(beach, game.spatial, String(game.room_spindle), edited, game.secret); }
      else console.warn('  room-description fold skipped: edited node failed shape check');
    } catch (e) { console.warn(`  room-description fold skipped: ${e.message}`); }
  }

  // Trim solid: keep the two recent beats at positions 1,2; preserve marker.
  const trimmed = { _: solid._ };
  keep.forEach((k, i) => { trimmed[String(i + 1)] = k.beat; });
  if (solid['9']) trimmed['9'] = solid['9'];
  await replaceBlock(beach, game.solid, trimmed, game.secret);

  return { acted: true, folded: fold.length, kept: keep.length };
}

// ── Loop ──

async function tick(beach, games) {
  for (const game of games) {
    try {
      const r = await resolveWindow(beach, game);
      if (r.acted) console.log(`[${game.name}] resolved: ${r.beats} beat(s), marker→${r.marker}`);
      else if (!['no-new-liquid', 'window-open', 'already-resolved'].includes(r.reason)) console.log(`[${game.name}] ${r.reason}`);
      const c = await consolidate(beach, game);
      if (c.acted) console.log(`[${game.name}] consolidated: folded ${c.folded}, kept ${c.kept}`);
    } catch (e) { console.error(`[${game.name}] tick error: ${e.message}`); }
  }
}

async function main() {
  loadEnv();
  const beach = requireEnv('BEACH_URL', 'e.g. https://beach.happyseaurchin.com').replace(/\/$/, '');
  requireEnv('ANTHROPIC_API_KEY', 'for resolution synthesis');
  const cfgPath = process.env.GAMES_CONFIG || resolve(HERE, 'games.json');
  const games = JSON.parse(readFileSync(cfgPath, 'utf8')).games;
  const oneShot = ['1', 'true', 'yes'].includes((process.env.ONE_SHOT || '').toLowerCase());
  const pollMs = Number(process.env.POLL_INTERVAL_MS || 15000);

  console.log(`▸ NOMAD GRIT resolver (crab) v0.1`);
  console.log(`  beach: ${beach}`);
  console.log(`  games: ${games.map(g => g.name).join(', ')}`);
  console.log(`  model: ${process.env.LLM_MODEL || 'claude-sonnet-4-6'}`);
  console.log(`  mode:  ${oneShot ? 'one-shot' : `poll every ${pollMs}ms`}`);

  if (oneShot) { await tick(beach, games); return; }
  while (true) { await tick(beach, games); await new Promise(r => setTimeout(r, pollMs)); }
}

main().catch(e => { console.error(`✗ fatal: ${e.message}`); process.exit(1); });
