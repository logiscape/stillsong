import { Icon } from "./Icon.jsx";

export function IconButton({icon,label,size=40,iconSize,variant="ghost",active,onClick,style,...rest}){
  const [h,setH]=React.useState(false);
  const skin={
    ghost:{background:h?"var(--wash-2)":"transparent",color:h?"var(--ink-1)":"var(--ink-2)",border:"1px solid transparent"},
    surface:{background:h?"var(--surface-3)":"var(--surface-2)",color:"var(--ink-1)",border:"1px solid var(--border-field)"},
    glass:{background:h?"rgba(245,238,230,.16)":"rgba(12,11,10,.42)",color:"var(--ink-1)",border:"1px solid var(--line-2)",backdropFilter:"var(--blur-chrome)"},
    brass:{background:h?"var(--brass-300)":"var(--brass)",color:"var(--text-on-accent)",border:"1px solid transparent",boxShadow:"var(--shadow-2)"}
  }[variant];
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:size,height:size,
        borderRadius:"var(--radius-pill)",cursor:"pointer",flex:"0 0 auto",
        transition:"background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)",
        ...skin,...(active?{color:"var(--brass-200)"}:null),...style}} {...rest}>
      <Icon name={icon} size={iconSize||Math.round(size*.45)}/>
    </button>
  );
}
