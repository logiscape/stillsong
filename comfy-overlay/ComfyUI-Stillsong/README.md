# ComfyUI-Stillsong

Stillsong's first-party overlay for ComfyUI's MiniMax Music 3 nodes. It adds one
node, **StillsongMusic3TextEncode** — the official `MiniMaxMusic3TextEncode`
contract plus three capabilities the app needs:

- **Composition capture** — the AR composer's per-frame RVQ code matrix
  (c0 + 7 depth codes, 25 frames/s) is saved as an `SSC1` binary
  (`codes_format.py`). The code matrix *is* the composition: melody,
  arrangement, timing. A 4-minute song is ~100 KB.
- **Forced prefix** — a saved code matrix teacher-forces the first N frames of
  a new run. Sampling still executes (advancing the RNG stream exactly as an
  unforced run would), but its results are discarded in favor of the saved
  codes. This makes "Let it finish" a true continuation and lets a same-seed
  remix keep the original performance up to the first lyric edit — exact by
  construction, immune to floating-point drift.
- **Fixed KV capacity** — the KV cache can be allocated at a fixed frame count
  so changing `max_duration` no longer changes kernel scheduling (and thereby
  numerics) for the frames two runs share.

## Provenance & license

`stillsong_ar.py` is adapted from `comfy/ldm/minimax_music/ar.py` of
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) **0.42.4** (GPL-3.0) and is
itself GPL-3.0, as is all of Stillsong. Modified from the original; the
modifications are the blocks marked `Stillsong:`.

The overlay is **pinned**: `__init__.py` hashes the installed ComfyUI's `ar.py`
and refuses to load on a mismatch (`PINNED_AR_SHA256` in `stillsong_ar.py`).
When bumping the pinned ComfyUI version: diff the new `ar.py` against the old,
re-apply the marked blocks to a fresh copy, update the hash, and re-run the
overlay smoke tests (`node scripts/overlay-smoke.mjs`). The check that the copy
is faithful: take upstream `generate`, dedent it and rename `self` → `ar_self`,
and `diff` it against `stillsong_generate`; the residual must be only the
signature/docstring, the `Stillsong:` blocks and the return tuple. Forced
frames must stay on upstream's fast path: they open the malloc graph like any
other frame (the backbone's per-block CUDA graphs only run inside it), and the
forced depth core is CUDA-graphed too, reading its row from a fixed buffer, with
the decoder's captured graph dropped at the first free frame. Running forced
frames eagerly is invisible in the output (it is bit-identical) but made a
forced song compose ~4x slower on 0.42.4. After every bump, re-time a forced
render against a free one (same seed and inputs, full and partial prefixes):
encode frames/s and GPU utilization should match.

This is not a general-purpose custom node package; it is versioned with, and
installed by, the Stillsong app (into `comfy-data/custom_nodes/`). Stillsong's
"no custom nodes" convention means no *third-party* custom nodes — this package
is first-party, vendored, and pinned.
