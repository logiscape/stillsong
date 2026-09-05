export function TextField({label,hint,value,onChange,placeholder,multiline,rows=4,mono,invalid,id,style,...rest}){
  const [foc,setFoc]=React.useState(false);
  const El=multiline?"textarea":"input";
  return (
    <label htmlFor={id} style={{display:"block",...style}}>
      {label&&<span style={{display:"block",font:"var(--ui-label)",color:"var(--text-quiet)",marginBottom:"var(--space-3)"}}>{label}</span>}
      <El id={id} rows={multiline?rows:undefined} value={value} placeholder={placeholder}
        onChange={e=>onChange&&onChange(e.target.value)} onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}
        style={{width:"100%",display:"block",resize:multiline?"vertical":undefined,
          minHeight:multiline?undefined:"var(--control-h)",padding:multiline?"12px 14px":"0 14px",
          font:mono?"var(--mono-md)":"var(--ui-md)",color:"var(--ink-1)",background:"var(--surface-field)",
          border:"1px solid "+(invalid?"var(--clay)":foc?"var(--brass-line)":"var(--border-field)"),
          borderRadius:"var(--radius-sm)",boxShadow:foc?"var(--glow-brass)":"var(--inset-field)",outline:"none",
          transition:"border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-base) var(--ease-out)"}} {...rest}/>
      {hint&&<span style={{display:"block",font:"var(--ui-xs)",color:"var(--text-faint)",marginTop:"var(--space-2)"}}>{hint}</span>}
    </label>
  );
}
