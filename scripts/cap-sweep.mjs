// Patient-tier cap-feasibility sweep (docs/PATIENT-TIER-MEASUREMENT.md step 2).
// Encode-only graphs at increasing KV capacity against a ComfyUI started with
// --reserve-vram (scripts/dev-comfy.ps1 -ReserveVram N).
//
// Under dynamic VRAM, global "headroom" is elastic - ComfyUI fills its budget
// with weight cache and streams the rest - so raw VRAM numbers are reported
// informationally only. The stop signals are (a) a step erroring and (b) the
// encode rate collapsing (KV squeezing the weight cache into pathological
// streaming). Run each sweep against a WARM instance (one throwaway encode
// first) or the first step pays cold first-touch staging and skews the rates.
//
//   node scripts/cap-sweep.mjs 8              # emulating a 16-8 = 8 GB card
//   node scripts/cap-sweep.mjs 4 --caps 120,180,240,300
//
// Node 22, no deps. STILLSONG_COMFY_URL overrides http://127.0.0.1:8000.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE = process.env.STILLSONG_COMFY_URL ?? 'http://127.0.0.1:8000';
const SLOWDOWN_STOP = 0.4; // stop when a step's frames/s falls under 40% of the best seen
const CODES_DIR = path.join(
  process.env.LOCALAPPDATA ?? '',
  'com.logiscape.stillsong', 'components', 'comfy-data', 'output', 'stillsong-capsweep',
);
const CODES_HEADER_BYTES = 12; // SSC1: 12-byte header + frames x 8 books x u16
const SEED = 424242;

const CAPTION = `Global Metadata: Warm indie folk, female vocals, fingerpicked acoustic guitar, soft piano. Intimate, hopeful. No drums.`;
// Short lyric: the composition ends naturally early, so each step stays quick
// while the KV pre-allocation (the thing being measured) is set by kv frames.
const LYRICS = `[verse]
Morning light on the kitchen floor
Coffee rings on a letter you wrote
[outro]`;

const reserveGb = Number(process.argv[2]);
if (!(reserveGb > 0)) {
  console.error('usage: node scripts/cap-sweep.mjs <reserve GB, matching dev-comfy -ReserveVram> [--caps 120,180,...]');
  process.exit(1);
}
const capsArg = process.argv.indexOf('--caps');
const CAPS = capsArg > 0 ? process.argv[capsArg + 1].split(',').map(Number) : [120, 180, 240, 300];

function smiUsedMb() {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], (err, out) => {
      if (err) return resolve(null);
      const [used, total] = out.trim().split('\n')[0].split(',').map((s) => Number(s.trim()));
      resolve({ used, total });
    });
  });
}

function graph(cap) {
  return {
    clip: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors', type: 'minimax', device: 'default' },
    },
    encode: {
      class_type: 'StillsongMusic3TextEncode',
      inputs: {
        clip: ['clip', 0],
        caption: CAPTION,
        lyrics: LYRICS,
        seed: SEED,
        max_duration: cap,
        cfg_scale: 1.5,
        top_k: 50,
        prefix_codes: '',
        save_codes_prefix: `stillsong-capsweep/cap${cap}`,
        kv_capacity_frames: cap * 25,
      },
    },
  };
}

async function submit(g) {
  const r = await fetch(`${BASE}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: g, client_id: `capsweep-${Date.now()}` }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`submit failed ${r.status}: ${JSON.stringify(body)}`);
  return body.prompt_id;
}

async function waitDone(promptId, onTick, timeoutMs = 900_000) {
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${promptId}`);
    await onTick();
    const r = await fetch(`${BASE}/history/${promptId}`);
    const hist = (await r.json())[promptId];
    if (hist) {
      const st = hist.status?.status_str;
      if (st === 'error') {
        const msg = hist.status?.messages?.map((m) => JSON.stringify(m)).join('; ') ?? 'unknown';
        throw new Error(`prompt errored: ${msg}`);
      }
      if (hist.status?.completed) return;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
}

/** Frames in the newest codes file for this cap (encode output), or null. */
function composedFrames(cap) {
  try {
    const files = fs.readdirSync(CODES_DIR)
      .filter((f) => f.startsWith(`cap${cap}_`) && f.endsWith('.codes.bin'))
      .map((f) => ({ f, mtime: fs.statSync(path.join(CODES_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return null;
    const size = fs.statSync(path.join(CODES_DIR, files[0].f)).size;
    return (size - CODES_HEADER_BYTES) / 16;
  } catch {
    return null;
  }
}

const baseline = await smiUsedMb();
if (!baseline) throw new Error('nvidia-smi unavailable');
console.log(`GPU used ${baseline.used} MB of ${baseline.total} MB at start; --reserve-vram ${reserveGb} assumed on the server`);
console.log(`stop rule: a step errors, or frames/s falls under ${SLOWDOWN_STOP * 100}% of the best step\n`);

let bestFps = 0;
for (const cap of CAPS) {
  let peakUsed = 0;
  const tick = async () => {
    const s = await smiUsedMb();
    if (s && s.used > peakUsed) peakUsed = s.used;
  };
  const t0 = Date.now();
  let error = null;
  try {
    await waitDone(await submit(graph(cap)), tick);
  } catch (e) {
    error = e.message;
  }
  const wall = (Date.now() - t0) / 1000;
  const frames = composedFrames(cap);
  const fps = frames ? frames / wall : null;
  console.log(
    `cap ${cap}s (kv ${cap * 25}): ${error ? 'FAILED - ' + error : 'ok'}; wall ${wall.toFixed(1)}s; ` +
      `composed ${frames ?? '?'} frames (${frames ? (frames / 25).toFixed(1) : '?'}s audio) ` +
      `= ${fps ? fps.toFixed(1) : '?'} f/s; peak GPU used ${peakUsed} MB`,
  );
  if (error) break;
  if (fps) {
    if (fps > bestFps) bestFps = fps;
    if (fps < bestFps * SLOWDOWN_STOP) {
      console.log('encode rate collapsed - stopping the sweep here (ceiling = previous step)');
      break;
    }
  }
}
