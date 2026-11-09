/* Data comes from data/slack-data.js, written by sync/build_features.py */
const RAW = (window.SLACK_DATA && window.SLACK_DATA.nights) || [];
const DETAIL = (window.SLACK_DATA && window.SLACK_DATA.detail) || {};
const NEED = (window.SLACK_DATA && window.SLACK_DATA.need) || 470;
const PLACE_TAGS = ["Slept at sea","Away from home","Travel day"];
const TAGS = [...PLACE_TAGS,"Alcohol","Caffeine after 2pm","Late meal","Screens in bed","Hot room","Woke for work","Unwell"];
const NIGHTS = RAW.map(r=>({date:r[0],start:r[1],end:r[2],score:r[3],sleep:r[4],deep:r[5],light:r[6],rem:r[7],awake:r[8],awakeN:r[9],sstress:r[10],rhr:r[11],hrv:r[12],
  ds:r[13],hi:r[14],z45:r[15],z45est:r[16],runHour:r[17],walk:r[18],elev:r[19],lift:r[20],plunge:r[21],steps:r[22],loc:r[23],travel:r[24]}));

try{const T=JSON.parse(localStorage.getItem("slack.tags.v1"))||{};NIGHTS.forEach(n=>{const t=T[n.date]||[];if(t.includes("Slept at sea"))n.loc="off";else if(t.includes("Away from home"))n.loc="away";if(t.includes("Travel day"))n.travel=1;});}catch(e){}
const HAS_GARMIN_SCORE=NIGHTS.some(n=>n.score>0), HAS_HRV=NIGHTS.some(n=>n.hrv!=null);
const $=s=>document.querySelector(s);
const median=a=>{const s=a.filter(ok).sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):0;};
const ok=v=>v!=null&&!Number.isNaN(v);
const mean=a=>{a=a.filter(ok);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;};
const sd=a=>{a=a.filter(ok);const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1));};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const min=s=>Math.round(s/60);
const hm=m=>`${Math.floor(m/60)}h ${String(Math.round(m%60)).padStart(2,"0")}`;
const ukTime=t=>new Date(t*1000).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
const ukHours=t=>{const [h,m]=ukTime(t).split(":").map(Number);let x=h+m/60;return x<15?x+24:x;};
const dayName=d=>new Date(d+"T12:00:00Z").toLocaleDateString("en-GB",{weekday:"short"});
const fullDate=d=>new Date(d+"T12:00:00Z").toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});
const shortDate=d=>new Date(d+"T12:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short"});
const nightOf=d=>{const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()-1);return x.toISOString().slice(0,10);};
const longDay=d=>new Date(d+"T12:00:00Z").toLocaleDateString("en-GB",{weekday:"long"});
const nightName=d=>`${longDay(nightOf(d))} night`;
const nightSpan=d=>{const a=new Date(nightOf(d)+"T12:00:00Z"),b=new Date(d+"T12:00:00Z");return a.getUTCMonth()===b.getUTCMonth()?`${a.getUTCDate()}–${b.toLocaleDateString("en-GB",{day:"numeric",month:"long"})}`:`${shortDate(nightOf(d))} – ${shortDate(d)}`;};
const sign=x=>(x>0?"+":x<0?"−":"±")+Math.abs(x);
const LOCNAME={off:"At sea",home:"Home",away:"Away"};

/* ---------- baselines + Restoration ---------- */
const MED={deep:median(NIGHTS.map(n=>n.deep)),rem:median(NIGHTS.map(n=>n.rem)),sleep:median(NIGHTS.map(n=>n.sleep)),stress:median(NIGHTS.map(n=>n.sstress))};
NIGHTS.forEach((n,i)=>{
  const p=NIGHTS.slice(Math.max(0,i-7),i), base=p.length>=3?p:NIGHTS.slice(0,7);
  n.hrvBase=mean(base.map(x=>x.hrv)); n.rhrBase=mean(base.map(x=>x.rhr)); n.hrvD=(n.hrv!=null&&n.hrvBase!=null)?n.hrv-n.hrvBase:0;
  const parts=[
    {k:"Duration",w:25,s:clamp(min(n.sleep)/NEED,0,1),why:`${hm(min(n.sleep))} of ${hm(NEED)} needed`},
    {k:"Deep sleep",w:20,s:clamp(n.deep/(MED.deep*1.15),0,1),why:`${min(n.deep)} min vs ${min(MED.deep)} typical`},
    {k:"REM",w:15,s:clamp(n.rem/(MED.rem*1.15),0,1),why:`${min(n.rem)} min vs ${min(MED.rem)} typical`},
    {k:"HRV",w:20,s:n.hrv!=null?clamp(.5+n.hrvD/20,0,1):.5,why:n.hrv!=null?`${n.hrv} ms vs ${(n.hrvBase??n.hrv).toFixed(0)} 7-night average`:"No HRV for this night"},
    {k:"Resting HR",w:10,s:clamp(.5+(n.rhrBase-n.rhr)/8,0,1),why:`${n.rhr} bpm vs ${n.rhrBase.toFixed(0)} average`},
    {k:"Continuity",w:10,s:1-clamp(n.awake/3600,0,1),why:`${min(n.awake)} min awake`}];
  parts.forEach(x=>x.pts=x.s*x.w); n.parts=parts; n.R=Math.round(parts.reduce((a,x)=>a+x.pts,0));
  n.bed=ukHours(n.start);
});
const bedMed={}; ["off","home","away"].forEach(l=>bedMed[l]=median(NIGHTS.filter(n=>n.loc===l).map(n=>n.bed)));
NIGHTS.forEach(n=>n.late=n.bed>bedMed[n.loc]+0.75);
const band=s=>s>=70?"--good":s>=45?"--mid":"--bad";

