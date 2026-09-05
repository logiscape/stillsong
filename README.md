# Stillsong

**Draw a picture or take a photo. Create a song that tells its story.**

[![CI](https://github.com/logiscape/stillsong/actions/workflows/ci.yml/badge.svg)](https://github.com/logiscape/stillsong/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey.svg)

Stillsong is a Windows desktop app that turns a picture into an original song.
A songwriter looks at your picture and writes lyrics about what it sees; a
composer performs them as finished music. The result plays in a full-screen
listening sanctuary where the picture fills the room and the lyrics drift over it.

Both the songwriter and the composer are open models, and both of them live on
your own PC. Stillsong installs like any other Windows program, fetches what
it needs during setup, and then never connects to the internet again. Your pictures
and songs stay with you.

<!-- Screenshot or short clip of the Sanctuary goes here once a release build is captured. -->

> **Status: pre-release.** The complete loop works end to end on the
> installed app: first-run setup on a clean machine, photo in, song out,
> sanctuary, remix, export. What remains before the first public release is
> listed under [Roadmap](#roadmap).

## Why Stillsong

Stillsong is driven by your creativity. It runs entirely on your own PC,
and your art always remains yours.

- **Driven by your creativity.** Stillsong encourages people to be creative.
  Draw a picture or upload a photo to create music that reflects your own
  original ideas. Even minor details can influence the story.
- **A normal Windows install.** A familiar setup wizard downloads the models
  and runtimes, checks every file against a pinned hash, and resumes on its
  own if the connection drops. The uninstaller removes all of it again.
- **Private by construction, not by promise.** After setup, the app has no
  network code path left to use. Nothing you make is uploaded, analysed, or
  used to train anything. [Here is how to verify that yourself](docs/OFFLINE-VERIFICATION.md).
- **Yours.** Songs you create belong to you.

## What it does

- **Create.** Choose a photo, or draw one in the built-in sketchpad. Pick
  instrumental, female or male vocals, optionally nudge the genre or mood, and
  choose the lyrics language. The songwriter studies the picture, writes a
  caption and lyrics, and the composer records the song. A seven-stage status
  view keeps you company while it works.
- **Listen.** The Sanctuary is a full-screen player: photo as the room, lyrics
  as a drifting sheet, glass controls. Remixes and continuations of a song
  are kept together as versions so you can audition takes side by side.
- **Remix.** Edit the lyrics or caption and record a new version. When the
  seed is kept, everything before your first edit is reproduced note for note
  and the song only changes from there.
- **Save.** Export an MP3 to listen or share, with an ID3 tag providing trust
  and transparency.

## How it works

Two open-weight models do the creative work, each run by a well-known
open-source engine that Stillsong bundles and supervises for you:

| Role | Model | Engine |
|---|---|---|
| Songwriter (looks at the photo, writes caption + lyrics) | [Gemma 4 12B](https://huggingface.co/ggml-org/gemma-4-12B-it-GGUF) | [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) |
| Composer (renders the music) | [MiniMax Music 3](https://huggingface.co/Comfy-Org/MiniMax-Music-3) | [ComfyUI](https://github.com/comfyanonymous/ComfyUI), headless |

Both engines are started as child processes bound to `127.0.0.1` only, tied
to the app with a Windows Job Object so they can never outlive it, and never
share the GPU at the same time. The photo is shown to the songwriter and to
nothing else: the render graph has no image input at all.

The app itself is a [Tauri v2](https://tauri.app) shell (Rust) around a React
interface. The engine is a pure TypeScript core with every side effect behind
an interface, which is what lets the whole pipeline be tested with in-process
fakes and no GPU.

## System requirements

- Windows 10 or 11, 64-bit
- An NVIDIA graphics card with at least 8 GB of VRAM
  - 16 GB or more creates songs at full speed (a 20-second draft in roughly
    25 seconds; a full song in a few minutes)
  - 8 to 16 GB produces identical songs, several times slower. This tier was
    measured under emulation on a 16 GB card (see
    [docs/PATIENT-TIER-MEASUREMENT.md](docs/PATIENT-TIER-MEASUREMENT.md));
    if it behaves differently on your card, please open an issue
- 32 GB of system RAM recommended for the 8 to 16 GB tier. It is not required:
  Stillsong streams from disk when memory is tight, so leave Windows virtual
  memory enabled
- About 40 GB of free disk space for the one-time component download (roughly
  25 GB is downloaded). The setup wizard lets you put the components on
  another drive

## Installing

> **Compiled installer coming soon.** The project is in pre-release. Once the
> first release is tagged, you will be able to install it using the instructions
> in this section. In the meantime, you can compile from source following the
> steps in the Development section below.

Download the latest installer from the
[Releases page](https://github.com/logiscape/stillsong/releases) and run it.
It installs per user, without administrator rights, and is small: no models or
runtimes are inside it.

On first launch the setup wizard checks your hardware, explains what it is
about to download and from where (the models from Hugging Face, the runtimes
from GitHub, PyPI and PyTorch), lets you pick a location, and fetches
everything. You can close the app mid-download; it picks up where it left off.
When it finishes, the app warms up the models once and you are ready to write
your first song.

Uninstalling through Windows removes the app, the runtimes and the models. It
asks whether to keep your song library; anything you exported with *Save a
copy* is untouched wherever you saved it.

## Privacy

Stillsong makes exactly two kinds of network requests, ever: the Windows
WebView2 bootstrapper during install (only if WebView2 is missing, which on
Windows 10/11 it almost never is), and the component download you start from
the setup wizard. Every file in that download — models, runtimes, the Python
interpreter and every Python package — is pinned by exact URL, size and
SHA-256 in [`components.json`](components.json); the downloader only starts a
connection to one of the four hosts named there, follows their redirects only
over https, accepts no more bytes than the pinned size, and discards anything
whose hash does not match. No package resolver ever runs on your machine: the
Python environment is assembled offline from the verified files.

After that there is no updater, no telemetry and no remote host the interface
is even permitted to contact: its only network bridge refuses anything that
is not a loopback address. The full list of network touches, and a
step-by-step packet-capture check, are in
[docs/OFFLINE-VERIFICATION.md](docs/OFFLINE-VERIFICATION.md).

### What is inside a saved song

Every MP3 carries a small text tag written by the renderer: the complete
recipe for the song. That is the caption and lyrics the songwriter wrote, the
seed, the length cap and sampler settings, the model file names, and, for a
song that continues an earlier take, the composition codes of the part being
continued. With the same models, that recipe re-creates the audio exactly.

It never contains the photo or drawing, or anything made from its pixels. It
carries no title, no name and nothing about your computer. The caption and
lyrics do describe the picture in words, so anyone with the file can read what
the song is about. *Save a copy* adds one more tag, a comment reading
"AI-generated music (MiniMax-Music3), created locally with Stillsong". If you
would rather share a song without its recipe, any tag editor can remove the
`prompt` tag; keep the disclosure comment if you share publicly.

## Development

Stillsong is built with Node 22, Rust (stable) and the standard
[Tauri v2 prerequisites for Windows](https://tauri.app/start/prerequisites/)
(Microsoft C++ Build Tools and the WebView2 runtime).

```
npm install
npm test              # unit tests: in-process fakes, no GPU or services needed
npm run typecheck     # both tsconfigs
npm run tauri dev     # run the app against Vite on :1432
npm run tauri build   # produce the (unsigned) NSIS installer
```

The dev build is fully self-hosted: on first run it walks the same setup
wizard as the installed app and spawns its own ComfyUI and llama-server from
the components folder. If you already have a ComfyUI or llama-server running,
point the app at them instead of spawning its own:

```
STILLSONG_COMFY_URL=http://127.0.0.1:8000   # treat this ComfyUI as external
STILLSONG_LLM_URL=http://127.0.0.1:8081     # same for an already-running llama-server
STILLSONG_COMPONENTS=D:\path\to\components  # use a different components dir
```

Only one process should hold the GPU at a time, so do not run the app
alongside a standalone ComfyUI that is also rendering.

### Live tests

`npm run test:live` runs the end-to-end suite against a real ComfyUI on
`:8000` (short draft renders, a few minutes). `scripts\dev-comfy.ps1` launches
the components copy of ComfyUI standalone with the same interpreter and flags
the supervisor uses. See [CLAUDE.md](CLAUDE.md) for the engineering notes,
including the measured facts about the music model that the code depends on.

### Repository layout

```
src/engine/        pure TypeScript core: domain, cowriter (LLM), comfy (graph + codes),
                   orchestrator (pipeline, VRAM arbiter), repos; all I/O behind ports.ts
src/adapters/      Tauri implementations of the engine ports
src/state/         UI store
src/ui/            React interface: screens, design-system components, vendored fonts
src-tauri/         Rust shell: process supervisor, downloads, GPU detection, installer hooks
comfy-overlay/     first-party ComfyUI custom node (composition capture and continuation)
components.json    pinned manifest of everything first-run setup downloads, incl. the Python lock
scripts/           dev ComfyUI launcher, overlay install/smoke tests, measurement tools,
                   the Python lock generator and manifest checker
docs/              offline verification, low-VRAM measurement report, Python package notices
```

### Building a release

`npm run tauri build` produces an installer at
`src-tauri/target/release/bundle/nsis/`. That is the whole build and it is
all a fork needs; models and runtimes are downloaded by first-run setup, never
bundled.

Official releases are built the same way and then code-signed, which is what
keeps Windows SmartScreen quiet. Tauri supports any signing tool through
`bundle.windows.signCommand` in `tauri.conf.json`; the repository ships
without one so that building does not require a certificate. If you sign your
own builds, add that setting locally rather than committing it.

Before tagging a release, run `npm run licenses` if dependencies changed (it
regenerates `THIRD-PARTY-LICENSES.txt`, which ships inside the app). If the
pinned ComfyUI or a Python constraint changed, run `npm run lock:python` (it
resolves ComfyUI's requirements once, downloads and hashes every wheel, and
rewrites the `python.wheels` section of `components.json` plus
`docs/THIRD-PARTY-PYTHON.md`), then `npm run check:manifest`. Tag
the exact commit that was built. The installer is GPL-3.0, and the tag is what
makes the matching source available for every binary.

## Roadmap

Remaining before the first public release:

- A signed installer
- A final design-review and keyboard-accessibility pass over the interface

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm test` and
`npm run typecheck`; CI runs the same plus `cargo test` for the Rust shell.
Bug reports are most useful with the GPU, VRAM and RAM filled in, since the
8 to 16 GB tier has only been measured under emulation and real cards are how
that gets confirmed.

A few principles the project holds to, so PRs that cross them will be
discussed rather than merged:

- No network activity after setup. No updater, no telemetry, no remote fonts.
- Official ComfyUI nodes plus our own vendored overlay only; no third-party
  custom nodes.
- The engine stays pure and testable without a GPU.

## FAQ

**Who owns the songs?** You do. Neither this project nor the model providers
claim ownership of what you create.

**Can I share them?** Yes. You can export your songs as MP3 files, and share them
however you wish. Your content belongs to you.

**Does it work on AMD or Intel graphics, or on a laptop without a dedicated GPU?**
Not today. Both engines are run with CUDA, and the first-run check requires an
NVIDIA card with 8 GB or more.

**Why is the download so large?** It is two full AI models (about 14 GB of
weights) plus their runtimes, including PyTorch with CUDA. Everything is
fetched from the upstream projects directly, never re-hosted here.

## License

Stillsong is free software under the
[GNU General Public License v3](LICENSE). Third-party components and their
licenses are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), with
full notice texts in [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).

Model weights are downloaded by the user from their upstream sources at first
run and are governed by their own licenses: the MiniMax-Music3 Community
License and, for Gemma 4, [Apache 2.0](https://ai.google.dev/gemma/apache_2).

Music composed locally by MiniMax-Music3. Lyrics by Gemma 4. Engines: ComfyUI
and llama.cpp. A [Logiscape](https://github.com/logiscape) project.
