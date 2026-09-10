# Physical release

Tooling to put Stillsong on a Blu-ray disc or a USB drive: the installer,
every component first-run setup would otherwise download, the license of
each, and the source. A PC that has never been online can install from it
and make songs indefinitely.

The release is symbolic more than practical. Almost everyone will download
the installer and let setup fetch the components. But the disc is the
project's principles made tangible: everything runs locally, nothing
updates itself, nothing is uploaded. It only works because those principles
are built into the architecture, and this directory is deliberately kept
apart from `src/` and `src-tauri/` so that it stays a *consumer* of that
architecture rather than a part of it.

**This directory changes nothing about the app, the installer, or the setup
wizard.** Read the "What the disc relies on" section before touching any of
those, because it lists the three facts about them the disc depends on.

## What is on the media

```
X:\
  autorun.inf              AutoPlay offer on optical drives (ignored on USB, by Windows design)
  Install-Stillsong.cmd    the one thing a user runs
  Verify-Disc.cmd          re-hashes every file on the disc
  README.txt               user-facing: requirements, steps, what is where
  SHA256SUMS               sha256sum-format hashes of everything
  Stillsong.ico
  setup\
    Stillsong_<ver>_x64-setup.exe    the ordinary NSIS installer, built with the offline WebView2 installer
    seed-components.ps1              copies + hashes components, records the folder, runs the installer
    verify-disc.ps1
    disc-manifest.json               every file with size + sha256 (what the two scripts read)
    components.json                  the pinned component manifest this build was made from
  components\              laid out exactly like the app's components dir (see below)
    _downloads\<archives>            uv, CPython, ComfyUI source, llama.cpp, cudart
    _downloads\wheelhouse\*.whl      the 85 pinned wheels
    models\*.gguf                    Gemma 4 (already at its install path)
    comfy-data\models\...            MiniMax Music 3 (already at its install path)
  licenses\                see collect-licenses.ps1
  source\                  git archive of the release commit (GPL-3.0 §6a)
```

## How an install from the disc works

1. The user runs `Install-Stillsong.cmd` (or accepts the AutoPlay offer on an
   optical drive). It launches `setup\seed-components.ps1` with PowerShell
   5.1, which every supported Windows has.
2. The script asks where the components should live (default:
   `%LOCALAPPDATA%\com.logiscape.stillsong\components`), checks free space,
   and copies each file from `components\` while hashing it, refusing any
   mismatch. From a 6x Blu-ray that is 15–30 minutes; from USB 3, a few.
3. It writes the chosen folder to `%APPDATA%\com.logiscape.stillsong\components-dir.txt`
   and the `HKCU\Software\Logiscape\Stillsong\ComponentsDir` registry value,
   exactly as the app's own "Where should they live?" step does.
4. It runs the NSIS installer, interactively, unchanged.
5. The user opens Stillsong. The wizard runs its normal steps; the folder is
   pre-selected; every "download" returns immediately because the file is
   already there; extraction, the offline `uv pip sync`, and the warm-up
   check run as they always do; `.install-complete` is written; the staged
   copies in `_downloads\` are deleted by the app's usual sweep.

Nothing on the disc is executed except the seed script and the installer.

### What the disc relies on

Three facts about the app. If any of them changes, `layout.test.mjs` or a
trial install will catch it, but the change should be made knowingly:

| Fact | Where | Why it matters |
|---|---|---|
| A file already at its destination is accepted as complete without a network request. | `downloads::fetch`, `src-tauri/src/downloads.rs` (`if dest.exists() { … return Ok(()) }`) | This is the whole mechanism. It also means the app never re-hashes a seeded file, so `seed-components.ps1` is the only integrity check the components get: it hashes while copying, and re-hashes anything already in the folder on a repeat run instead of trusting its size. "Verify installation" still re-hashes models afterwards. |
| Destinations are `_downloads/<url basename>` for archives (`%2B` → `+`), `<installPath>` for everything else, `<python.wheelhouse>/<filename>` for wheels. | `src-tauri/src/manifest.rs` (`download_dest`, `wheelhouse_dir`, `archive_basename`); mirrored by `lib/layout.mjs` | The staged tree must land byte-for-byte where the wizard looks. |
| The components dir is read at boot from `%APPDATA%\com.logiscape.stillsong\components-dir.txt` and shown pre-selected by the wizard. | `Supervisor::new` in `src-tauri/src/supervisor.rs`; `runtime_paths` → `SetupScreen` | Lets the user pick a second drive on the disc side without the wizard sending them elsewhere. |

Two known rough edges, both accepted rather than fixed to keep the online
process untouched:

- The wizard's free-space check (`REQUIRED_FREE_BYTES`, 40 GB) does not know
  the seeded 25 GB is already on the drive, so the disc's stated requirement
  is components + 40 GiB (about 68 GB today). `seed-components.ps1` checks for
  the same total before copying so the user is never stopped halfway.
- The wizard's copy still says the pieces are "downloaded once from Hugging
  Face, GitHub, PyPI and PyTorch". The disc README explains that step will
  simply finish at once.

## Requirements to build

- Windows 10/11 with the normal dev toolchain (Rust, Node 22, `npm install`
  done), plus `git` and the built-in `tar.exe`.
- ~55 GB free under `physical-release\out\` (25 GB staged components, and a
  25 GB `.iso` if you write one). The stage doubles as the download cache
  and survives runs.
- A Blu-ray recorder and blank **BD-R DL (50 GB)** media for burning. Use HTL
  (inorganic) or M-DISC discs, not LTH. Single-layer 25 GB discs are
  25,025,314,816 bytes; the current component set is 24,890,098,503 bytes,
  which leaves about 135 MB for everything else before file-system overhead.
  It fits today with the stock installer and nothing to spare, and the next
  manifest bump will not. The build refuses a medium the payload does not fit.
- For USB: a 32 GB or larger drive formatted **exFAT or NTFS** (FAT32 cannot
  hold the 9.2 GB text encoder).
- A code-signing certificate and the local, uncommitted
  `bundle.windows.signCommand`, as for any release. Sign with an RFC 3161
  timestamp so the signature outlives the certificate; an offline PC cannot
  check revocation and Windows tolerates that, but it does check the
  timestamp chain that was embedded at signing.

## Building

```powershell
# unit tests for the layout rules (fast, no network)
node --test physical-release/lib/layout.test.mjs

