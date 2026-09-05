import { Icon } from "../core/Icon.jsx";

export function LintList({items=[],style,...rest}){
  if(!items.length) return (
    <div style={{display:"flex",alignItems:"center",gap:8,font:"var(--ui-sm)",color:"var(--success)",...style}} {...rest}>
      <Icon name="check" size={14}/> Looks good.
    </div>
  );
  return (
    <ul style={{listStyle:"none",margin:0,padding:0,display:"flex",flexDirection:"column",gap:"var(--space-3)",...style}} {...rest}>
      {items.map((it,i)=>{
        const err=it.level==="error";
        return (
          <li key={i} style={{display:"flex",gap:8,font:"var(--ui-sm)",color:err?"#E0A18B":"#E6BC76"}}>
            <Icon name={err?"triangle-alert":"info"} size={14} style={{marginTop:2,flex:"0 0 auto"}}/>
            <span style={{color:"var(--text-body)"}}>{it.message}</span>
          </li>
        );
      })}
    </ul>
  );
}
