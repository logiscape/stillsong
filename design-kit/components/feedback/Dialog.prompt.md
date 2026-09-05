One-line: modal confirmation — used for Delete (two-step) and Rename only.

```jsx
<Dialog title="Delete this song?" onClose={close}
  footer={<><Button variant="ghost" onClick={close}>Keep it</Button><Button variant="danger" onClick={del}>Delete</Button></>}>
  The photo stays on your computer. The song file will be removed.
</Dialog>
```

Positioned absolutely — give the parent `position:relative` (the app frame).
