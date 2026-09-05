const {Button,PhotoWell,SegmentedChoice,TextField,Select,Disclosure,StageList,CREATION_STAGES,ProgressBar,Notice,Panel,Badge}=window.StillsongDesignSystem_4faa75;

function CreateScreen({onDone}){
  const [photo,setPhoto]=React.useState(null);
  const [voice,setVoice]=React.useState("female");
  const [hint,setHint]=React.useState("");
  const [lang,setLang]=React.useState("English");
  const [open,setOpen]=React.useState(false);
  const [stage,setStage]=React.useState(-1);
  const [failed,setFailed]=React.useState(false);
  const [showDetail,setShowDetail]=React.useState(false);
  const song=window.SS_DATA.SONGS[0];

  React.useEffect(()=>{
    if(stage<0||failed) return;
    if(stage>=CREATION_STAGES.length){const t=setTimeout(()=>onDone&&onDone(),700);return()=>clearTimeout(t)}
    const t=setTimeout(()=>setStage(s=>s+1),stage===2?2600:1700);
    return()=>clearTimeout(t);
  },[stage,failed]);

  const running=stage>=0&&!failed;

  if(failed) return (
    <div style={{display:"grid",placeItems:"center",height:"100%",padding:"var(--gutter-screen)"}}>
      <div style={{width:520,textAlign:"left"}}>
        <img src={photo} alt="" style={{width:"100%",height:200,objectFit:"cover",borderRadius:"var(--radius-photo)",opacity:.45,marginBottom:"var(--space-7)"}}/>
        <Notice tone="error" title="Something went wrong while writing your song"
          action="Try again" onAction={()=>{setFailed(false);setStage(0)}}>
          Nothing was lost — your photo and your choices are still here.
        </Notice>
        <div style={{marginTop:"var(--space-5)"}}>
          <Button variant="quiet" onClick={()=>setShowDetail(!showDetail)}>{showDetail?"hide details":"details"}</Button>
          {showDetail&&<Panel variant="inset" pad={14} style={{marginTop:10}}>
            <code style={{font:"var(--mono-sm)",color:"var(--text-quiet)",whiteSpace:"pre-wrap"}}>ComposeError: repair round failed after 2 attempts (llama-server 127.0.0.1:8081, /health ok, ctx 4096)</code>
          </Panel>}
        </div>
      </div>
    </div>
  );

  if(running) return (
    <div style={{display:"grid",gridTemplateColumns:"1.1fr 1fr",height:"100%",alignItems:"center",gap:"var(--space-9)",padding:"var(--gutter-screen)"}}>
      <div style={{position:"relative",borderRadius:"var(--radius-photo)",overflow:"hidden",boxShadow:"var(--shadow-photo)",aspectRatio:"4/3"}}>
        <img src={photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover",
          animation:"ss-kenburns 90s var(--ease-in-out) infinite alternate"}}/>
        <div style={{position:"absolute",inset:0,background:"radial-gradient(120% 100% at 50% 120%,var(--ambient-soft),transparent 70%)"}}/>
      </div>
      <div style={{maxWidth:400}}>
        <span style={{font:"var(--ui-eyebrow)",letterSpacing:"var(--tracking-eyebrow)",textTransform:"uppercase",color:"var(--brass-300)"}}>Your song is being made</span>
        <div style={{height:"var(--space-6)"}}/>
        <StageList activeIndex={Math.min(stage,CREATION_STAGES.length-1)}/>
        <div style={{height:"var(--space-7)"}}/>
        {stage>=3&&<div style={{opacity:0,animation:"ss-rise var(--dur-reveal) var(--ease-serene) forwards"}}>
          <span style={{font:"var(--ui-sm)",color:"var(--text-quiet)"}}>It will be called</span>
          <div style={{font:"var(--display-md)",color:"var(--ink-1)",letterSpacing:"var(--tracking-display)",marginTop:6}}>{song.title}</div>
        </div>}
        <div style={{height:"var(--space-7)"}}/>
        {stage===4&&<ProgressBar indeterminate label="Composing the melody…" detail="0:42 written"/>}
        {stage===5&&<ProgressBar value={.62} label="Bringing it to life…" detail="about 40 seconds left"/>}
        {stage!==4&&stage!==5&&<ProgressBar indeterminate/>}
        <div style={{marginTop:"var(--space-7)"}}>
          <Button variant="quiet" onClick={()=>setFailed(true)}>(demo: show the failure state)</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{height:"100%",overflowY:"auto",padding:"var(--space-9) var(--gutter-screen)",
      background:photo?"radial-gradient(90% 70% at 50% 0%,var(--ambient-soft),transparent 70%)":"none"}}>
      <div style={{maxWidth:680,margin:"0 auto"}}>
        <PhotoWell src={photo} height={photo?360:330}
          onChoose={()=>setPhoto(window.SS_DATA.SONGS[0].photo)} onClear={()=>setPhoto(null)}/>
        <div style={{height:"var(--space-8)"}}/>
        <SegmentedChoice label="Voice" value={voice} onChange={setVoice} options={[
          {value:"instrumental",label:"Instrumental",icon:"audio-lines"},
          {value:"female",label:"Female vocals",icon:"mic"},
          {value:"male",label:"Male vocals",icon:"mic"}]}/>
        <div style={{height:"var(--space-7)"}}/>
        <Disclosure summary="Add a touch of direction (optional)" open={open} onToggle={setOpen}>
          <div style={{display:"flex",flexDirection:"column",gap:"var(--space-5)",maxWidth:400}}>
            <TextField label="Genre or mood" placeholder="slow folk ballad" value={hint} onChange={setHint}/>
            {voice!=="instrumental"&&<Select label="Lyrics language" value={lang} onChange={setLang}
              options={["English","Spanish","French","German","Italian","Portuguese","Japanese","Korean","Chinese"]}/>}
          </div>
        </Disclosure>
        <div style={{height:"var(--space-8)",borderTop:"1px solid var(--border-hairline)"}}/>
        <div style={{display:"flex",alignItems:"center",gap:"var(--space-5)"}}>
          <Button variant="primary" size="lg" icon="wand-sparkles" disabled={!photo} onClick={()=>setStage(0)}>Create My Song</Button>
          <span style={{font:"var(--ui-sm)",color:"var(--text-faint)"}}>
            {photo?"About two minutes. Everything happens on your computer.":"Choose a photo to begin."}</span>
        </div>
      </div>
    </div>
  );
}
window.CreateScreen=CreateScreen;
