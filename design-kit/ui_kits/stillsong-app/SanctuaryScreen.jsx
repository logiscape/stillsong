const {SongCard,Badge,Icon,IconButton,Panel,Button}=window.StillsongDesignSystem_4faa75;

function SearchField({value,onChange}){
  const [foc,setFoc]=React.useState(false);
  return (
    <label style={{display:"flex",alignItems:"center",gap:9,width:foc||value?260:210,height:34,padding:"0 12px",
      background:"var(--wash-1)",border:"1px solid "+(foc?"var(--brass-line)":"var(--border-hairline)"),
      borderRadius:"var(--radius-pill)",transition:"width var(--dur-base) var(--ease-out)"}}>
      <Icon name="search" size={15} color="var(--ink-4)"/>
      <input value={value} onChange={e=>onChange(e.target.value)} onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}
        placeholder="Search your songs" style={{flex:1,minWidth:0,background:"none",border:"none",outline:"none",font:"var(--ui-sm)",color:"var(--ink-1)"}}/>
    </label>
  );
}

function SanctuaryScreen({onOpen,onCreate}){
  const [q,setQ]=React.useState("");
  const [playing,setPlaying]=React.useState(null);
  const [expanded,setExpanded]=React.useState(null);
  const [empty,setEmpty]=React.useState(false);
  const songs=window.SS_DATA.SONGS.filter(s=>(s.title+s.caption).toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{height:"100%",overflowY:"auto",padding:"var(--space-8) var(--gutter-screen) var(--space-9)"}}>
      <header style={{display:"flex",alignItems:"flex-end",gap:"var(--space-6)",marginBottom:"var(--space-8)"}}>
        <div style={{flex:1}}>
          <span style={{font:"var(--ui-eyebrow)",letterSpacing:"var(--tracking-eyebrow)",textTransform:"uppercase",color:"var(--brass-300)"}}>The Sanctuary</span>
          <h1 style={{font:"var(--display-md)",color:"var(--ink-1)",margin:"8px 0 0",letterSpacing:"var(--tracking-display)"}}>
            {empty?"Nothing here yet":`${songs.length} songs`}</h1>
        </div>
        <SearchField value={q} onChange={setQ}/>
        <Button variant="quiet" onClick={()=>setEmpty(!empty)}>{empty?"(demo: show songs)":"(demo: empty state)"}</Button>
      </header>

      {empty
        ?<button onClick={onCreate} style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,
            width:340,aspectRatio:"4/3",cursor:"pointer",background:"var(--wash-1)",border:"1px dashed var(--border-field)",
            borderRadius:"var(--radius-photo)"}}>
            <Icon name="image-plus" size={26} color="var(--brass-300)"/>
            <span style={{font:"var(--display-sm)",color:"var(--ink-1)"}}>Start with one photo</span>
            <span style={{font:"var(--ui-sm)",color:"var(--text-quiet)"}}>Its song will live here.</span>
          </button>
        :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:"var(--grid-gap)"}}>
          {songs.map(s=>(
            <div key={s.id}>
              <SongCard {...s} playing={playing===s.id} onPlay={()=>setPlaying(playing===s.id?null:s.id)} onOpen={()=>onOpen(s)}/>
              {s.versions>1&&<div style={{marginTop:8}}>
                <button onClick={()=>setExpanded(expanded===s.id?null:s.id)}
                  style={{display:"flex",alignItems:"center",gap:7,background:"none",border:"none",padding:0,cursor:"pointer",
                    font:"var(--ui-sm)",color:"var(--brass-200)"}}>
                  <Icon name={expanded===s.id?"chevron-down":"chevron-right"} size={14}/>{s.versions} versions</button>
                {expanded===s.id&&<Panel variant="quiet" pad={0} style={{marginTop:8,overflow:"hidden"}}>
                  {[{n:"Version 3",d:"today · let it finish",cur:true},{n:"Version 2",d:"12 March · remix"},{n:"Original",d:"11 March"}].map((v,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",
                      borderTop:i?"1px solid var(--border-hairline)":"none",background:v.cur?"var(--wash-1)":"transparent"}}>
                      <Icon name={v.cur?"disc-3":"disc"} size={15} color={v.cur?"var(--brass-200)":"var(--ink-4)"}/>
                      <span style={{flex:1,font:"var(--ui-sm)",color:"var(--ink-1)"}}>{v.n}</span>
                      <span style={{font:"var(--ui-xs)",color:"var(--text-faint)"}}>{v.d}</span>
                      <IconButton icon="play" label="Play version" size={30}/>
                    </div>))}
                </Panel>}
              </div>}
            </div>
          ))}
        </div>}
    </div>
  );
}
window.SanctuaryScreen=SanctuaryScreen;
