/**
 * Quemo's shared look: warm aurora light blurred behind frosted-glass surfaces.
 * Used by quemo-auth pages and by every tool's printable report.
 *
 * Shape system: containers 20px, inputs 12px, buttons and chips are full pills.
 * Color system: zinc neutrals + one accent (signal orange). Primary buttons are ink, never accent,
 * so their labels keep full contrast in both themes.
 * The glass is a web approximation using backdrop-filter, not an official platform material.
 */

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const FONTS = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap";
const ICONS = "https://unpkg.com/@phosphor-icons/web@2.1.1";

const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`,
)}")`;

export const THEME_CSS = `
:root{
  color-scheme:light dark;
  --bg:#f6f6f7;--text:#111114;--muted:#5d5d68;--faint:#8b8b96;
  --surface:rgba(255,255,255,.58);--surface-2:rgba(255,255,255,.78);--solid:#ffffff;
  --border:rgba(17,17,20,.08);--border-2:rgba(17,17,20,.14);--hi:rgba(255,255,255,.75);
  --accent:#ff5a1f;--accent-ink:#c2410c;--accent-soft:rgba(255,90,31,.10);
  --ok:#15803d;--ok-soft:rgba(21,128,61,.10);--warn:#a16207;--warn-soft:rgba(161,98,7,.10);--bad:#b91c1c;--bad-soft:rgba(185,28,28,.08);
  --ink:#111114;--on-ink:#fafafa;
  --shadow:0 1px 2px rgba(60,30,10,.04),0 24px 60px -24px rgba(90,45,15,.22);
  --blob-a:#ff5a1f;--blob-b:#ffb547;--blob-c:#ff8fa3;--blob-o:.42;
  --sans:"Geist",ui-sans-serif,system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,monospace;
  --ease:cubic-bezier(.16,1,.3,1);
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0b0b0e;--text:#f2f2f4;--muted:#a1a1ab;--faint:#71717b;
  --surface:rgba(26,26,31,.52);--surface-2:rgba(34,34,40,.72);--solid:#17171b;
  --border:rgba(255,255,255,.08);--border-2:rgba(255,255,255,.14);--hi:rgba(255,255,255,.07);
  --accent:#ff6a33;--accent-ink:#ff9466;--accent-soft:rgba(255,106,51,.12);
  --ok:#4ade80;--ok-soft:rgba(74,222,128,.10);--warn:#fbbf24;--warn-soft:rgba(251,191,36,.10);--bad:#f87171;--bad-soft:rgba(248,113,113,.10);
  --ink:#f2f2f4;--on-ink:#111114;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 30px 70px -30px rgba(0,0,0,.7);
  --blob-a:#ff5a1f;--blob-b:#c2410c;--blob-c:#9f1239;--blob-o:.34;
}}
*{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100dvh;color:var(--text);font:15px/1.6 var(--sans);letter-spacing:-.006em;background:var(--bg);overflow-x:hidden;-webkit-font-smoothing:antialiased}
a{color:var(--accent-ink);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
::selection{background:var(--accent);color:#fff}

/* ambient light: three blurred orbs drifting behind everything */
.aurora{position:fixed;inset:-20vmax;z-index:0;pointer-events:none;filter:blur(90px) saturate(130%);opacity:var(--blob-o)}
.aurora i{position:absolute;border-radius:50%;display:block}
.aurora i:nth-child(1){width:48vmax;height:48vmax;left:42%;top:4%;background:var(--blob-a);animation:driftA 26s var(--ease) infinite alternate}
.aurora i:nth-child(2){width:40vmax;height:40vmax;left:62%;top:38%;background:var(--blob-b);animation:driftB 32s var(--ease) infinite alternate}
.aurora i:nth-child(3){width:34vmax;height:34vmax;left:18%;top:46%;background:var(--blob-c);animation:driftC 38s var(--ease) infinite alternate}
.aurora.quiet{opacity:calc(var(--blob-o) * .55)}
@keyframes driftA{to{transform:translate(-12vmax,8vmax) scale(1.08)}}
@keyframes driftB{to{transform:translate(-18vmax,-10vmax) scale(.92)}}
@keyframes driftC{to{transform:translate(14vmax,-6vmax) scale(1.12)}}
.grain{position:fixed;inset:0;z-index:1;pointer-events:none;opacity:.07;background-image:${GRAIN};mix-blend-mode:overlay}

.shell{position:relative;z-index:2;width:100%;max-width:1120px;margin:0 auto;padding:0 20px}
nav.top{display:flex;align-items:center;justify-content:space-between;height:68px}
.wordmark{display:inline-flex;align-items:center;gap:10px;font-weight:600;font-size:18px;letter-spacing:-.03em;color:var(--text)}
.wordmark:hover{text-decoration:none}
.mark{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;color:#fff;font:600 15px/1 var(--sans);
  background:radial-gradient(120% 120% at 20% 10%,#ffb547 0%,#ff5a1f 55%,#c2410c 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 6px 16px -6px rgba(255,90,31,.6)}

h1,h2,h3{margin:0;font-weight:600;letter-spacing:-.035em;color:var(--text)}
h1{font-size:clamp(40px,5.6vw,64px);line-height:1.02}
h2{font-size:clamp(24px,2.6vw,30px);line-height:1.15;letter-spacing:-.03em}
h3{font-size:17px;line-height:1.3;letter-spacing:-.02em}
.accent{color:var(--accent-ink)}
.lede{font-size:18px;line-height:1.55;color:var(--muted);max-width:44ch;margin:0}
.muted{color:var(--muted)}.faint{color:var(--faint)}.small{font-size:13.5px}.mono{font-family:var(--mono);font-size:13px}
p{margin:0}

/* frosted glass */
.glass{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:20px;box-shadow:inset 0 1px 0 var(--hi),var(--shadow);
  -webkit-backdrop-filter:blur(28px) saturate(170%);backdrop-filter:blur(28px) saturate(170%)}
.glass.pad{padding:28px}
.spot{--x:50%;--y:0%;overflow:hidden}
.spot::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .4s var(--ease);
  background:radial-gradient(420px circle at var(--x) var(--y),var(--accent-soft),transparent 60%)}
.spot:hover::after{opacity:1}
@media (prefers-reduced-transparency:reduce){.glass{background:var(--solid);-webkit-backdrop-filter:none;backdrop-filter:none}.aurora{display:none}}

/* forms */
.field{display:grid;gap:7px}
label,.label{font-size:13px;font-weight:500;color:var(--text)}
.hint{font-size:12.5px;color:var(--muted)}
input,select{font:inherit;font-size:15px;color:var(--text);background:var(--surface-2);border:1px solid var(--border-2);border-radius:12px;padding:12px 14px;width:100%;outline:none;
  transition:border-color .2s var(--ease),box-shadow .2s var(--ease)}
input::placeholder{color:var(--faint)}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}
.inline{display:flex;gap:8px;padding:6px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border-2);transition:box-shadow .2s var(--ease),border-color .2s var(--ease)}
.inline:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}
.inline input{border:0;background:transparent;box-shadow:none;padding:10px 14px;border-radius:999px}
.otp{font:500 30px/1 var(--mono);letter-spacing:.62em;text-indent:.62em;text-align:left;padding:16px 0 16px 18px;max-width:320px;
  background-image:repeating-linear-gradient(90deg,transparent 0 44px,var(--border-2) 44px 45px,transparent 45px 47px)}

/* buttons */
.btn,button{font:inherit;font-size:14.5px;font-weight:550;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;cursor:pointer;
  border:0;border-radius:999px;padding:11px 20px;color:var(--on-ink);background:var(--ink);text-decoration:none;
  transition:transform .15s var(--ease),box-shadow .25s var(--ease),background .2s var(--ease)}
.btn:hover,button:hover{text-decoration:none;box-shadow:0 8px 24px -10px rgba(255,90,31,.55)}
.btn:active,button:active{transform:scale(.98)}
.btn:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.btn.ghost,button.ghost{background:var(--surface-2);color:var(--text);box-shadow:inset 0 0 0 1px var(--border-2)}
.btn.ghost:hover,button.ghost:hover{box-shadow:inset 0 0 0 1px var(--border-2),0 6px 20px -12px rgba(0,0,0,.3)}
button.danger{background:var(--bad);color:#fff}
.btn.sm,button.sm{padding:7px 13px;font-size:13px}
.icon-btn{padding:8px;border-radius:10px}

.chip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;padding:4px 10px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);color:var(--muted)}
.chip.live{color:var(--ok);background:var(--ok-soft);border-color:transparent}
.chip.live::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.notice{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;background:var(--warn-soft);color:var(--warn);font-size:14px}
.flash{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;background:var(--ok-soft);color:var(--ok);font-size:14px}
.ph{font-size:1.15em;line-height:1}

/* code + copy */
.copy{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 14px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border)}
.copy pre{flex:1;min-width:0;margin:0;font:13px/1.55 var(--mono);color:var(--text);white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto}
.copy.block{align-items:flex-start;padding:14px}

/* tabs (CSS-only): radios, then one .tablist div, then the .tabpanel divs (panel n is div n+1) */
.tabs{display:grid;gap:16px}
.tabs>input{position:absolute;opacity:0;pointer-events:none}
.tablist{display:flex;gap:4px;padding:4px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);width:max-content;max-width:100%;overflow-x:auto}
.tablist label{padding:7px 14px;border-radius:999px;font-size:13.5px;color:var(--muted);cursor:pointer;white-space:nowrap;transition:background .2s var(--ease),color .2s var(--ease)}
.tabpanel{display:none}
${[1, 2, 3, 4, 5].map((i) => `.tabs>input:nth-of-type(${i}):checked~.tablist label:nth-of-type(${i}){background:var(--solid);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.08)}.tabs>input:nth-of-type(${i}):checked~.tabpanel:nth-of-type(${i + 1}){display:grid;gap:12px}`).join("")}
.tabs>input:focus-visible~.tablist{outline:2px solid var(--accent);outline-offset:2px}

/* tables, KPIs, bars (dashboard + reports) */
.tablewrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th{font-size:12px;font-weight:500;color:var(--muted);text-align:left;padding:0 10px 10px}
td{padding:11px 10px;border-top:1px solid var(--border);vertical-align:top}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px}
.kpi{padding:18px;display:grid;gap:4px}
.kpi span{font-size:12.5px;color:var(--muted)}
.kpi b{font-size:28px;font-weight:600;letter-spacing:-.035em;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi small{font-size:12.5px;color:var(--muted)}
.kpi.good b{color:var(--ok)}.kpi.bad b{color:var(--bad)}.kpi.warn b{color:var(--warn)}
.bars{display:grid;gap:12px}
.bar{display:grid;grid-template-columns:minmax(100px,190px) 1fr auto;gap:14px;align-items:center;font-size:14px}
.bar .track{height:8px;border-radius:999px;overflow:hidden}
.bar .fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blob-b),var(--accent))}
.bar.good .fill{background:var(--ok)}.bar.warn .fill{background:var(--warn)}.bar.bad .fill{background:var(--bad)}
.bar .val{color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px}

/* entry motion */
.rise{animation:rise .8s var(--ease) both}
.rise.d1{animation-delay:.06s}.rise.d2{animation-delay:.14s}.rise.d3{animation-delay:.22s}.rise.d4{animation-delay:.3s}
@keyframes rise{from{opacity:0;transform:translateY(14px)}}
.float{animation:float 9s ease-in-out infinite}
@keyframes float{50%{transform:translateY(-6px)}}

footer.foot{position:relative;z-index:2;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:1120px;margin:0 auto;padding:40px 20px 36px;color:var(--faint);font-size:13px}
footer.foot a{color:var(--muted)}

@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media (max-width:767px){.glass.pad{padding:20px}.bar{grid-template-columns:1fr auto}.bar .track{grid-column:1/-1;grid-row:2}.otp{font-size:24px}}
@media print{
  :root{--bg:#fff;--text:#111;--muted:#555;--border:#e4e4e7;--surface:#fff;--surface-2:#fafafa}
  html,body{background:#fff!important;color:#111}.aurora,.grain,.noprint,nav.top,footer.foot{display:none!important}
  .glass{box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:1px solid #e4e4e7}
  .shell{max-width:none;padding:0}section,.kpi,tr{break-inside:avoid}h2,h3{break-after:avoid}
}
`;