/* ---------- drivers ---------- */
const plain=n=>!n.travel;
const DRIVERS=[
  {k:"Hard run",d:"20+ min in zones 4–5",yes:n=>n.z45>=20,no:n=>n.z45===0&&plain(n),tip:"Hard efforts hit deep sleep hardest. Cap zones 4–5 at 20 min and finish before midday"},
  {k:"Moderate run",d:"Under 20 min in zones 4–5",yes:n=>n.z45>0&&n.z45<20&&plain(n),no:n=>n.z45===0&&plain(n),tip:"Most of your runs are in the evening. Try mornings for two weeks and compare"},
  {k:"High-stress day at home",d:"Daytime stress 50+",yes:n=>n.loc!=="off"&&n.ds>=50&&plain(n),no:n=>n.loc!=="off"&&n.ds<50&&plain(n),tip:"On stressful home days, protect the evening: no hard training, wind down early"},
  {k:"High-stress day at sea",d:"Daytime stress 50+",yes:n=>n.loc==="off"&&n.ds>=50&&plain(n),no:n=>n.loc==="off"&&n.ds<50&&plain(n),tip:"After a heavy shift, take 30 min to come down before your bunk: no screens, no work messages"},
  {k:"Travel or crew change",d:"Night before or after travelling",yes:n=>n.travel,no:n=>!n.travel,tip:"Bank sleep before crew change: early night two days out, not just one"},
  {k:"Sleeping at sea",d:"vs at home",yes:n=>n.loc==="off"&&plain(n),no:n=>n.loc==="home"&&plain(n)},
  {k:"Away on a trip",d:"vs at home",yes:n=>n.loc==="away"&&plain(n),no:n=>n.loc==="home"&&plain(n)},
  {k:"Late lights-out",d:"45+ min after your usual",yes:n=>n.late&&plain(n),no:n=>!n.late&&plain(n),tip:"Hold lights-out within 45 min of your usual time"},
  {k:"Long walk",d:"2 h or more",yes:n=>n.walk>=120&&plain(n),no:n=>n.walk<120&&plain(n)},
  {k:"Big climb",d:"300 m+ elevation gain",yes:n=>n.elev>=300&&plain(n),no:n=>n.elev<300&&plain(n)},
  {k:"Strength session",d:"Logged in Hevy",yes:n=>n.lift&&plain(n),no:n=>!n.lift&&plain(n)},
  {k:"Cold plunge",d:"Any time of day",yes:n=>n.plunge&&plain(n),no:n=>!n.plunge&&plain(n)},
  {k:"15k+ steps",d:"Days with step data",yes:n=>n.steps!=null&&n.steps>=15000&&plain(n),no:n=>n.steps!=null&&n.steps<15000&&plain(n)}
];
function compare(yesF,noF){
  const Y=NIGHTS.filter(yesF),N=NIGHTS.filter(noF);
  const f=(k)=>mean(Y.map(x=>x[k]))-mean(N.map(x=>x[k]));
  const dR=f("R"), t= Y.length>1&&N.length>1 ? dR/Math.sqrt(sd(Y.map(x=>x.R))**2/Y.length+sd(N.map(x=>x.R))**2/N.length) : 0;
  return {ny:Y.length,nn:N.length,dR:Math.round(dR),dDeep:Math.round(f("deep")/60),dHrv:Math.round(f("hrvD")),dAwake:Math.round(f("awake")/60),t,
    conf: Y.length<3?["w","Too few nights"]: Math.abs(t)>=2.5?["s","Strong"]: Math.abs(t)>=1.6?["l","Likely"]:["w","No clear effect"]};
}
DRIVERS.forEach(d=>Object.assign(d,compare(d.yes,d.no)));

