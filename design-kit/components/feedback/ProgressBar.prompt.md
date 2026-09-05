One-line: the only progress meter in the app — thin brass rule, determinate or drifting.

```jsx
<ProgressBar indeterminate label="Composing the melody…" detail="0:42 written" />
<ProgressBar value={.62} label="Bringing it to life…" detail="about 40 seconds left" />
```

Needs `@keyframes ss-drift{0%{left:-38%}100%{left:100%}}`. Only the melody and life stages have real numbers; every other stage is indeterminate.
