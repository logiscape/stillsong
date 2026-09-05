One-line: the Sanctuary grid card — audition without leaving the grid, click anywhere else to enter the Song view.

```jsx
<SongCard photo={t.thumb} title="Harbour, Nearly Dark" genre="slow folk ballad"
  length="2:14" date="12 March" versions={3} playing={id===nowPlaying} onPlay={…} onOpen={…} />
```

The play affordance fades in on hover and stays visible while playing. One shared audio element app-wide: starting one card stops any other. Never show a render-time stat.
