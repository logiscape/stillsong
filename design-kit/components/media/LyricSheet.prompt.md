One-line: the lyric column — the story, readable over any photo.

```jsx
<LyricSheet title="Harbour, Nearly Dark" stanzas={parseLyrics(raw)} />
<LyricSheet title="Long Field, Rain" instrumental epigraph="A wet field at the edge of evening." mode="solid" />
```

Never render `[verse]` / `[chorus]` tags here (they belong in Remix). Instrumental songs show no lyric text at all. Text colour is fixed light — adapt the scrim, never the type.
