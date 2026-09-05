const {Button,Panel,Notice,ProgressBar,Icon,Badge,TextField,Switch}=window.StillsongDesignSystem_4faa75;

const STEPS=["Welcome","Your computer","What Stillsong needs","Where to keep them","Setting up","Almost ready"];

function Shell({step,title,lede,children,footer}){
  return (
    <div style={{display:"grid",placeItems:"center",height:"100%",padding:"var(--gutter-screen)",
      background:"radial-gradient(80% 60% at 50% 0%,rgba(58,47,40,.5),transparent 70%)"}}>
      <div style={{width:600}}>
        <div style={{display:"flex",gap:6,marginBottom:"var(--space-8)"}}>
          {STEPS.map((s,i)=><div key={s} style={{flex:1,height:2,borderRadius:2,
            background:i<=step?"var(--brass)":"var(--wash-2)"}}/>)}
        </div>
        <h1 style={{font:"var(--display-lg)",color:"var(--ink-1)",margin:0,letterSpacing:"var(--tracking-display)",textWrap:"pretty"}}>{title}</h1>
        {lede&&<p style={{font:"var(--ui-lg)",color:"var(--text-body)",margin:"var(--space-5) 0 0",maxWidth:"52ch",textWrap:"pretty"}}>{lede}</p>}
        <div style={{marginTop:"var(--space-8)"}}>{children}</div>
        <div style={{display:"flex",alignItems:"center",gap:"var(--space-5)",marginTop:"var(--space-8)"}}>{footer}</div>
      </div>
    </div>
  );
}

function Line({icon,label,value,tone}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderTop:"1px solid var(--border-hairline)"}}>
      <Icon name={icon} size={16} color={tone==="bad"?"#E0A18B":tone==="warn"?"#E6BC76":"var(--sage)"}/>
      <span style={{flex:1,font:"var(--ui-md)",color:"var(--ink-1)"}}>{label}</span>
      <span style={{font:"var(--mono-sm)",color:"var(--text-quiet)"}}>{value}</span>
    </div>
  );
}

