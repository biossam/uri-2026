const $=s=>document.querySelector(s);
const esc=t=>String(t??"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
const HOLD={privacy:"개인정보 의심",words:"욕설 의심",photo:"사진 확인",all:"확인 대기"};
const COLORS=["#e8e4d6","#ffe98a","#ffb3c7","#a8dcff","#bff0a6","#ffc89a"];
// 비밀번호는 저장하지 않고, 로그인할 때 받은 '관리자 열쇠(12시간)'만 이 탭에 잠깐 둬요
let SES=sessionStorage.getItem("uri2026Session")||"", all=[], filter="all", timer=null;

async function api(path,body){
  const r=await fetch("/api/admin/"+path,{method:body?"POST":"GET",headers:{"x-admin-session":SES,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  if(r.status===401){ lock("다시 로그인해 주세요"); throw new Error("401"); }
  const j=await r.json().catch(()=>({}));
  if(!r.ok){ alert(j.error||"잘 안 됐어요"); throw new Error(String(r.status)); }
  return j;
}
function lock(msg){ sessionStorage.removeItem("uri2026Session"); SES=""; clearInterval(timer); $("#gate").style.display="flex"; $("#gateMsg").textContent=msg||""; $("#gatePw").focus(); }
function enter(){ $("#gate").style.display="none"; loadInfo(); load(); clearInterval(timer); timer=setInterval(()=>{ load(); loadInfo(); },3000); }
const go=async()=>{
  const r=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pw:$("#gatePw").value})}).catch(()=>null);
  $("#gatePw").value="";
  if(!r){ $("#gateMsg").textContent="서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요 (서버가 깨어나는 데 1분쯤 걸려요)"; return; }
  const j=await r.json().catch(()=>({}));
  if(!r.ok){ $("#gateMsg").textContent=j.error||"들어가지 못했어요"; return; }
  SES=j.session; sessionStorage.setItem("uri2026Session",SES); enter();
};
$("#gateOk").onclick=go; $("#gatePw").addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
if(SES) fetch("/api/admin/check",{headers:{"x-admin-session":SES}}).then(r=>r.ok?enter():lock()).catch(()=>lock()); else $("#gatePw").focus();

let EV=null;
async function loadInfo(){
  try{ EV=await api("info"); $("#ev-code").textContent=EV.code;
    $("#ev-note").textContent=`코드를 아는 사람만 칠판을 보고 쓸 수 있어요 · 지금 앞 화면 ${EV.viewers}개 연결 · ${EV.retainDays?`글과 사진은 쓴 날부터 ${EV.retainDays}일 뒤 자동 삭제`:"자동 삭제 꺼짐"}${EV.fromEnv?" · 코드는 Render의 EVENT_CODE":""}`;
    $("#closeBoard").textContent=EV.closed?"🔓 방명록 다시 열기":"🔒 방명록 닫기";
    $("#closedBanner").hidden=!EV.closed;
    $("#rotate").hidden=EV.fromEnv;
    $("#weakBanner").hidden=!EV.weak;
  }catch(e){}
}
$("#closeBoard").onclick=()=>{ if(!EV) return;
  if(EV.closed) return api("close",{closed:false}).then(loadInfo);
  confirmBox("🔒 방명록을 닫을까요?","앞 화면이 꺼지고, 아무도 보거나 쓸 수 없어요.\n글은 그대로 남고, 다시 열 수 있어요.\n행사가 끝나면 닫아 두세요.",()=>api("close",{closed:true}).then(loadInfo),"닫기"); };
$("#rotate").onclick=()=>confirmBox("🔑 행사 코드를 바꿀까요?","코드가 밖으로 퍼졌을 때 써요.\n지금 켜진 앞 화면과 인쇄한 QR은 더 이상 안 돼요.\n바꾼 뒤 '앞 화면 열기'로 다시 띄워 주세요.",()=>api("rotate-code",{}).then(loadInfo),"바꾸기");
$("#logout").onclick=async()=>{ try{ await api("logout",{}); }catch(e){} lock("로그아웃했어요"); };
$("#openFront").onclick=()=>{ if(EV) window.open("/?c="+encodeURIComponent(EV.code),"_blank"); };
$("#copyLetter").onclick=async()=>{ if(!EV) return; const u=location.origin+"/letter.html?c="+encodeURIComponent(EV.code); try{ await navigator.clipboard.writeText(u); $("#copyLetter").textContent="✅ 복사됨"; setTimeout(()=>$("#copyLetter").textContent="📋 글쓰기 주소 복사",1500);}catch(e){ prompt("글쓰기 주소",u); } };
async function load(){
  try{ all=(await api("letters")).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
    $("#ldot").classList.add("on"); $("#lstat").textContent="연결됨 · 3초마다 새로 고침"; stats(); render(); }
  catch(e){ if(e.message!=="401"){ $("#ldot").classList.remove("on"); $("#lstat").textContent="서버에 연결하지 못했어요"; } }
}
function confirmBox(title,text,ok,okLabel){ $("#mTitle").textContent=title; $("#mText").textContent=text; $("#modal").style.display="flex"; $("#mOk").textContent=okLabel||"삭제";
  const blockable=title.startsWith("🗑️ 글을"); $("#mBlock").style.display=blockable?"block":"none"; $("#modal .box").style.width=blockable?"360px":"300px";
  $("#mOk").onclick=()=>{ $("#modal").style.display="none"; ok(false); }; $("#mBlock").onclick=()=>{ $("#modal").style.display="none"; ok(true); }; $("#mNo").onclick=()=>$("#modal").style.display="none"; }
