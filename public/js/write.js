const C=window.CONFIG, $=s=>document.querySelector(s);
const MAX=C.maxChars||80;
let EV=EVT.fallback();
function applyEvent(ev){
  EV=Object.assign(EVT.fallback(),ev||{}); EVT.theme(EV);
  document.title=EV.writeTitle; $("#title").textContent=EV.writeTitle; $("#subtitle").textContent=EV.writeSub||"";
  if(EV.prompt){ $("#promptLbl").textContent="② "+EV.prompt; $("#msg").placeholder="여기에 분필로 써 보세요 ✎"; }
  $("#nameRow").style.visibility=EV.askName===false?"hidden":"visible";
  $("#extraRow").hidden=!EV.extraLabel; $("#extraLbl").textContent=EV.extraLabel||""; $("#extra").placeholder=EV.extraLabel?"(선택)":"";
  const keep=[]; if(EV.askName!==false) keep.push("이름(별명도 괜찮아요)"); if(EV.extraLabel) keep.push(EV.extraLabel); keep.push("쓴 글","고른 색"); if(EV.photos!==false) keep.push("붙인 사진");
  $("#keepTxt").textContent=keep.join(", ");
  const d=EVT.deco[EV.theme]||EVT.deco.chalk; $("#wd1").textContent=d[0]; $("#wd2").textContent=d[1];
}
applyEvent(null);
/* 행사 코드: QR 주소의 ?c= 를 기억해 두고, 주소창에서는 지워요 (주소만 퍼져도 남이 못 들어오게) */
const qs=new URLSearchParams(location.search);
let CODE=(qs.get("c")||"").trim().toUpperCase();
try{ if(CODE) localStorage.setItem("uri2026Code",CODE); else CODE=localStorage.getItem("uri2026Code")||""; }catch(e){}
if(qs.has("c")) history.replaceState(null,"","/letter.html");
const H=()=>({"Content-Type":"application/json","x-event-code":CODE});
function showGate(msg){ $("#gate").hidden=false; $("#form").style.display="none"; $("#privacy").hidden=true; $("#codeErr").textContent=msg||""; }
$("#codeGo").onclick=()=>{ const v=$("#codeIn").value.trim().toUpperCase(); if(!v) return; try{ localStorage.setItem("uri2026Code",v); }catch(e){} location.href="/letter.html?c="+encodeURIComponent(v); };
fetch("/api/info").then(r=>r.json()).then(i=>{
  if(i.closed){ $("#form").innerHTML='<p class="chalk" style="text-align:center;font-family:Gaegu;font-size:24px;margin:40px 0">방명록이 닫혔어요.<br>함께해 줘서 고마워요 ♡</p>'; $("#gate").hidden=true; $("#notice").hidden=true; return; }
  applyEvent(i.event);
  if(i.retainDays) $("#retainTxt").textContent=`쓴 날부터 ${i.retainDays}일이 지나면`;
  if(!i.photos){ document.querySelectorAll("#photoLbl,#photoPrev,#photoHead").forEach(e=>e.remove()); }
}).catch(()=>{});
const ta=$("#msg"), cnt=$("#cnt"), nameEl=$("#name"), err=$("#err");
ta.maxLength=MAX;

const COLORS=["하양","노랑","분홍","하늘","연두","주황"];
let color=Math.floor(Math.random()*6);
COLORS.forEach((n,i)=>{ const b=document.createElement("button"); b.type="button"; b.title=n; b.setAttribute("aria-label",n+" 분필"); b.style.background=`var(--c${i})`; b.onclick=()=>{color=i;paint();}; $("#dots").appendChild(b); });
function paint(){ document.body.style.setProperty("--c",`var(--c${color})`); [...$("#dots").children].forEach((b,i)=>b.classList.toggle("on",i===color)); }
paint();

const count=()=>{ const l=ta.value.length; cnt.textContent=`${l} / ${MAX}`; cnt.classList.toggle("warn",l>=MAX-5); };
ta.addEventListener("input",count); count();

let photo=null, hadPhoto=false, editing=false;
function compress(file,max,q){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=e=>{ const img=new Image(); img.onload=()=>{ let w=img.width,h=img.height; if(w>=h&&w>max){h=h*max/w;w=max;} else if(h>max){w=w*max/h;h=max;} const c=document.createElement("canvas"); c.width=w;c.height=h; c.getContext("2d").drawImage(img,0,0,w,h); res(c.toDataURL("image/jpeg",q)); }; img.onerror=rej; img.src=e.target.result; }; r.readAsDataURL(file); }); }
$("#photoInput").addEventListener("change",async e=>{ const f=e.target.files[0]; if(!f) return;
  try{ photo=await compress(f,500,.65); if(photo.length>200000) photo=await compress(f,360,.6); showPhoto(photo); }catch(x){ err.textContent="사진을 읽지 못했어요"; } });
