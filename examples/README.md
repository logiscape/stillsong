# Example songs

The three songs a fresh Stillsong library starts with, so a new user has
something to listen to, remix, continue, and enhance before making their own.
The app bundles this folder as a resource and imports it once into an empty
library (`src/engine/examples.ts`); after that they are ordinary songs.
Deleting one is permanent, and a library that already has songs never receives
them.

| Song | Picture | Length | Notes |
|---|---|---|---|
| Where the Old Gods Stood | `moonlit-forest.jpg` — a photo of bare trees around the moon | 3:12 | symphonic metal, male vocal |
| The Skeleton of the Sky | `roller-coaster.jpg` — a photo of a coaster over still water | 3:40 | dark folk, female vocal |
| The Last Spark | `spark.png` — a sketch drawn in Stillsong: one white speck on black | 2:40 | ambient piano, male vocal |

Every song ships with its MP3 (V0, 40 sampler steps, so "Enhance quality" has
somewhere to go), its SSC1 composition (`*.codes.bin`, so "Let it finish" and
same-seed lyric edits are exact), and, in `examples.json`, the full song spec
plus the cached picture analysis the songwriter wrote.

## Provenance

The two photographs were taken by the Stillsong author on an iPhone; the sketch
was drawn by the author in Stillsong's sketchpad. The songs were written and
rendered entirely on the author's PC with Stillsong (Gemma 4 wrote the captions
and lyrics, MiniMax-Music3 composed and performed the audio).

Before bundling, the photographs were downscaled to 2048 px and re-encoded
with all EXIF metadata removed (the colour profile is kept), and each MP3
received the same ID3 "AI disclosure" comment that *Save a copy* writes. The
MP3s also carry the renderer's `prompt` tag like any Stillsong song: the
recipe, never the picture.

## License

Everything in this folder is © 2026 Logiscape LLC and released under the
Creative Commons Attribution 4.0 International license (CC BY 4.0), separately
from the GPL-3.0 that covers the code. See [LICENSE.md](LICENSE.md).

## Updating

`examples.json` is the manifest: `version` (bump it when the set changes) and
one entry per song with a fixed `id`, the `spec` (everything in `SongSpec`
except the photo), `actualSec`, `hitCeiling`, the `photo` (file, `source`
photo/drawing, and the cached `analysis` card), and the `audio` and `codes`
file names. To replace a song: render it in Stillsong, copy the MP3 and
`.codes.bin` from the library, strip and downscale the photo, write the
disclosure comment into the MP3, and edit the manifest. Keep the folder small;
it ships inside the installer.