function stats(){
  const now=Date.now(), t0=new Date().setHours(0,0,0,0);
  $("#s-total").textContent=all.length; $("#s-today").textContent=all.filter(l=>l.timestamp>=t0).length;
  $("#s-hour").textContent=all.filter(l=>l.timestamp>=now-36e5).length; $("#s-hidden").textContent=all.filter(l=>l.hidden).length; $("#s-hold").textContent=all.filter(l=>l.hold&&!l.hidden).length;
}
function render(){
  const q=$("#search").value.trim().toLowerCase(), t0=new Date().setHours(0,0,0,0);
  let items=all;
  if(filter==="today") items=items.filter(l=>l.timestamp>=t0);
  if(filter==="hidden") items=items.filter(l=>l.hidden);
  if(filter==="hold") items=items.filter(l=>l.hold&&!l.hidden);
  if(q) items=items.filter(l=>(l.name+" "+l.text).toLowerCase().includes(q));
  $("#rows").innerHTML=items.length?items.map((l,i)=>`<tr class="${l.hidden?"hid":l.hold?"hold":""}">
    <td>${items.length-i}</td>
    <td>${l.timestamp?new Date(l.timestamp).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):""}</td>
    <td><span class="chip" style="background:${COLORS[l.color]??"#eee"}"></span>${esc(l.name)}</td>
    <td>${l.photo?`<img src="${esc(l.photo)}" data-zoom>`:""}</td>
    <td class="msg">${esc(l.text)}${l.hold&&!l.hidden?`<span class="tag hold">${HOLD[l.hold]||"확인 대기"}</span>`:""}${l.hidden?`<span class="tag hid">숨김</span>`:""}${l.edited?`<span class="tag ed">고침</span>`:""}</td>
    <td class="act">${(l.hidden||l.hold)?`<button class="ok" data-k="${esc(l.key)}" data-a="show">${l.hold&&!l.hidden?"확인·공개":"보이기"}</button>`:`<button data-k="${esc(l.key)}" data-a="hide">숨기기</button>`}<button class="del" data-k="${esc(l.key)}" data-a="del">삭제</button></td>
  </tr>`).join(""):`<tr><td colspan="6" class="empty">아직 글이 없어요</td></tr>`;
}
$("#search").addEventListener("input",render);
document.querySelectorAll(".fb").forEach(b=>b.onclick=()=>{ filter=b.dataset.f; document.querySelectorAll(".fb").forEach(x=>x.classList.toggle("act",x===b)); render(); });
$("#rows").addEventListener("click",async e=>{
  const z=e.target.closest("[data-zoom]"); if(z){ $("#zoom img").src=z.src; $("#zoom").style.display="flex"; return; }
  const b=e.target.closest("button[data-a]"); if(!b) return;
  const L=all.find(x=>x.key===b.dataset.k); if(!L) return;
  if(b.dataset.a==="hide"){ await api("hide",{key:L.key}); load(); }
  else if(b.dataset.a==="show"){ await api("show",{key:L.key}); load(); }
  else confirmBox("🗑️ 글을 삭제할까요?",`"${L.text.slice(0,30)}"\n삭제하면 되돌릴 수 없어요.\n\n[삭제] 그 학생이 새로 쓸 수 있어요\n[삭제+차단] 그 기기에서는 다시 못 써요`,async(block)=>{ await api("delete",{key:L.key,block}); load(); });
});
$("#zoom").onclick=()=>$("#zoom").style.display="none";
$("#csv").onclick=()=>{
  const cell=v=>{ v=String(v??""); return /^[=+\-@\t\r]/.test(v)?"'"+v:v; };   // 엑셀 수식 끼워 넣기 막기
  const rows=[["시간","이름","내용","상태","사진","고친 시간"],...all.map(l=>[new Date(l.timestamp||0).toLocaleString("ko-KR"),cell(l.name),cell(l.text),l.hidden?"숨김":l.hold?"확인 대기":"공개",l.photo?"Y":"",l.edited?new Date(l.edited).toLocaleString("ko-KR"):""])];
  const csv="\uFEFF"+rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download="우리들의2026_방명록.csv"; a.click();
};
$("#delPhotos").onclick=()=>confirmBox("사진을 모두 지울까요?","글은 남고 사진만 지워져요.\n되돌릴 수 없어요.",async()=>{ await api("clear-photos",{}); load(); },"사진 삭제");
$("#reset").onclick=()=>confirmBox("🧹 전체 삭제할까요?",`글 ${all.length}개가 모두 지워져요.\n되돌릴 수 없어요.\n(먼저 CSV로 받아 두세요)\n\n행사 코드도 새로 바뀌고 앞 화면이 꺼져요. '앞 화면 열기'로 다시 띄워 주세요.`,async()=>{ await api("reset",{}); loadInfo(); load(); },"모두 삭제");
$("#pathInfo").textContent="숨김 / 삭제 / CSV · 행사가 끝나면 꼭 CSV로 받아 두세요";
