# Third-party notices

Stillsong is GPL-3.0 (see [LICENSE](LICENSE)). It builds on, bundles, or
downloads at first run the components below. **No model weights are ever
included in this repository or in the installer** — the app downloads them from
their upstream sources, with the user's consent, at first run.

## Bundled in the application

The full license and notice texts for everything compiled into the app — every
bundled npm package, every linked Rust crate, and the vendored fonts — are in
[THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt) (regenerate with
`npm run licenses` after dependency changes). The file ships inside the app
and is viewable from the About screen. Summary:

| Component | License |
|---|---|
| [Tauri](https://tauri.app) (and Tauri plugins: sql, dialog) | MIT / Apache-2.0 |
| [React](https://react.dev) | MIT |
| [reqwest, tokio, tokio-tungstenite, serde, sha2, base64, image, zip, flate2, tar, id3, win32job, windows-rs] (and transitive crates) | MIT / Apache-2.0 (per crate) |
| [Lucide](https://lucide.dev) icons (via lucide-static) | ISC |
| [Newsreader](https://fonts.google.com/specimen/Newsreader), [Source Sans 3](https://fonts.google.com/specimen/Source+Sans+3), [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) (vendored latin subsets; upstream OFL texts alongside the fonts in `src/ui/fonts/`) | SIL Open Font License 1.1 |

## Downloaded at first run (from upstream, never re-hosted by this project)

| Component | Source | License |
|---|---|---|
| [uv](https://github.com/astral-sh/uv) (pinned release) | GitHub | MIT / Apache-2.0 |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (pinned tag) | GitHub | GPL-3.0 |
| CPython ([python-build-standalone](https://github.com/astral-sh/python-build-standalone), pinned build) | GitHub (astral-sh) | PSF-2.0 (CPython); the build scripts are MPL-2.0 |
| Python packages incl. PyTorch CUDA wheels — every wheel pinned by URL and SHA-256 in `components.json`; the full per-package list with licenses is generated into [docs/THIRD-PARTY-PYTHON.md](docs/THIRD-PARTY-PYTHON.md) | PyPI (`files.pythonhosted.org`) / download.pytorch.org | Per-package licenses (read from each wheel's own METADATA). The CUDA runtime libraries inside the PyTorch wheels are governed by the **NVIDIA CUDA Toolkit EULA** (redistributable attachment); they are fetched from PyTorch's own published wheels and never re-hosted by this project. |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) win-cuda build + CUDA runtime zip (pinned release) | GitHub | MIT (llama.cpp); NVIDIA CUDA EULA (cudart, from ggml-org's published release) |
| MiniMax-Music3 weights (`Comfy-Org/MiniMax-Music-3` repack) | Hugging Face | **MiniMax-Music3 Community License.** The repack repository is tagged apache-2.0; that tag is a mislabel — the weights remain governed by the MiniMax-Music3 Community License published with the original model ([MiniMaxAI/MiniMax-Music3](https://huggingface.co/MiniMaxAI/MiniMax-Music3)), whose text applies per its §1 notice requirement. Its UI-display clause applies to commercial products; Stillsong is a free GPL application and credits MiniMax-Music3 on the About screen regardless. Its acceptable-use policy requires publicly shared AI-generated content to be disclosed as machine-generated — Stillsong writes that disclosure into every exported MP3 automatically. |
| Gemma 4 12B GGUF weights (`ggml-org/gemma-4-12B-it-GGUF`) | Hugging Face | **Apache 2.0** ([ai.google.dev/gemma/apache_2](https://ai.google.dev/gemma/apache_2)). Gemma 4 is the first Gemma generation released under Apache 2.0; earlier generations' Gemma Terms of Use do not apply to it. |

## App icon

The application icon (`src-tauri/icons/icon.png` / `icon.ico`) is original to
this project — procedurally drawn (flat shapes via a one-off Pillow script),
with no external artwork, fonts, or stock assets. It is covered by the
project's GPL-3.0 license like the rest of the repository.

## Your songs

Songs you create with Stillsong are yours. Neither this project nor the model
providers claim ownership of your outputs. If you share them publicly, keep the
machine-generated disclosure with them (exported files already carry it).
