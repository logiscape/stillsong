# UI kit — Stillsong (desktop app)

A click-through recreation of the whole app, composed entirely from this design system's
components. Open `index.html`.

| File | Surface |
|---|---|
| `AppFrame.jsx` | Tauri window chrome: title bar + 72px nav rail. Hidden on Song view and first run. |
| `CreateScreen.jsx` | Photo well → voice → quiet options → one primary button; the seven-stage status experience with the title-reveal beat; the failure state with a "details" disclosure. |
| `SanctuaryScreen.jsx` | Photo-dominant grid, card audition player, versions expanded inline, quiet search, empty state. |
| `SongScreen.jsx` | The photo as the room: scrim + lyric sheet, transport, overflow rail, cut-off note, solid-panel mode, delete confirmation. |
| `RemixScreen.jsx` | Title / caption / tag-highlighted lyrics editor, lint list, seed choice, collapsed Advanced, read-only derived cap. |
| `FirstRunScreen.jsx` | All six steps, plus the 8 GB interstitial, the below-floor refusal, and download paused/resumed. |
| `SettingsScreen.jsx` | Minimal settings and the dignified credits block. |
| `data.jsx` | Demo songs. Photos are placeholders from picsum.photos — swap for real imagery. |

Demo affordances are labelled `(demo: …)` in the UI and should not ship.
