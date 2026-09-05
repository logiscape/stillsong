import { Icon } from "./Icon.jsx";

const SIZES={sm:{h:32,px:12,font:"var(--ui-sm)",gap:6,icon:15},
  md:{h:"var(--control-h)",px:18,font:"var(--ui-button)",gap:8,icon:17},
  lg:{h:"var(--control-h-lg)",px:26,font:"500 15.5px/1 var(--font-ui)",gap:9,icon:18}};

export function Button({variant="primary",size="md",icon,iconRight,disabled,fullWidth,onClick,children,style,...rest}){
  const [h,setH]=React.useState(false),[p,setP]=React.useState(false);
  const s=SIZES[size]||SIZES.md;
  const skin={
    primary:{background:h?"var(--brass-300)":"var(--brass)",color:"var(--text-on-accent)",border:"1px solid transparent",boxShadow:h?"var(--glow-brass)":"var(--shadow-2)"},
    secondary:{background:h?"var(--surface-3)":"var(--surface-2)",color:"var(--ink-1)",border:"1px solid "+(h?"var(--border-strong)":"var(--border-field)"),boxShadow:"var(--shadow-1)"},
    ghost:{background:h?"var(--wash-1)":"transparent",color:h?"var(--ink-1)":"var(--ink-2)",border:"1px solid transparent",boxShadow:"none"},
    quiet:{background:"transparent",color:h?"var(--brass-100)":"var(--brass-200)",border:"1px solid transparent",boxShadow:"none",padding:0,height:"auto"},
    danger:{background:h?"var(--clay)":"var(--clay-wash)",color:h?"var(--ink-1)":"#E5A793",border:"1px solid var(--clay)",boxShadow:"none"}
  }[variant];
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      onMouseEnter={()=>setH(true)} onMouseLeave={()=>{setH(false);setP(false)}}
      onMouseDown={()=>setP(true)} onMouseUp={()=>setP(false)}
      style={{display:fullWidth?"flex":"inline-flex",width:fullWidth?"100%":undefined,alignItems:"center",
        justifyContent:"center",gap:s.gap,height:s.h,padding:variant==="quiet"?0:`0 ${s.px}px`,
        font:s.font,letterSpacing:"var(--tracking-tight)",borderRadius:variant==="quiet"?0:"var(--radius-sm)",
        cursor:disabled?"not-allowed":"pointer",opacity:disabled?.38:1,
        transform:p&&!disabled?"var(--press-scale)":"none",
        transition:"background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out),transform var(--dur-tap) var(--ease-out),box-shadow var(--dur-base) var(--ease-out)",
        ...skin,...style}} {...rest}>
      {icon&&<Icon name={icon} size={s.icon}/>}
      {children}
      {iconRight&&<Icon name={iconRight} size={s.icon}/>}
    </button>
  );
}
