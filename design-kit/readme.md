# Stillsong — "Twilight Gallery" design system

Stillsong is a Windows desktop app that turns a photo into a song that tells its story.
Everything runs locally: a photo is described, lyrics are written, a melody is composed and
performed, and the finished song lives in a gallery called **the Sanctuary**.

**Twilight Gallery** is its design language: a deep warm near-dark ground, matte
museum-wall surfaces, one warm metallic accent (brass), a serif display face for song
titles — they are *titles of works* — and a humanist sans for everything functional.
The photo is always the protagonist; the UI recedes.

## Sources given

- A written product + design brief (pasted into chat, 25 Aug 2026): product surfaces
  §4.1–4.7, design brief §5, legibility spec §5.3, voice & copy §5.4.
- The brief references a reference implementation by file and line —
  `CreateScreen.tsx:96–118`, `ReviewScreen.tsx`, `src/engine/cowriter/lyrics.ts:40`
  (`parseLyrics`), `genreTag(caption)`, `validateSpec`, `renderCap`, `ProgressTracker`.
  **That codebase was not attached and was not read.** Nothing here was recreated from it;
  component names and values below were authored from the brief.
- No Figma file, no slide deck, no logo or font files, no photography were provided.

### Substitutions (please confirm or replace)

| Thing | Used here | Why |
|---|---|---|
| Display serif | **Newsreader** (Google Fonts) | No brand font supplied. Warm literary serif with a light 300 weight for lyrics. |
| UI sans | **Source Sans 3** (Google Fonts) | Humanist, quiet, wide language coverage. |
| Mono | **IBM Plex Mono** | Timecodes, sizes, seeds, paths. |
| Icons | **Lucide** 0.454.0 via CDN, masked to `currentColor` | No icon set supplied. 1.5px stroke suits the quiet chrome. |
| Logo | **none — the name set in Newsreader 300** | No mark was provided and none was invented. See `guidelines/wordmark.card.html`. |
| Photography | `picsum.photos` seeds in demos | No real imagery supplied. |
| App icon / installer art (brief §5.2.7) | **not produced** | Would require drawing an original mark; needs your direction or a supplied asset. |

Fonts load via a Google Fonts `@import` in `tokens/fonts.css` rather than local
`@font-face` files — swap in licensed binaries when you have them; token names won't change.

## Content fundamentals

**Voice:** warm, plain, brief. A sanctuary, not a tool. Zero jargon — never *VRAM,
inference, model, render, prompt, generate* in primary UI. The engine becomes **the
studio**; work becomes **writing** and **composing**.

- **You, not I, and rarely we.** "Choose a photo." "Your song is being made."
  "Everything happens on your computer." *We* appears only when the app offers to do
  something on your behalf: "We can give it another half minute."
- **Sentence case everywhere.** Two exceptions: eyebrow labels (uppercase + `.14em`
  tracking, e.g. THE SANCTUARY) and the one Title Case button, **Create My Song**, which
  reads as a small ceremony.
- **Ellipses mean "in progress"**, and only there: "Looking at your photo…",
  "Finishing touches…". Never in body copy.
- **Em dashes for the quiet aside** — "An estimate — the words aren't timed to the music."
- **Errors: what happened, then one next step, apology-light.** "Something went wrong
  while writing your song. Nothing was lost — your photo and your choices are still here."
  → one **Try again**. Real error strings live behind a quiet `details` disclosure.
- **Refusals are kind and specific:** "Stillsong needs an NVIDIA graphics card with at
  least 8 GB of memory. This one has 6 GB." No workaround theatre, no blame.
- **Optional things sound invitational, not technical:** "Add a touch of direction
  (optional)". Advanced controls are simply "Advanced".
- **Numbers are plain and human.** Durations `2:14`; sizes "about 25 GB"; time left
  "about 6 minutes left"; dates "12 March". Never surface render time or step counts.
- **No emoji, anywhere.** No exclamation marks. No "AI", no "magic", no product-speak.
- **Credits are dignified prose, not a logo wall,** and only on About: "Music composed
  locally by MiniMax-Music3 · Lyrics by Gemma · Engines: ComfyUI, llama.cpp".
