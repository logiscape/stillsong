// Smoke tests for the ComfyUI-Stillsong overlay (Phase A validation).
// Encode-only graphs (no render) against a running ComfyUI with the overlay
// installed — scripts/dev-comfy.ps1 provides one. Node 22, no deps.
//
//   node scripts/overlay-smoke.mjs            # all tests (~7 encode passes)
//   STILLSONG_COMFY_URL=... overrides the default http://127.0.0.1:8000
//
// T1 determinism      same seed+cap twice            -> identical codes
// T2 cap independence same seed, cap 12s vs 16s, fixed KV -> shared prefix identical
// T3 continuation     force full 8s-capped codes, cap 20s -> byte-prefix + longer
// T4 word edit        force 150 frames, one lyric changed -> prefix identical; report re-lock
//
// The runs reuse each other (T3's A doubles as a second T2 data point), so
// order matters. Codes files land in ComfyUI's output/stillsong-smoke/.

const BASE = process.env.STILLSONG_COMFY_URL ?? 'http://127.0.0.1:8000';
const SEED = 424242;
const CAPTION = `Global Metadata: Warm indie folk, female vocals, fingerpicked acoustic guitar, soft piano. Intimate, hopeful. No drums.`;
const LYRICS_A = `[verse]
Morning light on the kitchen floor
Coffee rings on a letter you wrote
I keep the window open for
The song inside your winter coat
[chorus]
And we are still here, still here
Turning gold in the slow light
Still here, still here
Holding on to the whole night`;
// One word changed in the chorus: "gold" -> "green".
const LYRICS_B = LYRICS_A.replace('Turning gold in the slow light', 'Turning green in the slow light');
if (LYRICS_B === LYRICS_A) throw new Error('lyric edit did not apply');

const KV = 9000; // fixed capacity (frames) for every deterministic run

// ---- comfy client ----------------------------------------------------------

function graph(p) {
  return {
    clip: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors', type: 'minimax', device: 'default' },
    },
    encode: {
      class_type: 'StillsongMusic3TextEncode',
      inputs: {
        clip: ['clip', 0],
        caption: p.caption ?? CAPTION,
        lyrics: p.lyrics ?? LYRICS_A,
        seed: p.seed ?? SEED,
        max_duration: p.maxDuration,
        cfg_scale: 1.5,
        top_k: 50,
        prefix_codes: p.prefixCodes ?? '',
        save_codes_prefix: `stillsong-smoke/${p.name}`,
        kv_capacity_frames: p.kv ?? KV,
      },
    },
  };
}

async function submit(g) {
  const r = await fetch(`${BASE}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: g, client_id: `smoke-${Date.now()}` }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`submit failed ${r.status}: ${JSON.stringify(body)}`);
  return body.prompt_id;
}

async function waitDone(promptId, timeoutMs = 600_000) {
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${promptId}`);
    const r = await fetch(`${BASE}/history/${promptId}`);
    const hist = (await r.json())[promptId];
    if (hist) {
      const st = hist.status?.status_str;
      if (st === 'error') {
        const msg = hist.status?.messages?.find((m) => m[0] === 'execution_error')?.[1];
        throw new Error(`execution error: ${msg?.exception_type}: ${msg?.exception_message}`);
      }
      if (hist.status?.completed) return hist;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
}

async function fetchCodes(hist) {
  for (const nodeOut of Object.values(hist.outputs ?? {})) {
    for (const val of Object.values(nodeOut)) {
      if (!Array.isArray(val)) continue;
      for (const item of val) {
        if (item?.filename?.endsWith('.codes.bin')) {
          const q = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder ?? '', type: item.type ?? 'output' });
          const r = await fetch(`${BASE}/view?${q}`);
          if (!r.ok) throw new Error(`view failed ${r.status} for ${item.filename}`);
          return parseSSC1(Buffer.from(await r.arrayBuffer()));
        }
      }
    }
  }
  throw new Error('no .codes.bin in history outputs — did the ui result reach history?');
}

// ---- SSC1 ------------------------------------------------------------------

function parseSSC1(buf) {
  if (buf.subarray(0, 4).toString('latin1') !== 'SSC1') throw new Error('bad magic');
  const version = buf.readUInt16LE(4);
  const books = buf.readUInt16LE(6);
  const frames = buf.readUInt32LE(8);
  if (version !== 1) throw new Error(`bad version ${version}`);
  const body = new Uint16Array(buf.buffer, buf.byteOffset + 12, frames * books);
  return { books, frames, body };
}

function toB64(codes) {
  const header = Buffer.alloc(12);
  header.write('SSC1', 0, 'latin1');
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(codes.books, 6);
  header.writeUInt32LE(codes.frames, 8);
  return Buffer.concat([header, Buffer.from(codes.body.buffer, codes.body.byteOffset, codes.body.byteLength)]).toString('base64');
}

function slice(codes, frames) {
  return { books: codes.books, frames, body: codes.body.subarray(0, frames * codes.books) };
}