function FirstRunScreen({onFinish}){
  const [step,setStep]=React.useState(0);
  const [hw,setHw]=React.useState("ok");
  const [paused,setPaused]=React.useState(false);
  const next=()=>step<5?setStep(step+1):onFinish();

  if(step===0) return <Shell step={0} title="Turn your photos into songs."
    lede="Choose a photo and Stillsong writes and performs a song about it. Everything happens on your computer — nothing you make ever leaves it."
    footer={<Button variant="primary" size="lg" onClick={next}>Begin</Button>}>
      <div style={{display:"flex",gap:12}}>{["stillsong-harbour","stillsong-field","stillsong-window"].map(s=>
        <img key={s} src={`https://picsum.photos/seed/${s}/500/400`} alt="" style={{flex:1,height:150,objectFit:"cover",
          borderRadius:"var(--radius-photo)",boxShadow:"var(--shadow-photo)",opacity:.8}}/>)}</div>
    </Shell>;

  if(step===1) return <Shell step={1} title="Let's check this computer."
    lede="Stillsong does all its work here, so it needs a little room to work in."
    footer={<>{hw!=="bad"&&<Button variant="primary" size="lg" onClick={next}>Continue</Button>}
      <Button variant="quiet" onClick={()=>setHw(hw==="ok"?"warn":hw==="warn"?"bad":"ok")}>(demo: next hardware case)</Button></>}>
      <Panel pad={18}>
        <Line icon="check" label="Windows 11, 64-bit" value="ok"/>
        <Line icon={hw==="bad"?"x":"check"} label="Graphics card"
          value={hw==="ok"?"NVIDIA · 24 GB":hw==="warn"?"NVIDIA · 8 GB":"NVIDIA · 6 GB"} tone={hw==="bad"?"bad":hw==="warn"?"warn":"good"}/>
        <Line icon="check" label="Memory" value="64 GB"/>
        <Line icon="check" label="Free space on C:" value="412 GB"/>
      </Panel>
      {hw==="warn"&&<Notice tone="warn" style={{marginTop:"var(--space-6)"}} title="This will take a little longer">
        Your graphics card has 8 GB of memory — songs will sound exactly as good, but they'll take several times longer to create, and will run up to about two minutes.</Notice>}
      {hw==="bad"&&<Notice tone="error" style={{marginTop:"var(--space-6)"}} title="This computer can't run Stillsong">
        Stillsong needs an NVIDIA graphics card with at least 8 GB of memory. This one has 6 GB.</Notice>}
    </Shell>;

  if(step===2) return <Shell step={2} title="What Stillsong needs."
    lede="Three pieces, downloaded once. After this, Stillsong works completely offline."
    footer={<><Button variant="primary" size="lg" onClick={next}>Choose where they go</Button><span style={{font:"var(--ui-sm)",color:"var(--text-faint)"}}>Nothing is downloaded yet.</span></>}>
      <Panel pad={18}>
        <Line icon="pen-line" label="A songwriter" value="7.4 GB"/>
        <Line icon="music" label="A composer and its instruments" value="14–15 GB"/>
        <Line icon="audio-lines" label="A sound engine" value="3–4 GB"/>
        <div style={{display:"flex",justifyContent:"space-between",paddingTop:14,marginTop:2,borderTop:"1px solid var(--border-field)"}}>
          <span style={{font:"var(--ui-md)",color:"var(--ink-1)"}}>About 25 GB in total</span>
          <span style={{font:"var(--mono-sm)",color:"var(--text-quiet)"}}>from Hugging Face and GitHub</span></div>
      </Panel>
    </Shell>;

  if(step===3) return <Shell step={3} title="Where should they live?"
    lede="They're large, so you can keep them on another drive if you'd rather."
    footer={<><Button variant="primary" size="lg" onClick={next}>Download</Button><Button variant="secondary">Change…</Button></>}>
      <TextField label="Folder" mono value="%LOCALAPPDATA%\\com.example.stillsong\\components\\" hint="412 GB free on this drive — 40 GB is needed."/>
    </Shell>;

  if(step===4) return <Shell step={4} title={paused?"Paused.":"Setting things up."}
    lede={paused?"Pick it up whenever you like — Stillsong remembers where it got to, even if you close it.":"You can leave this running. It picks up where it left off if the connection drops."}
    footer={<><Button variant={paused?"primary":"secondary"} size="lg" onClick={()=>setPaused(!paused)}>{paused?"Resume":"Pause"}</Button>
      <Button variant="quiet" onClick={next}>(demo: finish)</Button></>}>
      <Panel pad={20} style={{display:"flex",flexDirection:"column",gap:"var(--space-6)"}}>
        <ProgressBar value={1} label="The songwriter" detail="7.4 / 7.4 GB"/>
        <ProgressBar value={paused?.42:.58} indeterminate={!paused} label="The composer" detail={paused?"paused · 6.2 / 14.8 GB":"8.6 / 14.8 GB · 24 MB/s"}/>
        <ProgressBar value={0} label="The sound engine" detail="waiting"/>
        <div style={{display:"flex",justifyContent:"space-between",font:"var(--ui-sm)",color:"var(--text-quiet)",
          paddingTop:14,borderTop:"1px solid var(--border-hairline)"}}>
          <span>16.0 of 25.2 GB</span><span>{paused?"—":"about 6 minutes left"}</span></div>
      </Panel>
    </Shell>;

  return <Shell step={5} title="Almost ready." lede="Warming up the studio and checking everything answers."
    footer={<Button variant="primary" size="lg" onClick={onFinish}>Start with a photo</Button>}>
      <Panel pad={18}>
        <Line icon="check" label="The songwriter answers" value="ok"/>
        <Line icon="check" label="The studio answers" value="ok"/>
        <Line icon="check" label="Instruments found" value="ok"/>
      </Panel>
    </Shell>;
}
window.FirstRunScreen=FirstRunScreen;
