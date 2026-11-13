// Smoke test for comfy-nodes/ComfyUI-Stillsong2 against a real ComfyUI
// (default http://127.0.0.1:8000, started by scripts/dev-comfy.ps1, which
// installs the working tree's copy of the package). Renders on the GPU: never
// run it while the app or another ComfyUI is rendering.
//
//   node scripts/nodes-smoke.mjs [--url http://127.0.0.1:8000]
//
// Uses the starter song "The Last Ember" (examples/examples.json) and checks:
//   T1  a capturing render is byte-identical (MP3 audio) to the core-node graph
//       for the same seed, and writes a well-formed take
//   T2  alignment: an unchanged lyric sheet gives a flat series; one edited
//       line gives a sharp drop where that line is sung
//   T3  a partial re-performance keeps tokens and latent bit-equal outside the
//       window, changes them inside, and keeps the length
//   T4  the re-performed take no longer sings the old words
//
// Run it after any change to the package and as part of the ComfyUI bump ritual.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlArg = process.argv.indexOf('--url');
const URL_ = urlArg > 0 ? process.argv[urlArg + 1] : (process.env.STILLSONG2_COMFY_URL ?? 'http://127.0.0.1:8000');
const NODES = ['Stillsong2Perform', 'Stillsong2LoadTake', 'Stillsong2HoldLatent', 'Stillsong2RestoreLatent', 'Stillsong2Align', 'Stillsong2SaveTake'];
const PREFIX = 'stillsong2-smoke';

const song = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'examples.json'), 'utf8')).songs
  .find((s) => s.spec.title === 'The Last Ember');
const spec = song.spec;
const OLD_LINE = 'The room is cold and wide,';
const NEW_LINE = 'The river runs with gold,';
if (!spec.lyrics.includes(OLD_LINE)) throw new Error('the starter song changed; update OLD_LINE');
const edited = spec.lyrics.replace(OLD_LINE, NEW_LINE);
// Measured 2026-11-13: that line is sung at 81.5-83.5 s (frames 2037-2088).
const LINE = [2037, 2088];
const WINDOW = [2025, 2105];

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

async function run(graph) {
  const t0 = Date.now();
  const res = await fetch(`${URL_}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: `smoke-${crypto.randomUUID()}` }),
  });
  const body = await res.json();
  if (!res.ok || !body.prompt_id) throw new Error(`submit failed: ${JSON.stringify(body).slice(0, 2000)}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const entry = (await (await fetch(`${URL_}/history/${body.prompt_id}`)).json())[body.prompt_id];
    if (!entry) continue;
    const status = entry.status ?? {};
    if (status.status_str === 'error') {
      const messages = (status.messages ?? []).filter((m) => m[0] === 'execution_error').map((m) => JSON.stringify(m[1]).slice(0, 2000));
      throw new Error(`prompt failed: ${messages.join('\n')}`);
    }
    if (status.completed) return { outputs: entry.outputs, seconds: (Date.now() - t0) / 1000 };
  }
}

function fileOf(outputs, nodeId, key) {
  const file = outputs[nodeId]?.[key]?.[0];
  if (!file) throw new Error(`node ${nodeId} reported no ${key}`);
  return file;
}

async function view(file) {
  const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' });
  const res = await fetch(`${URL_}/view?${q}`);
  if (!res.ok) throw new Error(`/view ${file.filename}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** sha256 of an MP3's audio, skipping the ID3v2 tag (which carries the prompt). */
function audioHash(bytes) {
  let start = 0;
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3') {
    start = 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f));
  }
  return crypto.createHash('sha256').update(bytes.subarray(start)).digest('hex');
}

function parseTake(bytes) {
  const headerLength = Number(bytes.readBigUInt64LE(0));
  const header = JSON.parse(bytes.subarray(8, 8 + headerLength).toString('utf8'));
  const data = bytes.subarray(8 + headerLength);
  const slice = (t) => data.subarray(t.data_offsets[0], t.data_offsets[1]);
  const codes = slice(header.codes);
  const latent = slice(header.latent);
  return {
    metadata: header.__metadata__,
    codesShape: header.codes.shape, codesType: header.codes.dtype,
    latentShape: header.latent.shape, latentType: header.latent.dtype,
    codes: new Int16Array(codes.buffer, codes.byteOffset, codes.byteLength / 2),
    latent, // raw float32 bytes, [64, frames] row-major
  };
}

async function uploadTake(bytes, name) {
  const form = new FormData();
  form.append('image', new Blob([bytes]), name);
  form.append('type', 'temp');
  form.append('subfolder', 'stillsong2');
  form.append('overwrite', 'true');
  const res = await fetch(`${URL_}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  const saved = await res.json();
  return `${saved.subfolder}/${saved.name} [temp]`;
}

const seed = Number(spec.seed);
const sampling = { temperature: 1.0, top_p: 0.95, top_k: 100, repetition_penalty: 1.2 };
const ckpt = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: spec.checkpoint } };
const tail = (latent, conditioning) => ({
  neg: { class_type: 'ConditioningZeroOut', inputs: { conditioning } },
  sample: {
    class_type: 'KSampler',
    inputs: {
      model: ['ckpt', 0], positive: conditioning, negative: ['neg', 0], latent_image: latent, seed,
      steps: spec.steps, cfg: spec.cfg, sampler_name: spec.sampler, scheduler: spec.scheduler, denoise: 1.0,
    },
  },
});
const saveMp3 = (samples, name) => ({
  decode: { class_type: 'VAEDecodeAudio', inputs: { samples, vae: ['ckpt', 2] } },
  save: { class_type: 'SaveAudioAdvanced', inputs: { audio: ['decode', 0], filename_prefix: `${PREFIX}/${name}`, format: 'mp3', 'format.quality': 'V0' } },
});
const music = (lyrics) => ({ clip: ['ckpt', 1], style: spec.caption, lyrics, abc: song.abc, seed, mode: 'full', max_duration: 500, ...sampling });

