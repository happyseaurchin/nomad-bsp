#!/usr/bin/env node
//
// synthesis-daemon.js — NOMAD synthesis daemon, v0.0.1 functional minimum.
//
// Polls a target beach for a frame's entity liquid. When any liquid is
// present, "synthesises" (currently: concatenates entity contributions into
// a paragraph) and writes the result to solid:<scene>. Rolls the prior solid
// into history:<scene>. Clears entity liquid lanes.
//
// v0.0.1: dummy synthesis only — no LLM call. The medium-agent prompt and
// the Anthropic API integration are TBD. This version validates the
// read→write loop end-to-end against the substrate; swap in the real LLM
// call when ready (see TODO: medium-agent below).
//
// Required env:
//   BEACH_URL          — e.g. https://beach.happyseaurchin.com
//   DAEMON_PASSPHRASE  — used as both `secret` (for writes against the
//                        existing locks) and `new_lock` on first creation
//                        of solid:<scene> / history:<scene>
//   FRAME              — name of the frame block to watch (e.g. frame:test-scene)
//   SCENE              — scene id used for solid:/history:/canon: siblings.
//                        Defaults to FRAME with "frame:" prefix stripped.
//
// Optional env:
//   POLL_INTERVAL_MS   — default 5000 (5s)
//   ONE_SHOT           — if "1" or "true", runs one iteration and exits
//                        (useful for testing or cron-driven mode)
//
// Reference: pscale-mcp-server/docs/protocol-grit.md daemon contract.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── Env loading ──

function loadEnv() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dirname, '..', '.env.local');
  try {
    const txt = readFileSync(envPath, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, rawV] = m;
      let v = rawV.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch (_e) { /* no .env.local; rely on process.env */ }
}

function requireEnv(name, hint) {
  const v = process.env[name];
  if (!v) { console.error(`✗ ${name} required — ${hint}`); process.exit(2); }
  return v;
}

// ── Beach HTTP ──

