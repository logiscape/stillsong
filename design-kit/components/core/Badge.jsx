import { Icon } from "./Icon.jsx";

export function Badge({children,tone="neutral",icon,mono,style,...rest}){
  const tones={
    neutral:{background:"var(--wash-1)",color:"var(--ink-2)",border:"1px solid var(--line-1)"},
    brass:{background:"var(--brass-wash)",color:"var(--brass-200)",border:"1px solid var(--brass-line)"},
    glass:{background:"rgba(12,11,10,.5)",color:"var(--ink-1)",border:"1px solid var(--line-2)",backdropFilter:"var(--blur-chrome)"},
    sage:{background:"var(--sage-wash)",color:"#A6BE9D",border:"1px solid rgba(127,154,118,.4)"},
    amber:{background:"var(--amber-wash)",color:"#E6BC76",border:"1px solid rgba(206,155,69,.4)"},
    clay:{background:"var(--clay-wash)",color:"#E0A18B",border:"1px solid rgba(180,102,76,.42)"}
  };
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:6,height:24,padding:"0 10px",
      borderRadius:"var(--radius-pill)",font:mono?"var(--mono-sm)":"var(--ui-xs)",
      letterSpacing:mono?0:".01em",whiteSpace:"nowrap",...tones[tone],...style}} {...rest}>
      {icon&&<Icon name={icon} size={13}/>}{children}
    </span>
  );
}
