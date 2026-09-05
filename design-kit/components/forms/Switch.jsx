export function Switch({checked,onChange,label,hint,style,...rest}){
  return (
    <label style={{display:"flex",alignItems:"flex-start",gap:"var(--space-4)",cursor:"pointer",...style}} {...rest}>
      <button type="button" role="switch" aria-checked={!!checked} onClick={()=>onChange&&onChange(!checked)}
        style={{position:"relative",flex:"0 0 auto",width:40,height:24,marginTop:1,borderRadius:"var(--radius-pill)",
          background:checked?"var(--brass)":"var(--surface-3)",
          border:"1px solid "+(checked?"var(--brass-600)":"var(--border-field)"),cursor:"pointer",
          transition:"background var(--dur-base) var(--ease-out)"}}>
        <span style={{position:"absolute",top:2,left:checked?18:2,width:18,height:18,borderRadius:"50%",
          background:checked?"var(--ink-inverse)":"var(--ink-2)",boxShadow:"var(--shadow-1)",
          transition:"left var(--dur-base) var(--ease-out)"}}/>
      </button>
      {(label||hint)&&<span style={{display:"block"}}>
        {label&&<span style={{display:"block",font:"var(--ui-md)",color:"var(--ink-1)"}}>{label}</span>}
        {hint&&<span style={{display:"block",font:"var(--ui-sm)",color:"var(--text-quiet)",marginTop:2,maxWidth:"48ch"}}>{hint}</span>}
      </span>}
    </label>
  );
}