async function readBlock(beachUrl, name, spindle = '') {
  const u = `${beachUrl}/.well-known/pscale-beach?block=${encodeURIComponent(name)}${spindle ? `&spindle=${encodeURIComponent(spindle)}` : ''}`;
  const r = await fetch(u);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${name} → ${r.status} ${r.statusText}`);
  return r.json();
}

async function writeBlock(beachUrl, name, content, secret, opts = {}) {
  const u = `${beachUrl}/.well-known/pscale-beach?block=${encodeURIComponent(name)}`;
  const body = {
    spindle: opts.spindle ?? '',
    content,
    confirm: true,
    secret,
    new_lock: secret  // idempotent: same lock value on re-write
  };
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`POST ${name} → ${r.status}: ${t.slice(0,200)}`);
  }
  return r.json();
}

// ── Synthesis ──

function collectEntityLiquid(frame) {
  // Returns [{ pos, entity_desc, liquid }]
  if (!frame || typeof frame !== 'object') return [];
  const out = [];
  for (const [k, v] of Object.entries(frame)) {
    if (!/^[1-9]$/.test(k)) continue;
    if (!v || typeof v !== 'object') continue;
    const liquid = v['1'];
    if (typeof liquid === 'string' && liquid.trim()) {
      out.push({ pos: k, entity_desc: v['_'] ?? '', liquid });
    }
  }
  return out.sort((a, b) => Number(a.pos) - Number(b.pos));
}

async function dummySynthesise(entities, canon) {
  // TODO: medium-agent — replace this with a real Anthropic API call that
  // uses the canon's skill-pack star-ref as the synthesis prompt.
  // For v0.0.1: concatenate entity contributions into a single paragraph.
  const lines = entities.map(e => {
    const who = (typeof e.entity_desc === 'string' ? e.entity_desc : '').split(' — ')[0] || `entity@${e.pos}`;
    return `${who}: ${e.liquid}`;
  });
  return lines.join(' ');
}

// ── Round ──

async function runRound(beachUrl, passphrase, frameName, sceneName) {
  const frame = await readBlock(beachUrl, frameName);
  if (!frame) {
    console.log(`[synth] ${new Date().toISOString()} frame ${frameName} not found`);
    return { acted: false, reason: 'frame-missing' };
  }

  const entities = collectEntityLiquid(frame);
  if (entities.length === 0) {
    return { acted: false, reason: 'no-liquid' };
  }

  console.log(`[synth] ${new Date().toISOString()} synthesising ${entities.length} entit${entities.length === 1 ? 'y' : 'ies'} in ${frameName}`);

  // 1. Read canon (may not exist yet)
  const canon = await readBlock(beachUrl, `canon:${sceneName}`).catch(() => null);

  // 2. Synthesise (currently dummy)
  const synthesis = await dummySynthesise(entities, canon);

  // 3. Roll prior solid into history (if it existed)
  const priorSolid = await readBlock(beachUrl, `solid:${sceneName}`).catch(() => null);
  if (priorSolid && priorSolid._ && priorSolid._ !== '') {
    const history = (await readBlock(beachUrl, `history:${sceneName}`).catch(() => null)) || { _: `History of ${sceneName} synthesised solids.` };
    // Find next free supernest slot at root: 1..9, then 11..19, then 21..., etc.
    const nextSlot = nextSupernestSlot(history);
    history[String(nextSlot)] = {
      _: priorSolid._,
      9: `[SYNTHESIS rule=dummy-concat by=daemon at=${new Date().toISOString()}]`
    };
    await writeBlock(beachUrl, `history:${sceneName}`, history, passphrase);
  }

  // 4. Write new solid
  const newSolid = {
    _: synthesis,
    1: {
      _: 'Latest round synthesis envelope',
      1: 'rule: dummy-concat (v0.0.1; replace with medium-agent)',
      2: 'by: synthesis-daemon',
      3: new Date().toISOString()
    }
  };
  await writeBlock(beachUrl, `solid:${sceneName}`, newSolid, passphrase);

  // 5. Update each entity's solid lane + clear their liquid
  // (writes into frame at <n>.2 and <n>.1)
  const updatedFrame = { ...frame };
  for (const e of entities) {
    updatedFrame[e.pos] = {
      ...updatedFrame[e.pos],
      1: '',                                              // clear liquid
      2: e.liquid                                         // promote to per-entity solid
    };
  }
  await writeBlock(beachUrl, frameName, updatedFrame, passphrase);

  return { acted: true, entities: entities.length, synthesis };
}

function nextSupernestSlot(block) {
  // Find next free positive integer made of digits 1-9 (no zero)
  // 1..9, 11..19, ..., 99, 111..., etc. — append past the largest present
  if (!block || typeof block !== 'object') return 1;
  let maxPresent = 0;
  for (const k of Object.keys(block)) {
    if (!/^[1-9]+$/.test(k)) continue;
    const n = Number(k);
    if (n > maxPresent) maxPresent = n;
  }
  return nextSupernestAfter(maxPresent);
}

function nextSupernestAfter(n) {
  if (n === 0) return 1;
  // Convert n to digits, increment in supernest sequence (digits 1-9 only, no 0)
  // 1→2, 2→3, ..., 9→11, 11→12, ..., 19→21, ..., 99→111, etc.
  const digits = String(n).split('').map(Number);
  // Increment the last digit; if it would be 10, carry like base-9-without-0
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] < 9) { digits[i]++; return Number(digits.join('')); }
    digits[i] = 1;  // wrap to 1 (no 0 allowed)
    if (i === 0) { digits.unshift(1); return Number(digits.join('')); }
  }
  return Number(digits.join(''));
}

// ── Main ──

async function main() {
  loadEnv();

  const beachUrl = requireEnv('BEACH_URL', 'e.g. https://beach.happyseaurchin.com').replace(/\/$/, '');
  const passphrase = requireEnv('DAEMON_PASSPHRASE', 'used as secret + new_lock for daemon writes');
  const frameName = requireEnv('FRAME', 'e.g. frame:test-scene');
  const sceneName = process.env.SCENE ?? frameName.replace(/^frame:/, '');
  const pollMs = Number(process.env.POLL_INTERVAL_MS ?? 5000);
  const oneShot = ['1', 'true', 'yes'].includes((process.env.ONE_SHOT || '').toLowerCase());

  console.log(`▸ NOMAD synthesis daemon v0.0.1`);
  console.log(`  beach:  ${beachUrl}`);
  console.log(`  frame:  ${frameName}`);
  console.log(`  scene:  ${sceneName}`);
  console.log(`  mode:   ${oneShot ? 'one-shot' : `poll every ${pollMs}ms`}`);

  if (oneShot) {
    const r = await runRound(beachUrl, passphrase, frameName, sceneName);
    console.log(`▸ result: ${JSON.stringify(r)}`);
    return;
  }

  while (true) {
    try { await runRound(beachUrl, passphrase, frameName, sceneName); }
    catch (e) { console.error(`[synth] error: ${e.message}`); }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

main().catch(e => { console.error(`✗ fatal: ${e.message}`); process.exit(1); });
