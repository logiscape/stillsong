One-line: three-up exclusive choice where all options carry equal visual weight.

```jsx
<SegmentedChoice label="Voice" value={voice} onChange={setVoice} options={[
  {value:"instrumental",label:"Instrumental",icon:"audio-lines"},
  {value:"female",label:"Female vocals",icon:"mic"},
  {value:"male",label:"Male vocals",icon:"mic"}]} />
```

Exactly one option is always selected — there is no empty state. Two-option use (Keep original / New seed) is fine.
