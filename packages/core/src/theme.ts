/**
 * Quemo's shared look: white type on black, with a soft pastel prism arc of light that glows now and then.
 * Used by quemo-auth pages and by every tool's printable report.
 *
 * Shape system: containers 20px, inputs 12px, buttons and chips are full pills.
 * Color system: zinc neutrals + one accent (signal orange). Primary buttons are ink, never accent,
 * so their labels keep full contrast in both themes.
 * The glass is a web approximation using backdrop-filter, not an official platform material.
 */

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const FONTS = "https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap";
const ICONS = "https://unpkg.com/@phosphor-icons/web@2.1.1";

export const THEME_CSS = `
:root{
  color-scheme:dark;
  --bg:#050505;--text:#f5f5f4;--muted:rgba(245,245,244,.62);--faint:rgba(245,245,244,.4);
  --surface:rgba(255,255,255,.04);--surface-2:rgba(255,255,255,.07);--solid:#121212;
  --border:rgba(255,255,255,.1);--border-2:rgba(255,255,255,.18);--hi:rgba(255,255,255,.06);
  --accent:#f5f5f4;--accent-ink:#f5f5f4;--accent-soft:rgba(255,255,255,.08);--blue:#4d8bff;--yellow:#ffd34d;--pink:#ff5fb0;
  --ok:#6ea0ff;--ok-soft:rgba(110,160,255,.12);--warn:#ffd34d;--warn-soft:rgba(255,211,77,.12);--bad:#ff7ac0;--bad-soft:rgba(255,122,192,.12);
  --ink:#f5f5f4;--on-ink:#0a0a0a;
  --shadow:none;
  --sans:"Figtree",ui-sans-serif,system-ui,sans-serif;--display:"Figtree",ui-sans-serif,system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,monospace;
  --ease:cubic-bezier(.16,1,.3,1);
}
*{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100dvh;color:var(--text);font:15px/1.6 var(--sans);letter-spacing:-.006em;background:var(--bg);overflow-x:hidden;-webkit-font-smoothing:antialiased}
a{color:var(--accent-ink);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
::selection{background:var(--accent);color:#fff}

/* Background: a soft pastel prism arc (light refracting through glass) with a warm glare where it rises.
   Pure CSS rings, heavily blurred; drifts slowly and swells brighter every few seconds. Same on every page. */
.prism{position:fixed;inset:-20%;z-index:0;pointer-events:none;filter:blur(26px) saturate(115%);opacity:.7;
  background:
    radial-gradient(55% 45% at 88% 12%,rgba(255,244,222,.42),transparent 62%),
    radial-gradient(circle at 86% 172%,transparent 57.5%,rgba(255,140,170,.5) 60%,rgba(255,205,140,.58) 62%,rgba(236,240,160,.55) 64%,rgba(160,232,200,.5) 66%,rgba(150,205,255,.48) 68%,rgba(205,175,255,.42) 70%,transparent 73.5%),
    radial-gradient(circle at 86% 172%,transparent 64%,rgba(255,250,235,.16) 70%,transparent 78%);
  animation:prismDrift 26s ease-in-out infinite alternate,prismGlow 8s ease-in-out infinite}
@keyframes prismDrift{to{transform:translate(-3%,2%) rotate(-2deg)}}
@keyframes prismGlow{0%,55%,100%{opacity:.62}72%{opacity:1}}
.veil{position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(50% 34% at 50% 46%,rgba(5,5,5,.42),transparent 72%)}
@keyframes driftC{to{transform:translate(14vmax,-6vmax) scale(1.12)}}
.grain{display:none}

.shell{position:relative;z-index:2;width:100%;max-width:760px;margin:0 auto;padding:0 20px}
.wide .shell,.wide footer.foot{max-width:1000px}
nav.top{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px 0 0}
.wordmark{display:inline-flex;align-items:center;gap:9px;font:800 19px/1 var(--display);letter-spacing:-.04em;color:var(--text)}
.wordmark:hover{text-decoration:none}
.mark{width:12px;height:12px;border-radius:50%;background:conic-gradient(#ff4fa3,#ffc928,#3ddc84,#2f6bff,#8b5cf6,#ff4fa3)}

h1,h2,h3{margin:0;font-family:var(--display);font-weight:400;letter-spacing:-.035em;color:var(--text)}
h1{font-size:clamp(32px,4.4vw,56px);line-height:1.06;font-weight:400}
h2{font-size:13px;line-height:1.4;letter-spacing:.01em;font-weight:600;color:var(--muted)}
h3{font-size:14px;line-height:1.4;letter-spacing:.02em}
.accent{color:var(--accent-ink)}
.lede{font-size:16px;line-height:1.6;color:var(--muted);max-width:40ch;margin:0}
.muted{color:var(--muted)}.faint{color:var(--faint)}.small{font-size:13.5px}.mono{font-family:var(--mono);font-size:13px}
p{margin:0}

/* frosted glass */
.glass{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:16px;
  -webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}
.glass.pad{padding:24px}
.spot{--x:50%;--y:0%;overflow:hidden}
.spot::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .4s var(--ease);
  background:radial-gradient(420px circle at var(--x) var(--y),var(--accent-soft),transparent 60%)}
.spot:hover::after{opacity:1}
@media (prefers-reduced-transparency:reduce){.glass{background:var(--solid);-webkit-backdrop-filter:none;backdrop-filter:none}.prism{opacity:.62}}

/* forms */
.field{display:grid;gap:7px}
label,.label{font:500 13px/1.4 var(--display);color:var(--muted)}
.hint{font-size:12.5px;color:var(--muted)}
input,select{font:inherit;font-size:15px;color:var(--text);background:var(--solid);border:1px solid var(--border-2);border-radius:12px;padding:12px 14px;width:100%;outline:none;
  transition:border-color .2s var(--ease),box-shadow .2s var(--ease)}
input::placeholder{color:var(--faint)}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}
.inline{display:flex;gap:8px;padding:6px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border-2);transition:box-shadow .2s var(--ease),border-color .2s var(--ease)}
.inline:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}
.inline input{border:0;background:transparent;box-shadow:none;padding:10px 14px;border-radius:999px}
.otp{font:500 30px/1 var(--mono);letter-spacing:.62em;text-indent:.62em;text-align:left;padding:16px 0 16px 18px;max-width:320px;
  background-image:repeating-linear-gradient(90deg,transparent 0 44px,var(--border-2) 44px 45px,transparent 45px 47px)}

/* buttons */
.btn,button{font:600 14.5px/1.2 var(--display);letter-spacing:-.01em;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;cursor:pointer;
  border:0;border-radius:999px;padding:11px 20px;color:var(--on-ink);background:var(--ink);text-decoration:none;
  transition:transform .15s var(--ease),box-shadow .25s var(--ease),background .2s var(--ease)}
.btn:hover,button:hover{text-decoration:none;opacity:.88}
.btn:active,button:active{transform:scale(.98)}
.btn:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.btn.ghost,button.ghost{background:transparent;color:var(--text);box-shadow:inset 0 0 0 1px var(--border-2)}
.btn.ghost:hover,button.ghost:hover{opacity:1;background:var(--solid)}
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
.kpi b{font-size:26px;font-weight:500;letter-spacing:-.035em;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi small{font-size:12.5px;color:var(--muted)}
.kpi.good b{color:var(--ok)}.kpi.bad b{color:var(--bad)}.kpi.warn b{color:var(--warn)}
.bars{display:grid;gap:12px}
.bar{display:grid;grid-template-columns:minmax(100px,190px) 1fr auto;gap:14px;align-items:center;font-size:14px}
.bar .track{height:8px;border-radius:999px;overflow:hidden}
.bar .fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--accent))}
.bar.good .fill{background:var(--ok)}.bar.warn .fill{background:var(--warn)}.bar.bad .fill{background:var(--bad)}
.bar .val{color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px}

/* hairline lists */
.rows{display:grid}
.rows>*{padding:18px 0;border-top:1px solid var(--border)}
.rows>*:last-child{border-bottom:1px solid var(--border)}
section.block{display:grid;gap:14px;padding:40px 0 0}
/* centered composition: text, labels and actions sit on the middle axis; rows and code stay readable */
.center{text-align:center;justify-items:center}
.center>*,.center form{width:100%}
.center .lede{margin:0 auto}
.center form{display:grid;justify-items:center}
.center form>*:not(input):not(.beam):not(.inline):not(div){justify-self:center}
.center .beam,.center .otp{margin:0 auto;width:100%}
.center .otp{text-align:center;text-indent:.62em;padding-left:0}
.center form[style*="display:flex"]{display:flex!important;justify-content:center}
.center .tablist{margin:0 auto}
.center .tabpanel>p{text-align:center}
.center details summary{list-style-position:inside}

/* entry motion */
.rise{animation:rise .6s var(--ease) both}
.rise.d1{animation-delay:.06s}.rise.d2{animation-delay:.14s}.rise.d3{animation-delay:.22s}.rise.d4{animation-delay:.3s}
@keyframes rise{from{opacity:0;transform:translateY(6px)}}
.float{}
@keyframes float{50%{transform:translateY(-6px)}}

footer.foot{position:relative;z-index:2;display:flex;justify-content:center;gap:12px;flex-wrap:wrap;max-width:760px;margin:0 auto;padding:40px 20px 36px;color:var(--faint);font-size:13px}
footer.foot a{color:var(--muted)}



/* ---------- big centered brand ---------- */
.brand{font:800 clamp(64px,13vw,148px)/.9 var(--display);letter-spacing:-.055em;margin:0;color:#fff;
  text-shadow:0 0 18px rgba(255,255,255,.35),0 0 60px rgba(255,255,255,.18);animation:brandBreath 6s ease-in-out infinite}
@keyframes brandBreath{50%{text-shadow:0 0 24px rgba(255,255,255,.5),0 0 80px rgba(255,255,255,.25)}}
.thin{font-family:var(--display);font-weight:300;letter-spacing:-.03em;color:var(--text)}
.tagline{font-size:clamp(20px,2.6vw,28px);line-height:1.3;margin:0}
.lede.thin{font-family:var(--sans);font-weight:300;font-size:16px;opacity:.8}

/* ---------- feedback (no glows; ink + hairlines) ---------- */
button:not(.ghost):not(.danger):hover,.btn:not(.ghost):hover{opacity:1;background:#d9d9d6}
.beam:focus-within{box-shadow:0 0 30px -8px rgba(255,255,255,.25)}
.rows>*:hover::before{box-shadow:inset 0 0 0 1px var(--border)}
.copy{transition:border-color .3s var(--ease)}
.copy:hover{border-color:var(--border-2)}
.otp{font-family:var(--mono);font-weight:500}
.kpi b{font-family:var(--display);font-weight:600;letter-spacing:-.04em}
.rotator{color:var(--text)}

/* everything on the middle axis */
.center .rows,.center .tabpanel{text-align:center}
.center .copy{justify-content:center}
.center .copy pre{text-align:center}

/* full-viewport centering */
body.fill{position:relative}
body.fill main.shell{min-height:100dvh;display:grid;place-items:center;padding-top:0;padding-bottom:0}
body.fill main.shell>*{width:100%}
body.fill .navwrap{position:absolute;top:0;left:0;right:0}
body.fill footer.foot{position:absolute;bottom:0;left:0;right:0;max-width:none}

/* reports and any remaining blocks sit on the middle axis too */
.wide main{text-align:center}
.wide main header,.wide main section{justify-items:center}
.wide main header>div{justify-content:center!important}
.wide main ul{list-style:none;padding-left:0!important;justify-items:center}
.wide main .kpi{justify-items:center;text-align:center}
.wide main .bars{width:100%}
.wide main table{text-align:center}.wide main th,.wide main td{text-align:center}
.wide main .notice{justify-content:center}
.center .copy{justify-content:center}.center .copy pre{text-align:center}
.center .field{justify-items:center}.center .field input,.center .field select{text-align:center}
.center details{text-align:center}
.center .tablist{display:flex}
footer.foot{text-align:center}

/* ---------- motion layer ---------- */
@view-transition{navigation:auto}
::view-transition-old(root),::view-transition-new(root){animation-duration:.38s;animation-timing-function:cubic-bezier(.16,1,.3,1)}


/* word-by-word blur reveal */
.reveal .w{display:inline-block;opacity:0;filter:blur(10px);transform:translateY(.25em);animation:wordIn .9s var(--ease) forwards;animation-delay:calc(var(--i) * 70ms + 80ms)}
@keyframes wordIn{to{opacity:1;filter:blur(0);transform:none}}

/* rotating word: all words share one grid cell, the active one slides + unblurs in */

/* rotating word: white, width follows the active word so the line stays centered; each arrival flashes a palette color */
.rotator{display:inline-block;position:relative;height:1.3em;vertical-align:bottom;text-align:left;color:var(--text);transition:width .6s var(--ease)}
.rotator>span{position:absolute;left:0;top:0;white-space:nowrap;opacity:0;filter:blur(8px);transform:translateY(.45em);transition:opacity .55s var(--ease),filter .55s var(--ease),transform .55s var(--ease)}
.rotator:not(.js)>span:first-child,.rotator>span.on{opacity:1;filter:blur(0);transform:none}
.rotator:not(.js){width:auto}.rotator:not(.js)>span:first-child{position:static}
.rotator>span.on{animation:wordFlash 1.6s var(--ease)}
.rotator>span:nth-child(4n+1){--c:#ff4fa3}.rotator>span:nth-child(4n+2){--c:#2f6bff}.rotator>span:nth-child(4n+3){--c:#8b5cf6}.rotator>span:nth-child(4n){--c:#f59e0b}
@keyframes wordFlash{0%,45%{color:var(--c)}100%{color:var(--text)}}
.rotator>span.out{opacity:0;filter:blur(8px);transform:translateY(-.45em)}

.brand{display:block;text-align:center}

/* light beam that orbits a field while it is focused */
@property --a{syntax:"<angle>";inherits:false;initial-value:0deg}
.beam{position:relative;border-radius:999px;padding:1px;background:var(--border-2)}
.beam::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;opacity:0;transition:opacity .35s ease;
  background:conic-gradient(from var(--a),#ff4fa3,#ffc928,#3ddc84,#2f6bff,#8b5cf6,#ff4fa3);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:spin 2.6s linear infinite}
.beam:focus-within::before{opacity:1}
.beam input{border:0;border-radius:999px;box-shadow:none!important;padding:14px 20px}
@keyframes spin{to{--a:360deg}}

/* buttons: sliding arrow, shine sweep, loading shimmer */
.btn .ph-arrow-right,button .ph-arrow-right{transition:transform .3s var(--ease)}
.btn:hover .ph-arrow-right,button:hover .ph-arrow-right{transform:translateX(3px)}
button:not(.ghost){position:relative;overflow:hidden}
button:not(.ghost)::after{content:"";position:absolute;inset:0;transform:translateX(-120%);background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.18) 50%,transparent 70%)}
button:not(.ghost):hover::after{transform:translateX(120%);transition:transform .8s var(--ease)}
button.loading{pointer-events:none;opacity:.75}
button.loading::after{transform:none;animation:shimmer 1.1s linear infinite}
@keyframes shimmer{from{transform:translateX(-120%)}to{transform:translateX(120%)}}

/* rows: hover wash slides in from the left */
.rows>*{position:relative}
.rows>*::before{content:"";position:absolute;inset:0 -12px;border-radius:12px;background:var(--surface-2);transform:scaleX(.96);opacity:0;z-index:-1;transition:opacity .3s var(--ease),transform .4s var(--ease)}
.rows>*:hover::before{opacity:1;transform:none}
.rows.stagger>*{opacity:0;animation:rise .7s var(--ease) forwards;animation-delay:calc(var(--i,0) * 60ms + 150ms)}
/* live status: real linked state only */
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ok);margin-right:7px;position:relative;top:-1px}
.dot::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--ok);animation:ping 2.4s var(--ease) infinite}
@keyframes ping{70%,100%{transform:scale(2.6);opacity:0}}

/* tabs: sliding pill indicator */
.tablist{position:relative}
.tablist .ind{position:absolute;top:4px;left:0;height:calc(100% - 8px);border-radius:999px;background:var(--solid);box-shadow:0 1px 3px rgba(0,0,0,.08);transition:transform .45s var(--ease),width .45s var(--ease);z-index:0}
.tablist label{position:relative;z-index:1}
.tablist.js label{background:transparent!important;box-shadow:none!important}
.tabpanel{animation:rise .45s var(--ease)}

/* copy feedback */
[data-copy].done{color:var(--ok)}

@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.reveal .w,.rows.stagger>*{opacity:1;filter:none;transform:none}.rotator>span{transition:none}}
@media (max-width:767px){.glass.pad{padding:20px}.bar{grid-template-columns:1fr auto}.bar .track{grid-column:1/-1;grid-row:2}.otp{font-size:24px}}
@media print{
  :root{--bg:#fff;--text:#111;--muted:#555;--border:#e4e4e7;--surface:#fff;--surface-2:#fafafa}
  html,body{background:#fff!important;color:#111}.prism,.veil,.noprint,nav.top,footer.foot{display:none!important}
  .glass{box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:1px solid #e4e4e7}
  .shell{max-width:none;padding:0}section,.kpi,tr{break-inside:avoid}h2,h3{break-after:avoid}
}
`;

