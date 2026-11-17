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
//   T5  singing a window alone (Stillsong2Resing) gives the tokens the full
//       re-performance gives (the time it takes is reported, not judged); it
//       works with no plan, and at the end of a take, where the model wants
//       to stop
//   T6  scoring a take under two sheets reproduces the alignment series
//   T7  a take laid out anew: frames taken out, and a gap opened and sung;
//       a gap that was never sung is refused, and so is a layout too long to perform
//   T8  writing on from a plan (Stillsong2ContinuePlan): from an empty plan it
//       writes what the core plan node writes for the same seed, and from the
//       middle of the song's plan it writes more bars in the plan's own form
//
// Run it after any change to the package and as part of the ComfyUI bump ritual.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlArg = process.argv.indexOf('--url');
const URL_ = urlArg > 0 ? process.argv[urlArg + 1] : (process.env.STILLSONG2_COMFY_URL ?? 'http://127.0.0.1:8000');
const NODES = ['Stillsong2Perform', 'Stillsong2Resing', 'Stillsong2ArrangeTake', 'Stillsong2Score', 'Stillsong2ContinuePlan', 'Stillsong2LoadTake', 'Stillsong2HoldLatent', 'Stillsong2RestoreLatent', 'Stillsong2Align', 'Stillsong2SaveTake'];
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

// Tokens only: the windows sung anew, saved beside the latent they came with.
function resingGraph(takeName, { lyrics = spec.lyrics, abc = song.abc, seed: s = seed, redo, name, ...settings }) {
  return {
    ckpt,
    source: { class_type: 'Stillsong2LoadTake', inputs: { take: takeName } },
    sing: { class_type: 'Stillsong2Resing', inputs: { ...music(lyrics), ...settings, abc, seed: s, tokens: ['source', 0], redo } },
    take: { class_type: 'Stillsong2SaveTake', inputs: { samples: ['source', 1], tokens: ['sing', 0], filename_prefix: `${PREFIX}/${name}` } },
  };
}

function scoreGraph(takeName, sheets) {
  const graph = { ckpt, source: { class_type: 'Stillsong2LoadTake', inputs: { take: takeName } } };
  sheets.forEach((lyrics, i) => {
    graph[`score${i}`] = { class_type: 'Stillsong2Score', inputs: { clip: ['ckpt', 1], style: spec.caption, lyrics, abc: song.abc, mode: 'full', tokens: ['source', 0] } };
  });
  return graph;
}

const arranged = (takeName, layout) => ({
  ckpt,
  source: { class_type: 'Stillsong2LoadTake', inputs: { take: takeName } },
  arrange: { class_type: 'Stillsong2ArrangeTake', inputs: { tokens: ['source', 0], samples: ['source', 1], layout } },
});

// A gap opened in the take, sung, and performed: the quick singing first, then
// the chosen tokens performed in full with everything outside the gap held.
function gapGraph(takeName, layout, redo) {
  return {
    ...arranged(takeName, layout),
    sing: { class_type: 'Stillsong2Resing', inputs: { ...music(spec.lyrics), seed: 7, tokens: ['arrange', 0], redo } },
    perform: { class_type: 'Stillsong2Perform', inputs: { ...music(spec.lyrics), tokens: ['sing', 0], redo: '' } },
    hold: { class_type: 'Stillsong2HoldLatent', inputs: { samples: ['arrange', 1], redo } },
    ...tail(['hold', 0], ['perform', 0]),
    restore: { class_type: 'Stillsong2RestoreLatent', inputs: { samples: ['sample', 0], take: ['arrange', 1], redo } },
    take: { class_type: 'Stillsong2SaveTake', inputs: { samples: ['restore', 0], tokens: ['perform', 2], filename_prefix: `${PREFIX}/gap` } },
    ...saveMp3(['restore', 0], 'gap'),
  };
}

async function refused(graph, pattern) {
  try {
    await run(graph);
  } catch (err) {
    return pattern.test(String(err.message));
  }
  return false;
}

/** Row c of a take's latent, frames [from, to), as raw bytes. */
const latentRow = (t, c, from, to) => t.latent.subarray((c * t.codes.length + from) * 4, (c * t.codes.length + to) * 4);

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

