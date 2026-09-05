import { Icon } from "../core/Icon.jsx";

export function Select({label,value,onChange,options=[],id,style,...rest}){
  const [foc,setFoc]=React.useState(false);
  return (
    <label htmlFor={id} style={{display:"block",...style}}>
      {label&&<span style={{display:"block",font:"var(--ui-label)",color:"var(--text-quiet)",marginBottom:"var(--space-3)"}}>{label}</span>}
      <span style={{position:"relative",display:"block"}}>
        <select id={id} value={value} onChange={e=>onChange&&onChange(e.target.value)}
          onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}
          style={{width:"100%",height:"var(--control-h)",padding:"0 38px 0 14px",font:"var(--ui-md)",
            color:"var(--ink-1)",background:"var(--surface-field)",appearance:"none",
            border:"1px solid "+(foc?"var(--brass-line)":"var(--border-field)"),borderRadius:"var(--radius-sm)",
            boxShadow:foc?"var(--glow-brass)":"var(--inset-field)",outline:"none",cursor:"pointer"}} {...rest}>
          {options.map(o=>{const v=typeof o==="string"?o:o.value,l=typeof o==="string"?o:o.label;
            return <option key={v} value={v} style={{background:"var(--surface-2)"}}>{l}</option>;})}
        </select>
        <Icon name="chevron-down" size={16} style={{position:"absolute",right:13,top:"50%",transform:"translateY(-50%)",color:"var(--ink-3)",pointerEvents:"none"}}/>
      </span>
    </label>
  );
}
