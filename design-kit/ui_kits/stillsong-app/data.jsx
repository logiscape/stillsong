const P=s=>`https://picsum.photos/seed/${s}/1200/900`;
const SONGS=[
 {id:1,photo:P("stillsong-harbour"),title:"Harbour, Nearly Dark",genre:"slow folk ballad",length:"2:14",dur:134,date:"12 March",lum:.28,versions:3,
  caption:"A small harbour at dusk, three boats tied up, the water almost still.",
  stanzas:["The gate stays open all evening\nand the rain keeps its own time","We counted the boats twice\nthen stopped counting\nand let the light go","Nearly dark, nearly home —\nthe water holds what's left of the day"]},
 {id:2,photo:P("stillsong-field"),title:"Long Field, Rain",genre:"quiet piano",length:"1:52",dur:112,date:"9 March",lum:.74,
  caption:"A wet field at the edge of evening. Nothing moving but the weather.",instrumental:true},
 {id:3,photo:P("stillsong-window"),title:"Winter Window",genre:"warm ambient",length:"2:41",dur:161,date:"2 March",lum:.62,
  caption:"Frost on the inside of the glass, a mug going cold on the sill.",truncated:true,
  stanzas:["Frost on the inside of the glass\nand your name in it, backwards","I keep the kettle going\nfor a house with one person in it"]},
 {id:4,photo:P("stillsong-kitchen"),title:"Kitchen, Late",genre:"slow soul",length:"3:02",dur:182,date:"27 February",lum:.36,
  caption:"Two plates, one lamp, the radio down low.",stanzas:["Two plates and one lamp on\nthe radio talking to nobody"]},
 {id:5,photo:P("stillsong-road"),title:"The Road Out",genre:"folk waltz",length:"2:28",dur:148,date:"21 February",lum:.55,
  caption:"A gravel road leaving town, hedges tall on both sides.",stanzas:["Gravel and hedges and heat\nand the town getting smaller behind us"]},
 {id:6,photo:P("stillsong-dog"),title:"Old Friend, Sleeping",genre:"lullaby",length:"1:47",dur:107,date:"14 February",lum:.44,
  caption:"He sleeps in the one square of sun that reaches the rug.",instrumental:true}
];
window.SS_DATA={SONGS};
