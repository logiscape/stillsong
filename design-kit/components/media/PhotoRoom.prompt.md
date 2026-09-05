One-line: full-bleed photo backdrop with the adaptive scrim — the shell of the Song view.

```jsx
<PhotoRoom photo={song.photo} luminance={song.lum} scrim="vertical" kenBurns={!reduceMotion}>
  <LyricSheet … />
</PhotoRoom>
```

Requires the `ss-kenburns` keyframes (declare once per page: `@keyframes ss-kenburns{from{transform:scale(1)}to{transform:scale(1.035)}}`). Luminance comes from the import-time sample, never from JS at render.
