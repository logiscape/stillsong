One-line: the vertical stage list shown while a song is being made — plain-language stages, one breathing marker.

```jsx
<StageList activeIndex={4} />
<StageList stages={CREATION_STAGES.filter(s=>!["look","write"].includes(s.id))} activeIndex={1} />
```

Stage copy is canonical: wording may be refined, granularity may not. Needs `@keyframes ss-breathe{0%,100%{opacity:.55}50%{opacity:1}}`. Never surface engine words (VRAM, model, render, inference).
