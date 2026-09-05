import { Icon } from "../core/Icon.jsx";

export function SegmentedChoice({label,value,onChange,options=[],style,...rest}){
  return (
    <div style={style} {...rest}>
      {label&&<span style={{display:"block",font:"var(--ui-label)",color:"var(--text-quiet)",marginBottom:"var(--space-4)"}}>{label}</span>}
      <div role="radiogroup" style={{display:"grid",gridTemplateColumns:`repeat(${options.length},1fr)`,gap:"var(--space-3)"}}>
        {options.map(o=>{
          const v=typeof o==="string"?o:o.value,l=typeof o==="string"?o:o.label,sel=v===value;
          return (
            <button key={v} type="button" role="radio" aria-checked={sel} onClick={()=>onChange&&onChange(v)}
              style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,
                minHeight:"var(--control-h-lg)",padding:"12px 10px",cursor:"pointer",
                font:sel?"500 14.5px/1.2 var(--font-ui)":"var(--ui-md)",
                color:sel?"var(--brass-100)":"var(--ink-2)",
                background:sel?"var(--brass-wash)":"var(--wash-1)",
                border:"1px solid "+(sel?"var(--border-selected)":"var(--border-hairline)"),
                borderRadius:"var(--radius-sm)",boxShadow:sel?"var(--glow-brass)":"none",
                transition:"all var(--dur-fast) var(--ease-out)"}}>
              {(typeof o==="object"&&o.icon)&&<Icon name={o.icon} size={18}/>}
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
