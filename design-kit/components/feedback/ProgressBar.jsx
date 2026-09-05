export function ProgressBar({value,label,detail,indeterminate,style,...rest}){
  const pct=Math.max(0,Math.min(100,(value||0)*100));
  return (
    <div style={{...style}} {...rest}>
      {(label||detail)&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:12,marginBottom:"var(--space-3)"}}>
        <span style={{font:"var(--ui-sm)",color:"var(--text-body)"}}>{label}</span>
        <span style={{font:"var(--mono-sm)",color:"var(--text-quiet)"}}>{detail}</span>
      </div>}
      <div style={{position:"relative",height:3,borderRadius:2,background:"var(--wash-2)",overflow:"hidden"}}>
        {indeterminate
          ?<div style={{position:"absolute",top:0,bottom:0,width:"38%",borderRadius:2,
             background:"linear-gradient(90deg,transparent,var(--brass-300),transparent)",
             animation:"ss-drift 2.4s var(--ease-in-out) infinite"}}/>
          :<div style={{position:"absolute",top:0,bottom:0,left:0,width:pct+"%",borderRadius:2,background:"var(--brass)",
             transition:"width var(--dur-slow) var(--ease-out)"}}/>}
      </div>
    </div>
  );
}
