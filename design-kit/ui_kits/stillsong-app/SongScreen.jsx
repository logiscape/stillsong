const {PhotoRoom,LyricSheet,Player,Notice,IconButton,Icon,Panel,Button,Dialog,Badge,Switch}=window.StillsongDesignSystem_4faa75;

function SongScreen({song,onBack,onRemix,autoplay}){
  const [playing,setPlaying]=React.useState(!!autoplay);
  const [pos,setPos]=React.useState(autoplay?0:38);
  const [vol,setVol]=React.useState(.75);
  const [menu,setMenu]=React.useState(false);
  const [solid,setSolid]=React.useState(false);
  const [confirm,setConfirm]=React.useState(false);
  React.useEffect(()=>{if(!playing)return;const t=setInterval(()=>setPos(p=>Math.min(song.dur,p+1)),1000);return()=>clearInterval(t)},[playing,song]);

  return (
    <PhotoRoom photo={song.photo} luminance={song.lum} scrim="vertical">
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"18px 22px"}}>
          <IconButton icon="chevron-left" label="Close" variant="glass" onClick={onBack}/>
          <div style={{flex:1}}/>
          <IconButton icon="shuffle" label="Remix" variant="glass" onClick={onRemix}/>
          <IconButton icon="ellipsis" label="More" variant="glass" onClick={()=>setMenu(!menu)}/>
        </div>

        <div style={{flex:1,minHeight:0,display:"flex",alignItems:"center",padding:"0 var(--gutter-screen)"}}>
          <div style={{maxWidth:520,maxHeight:"100%",overflowY:"auto",paddingRight:8}}>
            {song.truncated&&<Notice tone="calm" glass action="Let it finish"
              title="This song wanted to run longer than expected"
              style={{marginBottom:"var(--space-6)",maxWidth:420}}>
              We can give it another half minute and keep everything else the same.</Notice>}
            <LyricSheet title={song.title} stanzas={song.stanzas} instrumental={song.instrumental}
              epigraph={song.instrumental?song.caption.split(".")[0]+".":null} mode={solid?"solid":"blur"}/>
          </div>
        </div>

        <div style={{padding:"0 var(--gutter-screen) 26px",display:"flex",alignItems:"center",gap:"var(--space-5)"}}>
          <Player playing={playing} position={pos} duration={song.dur} volume={vol}
            onToggle={()=>setPlaying(!playing)} onSeek={setPos} onVolume={setVol} style={{flex:1,maxWidth:640}}/>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Badge tone="glass">{song.genre}</Badge>
            <Switch checked={solid} onChange={setSolid} label="Solid panel"/>
          </div>
        </div>

        {menu&&<Panel variant="glass" pad={6} style={{position:"absolute",top:64,right:22,width:230}}>
          {[["shuffle","Remix this song"],["download","Save a copy…"],["folder-open","Reveal in folder"],
            ["pencil-line","Rename"],["disc","View original version"],["trash-2","Delete"]].map(([ic,l])=>(
            <button key={l} onClick={()=>{setMenu(false);if(l==="Delete")setConfirm(true);if(l==="Remix this song")onRemix()}}
              style={{display:"flex",alignItems:"center",gap:11,width:"100%",padding:"9px 10px",background:"none",border:"none",
                cursor:"pointer",font:"var(--ui-sm)",color:l==="Delete"?"#E0A18B":"var(--ink-1)",textAlign:"left",borderRadius:"var(--radius-sm)"}}>
              <Icon name={ic} size={15}/>{l}</button>))}
        </Panel>}

        <Dialog open={confirm} title="Delete this song?" onClose={()=>setConfirm(false)}
          footer={<><Button variant="ghost" onClick={()=>setConfirm(false)}>Keep it</Button>
                   <Button variant="danger" onClick={()=>setConfirm(false)}>Delete</Button></>}>
          Your photo stays where it is. The song file will be removed from your computer.
        </Dialog>
      </div>
    </PhotoRoom>
  );
}
window.SongScreen=SongScreen;
