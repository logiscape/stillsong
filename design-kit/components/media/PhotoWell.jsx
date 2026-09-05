import { Icon } from "../core/Icon.jsx";
import { Button } from "../core/Button.jsx";

export function PhotoWell({src,dragging,onChoose,onClear,height=380,style,...rest}){
  const [h,setH]=React.useState(false);
  const active=dragging||h;
  if(src) return (
    <div style={{position:"relative",height,borderRadius:"var(--radius-photo)",overflow:"hidden",
      boxShadow:"var(--shadow-photo)",border:"1px solid var(--border-hairline)",...style}} {...rest}>
      <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
      <div style={{position:"absolute",inset:0,background:"var(--scrim-chrome-bottom)",opacity:.7,pointerEvents:"none"}}/>
      {onClear&&<div style={{position:"absolute",bottom:14,right:14}}>
        <Button variant="secondary" size="sm" icon="image-plus" onClick={onClear}>Choose another</Button>
      </div>}
    </div>
  );
  return (
    <button type="button" onClick={onChoose} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"var(--space-4)",
        width:"100%",height,cursor:"pointer",textAlign:"center",
        background:active?"var(--brass-wash)":"var(--wash-1)",
        border:"1px dashed "+(active?"var(--brass-line)":"var(--border-field)"),
        borderRadius:"var(--radius-photo)",boxShadow:active?"var(--glow-brass)":"none",
        transition:"background var(--dur-base) var(--ease-out),border-color var(--dur-base) var(--ease-out)",...style}} {...rest}>
      <Icon name="image-plus" size={30} color={active?"var(--brass-200)":"var(--ink-3)"}/>
      <span style={{font:"var(--display-sm)",color:"var(--ink-1)",letterSpacing:"var(--tracking-display)"}}>
        {dragging?"Let it go":"Choose a photo"}</span>
      <span style={{font:"var(--ui-sm)",color:"var(--text-quiet)"}}>or drag one here — png, jpg, webp, bmp, gif</span>
    </button>
  );
}
