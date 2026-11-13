// Makes the take file (music tokens + final latent) for each starter song in
// examples/, so "Keep the rest" edits work on them in every library.
//
//   node scripts/example-takes.mjs [--url http://127.0.0.1:8000]
//
// Needs a ComfyUI with comfy-nodes/ComfyUI-Stillsong2 loaded
// (scripts/dev-comfy.ps1). Each example is performed again from its recipe in
// examples.json through the capturing graph; the take is written to
// examples/<audio name>.take.safetensors only if the MP3 audio that comes out
// is byte-identical to the shipped one (otherwise the take would not belong
// to the recording). Renders on the GPU: never run it while the app or
// another ComfyUI is rendering. Re-run after changing an example's audio.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(ROOT, 'examples');
const urlArg = process.argv.indexOf('--url');
const URL_ = urlArg > 0 ? process.argv[urlArg + 1] : (process.env.STILLSONG2_COMFY_URL ?? 'http://127.0.0.1:8000');
const PREFIX = 'stillsong2-examples';

async function run(graph) {
  const res = await fetch(`${URL_}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: `examples-${crypto.randomUUID()}` }),
  });
  const body = await res.json();
  if (!res.ok || !body.prompt_id) throw new Error(`submit failed: ${JSON.stringify(body).slice(0, 2000)}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const entry = (await (await fetch(`${URL_}/history/${body.prompt_id}`)).json())[body.prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === 'error') throw new Error(`prompt failed: ${JSON.stringify(entry.status.messages).slice(0, 2000)}`);
    if (entry.status?.completed) return entry.outputs;
  }
}

async function view(file) {
  const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' });
  const res = await fetch(`${URL_}/view?${q}`);
  if (!res.ok) throw new Error(`/view ${file.filename}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** sha256 of an MP3's audio, skipping the ID3v2 tag. */
function audioHash(bytes) {
  let start = 0;
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3') {
    start = 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f));
  }
  return crypto.createHash('sha256').update(bytes.subarray(start)).digest('hex');
}

/** The app's capturing render graph (src/engine/comfy/graphBuilder.ts buildGraph with capture), for a kept plan. */
function captureGraph(song, name) {
  const spec = song.spec;
  const seed = Number(spec.seed);
  return {
    ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: spec.checkpoint } },
    perform: {
      class_type: 'Stillsong2Perform',
      inputs: {
        clip: ['ckpt', 1], style: spec.caption, lyrics: spec.lyrics, abc: song.abc, seed, mode: spec.planMode === 'melody' ? 'melody' : 'full',
        max_duration: spec.durationSec, temperature: 1.0, top_p: 0.95, top_k: 100, repetition_penalty: 1.2,
      },
    },
    neg: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['perform', 0] } },
    latent: { class_type: 'EmptyYuE2LatentAudio', inputs: { seconds: ['perform', 1], batch_size: 1 } },
    sample: {
      class_type: 'KSampler',
      inputs: {
        model: ['ckpt', 0], positive: ['perform', 0], negative: ['neg', 0], latent_image: ['latent', 0], seed,
        steps: spec.steps, cfg: spec.cfg, sampler_name: spec.sampler, scheduler: spec.scheduler, denoise: 1.0,
      },
    },
    take: { class_type: 'Stillsong2SaveTake', inputs: { samples: ['sample', 0], tokens: ['perform', 2], filename_prefix: `${PREFIX}/${name}` } },
    decode: { class_type: 'VAEDecodeAudio', inputs: { samples: ['sample', 0], vae: ['ckpt', 2] } },
    save: { class_type: 'SaveAudioAdvanced', inputs: { audio: ['decode', 0], filename_prefix: `${PREFIX}/${name}`, format: 'mp3', 'format.quality': spec.quality } },
  };
}

const manifest = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'examples.json'), 'utf8'));
let failures = 0;
for (const song of manifest.songs) {
  const name = song.audio.replace(/\.mp3$/i, '');
  if (!song.abc?.trim()) {
    console.log(`${name}: no melody plan in the manifest, skipped`);
    continue;
  }
  const outputs = await run(captureGraph(song, name));
  const mp3 = await view(outputs.save.audio[0]);
  const take = await view(outputs.take.stillsong_take[0]);
  const shipped = fs.readFileSync(path.join(EXAMPLES, song.audio));
  if (audioHash(mp3) !== audioHash(shipped)) {
    console.log(`${name}: FAIL, this studio performs the recipe differently from the shipped MP3; no take written`);
    failures++;
    continue;
  }
  const file = `${name}.take.safetensors`;
  fs.writeFileSync(path.join(EXAMPLES, file), take);
  console.log(`${name}: ok, ${file} (${take.length} bytes, sha256 ${crypto.createHash('sha256').update(take).digest('hex').slice(0, 16)}...)`);
}
console.log(failures === 0 ? 'Done. Set each song\'s "take" in examples.json to its file and bump "version".' : `${failures} example(s) did not match.`);
process.exit(failures === 0 ? 0 : 1);