- **The seven stage strings are canonical** (see `components/feedback/StageList.jsx`).
  Words may be refined; the seven-stage granularity may not.

## Visual foundations

**Ground and surfaces.** One background family, warm near-black: `--ground` #100E0D with
`--ground-deep` for chrome and `--surface-1…4` stepping up in 8–10% increments. Matte —
no gradients on surfaces. The only gradients in the system are photo scrims and one
radial ambient wash behind a chosen photo.

**Ambient colour.** At import the engine samples each photo's dominant colour and average
luminance. The dominant colour is written to `--ambient` and used as a very low-contrast
radial wash behind the photo well and status screen; luminance is written to
`--photo-lum` and drives the scrim maths. This is the only place the palette moves.

**Colour.** One accent: brass (`--brass` #C0975F, text tint `--brass-200`). It marks
selection, progress, the single primary button and the play affordance. Semantics are
muted pigments, never signal lights: sage, amber, clay. Anything else is warm white at
4–28% opacity (`--wash-*`, `--line-*`) — that's how surfaces separate. No blue anywhere;
no purple gradients; nothing neon.

**Type.** Newsreader for titles, lyrics, dialog and section heads — 300 for lyrics
(26/1.62, 34ch measure), 400 for titles with `-.015em` tracking. Source Sans 3 15/1.5 for
body, 13.5 for quiet lines, 12 for card metadata; 500 for labels and buttons. IBM Plex
Mono for durations, sizes, seeds, paths. Serif and sans never mix inside one line.

**Layout.** 48px screen gutter, 24px panel padding, 20px grid gap, 40/48px control
heights, 44px minimum hit target. The Sanctuary is `auto-fill minmax(320px,1fr)`. Chrome
is fixed: a 38px title bar and a 72px icon nav rail — both disappear on the Song view and
during first run, where the photo owns the window. Text measures are capped (`52–62ch`
prose, `34ch` lyrics).

**Imagery.** User photos are never filtered, cropped creatively or colour-graded — only
`object-fit: cover`, a 12px radius, a deep soft shadow, and a scrim. Full-bleed in the
Song view; 4:3 thumbnails in the Sanctuary. Warm by accident, not by grade.

**Radii.** 3 / 6 / 10 / 12 (photos) / 14 / 20 / pill. Buttons 6px; panels 14px; photos and
cards 12px; players, badges and icon buttons are pills.

**Shadows.** Warm-black, deep, soft, never crisp: `--shadow-1` hairline chrome →
`--shadow-4` dialogs, plus `--shadow-photo` for photo cards. Inner shadow only on inset
fields (`--inset-field`). The one glow in the system is `--glow-brass` on focus and
selection.

**Transparency and blur.** Blur exists **only over photographs**: `--panel-blur`
(22px + saturate) behind lyric columns and the player, `--blur-chrome` (12px) for glass
icon buttons and badges. Never blur over the app ground — matte surfaces there.

**Protection.** Two strategies. Over photos: the luminance-aware scrim (a gradient) plus
an optional blurred panel, plus `--scrim-chrome-top/bottom` behind edge chrome. On cards:
a bottom scrim gradient, strengthened on hover. Capsules (glass badges) are used only for
small floating metadata.

**Motion.** Slow and serene; nothing bounces, nothing springs. `--dur-tap` 110 →
`--dur-base` 280 for state changes, `--dur-slow` 520 for reveals, `--dur-reveal` 880 for
the title-reveal beat (fade + 8px rise), `--dur-breath` 6.2s for the pulsing stage marker,
`--dur-kenburns` 150s for the photo's 1–2%/min drift. Easing is `--ease-out`
(.2,.8,.24,1) for interaction and `--ease-serene` (.32,.06,.24,1) for photo and reveal
motion. `prefers-reduced-motion` disables Ken Burns, auto-scroll and the drift animation.

**States.** Hover: surfaces step up one level and/or a hairline brightens (`line-1` →
`line-3`); ghost controls gain a 4% wash; cards lift 2px and the photo scales 1.03 over
520ms. Press: `scale(.985)`, no colour change. Selected: brass wash + brass hairline +
`--glow-brass`. Focus: 2px brass outline, 2px offset. Disabled: opacity .38, no colour
change. Nothing ever turns grey-blue.

**Legibility (hard requirement, §5.3).** Text over photos is *fixed* light
(`--lyric-text`), never theme-switched. The backing adapts:
`--scrim-alpha = .42 + luminance × .46`, so a black photo gets ~.49 and a near-white photo
~.88 over warm black `rgb(8,7,6)` — the composited backing stays at or below ~L*35, which
keeps #F5EEE6 above 4.5:1 in the worst case. Layer 2 adds the blurred panel; layer 3 is an
opaque `--panel-solid-bg` panel, user-selectable and auto-engaged under
`prefers-contrast: more`. See `guidelines/scrim.card.html`.

## Iconography

**Lucide** (0.454.0), pulled from `unpkg.com/lucide-static` and applied as a CSS
`mask-image` so every glyph inherits `currentColor` — this is what the `Icon` component
does. No hand-drawn SVG paths exist in this system, and none should be added; if a glyph
is missing, pick another Lucide name. Sizes: 16 inline, 18 UI, 22 player, 28–30 empty
wells. Stroke is Lucide's default 2 at 24px, which reads as a hairline at these sizes.

The working vocabulary: `image-plus` (choose a photo), `play` / `pause`, `volume-2` /
`volume-x`, `shuffle` (remix), `dices` / `lock` (seed), `download` (save a copy),
`folder-open`, `pencil-line` (rename), `trash-2`, `layers` / `disc` / `disc-3`
(versions), `audio-lines` (instrumental), `mic` (vocals), `search`, `chevron-down` /
`chevron-left` / `chevron-right`, `x`, `ellipsis`, `check`, `triangle-alert`, `info`,
`clock`, `settings`, `layout-grid`.

**No emoji, ever**, and no unicode glyphs standing in for icons — the one exception is the
middle dot `·` as a metadata separator. Icons are never the only carrier of meaning:
every icon-only control has a `label` (tooltip + aria-label).

## Index

Root
- `styles.css` — the single entry point consumers link. `@import` lines only.
- `readme.md` (this file), `SKILL.md`, `thumbnail.html`.

`tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `radius.css`,
`elevation.css`, `motion.css`, `scrim.css`, `base.css`.

`guidelines/` — 21 specimen cards: colours (ground, ink, brass, semantic, lines,
ambient), type (display, lyric, UI, labels, mono), spacing (scale, layout, radius,
elevation, motion), brand (legibility ladder, glass & blur, wordmark, iconography,
photo treatment).

### Components

`components/core/` — **Icon**, **Button**, **IconButton**, **Badge**, **Panel**
`components/forms/` — **TextField**, **Select**, **SegmentedChoice**, **Switch**, **Disclosure**
`components/media/` — **PhotoWell**, **SongCard**, **Player**, **LyricSheet**, **PhotoRoom**
`components/feedback/` — **StageList** (+ `CREATION_STAGES`), **ProgressBar**, **Notice**, **LintList**, **Dialog**

Each has a `.d.ts` props contract and a `.prompt.md` with usage. No source defined a
component inventory, so this set was authored from the brief's surfaces; every one of the
twenty appears in the UI kit.

**Intentional additions** (not named in the brief, needed to build it):
`Icon` (Lucide wrapper — keeps hand-drawn SVG out of the system), `Panel` (the shared
matte/glass/solid surface, which is where the legibility spec's layers 2 and 3 live), and
`PhotoRoom` (the scrim + Ken Burns shell, so layer 1 is never re-implemented per screen).

### UI kit

`ui_kits/stillsong-app/` — the full click-through app: Create (empty → chosen → options →
seven-stage status with the title reveal → failure), Sanctuary (grid, audition, versions,
search, empty), Song view (vocal / instrumental / cut-off / solid-panel / delete), Remix
(lint + tag-highlighted lyrics + advanced), First run (all six steps, hardware warn and
refusal, download paused), About/Settings. See its `README.md`.

## Not done

- App icon, installer sidebar/header art, shortcut icon (brief §5.2.7) — needs a supplied
  mark or your go-ahead to design one.
- Real photography, real fonts, real logo.
- Auto-scroll lyrics behaviour is specified in copy and settings but not animated in the kit.