console.log('T5 singing a window alone');
const sung = await run(resingGraph(tempName, { lyrics: edited, redo, name: 'resing' }));
const sungTake = parseTake(await view(fileOf(sung.outputs, 'take', 'stillsong_take')));
check('it sings the tokens the full re-performance sings', sungTake.codes.length === frames && sungTake.codes.every((v, i) => v === editTake.codes[i]));
// A measurement, not a pass condition: it is wall time, with the queue and this script's one-second polling in it.
console.log(`  note ${sung.seconds.toFixed(1)} s for ${WINDOW[1] - WINDOW[0]} frames at ${(WINDOW[0] / 25).toFixed(0)} s (a render of this song: ${capture.seconds.toFixed(0)} s)`);
const noPlan = await run(resingGraph(tempName, { abc: '', seed: 5, redo: '0-60', name: 'resing-noplan' }));
const noPlanTake = parseTake(await view(fileOf(noPlan.outputs, 'take', 'stillsong_take')));
check('with no plan it keeps the length and everything after the window', noPlanTake.codes.length === frames && noPlanTake.codes.subarray(60).every((v, i) => v === take.codes[60 + i]));
check('with no plan the window is sung anew', noPlanTake.codes.subarray(0, 60).some((v, i) => v !== take.codes[i]));

// Near a song's end the model wants to stop, and a re-sung window may not. With
// the end token taken out after the sampling filters, the second of these left
// a step nothing to sample and took the studio down (2026-11-16); the third
// keeps only the likeliest token, which is the end token as soon as it leads.
for (const [label, settings] of [
  ['the last 12 s, seed 1', { seed: 1, redo: `${frames - 300}-${frames}` }],
  ['the last 12 s, seed 3', { seed: 3, redo: `${frames - 300}-${frames}` }],
  ['the last 2 s, only the likeliest token', { seed: 1, redo: `${frames - 50}-${frames}`, top_k: 1 }],
]) {
  const ending = await run(resingGraph(tempName, { ...settings, name: 'resing-end' }));
  const endTake = parseTake(await view(fileOf(ending.outputs, 'take', 'stillsong_take')));
  const from = Number(settings.redo.split('-')[0]);
  const keptBefore = endTake.codes.length === frames && endTake.codes.subarray(0, from).every((v, i) => v === take.codes[i]);
  const resung = endTake.codes.subarray(from).some((v, i) => v !== take.codes[from + i]);
  check(`the end of the take can be sung again: ${label}`, keptBefore && resung, `${endTake.codes.length} frames`);
}

console.log('T6 scoring');
const scored = await run(scoreGraph(tempName, [spec.lyrics, edited]));
const logp = [0, 1].map((i) => JSON.parse(scored.outputs[`score${i}`].text[0]));
check('one value per frame, all finite', logp.every((s) => s.frames === frames && s.logp.length === frames && s.logp.every((v) => Number.isFinite(v) && v <= 0)));
let apart = 0;
for (let i = 0; i < frames; i++) apart = Math.max(apart, Math.abs(logp[1].logp[i] - logp[0].logp[i] - drop[i]));
check('two scores differ by the alignment series', apart < 0.01, `largest difference ${apart.toFixed(4)}; two replays ${scored.seconds.toFixed(1)} s`);

console.log('T7 a take laid out anew');
const CUT = [1000, 1500];
const shorter = await run({
  ...arranged(tempName, `0-${CUT[0]},${CUT[1]}-${frames}`),
  take: { class_type: 'Stillsong2SaveTake', inputs: { samples: ['arrange', 1], tokens: ['arrange', 0], filename_prefix: `${PREFIX}/shorter` } },
});
const shorterTake = parseTake(await view(fileOf(shorter.outputs, 'take', 'stillsong_take')));
const cutLength = CUT[1] - CUT[0];
let cutRight = shorterTake.codes.length === frames - cutLength;
for (let i = 0; cutRight && i < shorterTake.codes.length; i++) if (shorterTake.codes[i] !== take.codes[i < CUT[0] ? i : i + cutLength]) cutRight = false;
for (let c = 0; cutRight && c < 64; c++) {
  if (!latentRow(shorterTake, c, 0, CUT[0]).equals(latentRow(take, c, 0, CUT[0]))) cutRight = false;
  if (!latentRow(shorterTake, c, CUT[0], frames - cutLength).equals(latentRow(take, c, CUT[1], frames))) cutRight = false;
}
check('frames taken out: the rest joins up, tokens and latent', cutRight, `${shorterTake.codes.length} frames`);

