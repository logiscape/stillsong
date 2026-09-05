const {Icon,IconButton}=window.StillsongDesignSystem_4faa75;

function TitleBar({title}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,height:38,padding:"0 14px",flex:"0 0 auto",
      borderBottom:"1px solid var(--border-hairline)",background:"var(--ground-deep)"}}>
      <span style={{font:"300 15px/1 var(--font-display)",letterSpacing:".01em",color:"var(--ink-2)"}}>Stillsong</span>
      <span style={{flex:1,textAlign:"center",font:"var(--ui-xs)",color:"var(--text-faint)"}}>{title}</span>
      <div style={{display:"flex",gap:2}}>
        {["minus","square","x"].map(n=><span key={n} style={{display:"flex",alignItems:"center",justifyContent:"center",width:30,height:24}}>
          <Icon name={n} size={11} color="var(--ink-4)"/></span>)}
      </div>
    </div>
  );
}

function NavRail({view,onNav}){
  const items=[{id:"create",icon:"image-plus",label:"Create"},{id:"sanctuary",icon:"layout-grid",label:"Sanctuary"},{id:"settings",icon:"settings",label:"About"}];
  return (
    <nav style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,width:72,padding:"18px 0",flex:"0 0 auto",
      borderRight:"1px solid var(--border-hairline)",background:"var(--ground-deep)"}}>
      {items.map(it=>{
        const on=view===it.id;
        return (
          <button key={it.id} onClick={()=>onNav(it.id)} title={it.label}
            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,width:56,padding:"10px 0",cursor:"pointer",
              background:on?"var(--brass-wash)":"transparent",border:"1px solid "+(on?"var(--brass-line)":"transparent"),
              borderRadius:"var(--radius-md)",color:on?"var(--brass-200)":"var(--ink-3)",
              transition:"all var(--dur-fast) var(--ease-out)"}}>
            <Icon name={it.icon} size={19}/>
            <span style={{font:"var(--ui-xs)",letterSpacing:".01em"}}>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function AppFrame({view,onNav,title,chrome=true,children}){
  return (
    <div style={{position:"relative",display:"flex",flexDirection:"column",width:"100%",height:"100%",overflow:"hidden",background:"var(--ground)"}}>
      <TitleBar title={title}/>
      <div style={{display:"flex",flex:1,minHeight:0}}>
        {chrome&&<NavRail view={view} onNav={onNav}/>}
        <main style={{position:"relative",flex:1,minWidth:0,overflow:"hidden"}}>{children}</main>
      </div>
    </div>
  );
}
Object.assign(window,{AppFrame,NavRail,TitleBar});
