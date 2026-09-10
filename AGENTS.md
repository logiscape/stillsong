# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code), Codex, and other AI agents when working with code in this repository.

Stillsong is a Windows desktop app (Tauri v2 + React 18 + TypeScript, GPL-3.0) that turns a photo into a song. Everything runs locally: Gemma 4 12B (via `llama-server`) looks at the photo and writes caption + lyrics; MiniMax Music 3 (via headless ComfyUI) renders the audio. Both are child processes the app downloads on first run, supervises, and binds to 127.0.0.1. The README covers the product and the user-facing setup; this file covers what the code depends on.

## Project principles

1. **The image analysis and song generation runs locally on the User's PC.** The app never automatically uploads or shares any content the user provides, or the songs that Stillsong generates. The user must choose to export and share them, if they wish to do so.

2. **The app never auto updates after the one-time initial setup.** The models and components installed by the app do not automatically update, unless the user initiates an update or configuration change.

3. **The app and the components installed by the app never upload usage statistics, crash reports, etc.** (Anything done by the user's operating system or external services not setup by the app are considered out of the project's control and out of scope of these principles)

4. **All commits are human-initiated.** Agents must never run `git commit`, `git push`, or tag releases. Leave verified work in the working tree for the human user to review, approve, and commit.

These core principles should be built into the architecture of the app, rather than a promise that the Stillsong developer is "doing the right thing". In other words, another company can't acquire Stillsong and remotely flip on an "auto update" switch without releasing a new version that the user must install on their own.

The app should follow standard best practices (eg. check the hashes for known pinned components) for securely obtaining the components from official sources and CDNs.

## Commands

```
npm test                       # unit tests (vitest, in-process fakes, no GPU/services)
npx vitest run src/engine/__tests__/linter.test.ts   # one test file
npx vitest run -t "pattern"    # tests matching a name
npm run typecheck              # both tsconfigs (app + tests)
npm run tauri dev              # run the app (Vite on :1432); fully self-hosted, no env needed
npm run tauri build            # unsigned NSIS installer -> src-tauri/target/release/bundle/nsis/
npm run test:live              # E2E against a real ComfyUI on :8000 (renders drafts, 2–6 min)
node scripts/overlay-smoke.mjs # 4 encode-only smoke tests of the ComfyUI-Stillsong overlay
npm run check:manifest         # probe every pinned URL/hop/size in components.json (CI)
npm run lock:python            # regenerate python.wheels lock (release-time, after ComfyUI bump)
npm run licenses               # regenerate THIRD-PARTY-LICENSES.txt after dep changes
```

