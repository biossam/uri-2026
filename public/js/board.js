const C = window.CONFIG;
const DEFAULT_TUNE = {perScreen:8, maxChars:C.maxChars||80, fontScale:1.1, tilt:0.6, pageSec:18};
let TUNE = {...DEFAULT_TUNE};
try{ Object.assign(TUNE, JSON.parse(localStorage.getItem("mvgb-chalk")||"{}")); }catch(e){}
const Q = new URLSearchParams(location.search);
if(Q.has("per")) TUNE.perScreen=+Q.get("per");
if(Q.has("shot")) document.documentElement.classList.add("shot");
const saveTune=()=>{ try{ localStorage.setItem("mvgb-chalk",JSON.stringify(TUNE)); }catch(e){} };

const $=s=>document.querySelector(s);
const notesEl=$("#notes"), emptyEl=$("#empty"), pagerEl=$("#pager");
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const esc=t=>String(t??"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
const MARKS=["♡","☆","✿","♪","☺","✓","",""];
const MAGS=["#ff6b6b","#4d96ff","#ffd43b","#51cf66"];
/* 글 테두리 낙서 (0~100 좌표) */
const FRAMES=[
  "",
  `<path d="M6 92c20-3 60-4 88-1"/>`,
  `<path d="M5 8c30-3 60-3 90 1M95 8c2 28 1 56-1 84M94 92c-30 2-60 2-89-1M5 91C3 63 4 35 5 8"/>`,
  `<path d="M14 18C10 4 34 2 40 10 46 0 66 2 68 12 82 4 98 18 90 32 100 44 96 70 84 74 86 92 62 98 54 88 44 98 22 96 20 84 4 86 0 62 8 54 -2 40 4 24 14 18z"/>`,
  `<path d="M8 90c8-4 12 4 20 0s12 4 20 0 12 4 20 0 12 4 22 0"/>`,
  `<path d="M10 6C4 30 4 70 10 94M90 6c6 24 6 64 0 88"/>`,
];

/* 행사 설정 (제목·부제·테마·꾸밈) — 서버에서 받고, 관리자가 바꾸면 실시간으로 다시 입혀요 */
let EV=EVT.fallback();
const DECO_POS=[["47%","12%"],["72%","13%"],["44%","auto","1.5%"],["70%","auto","2.5%"]];
function applyEvent(ev,relayout){
  EV=Object.assign(EVT.fallback(),ev||{}); EVT.theme(EV);
  document.title=EV.title; $("#title").textContent=EV.title; $("#subtitle").textContent=EV.subtitle||"";
  $("#emptySub").textContent=EV.prompt?`QR을 찍고 남겨 주세요 · ${EV.prompt}`:"QR을 찍고 한 마디 남겨 주세요";
  $("#deco").innerHTML=DECO_POS.map((p,i)=>EVT.svg(i,EV.theme,`left:${p[0]};top:${p[1]};${p[2]?`bottom:${p[2]};`:""}`)).join("");
  if(relayout) showPage(cur,{instant:true});
}
applyEvent(null,false);

/* 제목 클릭 → 관리자 화면 (비밀번호는 서버가 확인) */
$("#titleBox").addEventListener("click",()=>window.open("admin.html","_blank"));

/* 행사 코드 · QR */
let CODE=(Q.get("c")||"").trim().toUpperCase();
function drawQR(){
  const base=location.origin+"/letter.html";
  $("#qrurl").textContent=base.replace(/^https?:\/\//,"");   // 코드는 QR 안에만 (글자로는 안 보여요)
  $("#qrCard").href=base+"?c="+encodeURIComponent(CODE);
  $("#qrcode").innerHTML=`<img alt="글쓰기 QR" src="/api/qr.svg?c=${encodeURIComponent(CODE)}">`;
}
function askCode(msg){
  const ov=document.createElement("div"); ov.id="codeAsk";
  ov.innerHTML=`<div class="box"><b>행사 코드를 넣어 주세요</b><p>${msg||"관리자 화면에서 '앞 화면 열기'를 누르면 코드가 자동으로 들어가요."}</p><input id="codeIn" maxlength="12" autocomplete="off" style="text-transform:uppercase"><button id="codeGo">열기</button></div>`;
  document.body.appendChild(ov);
  const go=()=>{ const v=$("#codeIn").value.trim().toUpperCase(); if(v) location.href="/?c="+encodeURIComponent(v); };
  $("#codeGo").onclick=go; $("#codeIn").addEventListener("keydown",e=>{ if(e.key==="Enter") go(); }); $("#codeIn").focus();
}

/* 같은 글은 항상 같은 기울기·위치·낙서 */
function rngFor(key){ let h=2166136261>>>0; for(const ch of String(key)){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619)>>>0; }
  return ()=>{ h=(h+0x6D2B79F5)>>>0; let t=h; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function seedFor(key){ const r=rngFor(key); return {color:Math.floor(r()*6),rot:r()*2-1,jx:r()*2-1,jy:r()*2-1,mark:Math.floor(r()*MARKS.length),frame:Math.floor(r()*FRAMES.length),pr:r()*2-1,mag:Math.floor(r()*4)}; }

let letters=[], pages=[], cur=0, busy=false, lastChange=Date.now();
const pageOrders=new Map();

function rebuildPages(){ const n=TUNE.perScreen; pages=[]; for(let i=0;i<letters.length;i+=n) pages.push(letters.slice(i,i+n)); if(cur>pages.length-1) cur=Math.max(0,pages.length-1); }
function orderFor(pi,n){ let o=pageOrders.get(pi); if(!o||o.length!==n){ o=[...Array(n).keys()]; const r=rngFor("pg"+pi+"-"+n); for(let i=n-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [o[i],o[j]]=[o[j],o[i]]; } pageOrders.set(pi,o); } return o; }
function computeCells(n){
  const W=notesEl.clientWidth, H=notesEl.clientHeight;
  const cols=Math.max(1,Math.round(Math.sqrt(n*W/H*0.75))), rows=Math.max(1,Math.ceil(n/cols));
  const cw=W/cols, ch=H/rows, cells=[];
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) cells.push({cx:cw*(c+.5),cy:ch*(r+.5),cw,ch});
  return {cells,W,H};
}
function sizeClass(L){ const len=(L.text||"").length, m=TUNE.maxChars; return len<=m*.35?"S":len<=m*.65?"M":"L"; }

function buildNote(L,cell,W,H,delay){
  const sd=L.seed, sc=sizeClass(L);
  let h=cell.ch*({S:.8,M:.88,L:.95}[sc]);
  let w=Math.min(cell.cw*.94, h*1.6);
  const ax=(cell.cw-w)/2*.8, ay=(cell.ch-h)/2*.8;
  const x=Math.max(0,Math.min(W-w,cell.cx-w/2+sd.jx*ax)), y=Math.max(0,Math.min(H-h,cell.cy-h/2+sd.jy*ay));
  const rot=(sd.rot*6*TUNE.tilt).toFixed(2);
  const color=`var(--c${L.color??sd.color})`;
  const mk=MARKS[sd.mark];
  const el=document.createElement("div");
  el.className="note"; el.dataset.key=L.key;
  el.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px;--r:${rot}deg;--d:${delay}ms;--c:${color}`;
  const hasPhoto=!!L.photo;
  el.innerHTML=`<div class="ink chalk">
      ${FRAMES[sd.frame]?`<svg class="frame" viewBox="0 0 100 100" preserveAspectRatio="none">${FRAMES[sd.frame]}</svg>`:""}
      <div class="txt" style="${hasPhoto?"margin-right:34%":""}">${esc(L.text)}</div>
      <div class="from">${esc(EVT.sign(L,EV))}</div>
      ${mk?`<span class="mark" style="left:6%;bottom:4%">${mk}</span>`:""}
    </div>
    ${hasPhoto?`<div class="pol" style="--pr:${(sd.pr*8).toFixed(1)}deg;--mag:${MAGS[sd.mag]};right:2%;top:8%;width:32%;aspect-ratio:.86"><img src="${esc(L.photo)}" alt=""></div>`:""}`;
  el._cell=cell; notesEl.appendChild(el); fitText(el,h,w,hasPhoto); return el;
}
function fitText(el,h,w,hasPhoto){
  const txt=el.querySelector(".txt"), from=el.querySelector(".from"), mk=el.querySelector(".mark");
  from.style.fontSize=(h*.12)+"px"; if(mk) mk.style.fontSize=(h*.16)+"px";
  let fs=Math.min(h*.26, w*(hasPhoto?.11:.16))*TUNE.fontScale; txt.style.fontSize=fs+"px"; let g=0;
  while(txt.scrollHeight>txt.clientHeight+1&&fs>9&&g++<40){ fs*=.93; txt.style.fontSize=fs+"px"; }
}

async function showPage(i,{instant=false}={}){
  if(busy) return; busy=true;
  i=Math.max(0,Math.min(i,Math.max(0,pages.length-1)));
  const old=[...notesEl.children];
  if(old.length&&!instant&&!reduced){ old.forEach((n,k)=>{ n.style.setProperty("--d",(k*60)+"ms"); n.classList.add("leaving"); }); await wait(old.length*60+650); }
  notesEl.innerHTML=""; cur=i; lastChange=Date.now();
  const page=pages[i]||[], step=instant?60:reduced?0:420;
  const {cells,W,H}=computeCells(TUNE.perScreen), order=orderFor(i,cells.length);
  page.forEach((L,k)=>buildNote(L,cells[order[k%cells.length]],W,H,k*step));
  updateChrome(); await wait(page.length*step+400); busy=false;
}
function updateChrome(){
  emptyEl.hidden=letters.length>0;
  $("#total").textContent=letters.length;
  pagerEl.innerHTML=`<span data-go="-1">‹</span>${Math.min(cur+1,Math.max(1,pages.length))} / ${Math.max(1,pages.length)}<span data-go="1">›</span>`;
}

let initTimer=null; const liveQueue=[]; let pumping=false;
function onLetter(L,live){
  if(letters.some(x=>x.key===L.key)) return;
  L.seed=seedFor(L.key); letters.push(L);
  if(!live){ clearTimeout(initTimer); initTimer=setTimeout(()=>{ rebuildPages(); showPage(0); },400); return; }
  liveQueue.push(L); pumpLive();
}
async function pumpLive(){
  if(pumping) return; pumping=true;
  while(liveQueue.length){
    while(busy) await wait(80);
    const L=liveQueue.shift();
    const wasLast=cur===Math.max(0,pages.length-1), lastLen=pages.length?pages[pages.length-1].length:0;
    rebuildPages(); const last=pages.length-1;
    if(wasLast&&lastLen>0&&lastLen<TUNE.perScreen){
      const {cells,W,H}=computeCells(TUNE.perScreen), order=orderFor(last,cells.length), idx=pages[last].length-1;
      buildNote(L,cells[order[idx%cells.length]],W,H,0); cur=last; updateChrome(); lastChange=Date.now();
    } else await showPage(last);
    await wait(1200);
  }
  pumping=false;
}
function updateLetter(L){
  const i=letters.findIndex(x=>x.key===L.key); if(i<0) return onLetter(L,true);
  L.seed=letters[i].seed; letters[i]=L; rebuildPages();
  const el=notesEl.querySelector(`[data-key="${CSS.escape(L.key)}"]`);
  if(el&&el._cell&&!busy){ const cell=el._cell; el.remove(); buildNote(L,cell,notesEl.clientWidth,notesEl.clientHeight,0); }
}
function removeLetter(key){
  const i=letters.findIndex(x=>x.key===key); if(i<0) return;
  letters.splice(i,1); rebuildPages();
  const el=notesEl.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if(el){ el.style.setProperty("--d","0ms"); el.classList.add("leaving"); setTimeout(()=>el.remove(),700); }
  updateChrome();
}

/* 자동 넘김 */
setInterval(()=>{ if(!busy&&pages.length>1&&!liveQueue.length&&Date.now()-lastChange>TUNE.pageSec*1000) showPage((cur+1)%pages.length); },1000);
pagerEl.addEventListener("click",e=>{ const b=e.target.closest("[data-go]"); if(!b||!pages.length) return; showPage((cur+(+b.dataset.go)+pages.length)%pages.length); });
let rz; addEventListener("resize",()=>{ clearTimeout(rz); rz=setTimeout(()=>showPage(cur,{instant:true}),250); });

/* 조정 패널 */
const panel=$("#panel");
const fmt={perScreen:v=>v+"개",maxChars:v=>v+"자",fontScale:v=>"×"+(+v).toFixed(2),tilt:v=>"×"+(+v).toFixed(1),pageSec:v=>v+"초"};
function syncPanel(){
  for(const k in fmt){ $("#"+k).value=TUNE[k]; $("#o-"+k).textContent=fmt[k](TUNE[k]); }
  $("#summary").textContent=Object.entries(TUNE).map(([k,v])=>`${k.padEnd(10)}: ${JSON.stringify(v)}`).join("\n");
}
function applyTune(k,v,relayout=true){ TUNE[k]=v; saveTune(); syncPanel(); if(k==="perScreen"){ pageOrders.clear(); rebuildPages(); } if(relayout) showPage(cur,{instant:true}); }
for(const k in fmt) $("#"+k).addEventListener("input",e=>applyTune(k,+e.target.value,k!=="pageSec"));
const togglePanel=()=>panel.classList.toggle("open");
$("#gear").addEventListener("click",togglePanel); $("#close").addEventListener("click",togglePanel);
$("#b-reset").addEventListener("click",()=>{ TUNE={...DEFAULT_TUNE}; saveTune(); pageOrders.clear(); rebuildPages(); syncPanel(); showPage(cur,{instant:true}); });
$("#b-copy").addEventListener("click",async()=>{ try{ await navigator.clipboard.writeText($("#summary").textContent); $("#b-copy").textContent="✅ 복사됨"; setTimeout(()=>$("#b-copy").textContent="📋 현재 값 복사",1500); }catch(e){} });
$("#b-shuffle").addEventListener("click",()=>{ pageOrders.clear(); letters.forEach(L=>L.seed=seedFor(L.key+Math.random())); showPage(cur); });
$("#b-live").addEventListener("click",()=>fakeArrival());
addEventListener("keydown",e=>{
  if(e.target.matches("input,textarea")) return;
  const k=e.key.toLowerCase();
  if(k==="t") togglePanel();
  else if(k==="f"){ document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.(); }
  else if(e.key==="ArrowRight"&&pages.length) showPage((cur+1)%pages.length);
  else if(e.key==="ArrowLeft"&&pages.length) showPage((cur-1+pages.length)%pages.length);
  else if(k==="n") fakeArrival();
});
syncPanel();

/* 데이터 — 서버에서 실시간으로 받기 (?demo 면 예시 글) */
const DEMO=[
 ["지우","가상 세계에서 만나니까 더 신기해요! 다음에도 또 놀러 올게요",1],
 ["민준","아바타 꾸미기가 제일 재밌었어요 ㅎㅎ"],
 ["서연","우리 반 친구들이랑 같이 탐험해서 즐거웠어요. 선생님 감사합니다!"],
 ["하준","방명록 첫 글 남기고 싶었는데 ㅠㅠ"],
 ["예린","메타버스 교실 짱!!"],
 ["도윤","친구 집에 놀러 온 것 같았어요"],
 ["수아","다음엔 우주 맵에서 만나요 🚀"],
 ["시우","오늘 만든 작품 사진 붙여요!",1],
 ["채원","처음엔 어려웠는데 친구가 알려줘서 금방 했어요. 고마워 친구야!"],
 ["은우","최고의 수업 ♥"],
 ["지안","여기 계속 있고 싶어요"],
 ["유준","방명록 아이디어 너무 좋아요. 다른 반 친구들도 남겨 주세요!"],
];
const EXTRA=[["하린","방금 도착했어요 ✉️"],["준서","사진도 하나 붙여요 📷",1],["나은","모두 반가워요!"]];
let extraIdx=0;
function fakePhoto(i){
  const c=document.createElement("canvas"); c.width=400; c.height=400; const g=c.getContext("2d");
  const p=[["#ffd3a8","#ff9fb2"],["#a9e6d0","#8fc7ff"],["#ffe98a","#ffb38a"]][i%3];
  const gr=g.createLinearGradient(0,0,400,400); gr.addColorStop(0,p[0]); gr.addColorStop(1,p[1]); g.fillStyle=gr; g.fillRect(0,0,400,400);
  g.fillStyle="#ffffff88"; for(let k=0;k<5;k++){ g.beginPath(); g.arc(50+k*80,110+(k%2)*170,24+k*5,0,7); g.fill(); }
  g.fillStyle="#3b3350aa"; g.font="bold 40px 'Noto Sans KR',sans-serif"; g.textAlign="center"; g.fillText("예시 사진",200,215);
  return c.toDataURL("image/jpeg",.7);
}
const DEMOS={
  graduation:[["지우","6년 동안 함께해서 행복했어! 중학교 가서도 연락하자",1],["민준","선생님 감사합니다. 잊지 않을게요"],["서연","우리 반 최고! 다들 졸업 축하해 🎓"],["하준","운동회 때 이어달리기 1등 한 거 생각나"],["예린","언제나 응원할게 ♡"],["도윤","졸업 축하해요, 형 누나들!"],["수아","사진 남겨요 📷",1],["시우","행복한 초등학교 생활이었어요"]],
  entrance:[["6학년 언니","입학을 축하해요! 학교에서 만나면 반갑게 인사해요 🌸"],["2학년 형","급식이 엄청 맛있어요!"],["담임 선생님","만나서 반가워요. 즐겁게 지내요",1],["엄마","씩씩하게 다니자, 사랑해"],["5학년","도서관에 재밌는 책이 많아요"],["1학년 선배","학교 정말 재밌어요!"]],
  openclass:[["","아이들이 서로 질문하는 모습이 인상 깊었어요"],["","모둠 활동에서 친구 의견을 잘 듣는 게 보였어요"],["","집에서도 오늘 배운 걸 이야기해 볼게요"],["","활동지가 깔끔해서 따라가기 쉬웠어요"],["","발표할 때 기다려 주는 분위기가 좋았어요"],["","궁금한 점: 다음 차시엔 무엇을 배우나요?"]],
  farewell:[["6학년 1반","선생님 덕분에 행복한 한 해였어요. 새 학교에서도 건강하세요",1],["동료 교사","함께여서 든든했어요. 또 만나요!"],["지우","잊지 않을게요 ♡"],["민준","선생님 최고! 가끔 놀러 오세요"],["교무실","그동안 정말 고마웠어요 💐"],["서연","편지에 다 못 쓴 말: 사랑해요"]],
  welcome:[["6학년 1반","우리 반에 온 걸 환영해! 같이 재밌게 지내자 👋"],["교장 선생님","새로 오신 선생님들 환영합니다",1],["민준","궁금한 거 있으면 언제든 물어봐"],["서연","급식실은 2층이야!"],["동료 교사","반가워요, 잘 부탁드려요"],["하준","축구 같이 하자!"]],
  birthday:[["엄마","세상에서 제일 소중한 우리 아이, 생일 축하해 🎂",1],["지우","생일 축하해! 오늘 하루 행복하게 보내"],["민준","선물은 내 마음 ㅎㅎ"],["서연","항상 웃게 해 줘서 고마워 🎈"],["선생님","한 살 더 멋져진 걸 축하해요"],["하준","케이크 나눠 먹자!"]],
  recital:[["엄마","무대에서 정말 멋있었어! 🎭",1],["지우","우리 반 합창 최고였어"],["할머니","손녀 덕분에 행복한 하루였다"],["민준","춤 연습한 보람 있었다!"],["선생님","모두 떨지 않고 잘해 줘서 고마워요"],["서연","박수 소리가 아직도 들려요 👏"]],
  thanks:[["지우","선생님 덕분에 학교 오는 게 즐거워요"],["민준","잘 가르쳐 주셔서 감사합니다 💌"],["서연","선생님 사랑해요 ♡"],["하준","수학이 좋아졌어요!"],["예린","늘 웃어 주셔서 고맙습니다"],["도윤","건강하세요, 선생님"]],
  festa:[["김선생","AI 미술 수업 부스가 제일 기억에 남아요","성남초",1],["박선생","내일 바로 교실에서 써 볼게요","분당초"],["이선생","좋은 자료 나눠 주셔서 감사합니다","판교초"],["최선생","선생님들과 이야기 나눈 시간이 소중했어요","수내초"],["정선생","내년에도 꼭 올게요! 🎉","정자초"],["한선생","교실 놀이 아이디어 많이 얻어 가요","야탑초"]],
};
function startDemo(){
  $("#dot").className="demo"; $("#liveTxt").textContent="예시 모드"; $("#badge").hidden=false;
  const list=DEMOS[EV.preset]||DEMO;
  list.forEach((d,i)=>onLetter({key:"demo"+i,name:d[0]||"익명",text:d[1],extra:typeof d[2]==="string"?d[2]:"",photo:d[d.length-1]===1?fakePhoto(i):null},false));
}
function fakeArrival(){ const d=EXTRA[extraIdx++%EXTRA.length]; onLetter({key:"live"+Date.now(),name:d[0],text:d[1],photo:d[2]?fakePhoto(extraIdx):null},true); }

function resetAll(list){
  letters=[]; pages=[]; pageOrders.clear(); notesEl.innerHTML=""; cur=0;
  list.forEach(L=>{ L.seed=seedFor(L.key); letters.push(L); });
  rebuildPages(); busy=false; showPage(0); updateChrome();
}
async function connect(){
  if(Q.has("demo")){ CODE=CODE||"DEMO"; drawQR(); $("#qrcode").innerHTML='<div style="display:grid;place-items:center;height:100%;font:700 3cqh Gaegu;color:#2f4b3c;border:.3cqh dashed #2f4b3c55">예시 모드</div>'; return startDemo(); }
  if(!CODE) return askCode();
  const r=await fetch("/api/join",{headers:{"x-event-code":CODE}}).catch(()=>null);
  if(r&&r.status===403){ const j0=await r.clone().json().catch(()=>({})); if(j0.code==="closed"){ $("#empty").innerHTML='<div><b>방명록이 닫혔어요</b><span>함께해 줘서 고마워요 ♡</span></div>'; $("#qrCard").style.visibility="hidden"; $("#liveTxt").textContent="닫힘"; return; } }
  if(!r||!r.ok){ const j=r?await r.json().catch(()=>({})):{}; return askCode(r&&r.status===403?"코드가 맞지 않아요. 다시 확인해 주세요.":(j.error||"서버에 연결하지 못했어요. 잠시 뒤 새로 고침해 주세요.")); }
  history.replaceState(null,"","/?c="+encodeURIComponent(CODE));
  drawQR();
  const es=new EventSource("/api/stream?c="+encodeURIComponent(CODE));
  es.addEventListener("init",e=>{ $("#dot").className="on"; $("#liveTxt").textContent="실시간 연결됨"; resetAll(JSON.parse(e.data)); });
  es.addEventListener("add",e=>onLetter(JSON.parse(e.data),true));
  es.addEventListener("remove",e=>removeLetter(JSON.parse(e.data).key));
  es.addEventListener("update",e=>updateLetter(JSON.parse(e.data)));
  es.addEventListener("event",e=>applyEvent(JSON.parse(e.data),true));
  es.onerror=async()=>{
    $("#dot").className=""; $("#liveTxt").textContent="다시 연결하는 중…";
    // 끊긴 이유 확인: 선생님이 방명록을 닫았거나 코드를 바꿨으면 다시 붙지 않아요
    const r=await fetch("/api/join",{headers:{"x-event-code":CODE}}).catch(()=>null); if(!r||r.ok) return;
    const j=await r.json().catch(()=>({}));
    if(j.code==="closed"){ es.close(); resetAll([]); $("#empty").innerHTML='<div><b>방명록이 닫혔어요</b><span>함께해 줘서 고마워요 ♡</span></div>'; $("#empty").hidden=false; $("#qrCard").style.visibility="hidden"; $("#liveTxt").textContent="닫힘"; }
    else if(j.code==="bad_code"){ es.close(); resetAll([]); askCode("행사 코드가 바뀌었어요. 관리자 화면에서 '앞 화면 열기'를 다시 눌러 주세요."); }
  };
}
updateChrome();
const infoP=fetch("/api/info").then(r=>r.json()).then(i=>applyEvent(i.event,false)).catch(()=>{});
Promise.all([document.fonts.ready,infoP]).then(connect);