function coreGraph() {
  return {
    ckpt,
    perform: { class_type: 'YuE2GenerateMusic', inputs: music(spec.lyrics) },
    latent: { class_type: 'EmptyYuE2LatentAudio', inputs: { seconds: ['perform', 1], batch_size: 1 } },
    ...tail(['latent', 0], ['perform', 0]),
    ...saveMp3(['sample', 0], 'core'),
  };
}

function captureGraph() {
  return {
    ckpt,
    perform: { class_type: 'Stillsong2Perform', inputs: music(spec.lyrics) },
    latent: { class_type: 'EmptyYuE2LatentAudio', inputs: { seconds: ['perform', 1], batch_size: 1 } },
    ...tail(['latent', 0], ['perform', 0]),
    take: { class_type: 'Stillsong2SaveTake', inputs: { samples: ['sample', 0], tokens: ['perform', 2], filename_prefix: `${PREFIX}/capture` } },
    ...saveMp3(['sample', 0], 'capture'),
  };
}

function alignGraph(takeName, lyricsA, lyricsB) {
  return {
    ckpt,
    source: { class_type: 'Stillsong2LoadTake', inputs: { take: takeName } },
    align: {
      class_type: 'Stillsong2Align',
      inputs: { clip: ['ckpt', 1], style: spec.caption, abc: song.abc, mode: 'full', tokens: ['source', 0], lyrics_a: lyricsA, lyrics_b: lyricsB },
    },
  };
}

function editGraph(takeName, redo) {
  return {
    ckpt,
    source: { class_type: 'Stillsong2LoadTake', inputs: { take: takeName } },
    perform: { class_type: 'Stillsong2Perform', inputs: { ...music(edited), tokens: ['source', 0], redo } },
    hold: { class_type: 'Stillsong2HoldLatent', inputs: { samples: ['source', 1], redo } },
    ...tail(['hold', 0], ['perform', 0]),
    restore: { class_type: 'Stillsong2RestoreLatent', inputs: { samples: ['sample', 0], take: ['source', 1], redo } },
    take: { class_type: 'Stillsong2SaveTake', inputs: { samples: ['restore', 0], tokens: ['perform', 2], filename_prefix: `${PREFIX}/edit` } },
    ...saveMp3(['restore', 0], 'edit'),
  };
}

const series = (outputs) => JSON.parse(outputs.align.text[0]);
const smooth = (drop, i, k = 13) => {
  let sum = 0;
  for (let j = i - (k >> 1); j <= i + (k >> 1); j++) sum += drop[j] ?? 0;
  return sum / k;
};

// ---------------------------------------------------------------------------

for (const node of NODES) {
  const res = await fetch(`${URL_}/object_info/${node}`);
  const info = res.ok ? await res.json() : {};
  if (!info[node]) throw new Error(`${node} is not registered at ${URL_}: is the package installed (scripts/dev-comfy.ps1) and did it load? Check the ComfyUI log for IMPORT FAILED.`);
}
console.log(`ComfyUI at ${URL_}: all ${NODES.length} nodes registered`);