const GAP = [WINDOW[1], WINDOW[1] + 100];
const layout = `0-${GAP[0]},+${GAP[1] - GAP[0]},${GAP[0]}-${frames}`;
const gapRedo = `${GAP[0]}-${GAP[1]}`;
check('a take with an unsung gap cannot be saved', await refused({
  ...arranged(tempName, layout),
  take: { class_type: 'Stillsong2SaveTake', inputs: { samples: ['arrange', 1], tokens: ['arrange', 0], filename_prefix: `${PREFIX}/unsung` } },
}, /gaps that were never sung/));
check('nor performed with the gap outside the redo windows', await refused({
  ...arranged(tempName, layout),
  sing: { class_type: 'Stillsong2Resing', inputs: { ...music(spec.lyrics), tokens: ['arrange', 0], redo: `${GAP[0] + 10}-${GAP[1]}` } },
  take: { class_type: 'Stillsong2SaveTake', inputs: { samples: ['arrange', 1], tokens: ['sing', 0], filename_prefix: `${PREFIX}/unsung` } },
}, /holds no music/));
check('nor is a layout too long to perform built at all', await refused({
  ...arranged(tempName, `0-10,+${10 ** 9}`),
  take: { class_type: 'Stillsong2SaveTake', inputs: { samples: ['arrange', 1], tokens: ['arrange', 0], filename_prefix: `${PREFIX}/unsung` } },
}, /the studio can hold/));
const gap = await run(gapGraph(tempName, layout, gapRedo));
const gapTake = parseTake(await view(fileOf(gap.outputs, 'take', 'stillsong_take')));
const gapMp3 = await view(fileOf(gap.outputs, 'save', 'audio'));
const added = GAP[1] - GAP[0];
check('the take is longer by the gap', gapTake.codes.length === frames + added && gapTake.latentShape[1] === frames + added);
let around = gapTake.codes.length === frames + added;
for (let i = 0; around && i < frames; i++) if (gapTake.codes[i < GAP[0] ? i : i + added] !== take.codes[i]) around = false;
check('tokens before and after the gap are kept', around);
let latentAround = gapTake.codes.length === frames + added;
let gapFilled = false;
for (let c = 0; latentAround && c < 64; c++) {
  if (!latentRow(gapTake, c, 0, GAP[0]).equals(latentRow(take, c, 0, GAP[0]))) latentAround = false;
  if (!latentRow(gapTake, c, GAP[1], frames + added).equals(latentRow(take, c, GAP[0], frames))) latentAround = false;
  if (latentRow(gapTake, c, GAP[0], GAP[1]).some((b) => b !== 0)) gapFilled = true;
}
check('the latent before and after the gap is bit-equal', latentAround);
check('the gap holds new music', gapFilled && new Set(gapTake.codes.subarray(GAP[0], GAP[1])).size > 10, `${new Set(gapTake.codes.subarray(GAP[0], GAP[1])).size} different tokens in ${added} frames`);
check('it was performed to audio', gapMp3.length > 100000, `${gap.seconds.toFixed(0)} s for the whole pass`);

console.log('T8 writing on from a plan');
// The plan node's own sampling settings, and a budget small enough to compare whole.
const writer = { clip: ['ckpt', 1], style: spec.caption, lyrics: spec.lyrics, seed: 4321, mode: 'full' };
const writing = { temperature: 0.7, top_p: 0.9, top_k: 30, repetition_penalty: 1.005, penalty_window: 100 };
// The plan up to the end of its first played phrase (line 4 of a phrase is the instrument's).
const planLines = song.abc.split('\n');
const firstPart = planLines.findIndex((line) => line.startsWith('%'));
const firstIns = planLines.findIndex((line, i) => i > firstPart && /^V:\s*Ins/.test(line));
const soFar = `${planLines.slice(0, firstIns + 2).join('\n')}\n`;
const wrote = await run({
  ckpt,
  core: { class_type: 'YuE2GenerateABC', inputs: { ...writer, max_abc_tokens: 120, ...writing } },
  core_out: { class_type: 'PreviewAny', inputs: { source: ['core', 0] } },
  from_start: { class_type: 'Stillsong2ContinuePlan', inputs: { ...writer, abc: '', max_tokens: 120, ...writing } },
  onward: { class_type: 'Stillsong2ContinuePlan', inputs: { ...writer, abc: soFar, max_tokens: 120, ...writing } },
});
const coreText = wrote.outputs.core_out.text[0];
const fromStart = wrote.outputs.from_start.text[0];
const onward = wrote.outputs.onward.text[0];
check('from an empty plan it writes what the plan node writes', fromStart.length > 40 && fromStart === coreText, `${fromStart.length} characters`);
check('from the middle of the plan it writes on in the plan\'s form', firstPart >= 0 && firstIns > firstPart && /^V:\s*Vocal\n[^\n]*\|\nV:\s*Ins\n[^\n]*\|/m.test(onward) && onward !== fromStart, `${JSON.stringify(onward.slice(0, 60))}; three plans ${wrote.seconds.toFixed(1)} s`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