Rust (run in `src-tauri/`): `cargo test`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`. CI (`ci.yml`) enforces all three plus typecheck/test/check-manifest on pushes to `main` and on pull requests — feature-branch pushes run nothing, so run them locally. `cargo test first_run_headless` (with `STILLSONG_E2E_COMPONENTS=<dir>`, optionally `STILLSONG_E2E_SKIP_MODELS=1`) is the headless production first run that `first-run.yml` executes on manifest/bootstrap changes.

Dev env vars: `STILLSONG_COMFY_URL` / `STILLSONG_LLM_URL` make the supervisor treat that service as external instead of spawning it; `STILLSONG_COMPONENTS` overrides the components dir (default `%LOCALAPPDATA%\com.logiscape.stillsong\components\`). `scripts\dev-comfy.ps1` launches the components copy of ComfyUI standalone on :8000 with the supervisor's exact interpreter/flags (for live tests and overlay work); `scripts\install-comfy-overlay.ps1` mirrors the overlay into its custom_nodes. **One renderer on the GPU at a time** — never run the app alongside a standalone ComfyUI that is rendering. `tauri dev` watches `src-tauri/`, so editing Rust restarts the app mid-render.

Live tests are gated on `STILLSONG_LIVE=1`, which only `npm run test:live` sets (via cross-env): running `live.test.ts` or `live-cowriter.test.ts` through plain `npx vitest run` skips every test and reports green without rendering anything. They target a ComfyUI on `:8000` unless `STILLSONG_COMFY_URL` says otherwise (`livePorts.ts`). Files run sequentially (`--no-file-parallelism`) on purpose: parallel files would put Gemma and ComfyUI on the GPU at once. `STILLSONG_PHOTO=<path>` overrides the sample photo. The continuation test requires the overlay to be installed.

## Architecture

Three layers with a hard boundary:

- **`src/engine/`** — pure TypeScript core. No UI, no Tauri imports. Every side effect goes through the interfaces in `ports.ts` (`Db`, `HttpTransport`, `WsTransport`, `FileStore`, `Clock`, `Runtime`). Tests in `__tests__/` inject fakes from `fakes.ts`; `livePorts.ts` provides Node-backed real ports for the live suite.
  - `domain/` — `SongSpec` and friends, `validate.ts`, `duration.ts` (`renderCap`), `editPrefix.ts` (where a same-seed lyric edit cuts the forced prefix).
  - `cowriter/` — `LlmClient` over llama-server's OpenAI-compatible API, `guides.ts` (prompts, per-source vision analysis), `Cowriter.compose` (analysis → compose → silent lint-repair round), `linter.ts`, `lyrics.ts` (`parseLyrics`).
  - `comfy/` — `ComfyClient` (HTTP + WS), `graphBuilder.ts` + typed node constructors in `nodes.ts`, `NODE_PHASES` (node id → phase, in `graphBuilder.ts`), `events.ts` (`ProgressTracker`), `codes.ts` (SSC1 composition-code format, mirrors `codes_format.py` in the overlay).
  - `orchestrator/vram.ts` — `VramArbiter`: LLM and ComfyUI weights are never resident together. Probe-before-transition; stopping the LLM resolves only when the process has exited.
  - `repo/` — SQLite repos (songs, photos, jobs, settings). `migrations.ts` (in `src/engine/`, not `repo/`) is an ordered list of SQL strings.
  - `index.ts` — `Engine`: `createFromPhoto` one-shot pipeline (emits `creation_stage` for preparing → looking → writing → studio; the store derives composing → rendering → finishing from `progress` events), job queue/runner, `trackToCompletion` (WS + history-poll fallback), `recoverInFlight` on boot, boot-time sweeps (`sweepComfyOutputs`, `sweepOrphanPhotos`).
- **`src/adapters/tauriPorts.ts`** — the one Tauri implementation of `Ports`, over the Rust commands.
- **`src-tauri/src/`** — thin Rust shell, one module per concern: `supervisor.rs` (spawns llama-server/ComfyUI under a Job Object so they die with the app; dynamic ports 17800–17899; crash-restart-once for ComfyUI; mirrors the overlay into `comfy-data/custom_nodes` before each spawn), `downloads.rs` (resumable, hash-verified, host-allowlisted component downloads), `components.rs` (extraction + offline uv venv bootstrap + verify), `manifest.rs` (`components.json` compiled in via `include_str!`; the web view only names artifacts by id), `gpu.rs` (nvidia-smi → DXGI fallback), `http.rs`/`ws.rs` (loopback-only bridge), `files.rs` (library-relative file ops).

UI: `src/state/store.ts` (useSyncExternalStore; subscribes to engine events; owns the single shared audio element) → `src/ui/screens/*` → design-system primitives in `src/ui/ds/` and tokens in `src/ui/tokens/`. `src/state/paintSession.ts` holds the in-progress "Draw Something" canvas in memory until `song_done`. The "Twilight Gallery" design language, voice/copy rules, and a prototyping UI kit live in `design-kit/` (its `readme.md` is the brand reference; note it was authored from a brief, not from this code).

`comfy-overlay/ComfyUI-Stillsong/` is our first-party ComfyUI custom node (`StillsongMusic3TextEncode`): the official encoder plus SSC1 codes capture, teacher-forced prefix, and fixed KV capacity. It is bundled as a Tauri resource. The engine probes for it (`hasStillsongEncode`) and degrades to the stock node when absent. **No third-party custom nodes, ever.**

`examples/` is the three-song starter library (CC BY 4.0 media + `examples.json`), also bundled as a Tauri resource. `src/engine/examples.ts` (`seedExamples`, from `Engine.create`) imports it through the ordinary repos into an *empty* library exactly once, recording the outcome in the `examplesSeeded` setting: a library that already has songs is skipped for good, and deleted examples never come back. Song ids are fixed in the manifest so a failed seed resumes without duplicates. Never ship a pre-built database — every stored path is absolute. To change an example: re-render, copy the MP3 + `.codes.bin` + the photo (EXIF-stripped, ≤ 2048 px) into `examples/`, write the ID3 disclosure comment into the MP3, update `examples.json` (bump `version`).

### Supply chain

`components.json` pins every first-run download (uv, python-build-standalone, ComfyUI at a commit, llama.cpp, models, and `python.wheels` — one hashed wheel per package). `python.exclude` names packages ComfyUI's requirements resolve but the wheelhouse deliberately omits (today the five `comfyui-workflow-templates-media-*` gallery bundles, 444 MB): `lock-python.mjs` drops them *after* `uv pip compile` and fails on a name the resolution lacks, so a stale entry after a bump cannot silently do nothing. `npm run lock:python -- --freeze` re-locks with every current wheel pinned, for manifest-only changes that must not move other packages. Setup resolves nothing: `uv venv --offline` then `uv pip sync --offline --no-index --require-hashes` from the wheelhouse, with inherited `UV_*`/`PIP_*` (by prefix) and `PYTHONPATH`/`PYTHONHOME`/`PYTHONSTARTUP`/`PYTHONUSERBASE`/`VIRTUAL_ENV`/`CONDA_PREFIX` (by name) scrubbed — other `PYTHON*` variables pass through. `allowedHosts` is enforced on the first request only; redirect hops need only https (CDN hostnames churn); size + sha256 bind the bytes.

Post-setup disk hygiene: `_downloads/` (archives + wheelhouse) is deleted once `.install-complete` exists (`Supervisor::remove_downloads`, at setup finish and every boot). **Leave `uv-cache/` alone.** It looks huge (several GB apparent) but is hardlinked into `python-env/`, so its real cost is a few tens of MB — and once the wheelhouse is gone it is the only local source an offline `uv pip sync` repair can draw from. Do not add it to any sweep.

**ComfyUI bump ritual**: update the `comfyui` manifest item → re-apply the marked `Stillsong:` blocks to the new `ar.py` and update `PINNED_AR_SHA256` in `stillsong_ar.py` (the node refuses to load on mismatch) → check `python.exclude` still matches the media bundle names the new `comfyui-workflow-templates` release declares → `npm run lock:python` (no `--freeze`) → `npm run check:manifest` → `node scripts/overlay-smoke.mjs` → one real render.

## Hard-won facts (measured; do not rediscover)

**GPU / process**
- Never run the LLM and a render concurrently: with Gemma resident a 20 s render took ~6× longer (no OOM, ComfyUI offloads). The VRAM arbiter is mandatory.
- Fresh WS `clientId` per job, socket open before `/prompt` submit. ComfyUI keys sockets by clientId and pops the key when an old socket disconnects — reuse lets job N's teardown evict job N+1's socket and silently drop all progress. History polling every 10 s is the fallback; 3 transport errors on a dead ComfyUI fails the song.
- Speed on an RTX 5080 with warm models: 20 s song ≈ 22–27 s wall (encode ~42 frames/s, 30 KSampler steps ≈ 11 s, tiled decode ≈ 1 s). Gemma compose ≈ 10 s, photo card + compose ≈ 18 s.
- The `comfyui-workflow-templates-media-*` wheels are excluded on purpose (`python.exclude`). ComfyUI resolves every template asset eagerly while registering routes, so every boot logs one `Failed to resolve template asset paths: Package 'comfyui_workflow_templates_media_…' is not installed` error and skips the `/templates` route. Nothing else is affected (the meta/core/json packages stay, which is the quietest configuration; dropping the meta package too triggers a multi-line ERROR banner). Do not "fix" the log line by shipping the media.

**MiniMax Music 3 prompt contract** (`comfy/ldm/minimax_music/prompt.py`)
- Caption is Markdown-stripped; lyrics split on `[tag]` lines; `[start]` is prepended by the model.
- **Instrumental = tag-only lyrics** (`[intro]\n[instrumental]\n[outro]`), never empty lyrics (empty drifts off-caption). Only `[intro]/[instrumental]/[solo]/[outro]`; empty `[verse]`/`[chorus]`/`[bridge]` prime gibberish vocals. The linter rejects them for instrumentals.
- Instrumental length is linear in wordless tag count at ~9 s/tag from 3 to 15 tags, then breaks down (18+ tags come out shorter). Prose length statements and duration metadata have no effect. `instrumentalSkeleton` in `cowriter.ts` budgets 1 tag / 9 s clamped to 15 and force-overrides Gemma's lyrics — never ask a small LLM to count.
- `spec.targetSec` is the aim; `spec.durationSec = renderCap(target, lyrics)` = `max(target, estimate) × 2 + 40`, ≤ 300, is the `max_duration` sent to ComfyUI. The cap only pre-allocates the AR encoder's KV cache (360 s left 141 MB free on 16 GB, hence 300). Encode final progress within 1 s (25 frames) of max ⇒ truncated ⇒ `song.hit_ceiling`.
- Progress: the AR encoder emits WS `progress` with `max = max_duration × 25` and `data.node = "encode"`; KSampler emits `node = "sample"`. `ProgressTracker` keys ETAs by node. Node ids in the graph are stable strings mapped in `NODE_PHASES` — renaming one silently degrades progress text.
- KSampler `steps` touches only the diffusion pass (timbre, clarity); the composition is fixed upstream by seed + inputs. Defaults live in `RENDER_STEPS` (`fast` 40 for new songs, `enhanced` 80). "Enhance quality" re-renders at 80 with the saved codes forced and lands as a new version beside the original, like any remix — it briefly replaced the original in place, but listening found 80 steps usually, not always, better (it can over-sharpen some instruments), so both takes are kept and the button confirms before starting. `enhanceSong` returns the in-flight take (`isEnhanceOf`: same parent, same seed, ≥ 80 steps) instead of queuing a duplicate. It cannot skip the encode stage: the DiT consumes the encoder's live hidden states, which are never stored — and the encode node's inputs differ (codes prefix, save prefix), so ComfyUI's output cache never helps.
- `SaveAudioAdvanced`: `format: "mp3"` + dotted sub-input `"format.quality": "V0"|"128k"|"320k"`. History output subfolder uses backslashes; `/view` accepts both.
- Seeds are TEXT end-to-end, app-generated < 2^53. Same seed feeds encoder and KSampler. `max_duration` grid is 0.04 s (25 fps, 9000-frame hard limit). Tiled VAE decode is the hard default.

**Composition codes / teacher forcing**
- The composition is the AR code matrix (8 RVQ codes per 40 ms frame, u16-safe, ~100 KB per 4-min song), saved as `library/songs/<id>.codes.bin`.
- Same seed + same inputs ⇒ bit-identical codes. With `kv_capacity_frames` pinned, changing `max_duration` leaves the shared prefix bit-identical (keep the pin). Forcing the full matrix + a higher cap = a bit-exact continuation ("Let it finish"). With an edited lyric the forced prefix holds but generation diverges at the first free frame — there is no re-locking, so everything to keep must be inside the prefix (`editPrefixFrames` cuts at the edited section, erring early).

**llama-server**
- Context is fixed at launch (`-c 16384`); no per-request knob. Vision goes in the OpenAI content array as `{type:"image_url", image_url:{url:"data:image/jpeg;base64,…"}}` *before* the text part.
- Constrained JSON is `response_format: {type:"json_schema", schema}` (llama.cpp's flat shape, not OpenAI's nested one). String `maxLength` is grammar-enforced — keep bounds on every string field (an unbounded compose rambled for 191 s).
- `/health` returns 503 while loading (~10–20 s). Awaiting process exit is the VRAM-clear guarantee.
- Ollama's `/v1` is not a substitute in dev: it silently ignores context length (4K default) and guide-sized prompts overflow it.

**Tauri v2**
- Plugin commands need entries in `src-tauri/capabilities/default.json`; without them `Database.load` hangs at "Starting engine…". Restart `tauri dev` after editing capabilities.
- Native file drops are intercepted: use `getCurrentWebview().onDragDropEvent`, never HTML5 `onDrop`.
- `convertFileSrc` yields `http://asset.localhost/…` on Windows; the CSP must allow it in `img-src`/`media-src`. The CSP has no `blob:`, so canvas previews use `data:` URLs, and never `drawImage` from asset.localhost (taints the canvas).

## Conventions

- SQL: `?` placeholders, TEXT UUID ids from `newId()`. The full spec is denormalized as `spec_json` on the `song` row; remix/re-run reads it back, so keep it in sync with the columns.
- Engine → UI is events only (`Engine.on`). Keep the `refreshSeq` out-of-order guard in the store.
- Classic JSX runtime (`import React`). `tsconfig.test.json` adds `@types/node`; the app tsconfig excludes `src/engine/__tests__`. Path aliases (`@engine`, `@adapters`, `@state`, `@ui`) live in `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts` — update all three.
- Copy follows the design-kit voice: no *VRAM / inference / model / render / prompt / generate* in primary UI; the engine is "the studio"; sentence case except eyebrow labels and "Create My Song".
- **Privacy by construction — keep it that way.** Photos are read as base64 solely for the local LLM call; `buildGraph` has no photo input; production CSP allows no remote hosts; both servers bind 127.0.0.1; the native bridge accepts only plain `http://`/`ws://` to loopback, follows no redirects, uses no system proxy; `http_download` writes only library-relative paths. Every python/uv child gets `scrub_inherited_env`. The setup downloader is the one deliberate exception (manifest-pinned URLs on `allowedHosts`, https-only hops).
- Releases are built and signed locally. `npm run tauri build` is unsigned by default; signing is a local, uncommitted `bundle.windows.signCommand`. There is deliberately no release workflow. Exported MP3s carry an ID3 AI-disclosure comment.
