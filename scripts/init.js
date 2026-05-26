#!/usr/bin/env node
//
// init.js — seed nomad-bsp blocks onto a target federated beach.
//
// Reads BEACH_URL + BEACH_PASSPHRASE from env (or ../.env.local), iterates
// over ../seeds/*.json, POSTs each to <BEACH_URL>/.well-known/pscale-beach.
//
// Required env:
//   BEACH_URL         — e.g. https://beach.happyseaurchin.com (no trailing slash)
//   BEACH_PASSPHRASE  — operator passphrase (locks each NOMAD block)
//
// Optional env:
//   PREFIX            — prepended to each block name. Useful for testing
//                       (e.g. PREFIX="nomad-test-" → blocks named "nomad-test-soft-agent").
//                       Default: "" (production block names).
//   DRY_RUN           — if "1" or "true", prints the plan and exits without POSTing.
//
// Reference: pscale-beach/init/seed-beach.js (same wire shape).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = resolve(__dirname, '..', 'seeds');

// ── Env loading (.env.local preferred; falls back to process.env) ──

function loadEnv() {
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
  } catch (_e) {
    // no .env.local; rely on process.env only
  }
}

function requireEnv(name, hint) {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ ${name} required — ${hint}`);
    process.exit(2);
  }
  return v;
}

// ── HTTP wrapper ──

async function postBeach(beachUrl, blockName, body) {
  const url = `${beachUrl}/.well-known/pscale-beach?block=${encodeURIComponent(blockName)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const txt = await res.text();
  let parsed;
  try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt }; }
  if (!res.ok) {
    throw new Error(`POST ${blockName} → ${res.status}: ${parsed?.error ?? txt}`);
  }
  return parsed;
}

// ── Main ──

async function main() {
  loadEnv();

  const beachUrl = requireEnv('BEACH_URL', 'e.g. https://beach.happyseaurchin.com (no trailing slash)').replace(/\/$/, '');
  const passphrase = requireEnv('BEACH_PASSPHRASE', 'operator passphrase — locks each NOMAD block');
  const prefix = process.env.PREFIX ?? '';
  const dryRun = ['1', 'true', 'yes'].includes((process.env.DRY_RUN || '').toLowerCase());

  // Probe the beach
  console.log(`▸ target beach: ${beachUrl}`);
  const probe = await fetch(`${beachUrl}/.well-known/pscale-beach`).catch(e => {
    throw new Error(`Cannot reach ${beachUrl}/.well-known/pscale-beach (${e.message})`);
  });
  if (!probe.ok) {
    throw new Error(`Beach probe failed: ${probe.status} ${probe.statusText}`);
  }
  console.log(`✓ beach reachable`);

  // Enumerate seeds
  const files = readdirSync(SEEDS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    console.error(`✗ no .json files in ${SEEDS_DIR}`);
    process.exit(3);
  }

  console.log(`▸ seeding ${files.length} block(s)${prefix ? ` with prefix "${prefix}"` : ''}${dryRun ? ' [DRY-RUN]' : ''}:`);
  for (const f of files) {
    console.log(`    ${prefix}${f.replace(/\.json$/, '')}`);
  }

  if (dryRun) {
    console.log('— DRY-RUN: no writes performed.');
    return;
  }

  // POST each
  let ok = 0, fail = 0;
  for (const f of files) {
    const blockName = `${prefix}${f.replace(/\.json$/, '')}`;
    const content = JSON.parse(readFileSync(resolve(SEEDS_DIR, f), 'utf8'));
    try {
      await postBeach(beachUrl, blockName, {
        spindle: '',
        content,
        confirm: true,
        secret: passphrase,
        new_lock: passphrase
      });
      console.log(`  ✓ ${blockName}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${blockName} — ${e.message}`);
      fail++;
    }
  }

  console.log(`— done: ${ok} ok, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(e => {
  console.error(`✗ fatal: ${e.message}`);
  process.exit(1);
});