function clearPhoto(){ photo=null; hadPhoto=false; $("#photoInput").value=""; $("#photoPrev").style.display="none"; $("#photoLbl").style.display="flex"; }
$("#photoDel").onclick=clearPhoto;

function setEditing(on){ editing=on; $("#forget2").hidden=!on; $("#send").textContent=on?"고쳐 쓰기 ✎":"칠판에 쓰기 ✎";
  const n=$("#notice"); if(on){ n.hidden=false; n.textContent="이미 남긴 글이 있어요. 한 사람에 1개라서, 고쳐 쓰기만 할 수 있어요 ✎"; } }
function showPhoto(src){ $("#prevImg").src=src; $("#photoPrev").style.display="block"; $("#photoLbl").style.display="none"; }
// 공용 기기(학교 태블릿 등): 내 글과 이 기기의 연결을 끊어서 다음 친구가 내 글을 못 보게
document.querySelectorAll(".forget").forEach(b=>b.onclick=async()=>{
  if(!confirm("이 기기에서 내 글 연결을 끊을까요?\n글은 칠판에 그대로 남지만, 이 기기로는 더 이상 고칠 수 없어요.\n다음 친구가 새로 쓸 수 있어요.")) return;
  await fetch("/api/forget",{method:"POST",headers:H(),body:"{}"}).catch(()=>{});
  location.href="/letter.html";
});
if(!CODE) showGate();
else fetch("/api/mine",{headers:H()}).then(async r=>{ const j=await r.json(); if(r.status===403||r.status===429){ showGate(j.error); throw 0; } return j; }).then(j=>{
  if(j.revoked){ $("#form").innerHTML='<p style="text-align:center;font-family:Gaegu;font-size:22px;margin:30px 0">선생님이 이 기기의 글을 지웠어요.<br>궁금한 점은 선생님께 여쭤 보세요.</p>'; return; }
  const m=j.mine; if(!m) return;
  ta.value=m.text; nameEl.value=m.name==="익명"?"":m.name; $("#extra").value=m.extra||""; if(Number.isInteger(m.color)){ color=m.color; paint(); } count();
  if(m.photo){ hadPhoto=true; showPhoto(m.photo); }
  setEditing(true);
  if(m.hold) $("#notice").textContent+=" (지금은 선생님 확인을 기다리는 중이에요)";
  if(m.hidden) $("#notice").textContent+=" (선생님이 잠시 숨겨 둔 글이에요)";
}).catch(()=>{});
$("#send").addEventListener("click",async()=>{
  const text=ta.value.trim(), name=EV.askName===false?"익명":(nameEl.value.trim()||"익명"), extra=EV.extraLabel?$("#extra").value.trim():"";
  if(!text){ err.textContent="한 마디를 써 주세요 ✎"; ta.focus(); return; }
  err.textContent=""; $("#send").disabled=true; $("#send").textContent="쓰는 중…";
  try{
    const r=await fetch("/api/letters",{method:"POST",headers:H(),body:JSON.stringify({name,extra,text:text.slice(0,MAX),color,photo:(hadPhoto&&!photo)?"keep":photo})});
    const j=await r.json().catch(()=>({}));
    if(r.status===403&&j.code==="bad_code"){ showGate(j.error); return; }
    if(r.status===403&&j.code==="closed"){ err.textContent=j.error; return; }
    if(!r.ok) throw new Error(j.error||"보내지 못했어요");
    $("#doneText").textContent=text; $("#doneName").textContent=EVT.sign({name,extra},EV);
    $("#doneTitle").textContent=j.edited?"고쳐 썼어요!":"칠판에 썼어요!";
    $("#doneSub").textContent=j.hidden?"선생님이 잠시 숨겨 둔 글이에요":j.pending?"선생님이 확인한 뒤 칠판에 써져요 ✋":"앞 화면을 봐 주세요 👀";
    if(photo){ hadPhoto=true; photo=null; } setEditing(true);
    $("#form").style.display="none"; $("#done").style.display="block"; scrollTo(0,0);
  }catch(e){ console.error(e); err.textContent=(e.message&&e.message!=="Failed to fetch")?e.message:"보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요."; }
  $("#send").disabled=false; $("#send").textContent=editing?"고쳐 쓰기 ✎":"칠판에 쓰기 ✎";
});
$("#again").onclick=()=>{ $("#done").style.display="none"; $("#form").style.display="block"; scrollTo(0,0); };
