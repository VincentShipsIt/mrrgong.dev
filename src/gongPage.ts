/**
 * The browser gong: open it on a spare monitor / TV and it rings (with sound and
 * confetti) whenever a sale comes in. Sound is synthesised with WebAudio, so there
 * are no audio assets to ship. Browsers block audio until a click, hence the arm button.
 */
export const GONG_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MRR Gong</title>
<style>
  :root { color-scheme: dark; --gold:#f5b301; --bg:#14110b; --fg:#fff4d6; }
  * { box-sizing: border-box; }
  html,body { height:100%; margin:0; }
  body { background:var(--bg); color:var(--fg); font:16px/1.4 system-ui,sans-serif;
         display:grid; place-items:center; text-align:center; overflow:hidden; }
  canvas { position:fixed; inset:0; pointer-events:none; }
  main { position:relative; z-index:1; padding:16px; }
  h1 { font-size:clamp(2rem,8vw,5rem); margin:.2em 0; color:var(--gold); }
  #amount { font-size:clamp(3rem,14vw,10rem); font-weight:800; min-height:1.1em; }
  #amount.long { font-size:clamp(1.8rem,6vw,4.2rem); line-height:1.15; padding:0 .5em; }
  #who { opacity:.8; min-height:1.4em; }
  button { font:inherit; font-weight:700; padding:.8em 1.6em; border-radius:999px; border:0;
           background:var(--gold); color:#2a2000; cursor:pointer; margin:.4em; }
  button.ghost { background:transparent; color:var(--fg); border:1px solid #fff4d655; }
  #status { opacity:.6; font-size:.9rem; margin-top:1em; }
  .strike { animation: shake .6s; }
  @keyframes shake { 0%,100%{transform:none} 20%{transform:translateX(-12px) rotate(-1deg)} 40%{transform:translateX(10px) rotate(1deg)} 60%{transform:translateX(-6px)} 80%{transform:translateX(4px)} }
</style></head>
<body>
<canvas id="c"></canvas>
<main id="main">
  <h1>🔔 MRR Gong</h1>
  <div id="amount"></div>
  <div id="who"></div>
  <div><button id="arm">Click to arm the gong</button><button id="test" class="ghost" hidden>Test strike</button></div>
  <div id="status">connecting…</div>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let ctx = null;

  function strike(tier) {
    if (!ctx) return;
    const t0 = ctx.currentTime, base = tier === "huge" ? 70 : tier === "big" ? 82 : 98;
    const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    // Inharmonic partials are what make a gong a gong rather than a bell.
    [[1,1],[1.51,.7],[2.03,.55],[2.64,.45],[3.28,.3],[4.7,.2],[6.1,.12]].forEach(([r,g]) => {
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.type = "sine"; o.frequency.value = base * r;
      e.gain.setValueAtTime(0, t0);
      e.gain.linearRampToValueAtTime(g * 0.4, t0 + 0.01);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + (tier === "huge" ? 7 : 4.5) / Math.sqrt(r));
      o.connect(e); e.connect(master); o.start(t0); o.stop(t0 + 8);
    });
  }

  const cv = $("c"), g = cv.getContext("2d"); let bits = [];
  function resize() { cv.width = innerWidth; cv.height = innerHeight; }
  addEventListener("resize", resize); resize();
  function confetti(n) {
    for (let i = 0; i < n; i++) bits.push({ x: Math.random()*cv.width, y: -20, vx: (Math.random()-.5)*4, vy: 2+Math.random()*5,
      s: 5+Math.random()*7, c: "hsl(" + (30+Math.random()*30) + ",100%," + (50+Math.random()*20) + "%)", r: Math.random()*6 });
    if (bits.length === n) requestAnimationFrame(tick);
  }
  function tick() {
    g.clearRect(0,0,cv.width,cv.height);
    bits = bits.filter(b => b.y < cv.height + 20);
    for (const b of bits) { b.x += b.vx; b.y += b.vy; b.r += .1; g.fillStyle = b.c; g.save(); g.translate(b.x,b.y); g.rotate(b.r); g.fillRect(-b.s/2,-b.s/4,b.s,b.s/2); g.restore(); }
    if (bits.length) requestAnimationFrame(tick);
  }

  function celebrate(sale) {
    $("amount").classList.toggle("long", sale.amount.length > 12);
    $("amount").textContent = sale.amount;
    $("who").textContent = sale.label || "";
    document.title = sale.amount + " 🔔 MRR Gong";
    $("main").classList.remove("strike"); void $("main").offsetWidth; $("main").classList.add("strike");
    const strikes = sale.tier === "huge" ? 3 : sale.tier === "big" ? 2 : 1;
    for (let i = 0; i < strikes; i++) setTimeout(() => strike(sale.tier), i * 700);
    confetti(sale.tier === "huge" ? 400 : sale.tier === "big" ? 200 : 80);
  }

  $("arm").onclick = () => {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    $("arm").hidden = true; $("test").hidden = false; strike("normal");
  };
  $("test").onclick = () => celebrate({ amount: "$49.00", tier: "big", label: "Test strike" });

  const token = new URLSearchParams(location.search).get("token");
  const es = new EventSource("events" + (token ? "?token=" + encodeURIComponent(token) : ""));
  es.onopen = () => { $("status").textContent = "listening for sales"; };
  es.onerror = () => { $("status").textContent = "reconnecting…"; };
  es.onmessage = (e) => { try { celebrate(JSON.parse(e.data)); } catch {} };
  // Milestones arrive as a named event so older clients can ignore them.
  es.addEventListener("milestone", (e) => {
    try { const m = JSON.parse(e.data); celebrate({ amount: m.text, tier: "huge", label: m.label }); } catch {}
  });
})();
</script></body></html>`;
