import { Icon } from "../core/Icon.jsx";

export function Notice({tone="info",title,children,action,onAction,glass,style,...rest}){
  const map={info:{icon:"info",c:"var(--brass-200)",wash:"var(--brass-wash)",line:"var(--brass-line)"},
    warn:{icon:"triangle-alert",c:"#E6BC76",wash:"var(--amber-wash)",line:"rgba(206,155,69,.38)"},
    error:{icon:"triangle-alert",c:"#E0A18B",wash:"var(--clay-wash)",line:"rgba(180,102,76,.4)"},
    calm:{icon:"clock",c:"var(--ink-2)",wash:"var(--wash-1)",line:"var(--line-1)"}}[tone];
  return (
    <div style={{display:"flex",gap:"var(--space-4)",padding:"14px 16px",borderRadius:"var(--radius-md)",
      background:glass?"rgba(12,11,10,.55)":map.wash,backdropFilter:glass?"var(--blur-chrome)":undefined,
      border:"1px solid "+map.line,...style}} {...rest}>
      <Icon name={map.icon} size={17} color={map.c} style={{marginTop:2}}/>
      <div style={{minWidth:0}}>
        {title&&<div style={{font:"500 14.5px/1.4 var(--font-ui)",color:"var(--ink-1)"}}>{title}</div>}
        {children&&<div style={{font:"var(--ui-sm)",color:"var(--text-body)",marginTop:title?4:0,maxWidth:"56ch"}}>{children}</div>}
        {action&&<button type="button" onClick={onAction}
          style={{marginTop:"var(--space-4)",background:"none",border:"none",padding:0,cursor:"pointer",
            font:"var(--ui-button)",color:map.c,textDecoration:"underline",textUnderlineOffset:3}}>{action}</button>}
      </div>
    </div>
  );
}
