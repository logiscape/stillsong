STILLSONG {{VERSION}}
Turn a photo into a song. Entirely on your own computer.

This disc is the complete Stillsong studio: the app, and every component it
needs to write and perform songs. Nothing on it phones home, and nothing on
it updates itself. A computer with no internet connection can install it
today and still be making songs years from now.

    Built {{BUILD_DATE}} from Stillsong {{VERSION}} ({{COMMIT}}),
    component set {{MANIFEST_VERSION}}.


WHAT YOU NEED

  - Windows 10 or 11, 64-bit
  - An NVIDIA graphics card with at least 8 GB of memory, with a driver
    recent enough for CUDA 13 (a driver from 2025 or later). The driver is
    the one thing this disc cannot provide.
  - {{NEEDED_GB}} GB of free disk space: about {{COMPONENTS_GB}} GB for the
    components on this disc, plus the 40 GB of working room the setup
    wizard insists on before it unpacks them. Most of that comes back
    once setup finishes. You can put the components on a second drive.
  - 32 GB of system memory is recommended for cards with less than 16 GB.


HOW TO INSTALL

  1. Double-click  Install-Stillsong.cmd  on this disc.
     (If Windows offered to run it when you inserted the disc, that is
     the same thing.)

  2. Choose where the components should live, or press Enter for the
     usual place. The script copies them from the disc, checking every
     file as it goes. From a Blu-ray disc this takes 15 to 30 minutes;
     from a USB drive, a few minutes.

  3. The normal Stillsong installer runs next. Go through it as usual.

  4. Open Stillsong. Its setup wizard will find everything already in
     place, so the "download" step finishes in a moment, and then it
     unpacks and checks the studio. That takes a few minutes the first
     time. After that, Stillsong works completely offline, for good.

  If anything goes wrong, run  Verify-Disc.cmd  to check the disc itself.


WHAT IS ON THE DISC

  Install-Stillsong.cmd   Starts setup (step 1 above).
  Verify-Disc.cmd         Checks every file on the disc against its hash.
  README.txt              This file.
  SHA256SUMS              The hashes, in the usual sha256sum format.
  setup\                  The Stillsong installer ({{INSTALLER}}), the
                          setup script, and the exact list of components
                          with their hashes (components.json).
  components\             The studio: the songwriter model (Gemma 4), the
                          music model (MiniMax Music 3), the tools that run
                          them (llama.cpp, ComfyUI, Python), and every
                          library they depend on. All of it is exactly what
                          the online installer would download.
  licenses\               The license of every one of those components.
  source\                 The complete source code of Stillsong, which is
                          free software under the GNU GPL version 3.


A NOTE ON PRIVACY

  Stillsong never uploads your photos or your songs. It cannot: the app
  contains no address to send them to, and the two engines it runs are
  bound to your own computer. If you want to share a song, use "Save a
  copy" and share the file yourself. Exported songs carry a small note in
  their metadata saying they were made with AI, as the music model's
  license asks.

  Stillsong is a project of Logiscape LLC.
  https://github.com/logiscape/stillsong
