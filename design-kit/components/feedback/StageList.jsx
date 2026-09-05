import { Icon } from "../core/Icon.jsx";

/* The seven creation stages in warm plain language. Never show engine phases. */
export const CREATION_STAGES=[
  {id:"import",label:"Getting your photo ready…"},
  {id:"look",label:"Looking at your photo…"},
  {id:"write",label:"Writing your song…"},
  {id:"studio",label:"Setting up the studio…"},
  {id:"melody",label:"Composing the melody…"},
  {id:"life",label:"Bringing it to life…"},
  {id:"finish",label:"Finishing touches…"}
];

export function StageList({stages=CREATION_STAGES,activeIndex=0,style,...rest}){
  return (
    <ol style={{listStyle:"none",margin:0,padding:0,display:"flex",flexDirection:"column",gap:"var(--space-4)",...style}} {...rest}>
      {stages.map((s,i)=>{
        const done=i<activeIndex,now=i===activeIndex;
        return (
          <li key={s.id||i} style={{display:"flex",alignItems:"center",gap:"var(--space-4)",
            font:now?"500 16px/1.4 var(--font-ui)":"var(--ui-md)",
            color:now?"var(--ink-1)":done?"var(--text-quiet)":"var(--text-faint)",
            transition:"color var(--dur-slow) var(--ease-out)"}}>
            <span style={{display:"flex",alignItems:"center",justifyContent:"center",width:18,height:18,flex:"0 0 auto"}}>
              {done?<Icon name="check" size={14} color="var(--brass-600)"/>
               :now?<span style={{width:8,height:8,borderRadius:"50%",background:"var(--brass-200)",
                     boxShadow:"0 0 0 6px var(--brass-wash)",animation:"ss-breathe var(--dur-breath) var(--ease-in-out) infinite"}}/>
               :<span style={{width:5,height:5,borderRadius:"50%",background:"var(--line-3)"}}/>}
            </span>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
