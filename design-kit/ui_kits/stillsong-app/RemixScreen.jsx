const {TextField,Panel,Button,SegmentedChoice,Disclosure,LintList,Badge,Icon,IconButton}=window.StillsongDesignSystem_4faa75;

function TagLyrics({value,onChange}){
  const [foc,setFoc]=React.useState(false);
  const html=value.replace(/\[([a-z ]+)\]/g,'<span style="color:var(--brass-200)">[$1]</span>');
  return (
    <div>
      <span style={{display:"block",font:"var(--ui-label)",color:"var(--text-quiet)",marginBottom:"var(--space-3)"}}>Lyrics</span>
      <div style={{position:"relative",border:"1px solid "+(foc?"var(--brass-line)":"var(--border-field)"),
        borderRadius:"var(--radius-sm)",background:"var(--surface-field)",boxShadow:"var(--inset-field)"}}>
        <pre aria-hidden="true" style={{margin:0,padding:"12px 14px",font:"var(--mono-md)",color:"var(--ink-1)",
          whiteSpace:"pre-wrap",minHeight:200}} dangerouslySetInnerHTML={{__html:html}}/>
        <textarea value={value} onChange={e=>onChange(e.target.value)} onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}
          spellCheck={false} style={{position:"absolute",inset:0,width:"100%",height:"100%",padding:"12px 14px",
            font:"var(--mono-md)",color:"transparent",caretColor:"var(--brass-100)",background:"transparent",
            border:"none",outline:"none",resize:"none",whiteSpace:"pre-wrap"}}/>
      </div>
    </div>
  );
}

function RemixScreen({song,onBack,onSubmit}){
  const [title,setTitle]=React.useState(song.title);
  const [caption,setCaption]=React.useState(song.caption);
  const [seed,setSeed]=React.useState("keep");
  const [lyrics,setLyrics]=React.useState("[verse]\n"+(song.stanzas?song.stanzas.join("\n\n[chorus]\n"):"")+"\n\n[outro]\nnearly dark, nearly home");
  return (
    <div style={{height:"100%",overflowY:"auto",padding:"var(--space-8) var(--gutter-screen) var(--space-9)"}}>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:"var(--space-7)"}}>
        <IconButton icon="chevron-left" label="Back" onClick={onBack}/>
        <div style={{flex:1}}>
          <span style={{font:"var(--ui-eyebrow)",letterSpacing:"var(--tracking-eyebrow)",textTransform:"uppercase",color:"var(--brass-300)"}}>Remix</span>
          <h1 style={{font:"var(--display-md)",color:"var(--ink-1)",margin:"6px 0 0",letterSpacing:"var(--tracking-display)"}}>{song.title}</h1>
        </div>
        <Badge mono>renders up to 2:40</Badge>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.5fr) 320px",gap:"var(--space-8)",alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:"var(--space-6)"}}>
          <TextField label="Title" value={title} onChange={setTitle}/>
          <div>
            <TextField label="What's in the photo" multiline rows={3} value={caption} onChange={setCaption}/>
            <div style={{marginTop:10}}><LintList items={caption.length>90?[{level:"warn",message:"This is getting long — the songwriter may skip the end."}]:[]}/></div>
          </div>
          <TagLyrics value={lyrics} onChange={setLyrics}/>
          <SegmentedChoice label="Feel" value={seed} onChange={setSeed} options={[
            {value:"keep",label:"Keep original",icon:"lock"},{value:"new",label:"New seed",icon:"dices"}]}
            style={{maxWidth:320}}/>
          <Disclosure summary="Advanced">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--space-5)",maxWidth:460}}>
              <TextField label="Steps" mono value="30"/><TextField label="Guidance" mono value="4.5"/>
              <TextField label="Encode guidance" mono value="2.0"/><TextField label="Top K" mono value="50"/>
              <TextField label="MP3 quality" mono value="V0"/><TextField label="Tiled decode" mono value="off"/>
            </div>
          </Disclosure>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:"var(--space-5)",position:"sticky",top:0}}>
          <img src={song.photo} alt="" style={{width:"100%",aspectRatio:"4/3",objectFit:"cover",
            borderRadius:"var(--radius-photo)",boxShadow:"var(--shadow-photo)"}}/>
          <Panel variant="quiet" pad={16} style={{font:"var(--ui-sm)",color:"var(--text-quiet)"}}>
            A remix keeps the same photo. It becomes a new version alongside this one.
          </Panel>
          <Button variant="primary" size="lg" fullWidth icon="shuffle" onClick={onSubmit}>Create Remix</Button>
        </div>
      </div>
    </div>
  );
}
window.RemixScreen=RemixScreen;
