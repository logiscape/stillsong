import { Icon } from "../core/Icon.jsx";
import { Badge } from "../core/Badge.jsx";
import { IconButton } from "../core/IconButton.jsx";

export function SongCard({photo,title,genre,length,date,instrumental,versions,playing,onPlay,onOpen,style,...rest}){
  const [h,setH]=React.useState(false);
  return (
    <div onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} onClick={onOpen}
      style={{position:"relative",borderRadius:"var(--radius-photo)",overflow:"hidden",cursor:"pointer",
        background:"var(--surface-1)",border:"1px solid "+(h?"var(--line-2)":"var(--border-hairline)"),
        boxShadow:h?"var(--shadow-4)":"var(--shadow-photo)",transform:h?"var(--hover-lift)":"none",
        transition:"transform var(--dur-base) var(--ease-lift),box-shadow var(--dur-base) var(--ease-out),border-color var(--dur-base) var(--ease-out)",...style}} {...rest}>
      <div style={{position:"relative",aspectRatio:"4/3",overflow:"hidden"}}>
        <img src={photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block",
          transform:h?"scale(1.03)":"scale(1)",transition:"transform var(--dur-slow) var(--ease-serene)"}}/>
        <div style={{position:"absolute",inset:0,background:"var(--scrim-chrome-bottom)",
          opacity:h||playing?.95:.55,transition:"opacity var(--dur-base) var(--ease-out)"}}/>
        <div style={{position:"absolute",top:12,right:12,display:"flex",gap:6}}>
          {instrumental&&<Badge tone="glass" icon="audio-lines">Instrumental</Badge>}
          {versions>1&&<Badge tone="glass" icon="layers">{versions} versions</Badge>}
        </div>
        <div style={{position:"absolute",left:14,bottom:14,right:14,display:"flex",alignItems:"flex-end",gap:"var(--space-4)"}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{font:"var(--display-sm)",color:"var(--ink-1)",letterSpacing:"var(--tracking-display)",
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textShadow:"0 1px 12px rgba(0,0,0,.6)"}}>{title}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:5,font:"var(--ui-xs)",color:"rgba(245,238,230,.72)"}}>
              {genre&&<span>{genre}</span>}{genre&&<span style={{opacity:.45}}>·</span>}
              <span style={{font:"var(--mono-sm)"}}>{length}</span>
              <span style={{opacity:.45}}>·</span><span>{date}</span>
            </div>
          </div>
          <div style={{opacity:h||playing?1:0,transform:h||playing?"none":"translateY(4px)",
            transition:"opacity var(--dur-base) var(--ease-out),transform var(--dur-base) var(--ease-out)"}}>
            <IconButton icon={playing?"pause":"play"} label={playing?"Pause":"Play"} variant="glass" size={44}
              onClick={e=>{e.stopPropagation();onPlay&&onPlay()}}/>
          </div>
        </div>
        {playing&&<div style={{position:"absolute",left:0,right:0,bottom:0,height:2,background:"var(--brass)",width:"38%"}}/>}
      </div>
    </div>
  );
}
