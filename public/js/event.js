/* 행사 설정을 화면에 입히기 (앞 화면·글쓰기 화면이 함께 써요) */
window.EVT = {
  deco: {
    chalk:  ["🎓", "🌷", "✨", "💐"],
    sakura: ["🌸", "🎒", "🌸", "✨"],
    calm:   ["📖", "✏️", "⭐", "💬"],
    festa:  ["🎉", "🎈", "✨", "🎊"],
  },
  // 서버가 늦게 깨어나도 화면은 먼저 config.js 값으로 보여요
  fallback() {
    const C = window.CONFIG || {};
    return { title: C.title || "방명록", subtitle: C.subtitle || "", writeTitle: C.writeTitle || "방명록 남기기", writeSub: C.writeSub || "",
      prompt: "", extraLabel: "", askName: true, photos: true, theme: "chalk" };
  },
  theme(ev) { document.documentElement.dataset.theme = (ev && ev.theme) || "chalk"; },
  // 글 아래 '— 이름 · 소속' 줄 (이름을 받지 않는 행사면 소속만, 둘 다 없으면 빈 줄)
  sign(L, ev) {
    const parts = [];
    if (!ev || ev.askName !== false) parts.push(L.name || "익명");
    if (L.extra) parts.push(L.extra);
    return parts.length ? "— " + parts.join(" · ") : "";
  },
};
