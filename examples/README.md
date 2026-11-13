# Example songs

The three songs a fresh Stillsong 2 library starts with, so a new user has
something to listen to and remix before making their own.
The app bundles this folder as a resource and imports it once into an empty
library (`src/engine/examples.ts`); after that they are ordinary songs.
Deleting one is permanent, and a library that already has songs never receives
them.

| Song | Picture | Length | Notes |
|---|---|---|---|
| Where the Old Gods Stood | `moonlit-forest.jpg` — a photo of bare trees around the moon | 5:08 | symphonic metal, male vocal |
| Iron Ghost | `roller-coaster.jpg` — a photo of a coaster over still water | 4:52 | symphonic folk-metal, female vocal |
| The Last Ember | `spark.png` — a sketch drawn in Stillsong: one white speck on black | 3:16 | medieval ballad, male vocal |

Every song ships with its MP3 (V0) and, in `examples.json`, the full song spec,
the melody plan it performed (`abc`, so "Keep melody" remixes work on it), and
the cached picture analysis the songwriter wrote. Each also ships its take
(`<name>.take.safetensors`: the music tokens and final latent of that exact
recording), so a remix that only rewords some lines can keep the rest of the
recording. `node scripts/example-takes.mjs` makes them, and writes one only
when the song it performs is byte-identical to the shipped MP3.

## Provenance

The two photographs were taken by the Stillsong author on an iPhone; the sketch
was drawn by the author in Stillsong's sketchpad. The songs were written and
rendered entirely on the author's PC (Gemma 4 wrote the captions and lyrics in
Stillsong; YuE2 wrote the melody plans and performed the audio, with exactly
the graph and settings Stillsong 2 uses: the int8 checkpoint, a full melody
plan, 32 steps, the 500 s cap). Where the Old Gods Stood and The Last Ember use
the same captions and lyrics as Stillsong 1's examples; Iron Ghost uses another
take Gemma wrote for the same photo.

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
except the photo; no `abc`), `actualSec`, `hitCeiling`, the `photo` (file,
`source` photo/drawing, and the cached `analysis` card), the `audio` file name
and the performed plan as `abc`. To replace a song: render it in Stillsong 2,
copy the MP3 from the library and its `plan_abc`, strip and downscale the
photo, write the disclosure comment into the MP3, and edit the manifest. Keep the folder small;
it ships inside the installer.