console.log('T1 capture equals the core graph');
const core = await run(coreGraph());
const coreMp3 = await view(fileOf(core.outputs, 'save', 'audio'));
const capture = await run(captureGraph());
const captureMp3 = await view(fileOf(capture.outputs, 'save', 'audio'));
const takeFile = fileOf(capture.outputs, 'take', 'stillsong_take');
const takeBytes = await view(takeFile);
const take = parseTake(takeBytes);
const frames = take.codes.length;
check('MP3 audio is byte-identical', audioHash(coreMp3) === audioHash(captureMp3), `core ${core.seconds.toFixed(0)} s, capture ${capture.seconds.toFixed(0)} s`);
check('take is well-formed', take.metadata?.format === 'stillsong2-take' && take.codesType === 'I16' && take.latentType === 'F32'
  && take.latentShape[0] === 64 && take.latentShape[1] === frames && take.latent.length === 64 * frames * 4, `${frames} frames, ${takeBytes.length} bytes`);
check('take file name follows the prefix', /_\d{5}_\.take\.safetensors$/.test(takeFile.filename), takeFile.filename);

console.log('T2 alignment');
const tempName = await uploadTake(takeBytes, 'smoke.take.safetensors');
const flat = series((await run(alignGraph(tempName, spec.lyrics, spec.lyrics))).outputs);
check('an unchanged sheet gives a flat series', flat.frames === frames && flat.drop.every((v) => Math.abs(v) < 0.05));
const aligned = await run(alignGraph(tempName, spec.lyrics, edited));
const drop = series(aligned.outputs).drop;
let lowest = 0;
let at = 0;
for (let i = 0; i < frames; i++) {
  const v = smooth(drop, i);
  if (v < lowest) { lowest = v; at = i; }
}
check('the edited line shows a sharp drop where it is sung', lowest < -1 && at >= LINE[0] && at <= LINE[1], `lowest ${lowest.toFixed(2)} at ${(at / 25).toFixed(2)} s; replay ${aligned.seconds.toFixed(1)} s`);
let outside = 0;
for (let i = 0; i < frames; i++) if (i < WINDOW[0] - 50 || i > WINDOW[1] + 50) outside = Math.min(outside, smooth(drop, i));
check('nothing drops elsewhere', outside > -0.25, `lowest elsewhere ${outside.toFixed(3)}`);

console.log('T3 partial re-performance');
const redo = `${WINDOW[0]}-${WINDOW[1]}`;
const edit = await run(editGraph(tempName, redo));
const editMp3 = await view(fileOf(edit.outputs, 'save', 'audio'));
const editTakeFile = fileOf(edit.outputs, 'take', 'stillsong_take');
const editTake = parseTake(await view(editTakeFile));
check('the take keeps its length', editTake.codes.length === frames);
let keptEqual = true;
let changedInside = 0;
for (let i = 0; i < frames; i++) {
  const inside = i >= WINDOW[0] && i < WINDOW[1];
  if (!inside && take.codes[i] !== editTake.codes[i]) keptEqual = false;
  if (inside && take.codes[i] !== editTake.codes[i]) changedInside++;
}
check('tokens outside the window are kept', keptEqual);
check('tokens inside the window are sung anew', changedInside > (WINDOW[1] - WINDOW[0]) / 2, `${changedInside} of ${WINDOW[1] - WINDOW[0]} changed`);
let latentEqual = true;
let latentChanged = false;
for (let c = 0; c < 64 && latentEqual; c++) {
  const row = c * frames * 4;
  const before = [row, row + WINDOW[0] * 4];
  const after = [row + WINDOW[1] * 4, row + frames * 4];
  const within = [row + WINDOW[0] * 4, row + WINDOW[1] * 4];
  if (!take.latent.subarray(...before).equals(editTake.latent.subarray(...before))) latentEqual = false;
  if (!take.latent.subarray(...after).equals(editTake.latent.subarray(...after))) latentEqual = false;
  if (!take.latent.subarray(...within).equals(editTake.latent.subarray(...within))) latentChanged = true;
}
check('the latent outside the window is bit-equal', latentEqual);
check('the latent inside the window changed', latentChanged);
check('the audio changed', audioHash(editMp3) !== audioHash(captureMp3), `edit render ${edit.seconds.toFixed(0)} s`);

console.log('T4 the new take sings the new words');
const outputName = `${editTakeFile.subfolder ? `${editTakeFile.subfolder.replaceAll('\\', '/')}/` : ''}${editTakeFile.filename} [output]`;
const after = series((await run(alignGraph(outputName, spec.lyrics, edited))).outputs).drop;
let leftover = 0;
for (let i = 0; i < frames; i++) leftover = Math.min(leftover, smooth(after, i));
check('no old words are left', leftover > -0.25, `lowest ${leftover.toFixed(3)}`);
let gain = 0;
for (let i = WINDOW[0]; i < WINDOW[1]; i++) gain += after[i];
check('the window fits the new sheet better', gain > 10, `+${gain.toFixed(1)} nats`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
