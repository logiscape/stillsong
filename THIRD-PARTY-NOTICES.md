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

### ComfyUI-Stillsong2 (first-party, derived from ComfyUI)

The app also carries Stillsong 2's own ComfyUI node package
(`comfy-nodes/ComfyUI-Stillsong2`, compiled into the binary and written into
the studio's `custom_nodes` folder at each start). One of its files,
`stillsong2_ar.py`, is adapted from `comfy/text_encoders/yue2.py` of
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) 0.42.4 (GPL-3.0),
modified on 2026-11-13; the modifications are marked in the file. The package
is GPL-3.0, like the rest of Stillsong. It is the only custom node package
the studio loads.

## Downloaded at first run (from upstream, never re-hosted by this project)

| Component | Source | License |
|---|---|---|
| [uv](https://github.com/astral-sh/uv) (pinned release) | GitHub | MIT / Apache-2.0 |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (pinned tag) | GitHub | GPL-3.0 |
| CPython ([python-build-standalone](https://github.com/astral-sh/python-build-standalone), pinned build) | GitHub (astral-sh) | PSF-2.0 (CPython); the build scripts are MPL-2.0 |
| Python packages incl. PyTorch CUDA wheels — every wheel pinned by URL and SHA-256 in `components.json`; the full per-package list with licenses is generated into [docs/THIRD-PARTY-PYTHON.md](docs/THIRD-PARTY-PYTHON.md) | PyPI (`files.pythonhosted.org`) / download.pytorch.org | Per-package licenses (read from each wheel's own METADATA). The CUDA runtime libraries inside the PyTorch wheels are governed by the **NVIDIA CUDA Toolkit EULA** (redistributable attachment); they are fetched from PyTorch's own published wheels and never re-hosted by this project. |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) win-cuda build + CUDA runtime zip (pinned release) | GitHub | MIT (llama.cpp); NVIDIA CUDA EULA (cudart, from ggml-org's published release) |
| YuE2 3B weights (`Comfy-Org/YuE2` repack of [m-a-p/YuE2-3B](https://huggingface.co/m-a-p/YuE2-3B), `checkpoints/yue2_3b_int8_convrot.safetensors`) | Hugging Face | **CC BY-NC 4.0 with the YuE2 authors' additional creator permission**, per the project's [`MODEL_LICENSE`](https://github.com/multimodal-art-projection/YuE/blob/cbb3b060725ddd95ac6e6237cfb709e153da5988/MODEL_LICENSE) (2026-09-16; both Hugging Face repositories carry only a `cc-by-nc-4.0` tag). The permission lets "personal users, content creators and musicians acting in an individual capacity" use the weights free of charge to generate outputs and "publish, distribute, sell, license or otherwise monetize those outputs", on the condition of responsible use (no illegal, harmful, deceptive or otherwise unethical purposes). It "does not authorize commercial use of the model weights by companies" (they must contact the authors for a commercial license) and "does not extend to commercial redistribution or sale of the model weights". It also states: "Generated outputs are not subject to the model weights' NonCommercial restriction solely because they were generated with YuE2." Crediting YuE2 (or #YuE2) on shared work is encouraged and optional. Stillsong 2 never redistributes the weights from this repository (setup downloads them from Hugging Face); it credits YuE2 on the About screen and writes an AI-disclosure comment into every exported MP3. The YuE2 code, agent skill and documentation are Apache-2.0; ComfyUI's YuE2 implementation is part of ComfyUI (GPL-3.0). |
| Gemma 4 12B GGUF weights (`ggml-org/gemma-4-12B-it-GGUF`) | Hugging Face | **Apache 2.0** ([ai.google.dev/gemma/apache_2](https://ai.google.dev/gemma/apache_2)). Gemma 4 is the first Gemma generation released under Apache 2.0; earlier generations' Gemma Terms of Use do not apply to it. |

## App icon

The application icon (`src-tauri/icons/icon.png` / `icon.ico`) is original to
this project — procedurally drawn (flat shapes via a one-off Pillow script),
with no external artwork, fonts, or stock assets. It is covered by the
project's GPL-3.0 license like the rest of the repository.

## Example songs

The three songs a new library starts with (`examples/`: two photographs, one
sketch, and the songs Stillsong made from them) are first-party: the pictures
were taken and drawn by the Stillsong author, and the songs were written by
Gemma 4 in Stillsong and performed locally by YuE2. They are © 2026 Logiscape LLC and released under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — see
[examples/LICENSE.md](examples/LICENSE.md). The MP3s carry the same
machine-generated disclosure comment that *Save a copy* writes, and their
photos carry no camera metadata.

## Your songs

Songs you create with Stillsong are yours. Neither this project nor the model
providers claim ownership of your outputs. As an individual you may publish and
monetize them under YuE2's creator permission (above); a company using YuE2
commercially needs its own license from the YuE2 authors. If you share them
publicly, please keep the machine-generated disclosure with them (exported files
already carry it) — YuE2 does not require it, but it is how Stillsong asks its
songs to travel.