/* ---------- night view ---------- */
let cur=NIGHTS.length-1;
function renderNights(){
  $("#nights").innerHTML=NIGHTS.map((n,i)=>`<button class="nchip" data-i="${i}" aria-pressed="${i===cur}" aria-label="${nightName(n.date)}, ${nightSpan(n.date)}"><span class="d">${dayName(nightOf(n.date))}</span><span class="n">${+nightOf(n.date).slice(8)}</span><span class="bar" style="background:var(${band(n.R)})"></span></button>`).join("");
  $("#nights").querySelectorAll(".nchip").forEach(b=>b.onclick=()=>{cur=+b.dataset.i;renderAll();});
  const sel=$("#nights").querySelector('[aria-pressed="true"]'); sel&&sel.scrollIntoView({inline:"center",block:"nearest"});
}
function ring(score){
  const R=64,C=2*Math.PI*R,col=`var(${band(score)})`;
  $("#ring").innerHTML=`<svg viewBox="0 0 148 148" aria-hidden="true"><circle cx="74" cy="74" r="${R}" fill="none" stroke="var(--surface2)" stroke-width="11"/><circle class="arc" cx="74" cy="74" r="${R}" fill="none" stroke="${col}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><div class="c"><span class="big num" style="color:${col}">${score}</span><span class="lbl">Restoration</span></div>`;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{$("#ring .arc").style.strokeDashoffset=C*(1-score/100);}));
}
function yday(n){
  const c=[];
  c.push([n.loc==="off"?"--off":n.loc==="away"?"--away":"--good",LOCNAME[n.loc]]);
  if(n.travel) c.push(["--awake","Travel day"]);
  if(n.ds!=null) c.push([n.ds>=50?"--bad":n.ds<=35?"--good":"--ink3",`Day stress ${n.ds}`]);
  if(n.z45>0) c.push([n.z45>=20?"--bad":"--light",`Run: ${Math.round(n.z45)} min in Z4–5${n.z45est?" (est.)":""}`]);
  if(n.walk>=60) c.push(["--light",`Walk ${hm(n.walk)}`]);
  if(n.elev>=150) c.push(["--light",`${n.elev} m climbed`]);
  if(n.lift) c.push(["--rem","Strength"]);
  if(n.plunge) c.push(["--light","Cold plunge"]);
  if(n.late) c.push(["--mid",`Late lights-out ${ukTime(n.start)}`]);
  $("#yday").innerHTML=`<span class="chip" style="background:none;padding-left:0">That day:</span>`+c.map(([col,t])=>`<span class="chip"><i style="background:var(${col})"></i>${t}</span>`).join("");
}
const STG={0:["Deep","--deep"],1:["Light","--light"],2:["REM","--rem"],3:["Awake","--awake"]};
const stageAt=(levels,t)=>{for(const l of levels){if(t>=l[0]&&t<l[1])return l[2];}return null;};
function nightStats(n,d){
  const by={0:[],1:[],2:[],3:[]}; (d.hr||[]).forEach(([t,v])=>{const s=stageAt(d.levels,t);if(s!=null)by[s].push(v);});
  const secs={0:n.deep,1:n.light,2:n.rem,3:n.awake}, tot=n.deep+n.light+n.rem+n.awake||1;
  const lo=(d.hr||[]).length?d.hr.reduce((a,b)=>b[1]<a[1]?b:a):null;
  return {rows:[0,1,2,3].map(k=>({k,name:STG[k][0],col:STG[k][1],secs:secs[k],pct:Math.round(secs[k]/tot*100),hr:by[k].length?Math.round(mean(by[k])):null})),lo};
}
function soundSVG(d,W,full,availH){
  const fit=full&&availH?Math.max(.55,Math.min(1,(availH-80)/340)):1;
  const GL=full?46:36, GR=full?14:6, top=6, stH=full?Math.round(170*fit):100, gap=full?30:22, hrH=full?Math.round(170*fit):80, axis=24;
  const H=top+stH+gap+hrH+axis, t0=d.start, t1=d.end, X=t=>GL+(t-t0)/(t1-t0)*(W-GL-GR), fs=full?12:9.5;
  const depth={3:0,2:1,1:2,0:3}, rowH=stH/4, Y=lv=>top+depth[lv]*rowH, hy0=top+stH+gap;
  let s="";
  ["Awake","REM","Light","Deep"].forEach((nm,k)=>{s+=`<text x="${GL-6}" y="${top+k*rowH+rowH/2+4}" font-size="${fs}" fill="var(--ink3)" text-anchor="end">${nm}</text>`;});
  s+=`<rect x="${GL}" y="${top}" width="${W-GL-GR}" height="${stH}" rx="6" fill="var(--surface2)" opacity=".5"/>`;
  d.levels.forEach(([a,b,lv])=>{s+=`<rect x="${X(a).toFixed(1)}" y="${(Y(lv)+2).toFixed(1)}" width="${Math.max(1.2,X(b)-X(a)).toFixed(1)}" height="${(rowH-4).toFixed(1)}" rx="2" fill="var(${STG[lv][1]})"/>`;});
  const hr=d.hr||[];
  if(hr.length>1){
    const vals=hr.map(h=>h[1]), lo=Math.floor((Math.min(...vals)-2)/5)*5, hi=Math.ceil((Math.max(...vals)+2)/5)*5, HY=v=>hy0+(1-(v-lo)/(hi-lo))*hrH;
    d.levels.forEach(([a,b,lv])=>{s+=`<rect x="${X(a).toFixed(1)}" y="${hy0}" width="${Math.max(1.2,X(b)-X(a)).toFixed(1)}" height="${hrH}" fill="var(${STG[lv][1]})" opacity=".2"/>`;});
    const st=(hi-lo)>30?10:5;
    for(let v=lo;v<=hi;v+=st) s+=`<line x1="${GL}" x2="${W-GR}" y1="${HY(v)}" y2="${HY(v)}" stroke="var(--line)"/><text x="${GL-6}" y="${HY(v)+4}" font-size="${fs}" fill="var(--ink3)" text-anchor="end">${v}</text>`;
    let p="",prev=null; hr.forEach(([t,v])=>{p+=(prev!=null&&t-prev<=900?"L":"M")+X(t).toFixed(1)+" "+HY(v).toFixed(1)+" ";prev=t;});
    s+=`<path d="${p}" fill="none" stroke="var(--hr)" stroke-width="${full?1.8:1.4}" stroke-linejoin="round"/>`;
    const L=hr.reduce((a,b)=>b[1]<a[1]?b:a);
    s+=`<circle cx="${X(L[0])}" cy="${HY(L[1])}" r="4.5" fill="var(--hr)" stroke="var(--surface)" stroke-width="2"/><text x="${Math.min(W-GR-30,Math.max(GL+30,X(L[0])))}" y="${Math.min(hy0+hrH-4,HY(L[1])+17)}" font-size="${fs+1}" fill="var(--ink)" text-anchor="middle" font-weight="700">Low ${L[1]}</text>`;
    s+=`<text x="${GL-6}" y="${hy0-8}" font-size="${fs}" fill="var(--ink3)" text-anchor="end">bpm</text>`;
    if(hr[0][0]-t0>3600) s+=`<text x="${(X(t0)+X(hr[0][0]))/2}" y="${hy0+hrH/2}" font-size="${fs}" fill="var(--ink3)" text-anchor="middle">no heart rate yet</text>`;
  } else s+=`<text x="${(GL+W)/2}" y="${hy0+hrH/2}" font-size="${fs}" fill="var(--ink3)" text-anchor="middle">No heart rate for this night</text>`;
  const step=full&&W>700?3600:7200;
  for(let t=Math.ceil(t0/step)*step;t<t1;t+=step) s+=`<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${hy0+hrH}" stroke="var(--ink3)" opacity=".18"/><text x="${X(t)}" y="${H-7}" font-size="${fs}" fill="var(--ink3)" text-anchor="middle">${ukTime(t)}</text>`;
  s+=`<line class="xh" x1="0" x2="0" y1="${top}" y2="${hy0+hrH}" stroke="var(--ink)" stroke-width="1.2" style="display:none"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${full?W:"100%"}" height="${full?H:"auto"}" data-t0="${t0}" data-t1="${t1}" data-gl="${GL}" data-gr="${GR}" data-w="${W}" role="img" aria-label="Sleep stages with heart rate underneath">${s}</svg>`;
}
function statsHTML(n,d){
  const S=nightStats(n,d);
  return `<div class="sgrid">${S.rows.map(r=>`<div class="sg"><span class="sw" style="background:var(${r.col})"></span><b>${r.name}</b><span class="num">${hm(min(r.secs))}</span><span>${r.pct}%</span><span>${r.hr!=null?`avg ${r.hr} bpm`:"–"}</span></div>`).join("")}</div>`+
    (S.lo?`<p class="sub" style="margin:10px 0 0">Lowest heart rate ${S.lo[1]} bpm at ${ukTime(S.lo[0])}, ${hm(Math.round((S.lo[0]-d.start)/60))} after lights-out.${(()=>{const dp=S.rows[0].hr,aw=S.rows[3].hr,lt=S.rows[1].hr;return dp&&lt?` Deep sleep ran ${lt-dp>0?lt-dp+" bpm below":"level with"} light sleep${aw?`, and ${aw-dp} below your awake moments`:""}.`:"";})()}</p>`:"");
}
function sounding(n){
  const d=DETAIL[n.date];
  const stages=[["Deep",n.deep,"--deep"],["Light",n.light,"--light"],["REM",n.rem,"--rem"],["Awake",n.awake,"--awake"]];
  if(!d){$("#sounding").innerHTML=`<h3>Stage mix</h3><p class="sub">${ukTime(n.start)} – ${ukTime(n.end)}</p><div class="stagebar">${stages.map(s=>`<span style="flex:${s[1]};background:var(${s[2]})"></span>`).join("")}</div><div class="legend">${stages.map(s=>`<span><i style="background:var(${s[2]})"></i>${s[0]} ${hm(min(s[1]))}</span>`).join("")}</div>`;$("#sounding").onclick=null;return;}
  $("#sounding").innerHTML=`<div class="shead"><h3>Sleep stages and heart rate</h3><span class="expand">Tap to expand ⤢</span></div><p class="sub">Shaded bands under the heart rate line match the stage above it.</p>${soundSVG(d,360,false)}${statsHTML(n,d)}`;
  $("#sounding").onclick=()=>openFull(n);
}
function openFull(n){
  const d=DETAIL[n.date]; if(!d) return;
  let ov=$("#full"); if(!ov){ov=document.createElement("div");ov.id="full";document.body.appendChild(ov);}
  const draw=()=>{
    const W=Math.max(window.innerWidth-24,900);
    ov.innerHTML=`<div class="fhead"><div><b>${nightName(n.date)}, ${nightSpan(n.date)}</b><span>${ukTime(n.start)} – ${ukTime(n.end)}</span></div><button class="fclose" aria-label="Close">✕</button></div>
      <div class="readout" id="readout">Touch the chart to read stage and heart rate at any time</div>
      <div class="fscroll">${soundSVG(d,W,true,window.innerHeight-110)}</div>
      <div class="fstats">${statsHTML(n,d)}<p class="sub" style="margin-top:8px">${window.innerWidth<window.innerHeight?"Turn your phone sideways for a wider view, or scroll the chart.":""}</p></div>`;
    ov.querySelector(".fclose").onclick=()=>{ov.remove();window.removeEventListener("resize",draw);document.body.style.overflow="";};
    const svg=ov.querySelector("svg"), xh=svg.querySelector(".xh"), t0=+svg.dataset.t0, t1=+svg.dataset.t1, gl=+svg.dataset.gl, gr=+svg.dataset.gr, w=+svg.dataset.w;
    const move=e=>{const r=svg.getBoundingClientRect(), x=(e.clientX-r.left)*(w/r.width); if(x<gl||x>w-gr) return;
      const t=t0+(x-gl)/(w-gl-gr)*(t1-t0), st=stageAt(d.levels,t), near=(d.hr||[]).reduce((a,b)=>Math.abs(b[0]-t)<Math.abs(a[0]-t)?b:a,[0,null]);
      xh.setAttribute("x1",x);xh.setAttribute("x2",x);xh.style.display="";
      $("#readout").innerHTML=`<b>${ukTime(t)}</b>${st!=null?`<span><i style="background:var(${STG[st][1]})"></i>${STG[st][0]}</span>`:""}${near[1]!=null&&Math.abs(near[0]-t)<900?`<span style="color:var(--hr)">♥ ${near[1]} bpm</span>`:""}`;};
    svg.addEventListener("pointermove",move); svg.addEventListener("pointerdown",move);
  };
  draw(); document.body.style.overflow="hidden"; window.addEventListener("resize",draw);
}
function tile(k,v,unit,dlt,good){return `<div class="tile"><div class="k">${k}</div><div class="v num">${v}<small>${unit}</small></div><div class="dlt ${good===true?"up":good===false?"down":""}">${dlt}</div></div>`;}
function tiles(n){
  const asleep=min(n.sleep),dd=min(n.deep-MED.deep),rd=min(n.rem-MED.rem),hd=Math.round(n.hrvD),rh=Math.round(n.rhr-n.rhrBase),d=DETAIL[n.date];
  $("#tiles").innerHTML=
    tile("Asleep",hm(asleep).replace(" ","<small>h</small>").replace("h",""),"m",`${sign(asleep-NEED)} min vs need`,asleep>=NEED?true:asleep<NEED-45?false:null)+
    tile("Deep",min(n.deep),"min",`${sign(dd)} vs usual`,dd>=10?true:dd<=-10?false:null)+
    tile("REM",min(n.rem),"min",`${sign(rd)} vs usual`,rd>=10?true:rd<=-10?false:null)+
    (n.hrv!=null?tile("HRV",n.hrv,"ms",`${sign(hd)} vs 7-night`,hd>=4?true:hd<=-4?false:null):tile("HRV","–","","not shared",null))+
    tile("Resting HR",n.rhr,"bpm",`${sign(rh)} vs 7-night`,rh<=-2?true:rh>=2?false:null)+
    (d&&d.bb?tile("Body Battery",`${d.bb[0]}→${d.bb[1]}`,"",`+${d.bb[1]-d.bb[0]} overnight`,null):tile("Wake-ups",n.awakeN,"",`${min(n.awake)} min awake`,n.awakeN<=1?true:n.awakeN>=4?false:null));
}
const D=k=>DRIVERS.find(d=>d.k===k);
function insights(i){
  const n=NIGHTS[i],out=[],d=DETAIL[n.date],gap=n.R-n.score;
  if(n.score>0&&gap>=12) out.push({c:"--light",t:`Garmin scored this ${n.score}. The sleep itself was better than that.`,s:n.sstress>=30?`Most of Garmin’s penalty is overnight stress (${n.sstress}, typical ${MED.stress}). Duration and stages were on or above your norm.`:`Your duration and stage mix were on or above your norm.`});
  if(n.score>0&&gap<=-12) out.push({c:"--mid",t:`Garmin’s ${n.score} flatters this night`,s:`Against your own baselines the structure was weak. See the breakdown below.`});
  if(n.z45>=20){const h=D("Hard run");out.push({c:"--bad",t:`Hard run the day before: ${Math.round(n.z45)} min in zones 4–5`,s:`Across your ${h.ny} hard runs, the next night averaged ${sign(h.dDeep)} min deep sleep and ${sign(h.dHrv)} ms HRV. This night: ${sign(min(n.deep-MED.deep))} min deep.`});}
  if(n.travel){const h=D("Travel or crew change");out.push({c:"--awake",t:"Travel night",s:`Travel nights cost you ${Math.abs(h.dR)} Restoration points on average. Expect it and plan an early night after.`});}
  if(n.ds>=50&&!n.travel){const h=D(n.loc==="off"?"High-stress day at sea":"High-stress day at home");out.push({c:"--bad",t:`Stressful day (${n.ds}) ${n.loc==="off"?"at sea":"at home"}`,s:n.loc==="off"?`At sea this usually doesn’t touch your sleep (${sign(h.dR)} points on average).`:`At home, days like this cost you ${Math.abs(h.dR)} points on average.`});}
  const dd=min(n.deep-MED.deep);
  if(Math.abs(dd)>=15&&n.z45<20) out.push({c:dd>0?"--good":"--bad",t:dd>0?`${dd} min more deep sleep than usual`:`${-dd} min short on deep sleep`,s:dd>0?(n.deep===Math.max(...NIGHTS.map(x=>x.deep))?"Your best deep-sleep night on record. ":"")+`Physical repair night; good base for training today.`:`Deep sleep front-loads into the first hours. Hard evening efforts and late lights-out are your usual suspects.`});
  const hd=n.hrvD; if(Math.abs(hd)>=5) out.push({c:hd>0?"--good":"--bad",t:`HRV ${hd>0?"up":"down"} ${Math.abs(hd).toFixed(0)} ms on your 7-night average`,s:hd>0?`Trending towards recovered.`:`Keep today easy if it repeats tomorrow.`});
  if(d&&d.bb&&d.bb[0]<=15) out.push({c:"--awake",t:"Went to bed almost empty",s:`Body Battery ${d.bb[0]} at lights-out, recharged to ${d.bb[1]}. One night won’t clear that deficit.`});
  if(n.awakeN>=4) out.push({c:"--bad",t:`${n.awakeN} wake-ups`,s:`${min(n.awake)} min awake in total. Fragmented nights cost more than short ones.`});
  if(!out.length) out.push({c:"--ink3",t:"A typical night for you",s:"Nothing stood out against your baselines."});
  return out;
}
function renderTonight(){
  const n=NIGHTS[cur],s=n.R,h=s>=80?"Fully restored":s>=70?"Well recovered":s>=55?"Partly recovered":s>=45?"Running on reserve":"Under-recovered";
  ring(s); $("#verdict").innerHTML=`<h2>${h}</h2><p>${nightName(n.date)}, ${nightSpan(n.date)}<br>${ukTime(n.start)} – ${ukTime(n.end)}</p>${n.score>0?`<span class="vs">Garmin <b class="num">${n.score}</b></span>`:""}`;
  yday(n); sounding(n); tiles(n);
  $("#ins").innerHTML=insights(cur).map(x=>`<li><span class="tick" style="background:var(${x.c})"></span><div><b>${x.t}</b><span>${x.s}</span></div></li>`).join("");
  $("#bd").innerHTML=n.parts.map(p=>`<span class="nm">${p.k}</span><div><div class="track"><div class="fill" style="width:${p.s*100}%;background:var(${band(p.s*100)})"></div></div><div style="font-size:11.5px;color:var(--ink3);margin-top:3px">${p.why}</div></div><span class="pts num">${p.pts.toFixed(0)}/${p.w}</span>`).join("");
}

