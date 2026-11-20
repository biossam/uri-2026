/* 행사 설정을 화면에 입히기 (앞 화면·글쓰기 화면이 함께 써요) */
window.EVT = {
  // 테마마다 분필 낙서 4개 [그림, 분필 색]
  doodles: {"cap": "<path d=\"M4 16L20 9l16 7-16 7z\"/><path d=\"M11 19v7c5 4 13 4 18 0v-7\"/><path d=\"M34 17v9\"/>", "flower": "<circle cx=\"20\" cy=\"20\" r=\"3.5\"/><circle cx=\"20\" cy=\"11\" r=\"5\"/><circle cx=\"29\" cy=\"20\" r=\"5\"/><circle cx=\"20\" cy=\"29\" r=\"5\"/><circle cx=\"11\" cy=\"20\" r=\"5\"/>", "star": "<path d=\"M20 4l4.5 10 11 1-8.3 7.4 2.5 10.8L20 27.6l-9.7 5.6 2.5-10.8L4.5 15l11-1z\"/>", "heart": "<path d=\"M20 33C6 24 3 16 8 10s11-2 12 3c1-5 7-9 12-3s2 14-12 23z\"/>", "book": "<path d=\"M20 12c-5-3-10-3-15-1v20c5-2 10-2 15 1 5-3 10-3 15-1V11c-5-2-10-2-15 1zM20 12v20\"/>", "pencil": "<path d=\"M8 32l3-9L27 7l6 6-16 16zM11 23l6 6M24 10l6 6\"/>", "bubble": "<path d=\"M6 8h28v18H18l-7 6v-6H6z\"/><path d=\"M13 17h.1M20 17h.1M27 17h.1\"/>", "balloon": "<ellipse cx=\"20\" cy=\"15\" rx=\"9\" ry=\"11\"/><path d=\"M18 29h4l-2-3zM20 29c-3 4 3 6 0 10\"/>", "sun": "<path d=\"M5 29h30\"/><path d=\"M11 29a9 9 0 0 1 18 0\"/><path d=\"M20 14v-6M9 18l-4-3M31 18l4-3\"/>", "letter": "<rect x=\"6\" y=\"11\" width=\"28\" height=\"19\" rx=\"2\"/><path d=\"M6 12l14 10 14-10\"/>", "cloud": "<path d=\"M10 28a6 6 0 0 1 1-12 8 8 0 0 1 15-2 6 6 0 0 1 4 14z\"/>", "rainbow": "<path d=\"M5 30a15 15 0 0 1 30 0M10 30a10 10 0 0 1 20 0M15 30a5 5 0 0 1 10 0\"/>", "cake": "<path d=\"M8 32h24V20H8zM8 25c4 3 8-3 12 0s8 3 12 0M14 20v-5M20 20v-5M26 20v-5M14 11v.1M20 11v.1M26 11v.1\"/>", "gift": "<path d=\"M8 17h24v15H8zM6 12h28v5H6zM20 12v20M20 12c-4-7-10-3-6 0M20 12c4-7 10-3 6 0\"/>", "bunting": "<path d=\"M2 4q48 10 96 0\"/><path d=\"M8 5l6 14 6-12M30 8l6 14 6-14M54 8l6 14 6-14M78 7l6 14 6-12\"/>", "sparkle": "<path d=\"M20 5v30M5 20h30M10 10l20 20M30 10L10 30\"/>"},
  deco: {"chalk": [["cap", "--c1"], ["flower", "--c2"], ["star", "--c3"], ["letter", "--c1"]], "sakura": [["flower", "--c2"], ["flower", "--c0"], ["star", "--c3"], ["sparkle", "--c2"]], "calm": [["book", "--c1"], ["pencil", "--c3"], ["bubble", "--c0"], ["star", "--c1"]], "festa": [["bunting", "--c1"], ["balloon", "--c2"], ["star", "--c3"], ["sparkle", "--c4"]], "sunset": [["sun", "--c5"], ["letter", "--c0"], ["flower", "--c2"], ["star", "--c1"]], "sky": [["cloud", "--c0"], ["rainbow", "--c3"], ["star", "--c1"], ["sparkle", "--c2"]], "birthday": [["cake", "--c2"], ["balloon", "--c1"], ["gift", "--c3"], ["bunting", "--c4"]]},
  svg(i, theme, pos) {
    const d = (this.deco[theme] || this.deco.chalk)[i]; if (!d) return "";
    const wide = d[0] === "bunting";
    return `<svg class="chalk${wide ? " wide" : ""}" viewBox="0 0 ${wide ? "100 30" : "40 40"}" style="stroke:var(${d[1]});${pos || ""}">${this.doodles[d[0]]}</svg>`;
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
