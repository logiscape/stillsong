# Verifying that Stillsong stays offline

Stillsong's privacy claim is structural, not a promise. This document lists
every network touch the app can make and how to verify there are no others.

## The complete list of network touches

1. **Installer**: the Microsoft WebView2 Evergreen bootstrapper runs *only if*
   WebView2 is missing (it is preinstalled on effectively every Windows 10/11
   machine, so this is normally a no-op).
2. **First-run setup**: after you click **Download**, components are fetched
   from the exact URLs pinned in `components.json`. Every one of those URLs
   is on a fixed allowlist of four hosts — `huggingface.co`, `github.com`,
   `files.pythonhosted.org` and `download-r2.pytorch.org` (`allowedHosts` in
   the same file) — and the Rust downloader refuses to *start* a connection
   anywhere else. Those hosts serve large files by redirecting to their
   content delivery networks (at the time of writing `*.hf.co` for Hugging
   Face and `*.githubusercontent.com` for GitHub); the downloader follows
   such a redirect only over https and only to a DNS name (never a bare IP
   address), and does not pin the CDN hostname, because CDN names change
   between releases and the app never updates itself — a pinned name would
   only turn a rename into a setup that fails. A redirect can therefore only
   complete to a host that holds a valid certificate for its name, and the
   app sends nothing on that connection except the request for the pinned
   file.
   What is pinned is the content: every file — including the Python
   interpreter and each Python wheel — has an exact size and SHA-256 in
   `components.json`; the downloader accepts no more bytes than that size
   and discards anything whose hash does not match, whichever host served
   it. Nothing is fetched before that click, and nothing is *resolved* on
   your machine: the Python environment is installed offline from the
   verified wheelhouse (`uv pip sync --offline --no-index --require-hashes`),
   so no package index is ever consulted.
3. **Nothing else, ever.** There is no updater in the build, no telemetry, and
   the downloader cannot be pointed at a URL the compiled-in manifest does not
   name. "Verify installation" only re-hashes local files.

## Why your content cannot leave

- Photos are read as base64 solely for the request to the **local**
  llama-server on `127.0.0.1`; the ComfyUI render graph has no photo input at
  all (`src/engine/comfy/graphBuilder.ts` — see for yourself).
- Both child servers bind loopback only (`127.0.0.1`, dynamic private ports);
  ComfyUI is launched without `--listen`, so Windows never even shows a
  firewall prompt.
- The window's web content runs under a Content-Security-Policy that allows no
  remote hosts (`src-tauri/tauri.conf.json`), so the UI cannot make a browser
  request to the internet.
- The only network path the interface has at all is a small native bridge
  (`src-tauri/src/http.rs`, `ws.rs`), and that bridge refuses every
  destination that is not plain `http://` or `ws://` to a loopback address
  (127.0.0.1, ::1, localhost), never follows a redirect, and can only write
  downloads inside the song library. So even code running inside the window
  has no way to reach a remote host through the app. First-run setup uses a
  separate, allowlisted downloader that is only reachable from the setup
  wizard.
- Child processes run with `HF_HUB_OFFLINE=1` and `DO_NOT_TRACK=1`, and
  ComfyUI is started with API nodes disabled.

## How to check with a packet capture

1. Finish first-run setup and create at least one song.
2. Start a capture (e.g. Wireshark on your active interface, filter:
   `ip.addr != 127.0.0.1 && tcp`), or add a Windows Firewall outbound-block
   rule for `Stillsong.exe`, `python.exe` and `llama-server.exe` under the
   components folder.
3. Use the app normally — create, listen, remix, export.
4. Observe: zero packets from Stillsong or its children to any non-loopback
   address. With the firewall rule in place, the app keeps working normally —
   nothing it does after setup needs the network.

## One honest caveat

The WebView2 runtime that renders the interface is owned and updated by
Windows itself (Microsoft's Evergreen channel). That OS-level updater is
outside any app's control and is not Stillsong traffic.
