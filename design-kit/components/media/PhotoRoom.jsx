export function PhotoRoom({photo,luminance=.5,scrim="radial",kenBurns=true,children,style,...rest}){
  const bg=scrim==="vertical"?"var(--scrim-vertical)":scrim==="none"?"none":"var(--scrim-radial)";
  return (
    <div style={{position:"relative",width:"100%",height:"100%",overflow:"hidden",background:"var(--ground-deep)",
      ["--photo-lum"]:String(luminance),...style}} {...rest}>
      <img src={photo} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",
        animation:kenBurns?"ss-kenburns var(--dur-kenburns) var(--ease-in-out) infinite alternate":"none"}}/>
      <div style={{position:"absolute",inset:0,background:bg,pointerEvents:"none"}}/>
      <div style={{position:"relative",width:"100%",height:"100%"}}>{children}</div>
    </div>
  );
}
