# ComfyUI-Stillsong2

Stillsong 2's first-party nodes for ComfyUI's YuE2 support. They exist for one
feature: changing some lyric lines of a finished song and having only those
lines sung again, while the rest of the recording stays exactly as it was.

| Node | What it does |
|---|---|
| `Stillsong2Perform` | `YuE2GenerateMusic` plus a third output, the music tokens it wrote. Given a take's tokens and `redo` frame windows, it performs the take again: tokens outside the windows are teacher-forced, the windows are sampled anew, and the take keeps its length. |
| `Stillsong2SaveTake` | Writes a take (tokens + final latent) to `<output>/<prefix>_NNNNN_.take.safetensors`. |
| `Stillsong2LoadTake` | Reads a take from ComfyUI's `temp` or `output` folder (`name [temp]` / `name [output]`), nowhere else. |
| `Stillsong2Align` | Replays a take under two lyric sheets in one forward pass each and returns the per-frame change in log-probability. Words the second sheet no longer has show as sharp drops at the frames where they are sung. |
| `Stillsong2HoldLatent` | Sets a 1D noise mask over the `redo` windows, so the sampler holds every other frame. (Core `SetLatentNoiseMask` only handles image-shaped masks.) |
| `Stillsong2RestoreLatent` | After sampling, copies the take's own frames back outside the windows, making them bit-equal. |

Frame ranges are strings such as `583-662,2264-2338`: half-open, ascending,
25 frames per second.

## How a normal render uses it

An ordinary song runs **upstream's own sampling code**. `stillsong_encode`
mirrors `YuE2TEModel.encode_token_weights` and calls the unmodified
`_generate`; the only difference is that the generated tokens are handed out
instead of dropped. For the same seed and inputs the audio is byte-identical to
the core `YuE2GenerateMusic` graph (asserted by the live suite and
`scripts/nodes-smoke.mjs`).

Only a partial re-performance goes through `stillsong_generate`, the adapted
copy of `_generate`.

## Take file

One safetensors file (never pickle): `codes` int16 `[frames]` (YuE2 codec code
per frame), `latent` float32 `[64, frames]`, metadata `format =
stillsong2-take`, `version = 1`. About 1.9 MB for a five-minute song.

## Provenance & license

`stillsong2_ar.py` is adapted from `comfy/text_encoders/yue2.py` of
[ComfyUI](https://github.com/Comfy-Org/ComfyUI) **0.42.4** (GPL-3.0) and is
itself GPL-3.0, as is all of Stillsong. Modified from the original on
2026-11-13; the modifications are the blocks marked `Stillsong:`.

The package is **pinned**: `__init__.py` hashes the installed ComfyUI's
`yue2.py` and refuses to load on a mismatch (`PINNED_YUE2_SHA256` in
`stillsong2_ar.py`). The app then falls back to the core nodes, without takes.

When bumping the pinned ComfyUI version:

1. Diff the new `comfy/text_encoders/yue2.py` (and `comfy/text_encoders/llama.py`'s
   `Llama2_.forward` / `init_kv_cache`, which the replay calls) against the old.
2. Re-apply the marked blocks to a fresh copy of `_generate`, and re-check
   `stillsong_encode` against `encode_token_weights` line by line.
3. The check that the copy is faithful: take upstream `_generate`, rename
   `self` to `te`, and `diff` it against `stillsong_generate`. The residual must
   be only the signature and docstring, the imported names, and the `Stillsong:`
   blocks.
4. Update `PINNED_YUE2_SHA256`, then run `node scripts/nodes-smoke.mjs` and
   `npm run test:live`.

Forced steps must stay on upstream's fast path: the sampling head is captured as
a CUDA graph, so the forcing reads device tensors by `step_index` and never
branches on the step in Python. After a bump, time a partial re-performance
against a plain one; tokens per second should match.

This is not a general-purpose custom node package. It is versioned with, and
installed by, the Stillsong 2 app (into `comfy-data/custom_nodes/`), which
launches ComfyUI with every other custom node disabled.