export interface LayoutOptions {
  title: string;
  body: string;
  /** "report" is print-first; every variant shares the same prism background. */
  variant?: "hero" | "app" | "report";
  head?: string;
  /** Hide the default top nav (pages that render their own). */
  bare?: boolean;
  /** Center the content in the full viewport (nav and footer float over the edges). */
  fill?: boolean;
}

export const wordmark = (href = "/") => `<a class="wordmark" href="${escapeHtml(href)}"><span class="mark">q</span>quemo</a>`;

export function layout({ title, body, variant = "app", head = "", bare = false, fill = false }: LayoutOptions): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<script src="${ICONS}"></script>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx=".2" cy=".1" r="1.2"><stop offset="0" stop-color="#facc15"/><stop offset=".5" stop-color="#8b5cf6"/><stop offset="1" stop-color="#3b82f6"/></radialGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><text x="32" y="44" font-family="system-ui,sans-serif" font-weight="600" font-size="36" text-anchor="middle" fill="#fff">q</text></svg>`)}">
<style>${THEME_CSS}</style>${head}</head><body class="${variant === "report" ? "wide" : ""}${fill ? " fill" : ""}">
<div class="prism" aria-hidden="true"></div><div class="veil" aria-hidden="true"></div>
${bare ? "" : `<div class="shell navwrap"><nav class="top">${wordmark()}<a class="small muted" href="https://github.com/chxmxii/quemo" rel="noopener">GitHub</a></nav></div>`}
<main class="shell">${body}</main>
<footer class="foot noprint"><span>quemo</span><a href="https://github.com/chxmxii/quemo" rel="noopener">Open source</a></footer>
<script>
(()=>{
const still=matchMedia("(prefers-reduced-motion: reduce)").matches;

document.addEventListener("click",e=>{const b=e.target.closest("[data-copy]");if(!b)return;const t=document.getElementById(b.dataset.copy);navigator.clipboard.writeText(t.innerText).then(()=>{const o=b.innerHTML;b.innerHTML='<i class="ph ph-check"></i>Copied';b.classList.add("done");setTimeout(()=>{b.innerHTML=o;b.classList.remove("done")},1400)})});
document.querySelectorAll(".spot").forEach(el=>el.addEventListener("pointermove",e=>{const r=el.getBoundingClientRect();el.style.setProperty("--x",(e.clientX-r.left)+"px");el.style.setProperty("--y",(e.clientY-r.top)+"px")}));
document.addEventListener("submit",e=>{const b=e.submitter||e.target.querySelector("button");if(b&&!b.classList.contains("ghost"))setTimeout(()=>b.classList.add("loading"),0)});
document.querySelectorAll(".rows.stagger>*").forEach((el,i)=>el.style.setProperty("--i",i));
// sliding tab indicator
document.querySelectorAll(".tabs").forEach(tabs=>{const list=tabs.querySelector(".tablist");if(!list)return;const ind=document.createElement("span");ind.className="ind";list.prepend(ind);list.classList.add("js");
  const move=()=>{const r=tabs.querySelector("input:checked");if(!r)return;const l=list.querySelector('label[for="'+r.id+'"]');ind.style.width=l.offsetWidth+"px";ind.style.transform="translateX("+l.offsetLeft+"px)";list.querySelectorAll("label").forEach(x=>x.style.color=x===l?"var(--text)":"")};
  tabs.addEventListener("change",move);addEventListener("resize",move);move()});
// rotating words (width follows the active word so the sentence stays centered)
document.querySelectorAll(".rotator").forEach(r=>{const w=[...r.children];let i=0;r.classList.add("js");w[0].classList.add("on");const fit=()=>{r.style.width=w[i].getBoundingClientRect().width+"px"};fit();addEventListener("resize",fit);document.fonts&&document.fonts.ready.then(fit);
  if(still)return;setInterval(()=>{const a=w[i];a.classList.remove("on");a.classList.add("out");setTimeout(()=>a.classList.remove("out"),600);i=(i+1)%w.length;w[i].classList.add("on");fit()},2600)});
if(still)return;
})();
</script>
</body></html>`;
}

/** Wraps each word so it can blur-reveal in sequence. Pass already-escaped HTML-free text. */
export function revealWords(text: string, start = 0): string {
  return text.split(" ").map((w, i) => `<span class="w" style="--i:${i + start}">${escapeHtml(w)}</span>`).join(" ");
}

export function htmlResponse(html: string, status = 200, headers: HeadersInit = {}): Response {
  const res = new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Referrer-Policy": "same-origin", // never leaks report links to other sites
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
