/**
 * Quemo's shared look: a smooth dusk-sky gradient behind frosted-glass surfaces, dark only.
 * Used by quemo-auth pages and by every tool's printable report.
 *
 * Shape system: containers 20px, inputs 12px, buttons and chips are full pills.
 * Color system: zinc neutrals + one accent (signal orange). Primary buttons are ink, never accent,
 * so their labels keep full contrast in both themes.
 * The glass is a web approximation using backdrop-filter, not an official platform material.
 */

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const FONTS = "https://fonts.googleapis.com/css2?family=Unbounded:wght@200;300;400;500;600&family=Space+Grotesk:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap";
const ICONS = "https://unpkg.com/@phosphor-icons/web@2.1.1";

export const THEME_CSS = `
:root{
  color-scheme:dark;
  --bg:#050507;--text:#f2f2f4;--muted:#a1a1ab;--faint:#71717b;
  --surface:rgba(26,26,31,.52);--surface-2:rgba(34,34,40,.72);--solid:#17171b;
  --border:rgba(255,255,255,.08);--border-2:rgba(255,255,255,.14);--hi:rgba(255,255,255,.07);
  --accent:#a78bfa;--accent-ink:#c4b5fd;--accent-soft:rgba(167,139,250,.14);--blue:#60a5fa;--yellow:#fde047;--pink:#f472b6;
  --ok:#60a5fa;--ok-soft:rgba(96,165,250,.12);--warn:#fde047;--warn-soft:rgba(253,224,71,.12);--bad:#c084fc;--bad-soft:rgba(192,132,252,.12);
  --ink:#f2f2f4;--on-ink:#111114;
  --shadow:none;
  --blob-a:#7c3aed;--blob-b:#2563eb;--blob-c:#eab308;--blob-o:.55;
  --sans:"Space Grotesk",ui-sans-serif,system-ui,sans-serif;--display:"Unbounded","Space Grotesk",ui-sans-serif,sans-serif;--mono:"Geist Mono",ui-monospace,monospace;
  --ease:cubic-bezier(.16,1,.3,1);
}
*{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100dvh;color:var(--text);font:15px/1.6 var(--sans);letter-spacing:-.006em;background:var(--bg);overflow-x:hidden;-webkit-font-smoothing:antialiased}
a{color:var(--accent-ink);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
::selection{background:var(--accent);color:#fff}

/* GTA-style dusk sky: a smooth pink / purple / blue / yellow gradient that slowly breathes.
   Base layer is a static gradient, the glow layer drifts very slowly (no pulsing). */
.sky{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;
  background:
    radial-gradient(100% 45% at 50% 115%,rgba(250,204,21,.28) 0%,rgba(236,72,153,.24) 30%,transparent 65%),
    radial-gradient(70% 40% at 12% 105%,rgba(236,72,153,.28),transparent 60%),
    radial-gradient(70% 40% at 88% 105%,rgba(139,92,246,.3),transparent 62%),
    radial-gradient(90% 45% at 50% -12%,rgba(37,99,235,.22),transparent 60%),
    linear-gradient(180deg,#05040c 0%,#07061a 55%,#130a26 85%,#1d0c2c 100%)}
/* moving color layer: a big mesh of pink / purple / blue / yellow light that slowly swirls */
.sky::before{content:"";position:absolute;left:50%;top:78vh;width:180vmax;height:180vmax;margin-left:-90vmax;opacity:.32;filter:blur(70px);
  background:
    radial-gradient(22% 18% at 30% 70%,#ec4899,transparent 70%),
    radial-gradient(24% 20% at 70% 72%,#8b5cf6,transparent 70%),
    radial-gradient(18% 14% at 50% 80%,#facc15,transparent 70%),
    radial-gradient(26% 20% at 50% 35%,#2563eb,transparent 70%),
    radial-gradient(20% 16% at 22% 40%,#8b5cf6,transparent 70%),
    radial-gradient(20% 16% at 78% 42%,#ec4899,transparent 70%);
  animation:swirl 26s linear infinite}
@keyframes swirl{to{transform:rotate(360deg)}}
.sky::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#05040c 0%,rgba(5,4,12,.85) 35%,transparent 70%)}
.sky i{position:absolute;border-radius:50%;filter:blur(80px);opacity:.3;will-change:transform,background-color}
.sky i:nth-child(1){width:44vmax;height:26vmax;left:-10vmax;bottom:-16vmax;background:#ec4899;animation:skyA 14s ease-in-out infinite alternate,tint 18s linear infinite}
.sky i:nth-child(2){width:44vmax;height:26vmax;right:-10vmax;bottom:-15vmax;background:#8b5cf6;animation:skyB 17s ease-in-out infinite alternate,tint 18s linear -6s infinite}
.sky i:nth-child(3){width:40vmax;height:24vmax;left:50%;bottom:-8vmax;margin-left:-20vmax;background:#facc15;opacity:.22;animation:skyC 11s ease-in-out infinite alternate}
.sky i:nth-child(4){width:56vmax;height:22vmax;left:50%;top:-16vmax;margin-left:-28vmax;background:#2563eb;opacity:.2;z-index:1;animation:skyTop 20s ease-in-out infinite alternate}
.sky.quiet{opacity:.7}
@keyframes skyA{to{transform:translate(22vmax,-4vmax) scale(1.15)}}
@keyframes skyB{to{transform:translate(-22vmax,-4vmax) scale(1.12)}}
@keyframes skyTop{to{transform:translate(6vmax,2vmax) scale(1.1)}}
@keyframes skyC{to{transform:translate(0,-4vmax) scale(1.2)}}
@keyframes tint{0%,100%{background-color:#ec4899}33%{background-color:#8b5cf6}66%{background-color:#2563eb}}
@keyframes driftC{to{transform:translate(14vmax,-6vmax) scale(1.12)}}
.grain{display:none}

.shell{position:relative;z-index:2;width:100%;max-width:760px;margin:0 auto;padding:0 20px}
.wide .shell,.wide footer.foot{max-width:1000px}
nav.top{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px 0 0}
.wordmark{display:inline-flex;align-items:center;gap:10px;font:500 15px/1 var(--display);letter-spacing:.32em;text-transform:uppercase;color:var(--text)}
.wordmark:hover{text-decoration:none}
.mark{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px 2px var(--accent);animation:breathe 3.2s ease-in-out infinite}

h1,h2,h3{margin:0;font-family:var(--display);font-weight:500;letter-spacing:-.02em;color:var(--text)}
h1{font-size:clamp(30px,4.6vw,48px);line-height:1.12;font-weight:400}
h2{font-size:12px;line-height:1.4;letter-spacing:.22em;text-transform:uppercase;font-weight:400;color:var(--muted)}
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
@media (prefers-reduced-transparency:reduce){.glass{background:var(--solid);-webkit-backdrop-filter:none;backdrop-filter:none}.sky i{display:none}}

/* forms */
.field{display:grid;gap:7px}
label,.label{font:400 11px/1.4 var(--display);letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
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
.btn,button{font:500 12.5px/1.2 var(--display);letter-spacing:.14em;text-transform:uppercase;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;cursor:pointer;
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
.brand{font:500 clamp(56px,13vw,132px)/1 var(--display);letter-spacing:.16em;text-indent:.16em;text-transform:uppercase;margin:0;color:var(--text);}
.thin{font-family:var(--display);font-weight:200;letter-spacing:.01em;color:var(--text)}
.tagline{font-size:clamp(20px,2.6vw,28px);line-height:1.3;margin:0}
.lede.thin{font-family:var(--sans);font-weight:300;font-size:16px;opacity:.8}

/* ---------- glow ---------- */
@keyframes breathe{50%{box-shadow:0 0 22px 6px var(--accent);opacity:.85}}
.reveal{animation:textGlow 4.5s ease-in-out 1.4s infinite}
@keyframes textGlow{0%,100%{text-shadow:0 0 0 transparent}50%{text-shadow:0 0 28px var(--accent-soft),0 0 2px var(--accent-soft)}}
button:not(.ghost):not(.danger),.btn:not(.ghost){box-shadow:0 0 0 0 rgba(139,92,246,0);animation:aura 3.6s ease-in-out infinite}
@keyframes aura{50%{box-shadow:0 0 28px -2px rgba(139,92,246,.45)}}
button:not(.ghost):not(.danger):hover,.btn:not(.ghost):hover{box-shadow:0 0 36px 0 rgba(139,92,246,.6);opacity:1}
.beam:focus-within{box-shadow:0 0 30px -4px rgba(139,92,246,.45)}
.rows>*:hover::before{box-shadow:0 0 30px -8px rgba(139,92,246,.4),inset 0 0 0 1px rgba(139,92,246,.25)}
.copy{transition:box-shadow .3s var(--ease),border-color .3s var(--ease)}
.copy:hover{border-color:rgba(139,92,246,.35);box-shadow:0 0 24px -8px rgba(139,92,246,.45)}
.tablist .ind{box-shadow:0 0 18px -4px rgba(139,92,246,.5),0 1px 3px rgba(0,0,0,.08)}
.otp{font-family:var(--display);font-weight:300}
.kpi b{font-family:var(--display);font-weight:400}

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

/* cursor-following glow (positioned by JS) */
.glow{position:fixed;left:0;top:0;width:520px;height:520px;margin:-260px 0 0 -260px;border-radius:50%;z-index:0;pointer-events:none;
  background:radial-gradient(circle,var(--accent-soft) 0%,transparent 65%);opacity:0;transition:opacity .6s ease;will-change:transform}
.glow.on{opacity:1}
@media (hover:none){.glow{display:none}.sky i,.sky::before{animation:none}}

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
.rotator>span:nth-child(4n+1){--c:#8b5cf6}.rotator>span:nth-child(4n+2){--c:#3b82f6}.rotator>span:nth-child(4n+3){--c:#ec4899}.rotator>span:nth-child(4n){--c:#facc15}
@keyframes wordFlash{0%{color:var(--c);text-shadow:0 0 22px var(--c),0 0 6px var(--c)}55%{color:var(--c);text-shadow:0 0 16px var(--c)}100%{color:var(--text);text-shadow:0 0 0 transparent}}
.rotator>span.out{opacity:0;filter:blur(8px);transform:translateY(-.45em)}

.brand{display:block;text-align:center}

/* light beam that orbits a field while it is focused */
@property --a{syntax:"<angle>";inherits:false;initial-value:0deg}
.beam{position:relative;border-radius:14px;padding:1px;background:var(--border-2)}
.beam::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;opacity:0;transition:opacity .35s ease;
  background:conic-gradient(from var(--a),transparent 0 58%,var(--blue) 68%,var(--accent) 78%,var(--pink) 86%,var(--yellow) 93%,transparent 98%);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:spin 2.6s linear infinite}
.beam:focus-within::before{opacity:1}
.beam input{border:0;border-radius:13px;box-shadow:none!important}
@keyframes spin{to{--a:360deg}}

/* buttons: sliding arrow, shine sweep, loading shimmer */
.btn .ph-arrow-right,button .ph-arrow-right{transition:transform .3s var(--ease)}
.btn:hover .ph-arrow-right,button:hover .ph-arrow-right{transform:translateX(3px)}
button:not(.ghost){position:relative;overflow:hidden}
button:not(.ghost)::after{content:"";position:absolute;inset:0;transform:translateX(-120%);background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.28) 50%,transparent 70%)}
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

@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.reveal .w,.rows.stagger>*{opacity:1;filter:none;transform:none}.rotator>span{transition:none}.glow{display:none}.sky i,.sky::before{animation:none}}
@media (max-width:767px){.glass.pad{padding:20px}.bar{grid-template-columns:1fr auto}.bar .track{grid-column:1/-1;grid-row:2}.otp{font-size:24px}}
@media print{
  :root{--bg:#fff;--text:#111;--muted:#555;--border:#e4e4e7;--surface:#fff;--surface-2:#fafafa}
  html,body{background:#fff!important;color:#111}.sky,.noprint,nav.top,footer.foot{display:none!important}
  .glass{box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:1px solid #e4e4e7}
  .shell{max-width:none;padding:0}section,.kpi,tr{break-inside:avoid}h2,h3{break-after:avoid}
}
`;

export interface LayoutOptions {
  title: string;
  body: string;
  /** "hero" = full sky, "app" = dimmer sky, "report" = dimmer sky + print-first. */
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
<div class="sky${variant === "hero" ? "" : " quiet"}" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
${bare ? "" : `<div class="shell navwrap"><nav class="top">${wordmark()}<a class="small muted" href="https://github.com/chxmxii/quemo" rel="noopener">GitHub</a></nav></div>`}
<main class="shell">${body}</main>
<footer class="foot noprint"><span>quemo</span><a href="https://github.com/chxmxii/quemo" rel="noopener">Open source</a></footer>
<div class="glow" aria-hidden="true"></div>
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
// cursor glow with easing
const g=document.querySelector(".glow");if(g&&matchMedia("(hover:hover)").matches){let x=innerWidth/2,y=innerHeight/3,tx=x,ty=y;addEventListener("pointermove",e=>{tx=e.clientX;ty=e.clientY;g.classList.add("on")});(function f(){x+=(tx-x)*.08;y+=(ty-y)*.08;g.style.transform="translate("+x+"px,"+y+"px)";requestAnimationFrame(f)})()}
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