/** First frame index where a and b differ (compares the overlapping range); -1 = identical overlap. */
function firstDiffFrame(a, b) {
  if (a.books !== b.books) throw new Error('codebook count mismatch');
  const frames = Math.min(a.frames, b.frames);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < a.books; c++) {
      if (a.body[f * a.books + c] !== b.body[f * b.books + c]) return f;
    }
  }
  return -1;
}

// ---- runs ------------------------------------------------------------------

async function run(p) {
  const t0 = Date.now();
  const hist = await waitDone(await submit(graph(p)));
  const codes = await fetchCodes(hist);
  console.log(`  ${p.name}: ${codes.frames} frames (${(codes.frames / 25).toFixed(1)}s composed) in ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);
  return codes;
}

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const stats = await fetch(`${BASE}/system_stats`).catch(() => null);
if (!stats?.ok) {
  console.error(`ComfyUI not reachable at ${BASE} — start it with scripts/dev-comfy.ps1`);
  process.exit(2);
}
const objInfo = await fetch(`${BASE}/object_info/StillsongMusic3TextEncode`);
const objBody = await objInfo.json().catch(() => ({}));
if (!objBody?.StillsongMusic3TextEncode) {
  console.error('StillsongMusic3TextEncode not registered — run scripts/install-comfy-overlay.ps1 and restart ComfyUI.');
  process.exit(2);
}
console.log(`Overlay registered at ${BASE}. Running smoke tests (first encode loads the 8.8 GB text encoder)...`);

// T1: determinism at fixed everything (save prefix differs so the second run isn't served from cache).
console.log('\nT1 determinism (12s cap, twice)');
const r1 = await run({ name: 't1a', maxDuration: 12 });
const r2 = await run({ name: 't1b', maxDuration: 12 });
check('T1 identical codes', r1.frames === r2.frames && firstDiffFrame(r1, r2) === -1,
  `frames ${r1.frames} vs ${r2.frames}, firstDiff ${firstDiffFrame(r1, r2)}`);

// T2: cap independence under fixed KV capacity.
console.log('\nT2 cap independence (12s vs 16s cap, kv fixed)');
const r3 = await run({ name: 't2-16s', maxDuration: 16 });
{
  const d = firstDiffFrame(r1, r3);
  check('T2 shared prefix identical', d === -1, `firstDiff ${d} of overlap ${Math.min(r1.frames, r3.frames)}`);
}

// T2b (informational): same comparison WITHOUT fixed KV — expected to drift.
console.log('\nT2b drift without fixed KV (informational, not a pass/fail)');
const r4a = await run({ name: 't2b-12s-kv0', maxDuration: 12, kv: 0 });
const r4b = await run({ name: 't2b-16s-kv0', maxDuration: 16, kv: 0 });
{
  const d = firstDiffFrame(r4a, r4b);
  console.log(`  kv0: firstDiff at frame ${d === -1 ? 'none (identical overlap!)' : `${d} (~${(d / 25).toFixed(1)}s)`}`);
}

// T3: continuation — truncate hard at 8s, then force the full matrix with a 20s cap.
console.log('\nT3 continuation (8s truncated -> forced full prefix, 20s cap)');
const r5 = await run({ name: 't3-8s', maxDuration: 8 });
check('T3 8s run also matches the 12s run prefix', firstDiffFrame(r5, r1) === -1, `firstDiff ${firstDiffFrame(r5, r1)}`);
const r6 = await run({ name: 't3-cont', maxDuration: 20, prefixCodes: toB64(r5) });
{
  const d = firstDiffFrame(slice(r6, Math.min(r5.frames, r6.frames)), r5);
  check('T3 continuation preserves the forced prefix', d === -1 && r6.frames >= r5.frames, `firstDiff ${d}, frames ${r5.frames} -> ${r6.frames}`);
  const d16 = firstDiffFrame(r6, r3);
  console.log(`  continuation vs free 16s run: firstDiff ${d16 === -1 ? 'none in overlap' : `${d16} (~${(d16 / 25).toFixed(1)}s)`} — measures RNG re-lock after forced handoff`);
}

// T4: word edit — force 150 frames (6s) of the original, change one chorus word.
console.log('\nT4 word edit (force 6s prefix, one word changed)');
const N = Math.min(150, r1.frames);
const r7 = await run({ name: 't4-edit', maxDuration: 12, lyrics: LYRICS_B, prefixCodes: toB64(slice(r1, N)) });
{
  const d = firstDiffFrame(slice(r7, Math.min(N, r7.frames)), slice(r1, N));
  check('T4 forced prefix identical under edited lyrics', d === -1, `firstDiff ${d} within forced ${N}`);
  const dFree = firstDiffFrame(r7, r1);
  const lock = dFree === -1 ? Math.min(r7.frames, r1.frames) : dFree;
  console.log(`  after the forced ${N} frames, tracks the original to frame ${lock} (~${(lock / 25).toFixed(1)}s; ${lock - N} free frames re-locked) — RNG alignment metric`);
}

console.log('\nDone.');
