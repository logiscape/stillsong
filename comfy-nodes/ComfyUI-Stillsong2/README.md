# ComfyUI-Stillsong2

Stillsong 2's first-party nodes for ComfyUI's YuE2 support. They exist to
change part of a finished song and have only that part sung again, while the
rest of the recording stays exactly as it was.

| Node | What it does |
|---|---|
| `Stillsong2Perform` | `YuE2GenerateMusic` plus a third output, the music tokens it wrote. Given a take's tokens and `redo` frame windows, it performs the take again: the windows are sampled anew, every other token is kept, and the take keeps its length. With a take and an empty `redo` it performs the take as it is (the tokens chosen by `Stillsong2Resing`). |
| `Stillsong2Resing` | The quick part of performing a take again: sings the `redo` windows and returns the tokens, without building the acoustic conditioning. About a second for a window of a few bars, so several seeds can be tried and scored before one is performed in full. |
| `Stillsong2Score` | Replays a take under a style, lyric sheet and melody plan in one forward pass and returns the log-probability of every frame's token. |
| `Stillsong2Align` | Two scores of one take, under two lyric sheets, subtracted: words the second sheet no longer has show as sharp drops at the frames where they are sung. |
| `Stillsong2ArrangeTake` | Lays a take out anew: spans of it kept in the order given, with gaps of new frames between them (`0-2920,+340,2920-7694`). A gap holds no music until a `redo` window covering it is sung; the other nodes refuse a take whose gaps were never sung. |
| `Stillsong2SaveTake` | Writes a take (tokens + final latent) to `<output>/<prefix>_NNNNN_.take.safetensors`. |
| `Stillsong2LoadTake` | Reads a take from ComfyUI's `temp` or `output` folder (`name [temp]` / `name [output]`), nowhere else. |
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

Only singing part of a take again goes through `stillsong_generate`, the
adapted copy of `_generate`.

## How part of a take is sung again

Only the frames that have to be stepped are stepped:

1. The take's tokens before the first window are appended to the prompt and
   read in one pass by upstream's `_prefill` (the same batched pass
   `_acoustic_conditioning` uses to read a whole take).
2. Sampling steps from the first window's start to the last window's end.
   Frames between two windows are forced to the take's tokens. The end token is
   blocked at every free step, so the take keeps its length. The block goes on
   the logits before upstream's `distribution` filters them: near a song's end
   the end token can be the only candidate top-k and top-p keep, and removing
   it after them leaves nothing to sample (a device-side assert that ends the
   ComfyUI process).
3. Everything after the last window is kept without being stepped.

The kept tokens before the first window count as steps already taken: the
repetition-penalty window is filled with the last of them, and the random
generator is advanced by one draw per token. So a window is sung from the same
random numbers a full stepped-through pass would have used.

It is not bit-identical to stepping through the whole take. Read in one pass,
the kept tokens leave the model's cache a rounding error away from stepping
them one at a time, and sampled tokens then part ways after a few steps
(measured on "The Last Ember", same seed and prompt: the first difference came
2 to 44 steps into a window; a window at frame 0, where nothing is read ahead,
was identical). A re-sung window is a new performance either way.

Measured 2026-11-16 (RTX 5080, a 4,900-frame take): an 80-frame window at 81 s
takes 1.0 s, against 24.5 s when every token was stepped; two windows 2,000
frames apart take 10.9 s (the frames between them are stepped).

## Take file

One safetensors file (never pickle): `codes` int16 `[frames]` (YuE2 codec code
per frame), `latent` float32 `[64, frames]`, metadata `format =
stillsong2-take`, `version = 1`. About 1.9 MB for a five-minute song.

## Provenance & license

`stillsong2_ar.py` is adapted from `comfy/text_encoders/yue2.py` of
[ComfyUI](https://github.com/Comfy-Org/ComfyUI) **0.42.4** (GPL-3.0) and is
itself GPL-3.0, as is all of Stillsong. Modified from the original on
2026-11-13 and 2026-11-16; the modifications are the blocks marked `Stillsong:`.

The package is **pinned**: `__init__.py` hashes the installed ComfyUI's
`yue2.py` and refuses to load on a mismatch (`PINNED_YUE2_SHA256` in
`stillsong2_ar.py`). The app then falls back to the core nodes, without takes.

When bumping the pinned ComfyUI version:

1. Diff the new `comfy/text_encoders/yue2.py` (and `comfy/text_encoders/llama.py`'s
   `Llama2_.forward` / `init_kv_cache`, which the replay calls) against the old.
2. Re-apply the marked blocks to a fresh copy of `_generate`, and re-check
   `stillsong_encode` against `encode_token_weights` line by line. Check that
   `_prefill` still takes a list of token lists and a cache capacity, and that
   the sampling head still draws once per step with `torch.multinomial` over
   the whole vocabulary: the generator is advanced on that assumption.
3. The check that the copy is faithful: take upstream `_generate`, rename
   `self` to `te`, and `diff` it against `stillsong_generate`. The residual must
   be only the signature and docstring, the imported names, the final `return`,
   and the `Stillsong:` blocks.
4. Update `PINNED_YUE2_SHA256`, then run `node scripts/nodes-smoke.mjs` and
   `npm run test:live`.

Forced steps must stay on upstream's fast path: the sampling head is captured as
a CUDA graph, so the forcing reads device tensors by `step_index` and never
branches on the step in Python. After a bump, check that `distribution` still
adds its allowed-token mask to whatever logits it is given (the end-token block
relies on -inf surviving it), and that a window late in a take still takes
about a second; the smoke script prints the time and re-sings the end of a take.

This is not a general-purpose custom node package. It is versioned with, and
installed by, the Stillsong 2 app (into `comfy-data/custom_nodes/`), which
launches ComfyUI with every other custom node disabled.
