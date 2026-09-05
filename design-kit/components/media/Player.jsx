import { Icon } from "../core/Icon.jsx";
import { IconButton } from "../core/IconButton.jsx";

const fmt=s=>{s=Math.max(0,Math.round(s||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};

export function Player({playing,position=0,duration=1,volume=.8,onToggle,onSeek,onVolume,variant="glass",style,...rest}){
  const pct=Math.min(100,(position/(duration||1))*100);
  const skin=variant==="glass"
    ?{background:"var(--panel-blur-bg)",backdropFilter:"var(--panel-blur)",border:"1px solid var(--line-1)"}
    :{background:"var(--surface-2)",border:"1px solid var(--border-hairline)"};
  return (
    <div style={{display:"flex",alignItems:"center",gap:"var(--space-5)",padding:"12px 18px",
      borderRadius:"var(--radius-pill)",boxShadow:"var(--shadow-3)",...skin,...style}} {...rest}>
      <IconButton icon={playing?"pause":"play"} label={playing?"Pause":"Play"} variant="brass" size={46} onClick={onToggle}/>
      <span style={{font:"var(--mono-sm)",color:"var(--lyric-text-quiet)",width:38,textAlign:"right"}}>{fmt(position)}</span>
      <div onClick={e=>{const r=e.currentTarget.getBoundingClientRect();onSeek&&onSeek(((e.clientX-r.left)/r.width)*duration)}}
        style={{position:"relative",flex:1,height:22,display:"flex",alignItems:"center",cursor:"pointer"}}>
        <div style={{width:"100%",height:3,borderRadius:2,background:"rgba(245,238,230,.2)"}}/>
        <div style={{position:"absolute",left:0,width:pct+"%",height:3,borderRadius:2,background:"var(--brass-200)"}}/>
        <div style={{position:"absolute",left:`calc(${pct}% - 5px)`,width:10,height:10,borderRadius:"50%",
          background:"var(--brass-100)",boxShadow:"0 0 0 4px rgba(192,151,95,.18)"}}/>
      </div>
      <span style={{font:"var(--mono-sm)",color:"var(--lyric-text-quiet)",width:38}}>{fmt(duration)}</span>
      <div style={{display:"flex",alignItems:"center",gap:8,minWidth:96}}>
        <Icon name={volume>0?"volume-2":"volume-x"} size={16} color="var(--lyric-text-quiet)"/>
        <div onClick={e=>{const r=e.currentTarget.getBoundingClientRect();onVolume&&onVolume((e.clientX-r.left)/r.width)}}
          style={{position:"relative",width:64,height:18,display:"flex",alignItems:"center",cursor:"pointer"}}>
          <div style={{width:"100%",height:3,borderRadius:2,background:"rgba(245,238,230,.2)"}}/>
          <div style={{position:"absolute",left:0,width:volume*100+"%",height:3,borderRadius:2,background:"var(--lyric-text-quiet)"}}/>
        </div>
      </div>
    </div>
  );
}
