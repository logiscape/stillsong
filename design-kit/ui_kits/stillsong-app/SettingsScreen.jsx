const {Panel,Switch,Select,Button,Icon,Badge}=window.StillsongDesignSystem_4faa75;

function Section({title,children}){
  return (
    <section style={{marginBottom:"var(--space-8)"}}>
      <h2 style={{font:"var(--ui-eyebrow)",letterSpacing:"var(--tracking-eyebrow)",textTransform:"uppercase",
        color:"var(--brass-300)",margin:"0 0 var(--space-5)"}}>{title}</h2>
      {children}
    </section>
  );
}

function SettingsScreen(){
  const [scroll,setScroll]=React.useState(true);
  const [contrast,setContrast]=React.useState(false);
  return (
    <div style={{height:"100%",overflowY:"auto",padding:"var(--space-8) var(--gutter-screen) var(--space-9)"}}>
      <div style={{maxWidth:640}}>
        <h1 style={{font:"var(--display-md)",color:"var(--ink-1)",margin:"0 0 var(--space-8)",letterSpacing:"var(--tracking-display)"}}>Stillsong</h1>

        <Section title="Settings">
          <Panel pad={20} style={{display:"flex",flexDirection:"column",gap:"var(--space-6)"}}>
            <Select label="Quality of saved songs" value="V0" options={[{value:"V0",label:"Best (V0)"},{value:"V2",label:"Smaller files (V2)"}]}/>
            <Switch checked={scroll} onChange={setScroll} label="Gently scroll the lyrics while a song plays"
              hint="An estimate — the words aren't timed to the music."/>
            <Switch checked={contrast} onChange={setContrast} label="Always use a solid panel behind lyrics"
              hint="Turns on by itself when your system asks for more contrast."/>
            <div style={{display:"flex",alignItems:"center",gap:14,paddingTop:"var(--space-5)",borderTop:"1px solid var(--border-hairline)"}}>
              <div style={{flex:1}}>
                <div style={{font:"var(--ui-md)",color:"var(--ink-1)"}}>Where the pieces are kept</div>
                <div style={{font:"var(--mono-sm)",color:"var(--text-quiet)",marginTop:3}}>%LOCALAPPDATA%\\com.example.stillsong\\components\\</div>
              </div>
              <Button variant="secondary" size="sm">Verify installation</Button>
            </div>
          </Panel>
        </Section>

        <Section title="About">
          <Panel variant="quiet" pad={20}>
            <div style={{display:"flex",alignItems:"baseline",gap:12}}>
              <span style={{font:"300 30px/1 var(--font-display)",color:"var(--ink-1)"}}>Stillsong</span>
              <Badge mono>1.0.0</Badge>
            </div>
            <p style={{font:"var(--ui-md)",color:"var(--text-body)",margin:"var(--space-5) 0 0",maxWidth:"54ch"}}>
              Stillsong never connects to the internet after setup. Your photos and songs stay on this computer.</p>
            <div style={{marginTop:"var(--space-7)",display:"flex",flexDirection:"column",gap:6,
              font:"var(--ui-sm)",color:"var(--text-quiet)"}}>
              <span style={{font:"var(--ui-label)",color:"var(--text-faint)",letterSpacing:".04em"}}>With thanks to</span>
              <span>Music composed locally by <span style={{color:"var(--ink-1)"}}>MiniMax-Music3</span></span>
              <span>Lyrics by <span style={{color:"var(--ink-1)"}}>Gemma</span></span>
              <span>Engines: <span style={{color:"var(--ink-1)"}}>ComfyUI</span>, <span style={{color:"var(--ink-1)"}}>llama.cpp</span></span>
            </div>
            <div style={{display:"flex",gap:"var(--space-5)",marginTop:"var(--space-7)"}}>
              <Button variant="ghost" size="sm" icon="scroll-text">Licences</Button>
              <Button variant="ghost" size="sm" icon="github">Source</Button>
              <Button variant="ghost" size="sm" icon="folder-open">Open logs folder</Button>
            </div>
          </Panel>
        </Section>
      </div>
    </div>
  );
}
window.SettingsScreen=SettingsScreen;
