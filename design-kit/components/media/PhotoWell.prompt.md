One-line: the photo well — Create's hero, and the only element on the screen before a photo exists.

```jsx
<PhotoWell onChoose={pick} dragging={isDragging} />
<PhotoWell src={photoUrl} onClear={pick} height={420} />
```

On selection, also shift the screen's ambient colour (`--ambient`) to the photo's dominant colour. Drag detection must come from the Tauri webview drag events.