# everything, writing an .iso (reuse models from a local install to skip 22 GB of download)
.\physical-release\build-physical.ps1 -FromComponents "$env:LOCALAPPDATA\com.logiscape.stillsong\components" -Iso

# burn a disc from the already-assembled tree, then verify it
.\physical-release\make-image.ps1 -ListRecorders
.\physical-release\build-physical.ps1 -SkipBuild -Burn -RecorderIndex 0
powershell -File D:\setup\verify-disc.ps1

# a USB drive instead
.\physical-release\build-physical.ps1 -SkipBuild -Usb E: -VerifyDrive E:
```

The scripts, in the order the build runs them:

| Script | Does |
|---|---|
| `build-physical.ps1` | Orchestrates the steps below; refuses a dirty working tree (the source archive must correspond to the binary; `-AllowDirty` for local trials); prints the capacity table; writes `disc-manifest.json` and `SHA256SUMS`. |
| `tauri.physical.conf.json` | Merged over `tauri.conf.json` via `tauri build --config`. Only sets `webviewInstallMode: offlineInstaller` (+127 MB) so a PC without the WebView2 runtime can still install offline. Windows 11 ships the runtime and Windows 10 gets it from Windows Update, but a basement PC set up from old media might not have it. The web installer keeps `downloadBootstrapper`. |
| `stage-components.mjs` | Fetches every artifact in `components.json` into `out\stage\components\` in the app's layout: allowed-host check on the first hop, https-only redirects, Range resume, size cap, full sha256 before rename. `--from-components <dir>` copies matching files from an existing install first. `--check-only` reports missing or wrong files and changes nothing. Files an older manifest left in the stage are reported, never packaged. |
| `collect-licenses.ps1` | Builds `licenses\`: the repo's own license files; LICENSE/COPYING/NOTICE files found inside each runtime archive; each wheel's `.dist-info` license (or its METADATA when there is none) with an index; and the model/CUDA licenses pinned in `licenses.json`. |
| `make-image.ps1` | UDF 2.50 image via IMAPI2 (ISO 9660 cannot hold files over 4 GiB and IMAPI has no level 3), written to a file and/or a recorder with the session closed; or `robocopy` to an exFAT/NTFS USB drive. Two source roots: the disc root, and `out\disc-components`, which the build assembles from the manifest's files only, hard-linked from the stage so nothing is duplicated and nothing an older manifest left behind can ship. |
| `disc\` | Copied verbatim to the media root. `README.txt` has `{{PLACEHOLDERS}}` the build fills in. |

Burning through IMAPI2 has no progress display. Expect 20–40 minutes for
25 GB, then run `verify-disc.ps1` from the disc before labelling it.
Prefer a moderate write speed over the drive's maximum for archival media.

## Testing without a burner

1. `build-physical.ps1 -SkipBuild -AllowDirty -Iso` on a working copy.
2. `Mount-DiskImage out\Stillsong-<ver>.iso`, note the drive letter, and run
   `<drive>:\setup\verify-disc.ps1`. This proves the UDF image is complete
   and readable by Windows.
3. Full offline trial, in a VM or on a spare machine with the network
   disabled: run `Install-Stillsong.cmd` from the mounted image, then open
   Stillsong and let the wizard finish. Watch that the download step
   completes instantly and that `Verify installation` on the About screen
   passes.
4. Headless variant on the build machine: point the production first-run
   test at a copy of the seeded tree with the network unplugged:
   `STILLSONG_E2E_COMPONENTS=<copy of out\stage\components> cargo test first_run_headless`
   (in `src-tauri\`). It fetches nothing if the layout is right, then
   extracts, syncs Python offline, and imports torch with CUDA. Steps 1–4
   were run this way when the tooling was written: the image mounted as
   UDF, all 353 files verified in under a minute, and the headless first
   run finished in 50 s with every "fetch" returning at once.

## Licensing obligations the disc takes on

The online installer downloads components from their publishers; the disc
redistributes them. `THIRD-PARTY-NOTICES.md` says model weights are never
in the installer, which stays true, but a physical release is a new
distribution channel and its notice text should gain a section saying so
when the first disc ships. Per license:

- **GPL-3.0** (Stillsong; ComfyUI; `comfyui-embedded-docs`): object code on a
  physical medium must be accompanied by Corresponding Source (§6a) or a
  written offer good for three years (§6b). The build takes §6a: `source\`
  holds a `git archive` of the release commit, and ComfyUI is already on the
  disc as its source tarball. Keep the tree clean when building so the
  archive corresponds to the binary.
- **MiniMax-Music3 Community License**: §1 requires its notice with every
  copy (`licenses\models\MiniMax-Music3\`). The UI-display clause (§3.1) is
  for commercial products and the revenue threshold (§3.2) is $20M; neither
  applies to a free GPL app. The machine-generated disclosure the AUP asks
  for is already written into exported songs.
- **Gemma 4**: Apache-2.0; text plus a NOTICE are included.
- **NVIDIA CUDA runtime** (cudart zip from the llama.cpp release; DLLs inside
  the torch wheel): the CUDA EULA's Attachment A allows redistribution only
  as part of an application with material additional functionality, in
  object form, never stand-alone, under terms consistent with the EULA. A
  disc that is a Stillsong installer is that case. This is the one item the
  project has so far deliberately avoided re-hosting, so have it reviewed
  before the first disc leaves the building. The EULA PDF URL in
  `licenses.json` is unversioned; refresh its pin when NVIDIA republishes.
- **Python wheels**: 84 permissive plus the GPL one; license texts are
  extracted from the wheels themselves.
- **uv, CPython, llama.cpp**: permissive; texts extracted from the archives.

## What the disc cannot fix

- An NVIDIA driver too old for the CUDA 13 runtime. Drivers are not
  redistributable; the README states the requirement.
- The Visual C++ runtime, if a machine somehow lacks it. Same as the online
  install; not a new dependency.
- Windows itself refusing to run an unsigned installer. Sign it.

## Release checklist

1. `npm run check:manifest` passes and the manifest is the one you mean to
   ship. Commit; clean tree.
2. `build-physical.ps1 -Iso`. Read the capacity table. Confirm the installer
   signature line says `Valid`.
3. Mount the image and run `verify-disc.ps1`; do a full offline trial
   install on a machine that has never had Stillsong.
4. Burn (BD-R DL, HTL or M-DISC), re-insert, `verify-disc.ps1` again from
   the disc.
5. Label: app version, commit, components manifest version, burn date.
   Store discs vertically, in cases, away from heat.
6. Keep the `.iso` and its SHA-256 with the release notes.