/* ---------- drivers view ---------- */
function renderDrivers(){
  const ranked=[...DRIVERS].filter(d=>d.ny>=3).sort((a,b)=>Math.abs(b.t)-Math.abs(a.t));
  $("#drivers").innerHTML=ranked.map(d=>{
    const w=clamp(Math.abs(d.dR)/20*50,2,50), col=d.dR>=0?"--good":"--bad";
    return `<div class="drv"><div class="top"><span class="nm">${d.k}<br><span style="font-weight:400;font-size:12.5px;color:var(--ink3)">${d.d}</span></span><span class="eff num" style="color:var(${Math.abs(d.dR)<3?"--ink3":col})">${sign(d.dR)}</span></div>
    <div class="divbar"><span style="background:var(${col});${d.dR>=0?`left:50%;width:${w}%`:`right:50%;width:${w}%`}"></span></div>
    <div class="row"><div>Deep<b>${sign(d.dDeep)} min</b></div><div>HRV<b>${sign(d.dHrv)} ms</b></div><div>Awake<b>${sign(d.dAwake)} min</b></div></div>
    <div class="meta"><span>${d.ny} nights vs ${d.nn}</span><span class="conf ${d.conf[0]}">${d.conf[1]}</span></div></div>`;}).join("")+
    `<p class="empty" style="margin-top:12px;font-size:12.5px">Effects are differences in averages, not proof of cause. Some run intensities before mid-September are estimated from average heart rate.</p>`;
  // buckets
  const H=NIGHTS.filter(n=>n.loc==="home"&&!n.travel);
  const B=[["Before 22:30",n=>n.bed<22.5],["22:30–23:30",n=>n.bed>=22.5&&n.bed<23.5],["After 23:30",n=>n.bed>=23.5]].map(([k,f])=>{const g=H.filter(f);return {k,n:g.length,v:g.length?Math.round(mean(g.map(x=>x.R))):null};});
  const best=Math.max(...B.filter(b=>b.n>=3).map(b=>b.v));
  $("#buckets").innerHTML=B.map(b=>`<div class="bk ${b.v===best?"best":""}"><div class="v num" style="color:var(${b.v==null?"--ink3":band(b.v)})">${b.v??"–"}</div><div class="k">${b.k}<br>${b.n} nights</div></div>`).join("");
  // playbook
  const neg=ranked.filter(d=>d.dR<=-3&&d.conf[0]!=="w"&&d.tip);
  const g=neg.map(d=>`<li><b>${d.k}:</b> ${d.tip}. <span style="color:var(--ink3)">(${sign(d.dR)} points, ${d.conf[1].toLowerCase()})</span></li>`);
  const bb=B.find(b=>b.v===best); if(bb) g.push(`<li><b>Lights-out at home:</b> aim for ${bb.k.toLowerCase()}, your best window (${bb.v} average).</li>`);
  const sea=D("Sleeping at sea"); if(sea.dR>=3) g.push(`<li><b>Copy your sea routine at home:</b> you sleep ${sea.dR} points better offshore. The fixed schedule is the likely reason.</li>`);
  $("#guide").innerHTML=g.join("")||`<li>No factor stands out strongly yet. Keep tagging nights.</li>`;
  $("#gsub").textContent=`Built from ${NIGHTS.length} nights since ${shortDate(NIGHTS[0].date)}, strongest effects first`;
}