export interface LayoutOptions {
  title: string;
  body: string;
  /** "hero" = full aurora, "app" = calmer aurora, "report" = calm + print-first. */
  variant?: "hero" | "app" | "report";
  head?: string;
  /** Hide the default top nav (pages that render their own). */
  bare?: boolean;
}

export const wordmark = (href = "/") => `<a class="wordmark" href="${escapeHtml(href)}"><span class="mark">q</span>quemo</a>`;

export function layout({ title, body, variant = "app", head = "", bare = false }: LayoutOptions): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<script src="${ICONS}"></script>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx=".2" cy=".1" r="1.2"><stop offset="0" stop-color="#ffb547"/><stop offset=".55" stop-color="#ff5a1f"/><stop offset="1" stop-color="#c2410c"/></radialGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><text x="32" y="44" font-family="system-ui,sans-serif" font-weight="600" font-size="36" text-anchor="middle" fill="#fff">q</text></svg>`)}">
<style>${THEME_CSS}</style>${head}</head><body>
<div class="aurora${variant === "hero" ? "" : " quiet"}" aria-hidden="true"><i></i><i></i><i></i></div><div class="grain" aria-hidden="true"></div>
${bare ? "" : `<div class="shell"><nav class="top">${wordmark()}<a class="btn ghost sm" href="https://github.com/chxmxii/quemo" rel="noopener"><i class="ph ph-github-logo"></i>GitHub</a></nav></div>`}
<main class="shell">${body}</main>
<footer class="foot noprint"><span>quemo. Track your life from any AI chat.</span><a href="https://github.com/chxmxii/quemo" rel="noopener">Open source on GitHub</a></footer>
<script>
document.addEventListener("click",e=>{const b=e.target.closest("[data-copy]");if(!b)return;const t=document.getElementById(b.dataset.copy);navigator.clipboard.writeText(t.innerText).then(()=>{const o=b.innerHTML;b.innerHTML='<i class="ph ph-check"></i>Copied';setTimeout(()=>b.innerHTML=o,1400)})});
document.querySelectorAll(".spot").forEach(el=>el.addEventListener("pointermove",e=>{const r=el.getBoundingClientRect();el.style.setProperty("--x",(e.clientX-r.left)+"px");el.style.setProperty("--y",(e.clientY-r.top)+"px")}));
</script>
</body></html>`;
}

export function htmlResponse(html: string, status = 200, headers: HeadersInit = {}): Response {
  const res = new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
  new Headers(headers).forEach((v, k) => res.headers.append(k, v));
  return res;
}

/** A code block with a copy button. */
export function copyBlock(id: string, content: string): string {
  const multi = content.includes("\n");
  return `<div class="copy${multi ? " block" : ""}"><pre id="${escapeHtml(id)}">${escapeHtml(content)}</pre><button type="button" class="ghost sm noprint" data-copy="${escapeHtml(id)}"><i class="ph ph-copy"></i>Copy</button></div>`;
}