/* ---------- trends ---------- */
let metric="recovery";
function bandsSVG(X,T,Hh,L){
  let s="",startI=null;
  NIGHTS.forEach((n,i)=>{const isB=n.loc!=="home";if(isB&&startI===null)startI=i;if((!isB||i===NIGHTS.length-1)&&startI!==null){const e=isB?i:i-1;const col=NIGHTS[startI].loc==="off"?"--off":"--away";s+=`<rect x="${X(startI)-2}" width="${X(e)-X(startI)+4}" y="${T}" height="${Hh}" fill="var(${col})" opacity=".09"/>`;startI=null;}});
  return s;
}
function lineChart({series,yMin,yMax,fmt=v=>v,unit=""}){
  const W=360,H=210,L=30,R=6,T=10,B=26,n=NIGHTS.length,X=i=>L+i*(W-L-R)/(n-1),Y=v=>T+(1-(v-yMin)/(yMax-yMin))*(H-T-B);
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img">`+bandsSVG(X,T,H-T-B,L);
  for(let k=0;k<=4;k++){const g=yMin+k*(yMax-yMin)/4;s+=`<line x1="${L}" x2="${W-R}" y1="${Y(g)}" y2="${Y(g)}" stroke="var(--line)"/><text x="${L-6}" y="${Y(g)+3}" font-size="9.5" fill="var(--ink3)" text-anchor="end">${fmt(Math.round(g))}</text>`;}
  series.forEach(se=>{const d=se.v.map((v,i)=>v==null?null:`${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).filter(Boolean).map((p,k)=>(k?"L":"M")+p).join(" ");
    s+=`<path d="${d}" fill="none" stroke="var(${se.c})" stroke-width="${se.w||1.6}" ${se.dash?`stroke-dasharray="${se.dash}"`:""} opacity="${se.o||1}" stroke-linejoin="round"/>`;
    if(se.dots) s+=se.v.map((v,i)=>v==null?"":`<circle cx="${X(i)}" cy="${Y(v)}" r="${i===cur?4:1.6}" fill="var(${se.c})"/>`).join("");});
  NIGHTS.forEach((nn,i)=>{if(nn.date.endsWith("-01")||i===n-1)s+=`<text x="${X(i)}" y="${H-8}" font-size="9.5" fill="var(--ink3)" text-anchor="middle">${shortDate(nn.date)}</text>`;});
  return s+"</svg>";
}
const roll=(k,w=7)=>NIGHTS.map((n,i)=>i<w-1?null:mean(NIGHTS.slice(i-w+1,i+1).map(x=>x[k])));
const LEG=`<span><i style="background:var(--off);opacity:.5"></i>At sea</span><span><i style="background:var(--away);opacity:.5"></i>Away</span>`;
function renderTrends(){
  const first=mean(NIGHTS.slice(0,14).map(n=>n.hrv)),last=mean(NIGHTS.slice(-14).map(n=>n.hrv)),r1=mean(NIGHTS.slice(0,14).map(n=>n.rhr)),r2=mean(NIGHTS.slice(-14).map(n=>n.rhr));
  $("#slide").style.display=HAS_HRV?"":"none";
  $("#slide").innerHTML=`<h3>Your recovery has slid since August</h3><p class="sub" style="margin:0">HRV ${Math.round(first)} → ${Math.round(last)} ms and resting HR ${Math.round(r1)} → ${Math.round(r2)} bpm, first fortnight vs last. That’s bigger than any nightly factor. Load, alcohol, illness or a device change can all cause it; worth a closer look if you feel run-down.</p>`;
  let html="";
  if(metric==="recovery") html=`<h3>HRV and resting heart rate</h3><p class="sub">Dots are nights, lines are 7-night averages</p>`+
    lineChart({series:[{v:NIGHTS.map(n=>n.hrv),c:"--rem",dots:true,w:0},{v:roll("hrv"),c:"--rem",w:2.4},{v:NIGHTS.map(n=>n.rhr),c:"--hr",dots:true,w:0},{v:roll("rhr"),c:"--hr",w:2.4}],yMin:20,yMax:100})+
    `<div class="legend"><span><i style="background:var(--rem)"></i>HRV (ms)</span><span><i style="background:var(--hr)"></i>Resting HR (bpm)</span>${LEG}</div>`;
  else if(metric==="score") html=`<h3>Restoration vs Garmin</h3><p class="sub">7-night averages</p>`+
    lineChart({series:[{v:NIGHTS.map(n=>n.R),c:"--good",dots:true,w:0,o:.6},{v:roll("R"),c:"--good",w:2.4},...(HAS_GARMIN_SCORE?[{v:roll("score"),c:"--ink3",dash:"4 3",w:1.6}]:[])],yMin:20,yMax:100})+
    `<div class="legend"><span><i style="background:var(--good)"></i>Restoration</span><span><i style="background:var(--ink3)"></i>Garmin</span>${LEG}</div>`;
  else if(metric==="deep"){NIGHTS.forEach(n=>n.deepM=n.deep/60);html=`<h3>Deep sleep</h3><p class="sub">Minutes per night; red dots follow a hard run</p>`+
    lineChart({series:[{v:NIGHTS.map(n=>n.deepM),c:"--deep",dots:true,w:0},{v:roll("deepM"),c:"--deep",w:2.4},{v:NIGHTS.map(n=>n.z45>=20?n.deepM:null),c:"--bad",dots:true,w:0}],yMin:0,yMax:120})+
    `<div class="legend"><span><i style="background:var(--deep)"></i>Deep</span><span><i style="background:var(--bad)"></i>After hard run</span>${LEG}</div>`;}
  else if(metric==="debt"){NIGHTS.forEach((n,i)=>{n.debtH=i<6?null:NIGHTS.slice(i-6,i+1).reduce((s,x)=>s+Math.max(0,NEED-min(x.sleep)),0)/60;});
    html=`<h3>Rolling sleep debt</h3><p class="sub">Hours short of your ${hm(NEED)} need over the last 7 nights</p>`+lineChart({series:[{v:NIGHTS.map(n=>n.debtH),c:"--awake",w:2.4}],yMin:0,yMax:16,fmt:v=>v+"h"})+`<div class="legend">${LEG}</div>`;}
  else {const fmt=v=>{const h=((-v%24)+24)%24;return String(Math.floor(h)).padStart(2,"0")+":00";};NIGHTS.forEach(n=>{n.bedN=-n.bed;n.wakeN=-ukHours(n.end);});
    html=`<h3>Sleep window</h3><p class="sub">Lights-out (top) and wake (bottom), phone time</p>`+lineChart({series:[{v:NIGHTS.map(n=>n.bedN),c:"--rem",dots:true,w:1},{v:NIGHTS.map(n=>n.wakeN),c:"--light",dots:true,w:1}],yMin:-34,yMax:-18,fmt})+`<div class="legend"><span><i style="background:var(--rem)"></i>Lights-out</span><span><i style="background:var(--light)"></i>Wake</span>${LEG}</div>`;}
  $("#trend").innerHTML=html;
}

/* ---------- journal ---------- */
const KEY="slack.tags.v1";
const loadTags=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{};}catch(e){return {};}};
const saveTags=t=>{try{localStorage.setItem(KEY,JSON.stringify(t));}catch(e){}};
function renderJournal(){
  const n=NIGHTS[cur],all=loadTags(),mine=all[n.date]||[];
  $("#jtitle").textContent=`Tag ${nightName(n.date)} (${nightSpan(n.date)})`;
  $("#tags").innerHTML=TAGS.map(t=>`<button class="tag" aria-pressed="${mine.includes(t)}">${t}</button>`).join("");
  $("#tags").querySelectorAll(".tag").forEach(b=>b.onclick=()=>{const t=b.textContent,a=loadTags(),s=new Set(a[n.date]||[]);s.has(t)?s.delete(t):s.add(t);a[n.date]=[...s];saveTags(a);if(PLACE_TAGS.includes(t))location.reload();else renderJournal();});
  const rows=TAGS.filter(t=>!PLACE_TAGS.includes(t)).map(t=>{const c=compare(x=>(all[x.date]||[]).includes(t),x=>!(all[x.date]||[]).includes(t));return c.ny>=3?`<div class="eff"><span class="t">${t}</span><span class="s num ${c.dR>=3?"up":c.dR<=-3?"down":""}">${sign(c.dR)}</span><span class="m">${sign(c.dDeep)} min deep, ${sign(c.dHrv)} ms HRV, ${c.ny} nights, ${c.conf[1].toLowerCase()}</span></div>`:"";}).join("");
  const tagged=Object.values(all).filter(v=>v.length).length;
  $("#effects").innerHTML=rows||`<p class="empty">Tag a habit on at least 3 nights to see its effect. ${tagged?`${tagged} night${tagged>1?"s":""} tagged so far.`:"Start with last night, then work back using the dates at the top."}</p>`;
}


/* ---------- weekly report ---------- */
const isoMonday=d=>{const x=new Date(d+"T12:00:00Z");const wd=(x.getUTCDay()+6)%7;x.setUTCDate(x.getUTCDate()-wd);return x.toISOString().slice(0,10);};
const addDays=(d,k)=>{const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+k);return x.toISOString().slice(0,10);};
const WEEKS=[...new Set(NIGHTS.map(n=>isoMonday(nightOf(n.date))))].sort();
let wk=WEEKS.length-1;
function weekStats(mon){
  const ns=NIGHTS.filter(n=>isoMonday(nightOf(n.date))===mon); if(!ns.length) return null;
  const a=k=>mean(ns.map(n=>n[k]));
  const debt=ns.reduce((s,n)=>s+Math.max(0,NEED-min(n.sleep)),0);
  return {mon,ns,n:ns.length,R:a("R"),sleep:a("sleep")/60,deep:a("deep")/60,rem:a("rem")/60,hrv:a("hrv"),rhr:a("rhr"),debt,
    hit:ns.filter(n=>min(n.sleep)>=NEED).length, bedSd:sd(ns.map(n=>n.bed))*60,
    runs:ns.filter(n=>n.z45>0).length, hard:ns.filter(n=>n.z45>=20).length, late:ns.filter(n=>n.late).length,
    stress:ns.filter(n=>n.ds>=50).length, travel:ns.filter(n=>n.travel).length,
    locs:[...new Set(ns.map(n=>n.loc))], best:ns.reduce((a,b)=>b.R>a.R?b:a), worst:ns.reduce((a,b)=>b.R<a.R?b:a)};
}
function reasons(n){
  const r=[]; if(n.travel) r.push("travel"); if(n.z45>=20) r.push(`hard run (${Math.round(n.z45)} min Z4–5)`); else if(n.z45>0) r.push("run the day before");
  if(n.late) r.push(`lights-out ${ukTime(n.start)}`); if(n.ds>=50) r.push(`stress ${n.ds}`); if(n.awakeN>=4) r.push(`${n.awakeN} wake-ups`);
  if(min(n.deep)>=90) r.push(`${min(n.deep)} min deep`); if(n.hrvD>=6) r.push("HRV up"); if(min(n.sleep)>=NEED) r.push("met sleep need");
  return r.length?r.join(", "):"nothing unusual";
}
function focus(w){
  const f=[];
  if(w.late>=2) f.push(`Lights-out ran late on ${w.late} nights. Hold it within 45 min of your usual time; it’s your biggest single lever (${sign(D("Late lights-out").dR)} points).`);
  if(w.runs>=2) f.push(`${w.runs} runs this week, mostly evenings. Move at least one to the morning and compare the nights after.`);
  if(w.hard>=1) f.push(`Keep zone 4–5 time under 20 min; hard sessions cost you ${Math.abs(D("Hard run").dDeep)} min of deep sleep on average.`);
  if(w.debt>=180) f.push(`You’re ${hm(w.debt)} short of your sleep need over the week. Two earlier nights would clear most of it.`);
  if(w.bedSd>=60) f.push(`Bedtime varied by ±${Math.round(w.bedSd)} min. Your best weeks are the consistent ones.`);
  if(w.stress>=3 && w.locs.includes("off")) f.push(`${w.stress} high-stress days. After heavy shifts, give yourself 30 min to come down before the bunk.`);
  if(!f.length) f.push("A solid week. Keep the same routine.");
  return f.slice(0,4);
}
function weekText(w,p){
  const L=[`Slack weekly report: ${shortDate(w.mon)} – ${shortDate(addDays(w.mon,6))}`,
  `Restoration ${Math.round(w.R)}${p?` (${sign(Math.round(w.R-p.R))} vs last week)`:""}`,
  `Sleep ${hm(w.sleep)} avg, need met ${w.hit}/${w.n}, debt ${hm(w.debt)}`,
  `Deep ${Math.round(w.deep)} min, REM ${Math.round(w.rem)} min, HRV ${Math.round(w.hrv)} ms, resting HR ${Math.round(w.rhr)}`,
  `Best: ${nightName(w.best.date)} ${w.best.R} (${reasons(w.best)})`,`Toughest: ${nightName(w.worst.date)} ${w.worst.R} (${reasons(w.worst)})`,"Focus:",...focus(w).map(x=>"- "+x)];
  return L.join("\n");
}
function renderWeek(){
  const w=weekStats(WEEKS[wk]), p=wk>0?weekStats(WEEKS[wk-1]):null;
  const partial=wk===WEEKS.length-1&&w.n<7;
  const dl=(v,pv,good=1,fmt=x=>Math.round(x))=>p?`<span class="${(v-pv)*good>0.5?"up":(v-pv)*good<-0.5?"down":""}">${sign(fmt(v-pv))} vs last week</span>`:"";
  // bars
  const W=360,H=130,bw=W/7;
  let bars=`<svg viewBox="0 0 ${W} ${H+22}" role="img" aria-label="Restoration by night">`;
  for(let k=0;k<7;k++){const d=addDays(w.mon,k),n=NIGHTS.find(x=>nightOf(x.date)===d),x=k*bw+bw*.18,bwid=bw*.64;
    if(n){const h=n.R/100*H;bars+=`<rect x="${x}" y="${H-h}" width="${bwid}" height="${h}" rx="5" fill="var(${band(n.R)})"/><text x="${x+bwid/2}" y="${H-h-5}" font-size="11" fill="var(--ink)" text-anchor="middle" font-weight="700">${n.R}</text>`;}
    else bars+=`<rect x="${x}" y="${H-6}" width="${bwid}" height="6" rx="3" fill="var(--surface2)"/>`;
    bars+=`<text x="${x+bwid/2}" y="${H+16}" font-size="11" fill="var(--ink3)" text-anchor="middle">${dayName(d)}</text>`;}
  bars+="</svg>";
  $("#week").innerHTML=`
  <div class="wkhead"><button class="wnav" id="wprev" aria-label="Previous week" ${wk===0?"disabled":""}>‹</button>
    <div><h2>${shortDate(w.mon)} – ${shortDate(addDays(w.mon,6))}${partial?" (so far)":""}</h2><p>${w.n} nights, ${w.locs.map(l=>LOCNAME[l]).join(" and ")}</p></div>
    <button class="wnav" id="wnext" aria-label="Next week" ${wk===WEEKS.length-1?"disabled":""}>›</button></div>
  <div class="card"><div class="wkscore"><span class="num" style="color:var(${band(w.R)})">${Math.round(w.R)}</span><div><b>Average Restoration</b><br>${dl(w.R,p&&p.R)}</div></div>${bars}</div>
  <div class="tiles">
    ${tile("Avg sleep",hm(w.sleep).replace(" ","<small>h</small>").replace("h",""),"m",`need met ${w.hit}/${w.n}`,w.hit>=w.n/2?true:w.hit===0?false:null)}
    ${tile("Sleep debt",hm(w.debt).replace(" ","<small>h</small>").replace("h",""),"m","this week",w.debt<90?true:w.debt>240?false:null)}
    ${tile("Bedtime",`±${Math.round(w.bedSd)}`,"min","consistency",w.bedSd<40?true:w.bedSd>75?false:null)}
    ${tile("Deep",Math.round(w.deep),"min",p?`${sign(Math.round(w.deep-p.deep))} vs last week`:"avg",p?(w.deep-p.deep>=5?true:w.deep-p.deep<=-5?false:null):null)}
    ${tile("HRV",Math.round(w.hrv),"ms",p?`${sign(Math.round(w.hrv-p.hrv))} vs last week`:"avg",p?(w.hrv-p.hrv>=3?true:w.hrv-p.hrv<=-3?false:null):null)}
    ${tile("Resting HR",Math.round(w.rhr),"bpm",p?`${sign(Math.round(w.rhr-p.rhr))} vs last week`:"avg",p?(w.rhr-p.rhr<=-1?true:w.rhr-p.rhr>=1?false:null):null)}
  </div>
  <div class="card"><h3>This week’s factors</h3><div class="chips" style="margin-top:6px">
    <span class="chip"><i style="background:var(--light)"></i>${w.runs} run${w.runs===1?"":"s"}${w.hard?`, ${w.hard} hard`:""}</span>
    <span class="chip"><i style="background:var(--mid)"></i>${w.late} late lights-out</span>
    <span class="chip"><i style="background:var(--bad)"></i>${w.stress} high-stress day${w.stress===1?"":"s"}</span>
    ${w.travel?`<span class="chip"><i style="background:var(--awake)"></i>${w.travel} travel night${w.travel===1?"":"s"}</span>`:""}</div>
    <ul class="ins" style="margin-top:12px">
      <li><span class="tick" style="background:var(--good)"></span><div><b>Best: ${nightName(w.best.date)} ${+nightOf(w.best.date).slice(8)}, ${w.best.R}</b><span>${reasons(w.best)}</span></div></li>
      <li><span class="tick" style="background:var(--bad)"></span><div><b>Toughest: ${nightName(w.worst.date)} ${+nightOf(w.worst.date).slice(8)}, ${w.worst.R}</b><span>${reasons(w.worst)}</span></div></li>
    </ul></div>
  <div class="card guide"><h3>Focus for next week</h3><ol>${focus(w).map(x=>`<li>${x}</li>`).join("")}</ol>
    <button class="copy" id="wcopy">Copy report as text</button></div>`;
  $("#wprev").onclick=()=>{wk--;renderWeek();}; $("#wnext").onclick=()=>{wk++;renderWeek();};
  $("#wcopy").onclick=async e=>{try{await navigator.clipboard.writeText(weekText(w,p));e.target.textContent="Copied";}catch(err){e.target.textContent="Copy isn’t available here";}};
}

/* ---------- long-term analysis ---------- */
function slope(ys){const P=ys.map((y,i)=>[i,y]).filter(p=>ok(p[1]));if(P.length<3)return 0;const mx=mean(P.map(p=>p[0])),my=mean(P.map(p=>p[1]));let a=0,b=0;P.forEach(([x,y])=>{a+=(x-mx)*(y-my);b+=(x-mx)**2;});return a/b;}
function blocks(){
  const out=[];let curB=null;
  NIGHTS.forEach(n=>{if(n.travel)return; if(!curB||curB.loc!==n.loc){curB={loc:n.loc,ns:[]};out.push(curB);} curB.ns.push(n);});
  return out.filter(b=>b.ns.length>=3).map(b=>({loc:b.loc,from:b.ns[0].date,to:b.ns[b.ns.length-1].date,n:b.ns.length,R:mean(b.ns.map(x=>x.R)),hrv:mean(b.ns.map(x=>x.hrv)),
    early:mean(b.ns.slice(0,3).map(x=>x.R)),rest:b.ns.length>5?mean(b.ns.slice(3).map(x=>x.R)):null}));
}
function renderLong(){
  const months=[...new Set(NIGHTS.map(n=>n.date.slice(0,7)))];
  const rows=months.map(m=>{const ns=NIGHTS.filter(n=>n.date.startsWith(m));const a=k=>mean(ns.map(n=>n[k]));
    return `<tr><td>${new Date(m+"-15T12:00:00Z").toLocaleDateString("en-GB",{month:"short"})}</td><td>${ns.length}</td><td style="color:var(${band(a("R"))})">${Math.round(a("R"))}</td><td>${hm(a("sleep")/60)}</td><td>${Math.round(a("deep")/60)}</td><td>${Math.round(a("hrv"))}</td><td>${Math.round(a("rhr"))}</td><td>±${Math.round(sd(ns.map(n=>n.bed))*60)}</td></tr>`;}).join("");
  const hs=slope(NIGHTS.map(n=>n.hrv))*7, rs=slope(NIGHTS.map(n=>n.rhr))*7, Rs=slope(NIGHTS.map(n=>n.R))*7;
  const B=blocks(), offB=B.filter(b=>b.loc==="off"&&b.rest!=null);
  const adapt=offB.length?mean(offB.map(b=>b.rest-b.early)):null;
  const homeAfter=B.filter((b,i)=>b.loc==="home"&&i>0&&B[i-1].loc==="off");
  $("#long").innerHTML=`
  <div class="card"><h3>Long-term direction</h3><p class="sub">Linear trend across all ${NIGHTS.length} nights</p>
    <div class="tiles" style="margin-top:0">
      ${tile("HRV",(hs>0?"+":"−")+Math.abs(hs).toFixed(1),"ms/wk","since "+shortDate(NIGHTS[0].date),hs>0.3?true:hs<-0.3?false:null)}
      ${tile("Resting HR",(rs>0?"+":"−")+Math.abs(rs).toFixed(1),"bpm/wk","lower is better",rs<-0.1?true:rs>0.1?false:null)}
      ${tile("Restoration",(Rs>0?"+":"−")+Math.abs(Rs).toFixed(1),"pts/wk","scored vs your 7-night baseline",Rs>0.3?true:Rs<-0.3?false:null)}
    </div>
    <p class="empty" style="margin-top:10px;font-size:13px">${hs<-0.3?`HRV is falling about ${Math.abs(hs).toFixed(1)} ms a week and resting HR rising ${rs.toFixed(1)} bpm a week. Restoration stays flatter because it’s scored against your recent baseline, so the slide is in your underlying recovery, not single bad nights.`:"Your underlying recovery is holding steady."}</p></div>
  <div class="card"><h3>Month by month</h3><div class="tbl"><table><thead><tr><th>Month</th><th>Nights</th><th>Score</th><th>Sleep</th><th>Deep</th><th>HRV</th><th>RHR</th><th>Bedtime</th></tr></thead><tbody>${rows}</tbody></table></div></div>
  <div class="card"><h3>Rotation by rotation</h3><p class="sub">Each stretch at sea, at home or away, travel nights excluded</p>
    ${B.map(b=>`<div class="blk"><i style="background:var(${b.loc==="off"?"--off":b.loc==="away"?"--away":"--good"})"></i><div><b>${LOCNAME[b.loc]}</b> ${shortDate(b.from)} – ${shortDate(b.to)}<br><span>${b.n} nights, HRV ${Math.round(b.hrv)} ms</span></div><span class="num" style="color:var(${band(b.R)})">${Math.round(b.R)}</span></div>`).join("")}
    ${adapt!=null?`<p class="empty" style="margin-top:10px;font-size:13px">Offshore, your first 3 nights average ${sign(-Math.round(adapt))} points vs the rest of the trip${adapt>3?", so it takes you a few nights to settle on the boat":adapt<-3?", so you start strong and fade as the trip goes on":""}.</p>`:""}
  </div>`;
}

/* ---------- routing ---------- */
const VIEWS=["tonight","week","drivers","trends","journal"];
function route(){const v=VIEWS.includes(location.hash.slice(1))?location.hash.slice(1):"tonight";VIEWS.forEach(x=>$("#v-"+x).classList.toggle("on",x===v));document.querySelectorAll("nav.tabs a").forEach(a=>{a.dataset.v===v?a.setAttribute("aria-current","page"):a.removeAttribute("aria-current");});window.scrollTo(0,0);}
function renderAll(){renderNights();renderTonight();renderTrends();renderJournal();}
document.querySelectorAll(".seg button").forEach(b=>b.onclick=()=>{metric=b.dataset.m;document.querySelectorAll(".seg button").forEach(x=>x.setAttribute("aria-pressed",x===b));renderTrends();});
window.addEventListener("hashchange",route);
$("#src").textContent=`${NIGHTS.length} nights from ${(window.SLACK_DATA||{}).source==="healthconnect"?"Health Connect":"Garmin and Hevy"}`;
renderDrivers(); renderWeek(); renderLong(); renderAll(); route();
