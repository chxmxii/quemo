/**
 * The shared "Quemo City" look: neon sunset, chrome type, palm silhouettes and a synthwave grid.
 * Used by the sign-up / dashboard pages in quemo-auth and by every tool's printable reports.
 */

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Chakra+Petch:ital,wght@0,400;0,500;0,600;0,700;1,600&family=JetBrains+Mono:wght@400;600&display=swap";

const PALM = `<svg viewBox="0 0 200 400" aria-hidden="true"><path fill="currentColor" d="M104 400h-14c4-70 8-150 2-230l8-2c8 80 6 160 4 232z"/><path fill="currentColor" d="M98 170c-30-40-70-50-98-40 30-4 62 8 90 46zM100 168c10-50 40-80 80-86-34 14-58 44-72 90zM96 172C70 130 40 112 6 118c40 2 68 26 86 60zM102 170c30-30 64-36 96-24-34-4-62 6-88 32zM98 166c-6-50 6-90 34-118-20 34-28 74-26 120zM96 168c-24-34-28-76-14-110-4 36 4 72 22 108z"/></svg>`;

export const THEME_CSS = `
:root{
  --night:#07030f;--night2:#160a2b;--ink:#f7f0ff;--muted:#b9a7d6;--line:rgba(255,255,255,.12);
  --pink:#ff3d8b;--orange:#ff9a3c;--sun:#ffd166;--violet:#8b5cf6;--cyan:#33f0ff;--lime:#7dffb2;--red:#ff4d6d;
  --glass:rgba(22,10,44,.62);--glass2:rgba(255,255,255,.04);
  --grad:linear-gradient(100deg,var(--pink) 0%,var(--orange) 55%,var(--sun) 100%);
  --grad2:linear-gradient(120deg,var(--violet),var(--pink));
  --display:"Bebas Neue",Impact,"Arial Narrow",sans-serif;--ui:"Chakra Petch",system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,monospace;
}
*{box-sizing:border-box}
html{background:var(--night)}
body{margin:0;min-height:100vh;color:var(--ink);font:16px/1.55 var(--ui);background:
  radial-gradient(120% 70% at 50% 110%,rgba(255,61,139,.35),transparent 60%),
  radial-gradient(90% 60% at 80% -10%,rgba(139,92,246,.35),transparent 60%),
  linear-gradient(180deg,var(--night) 0%,var(--night2) 100%);overflow-x:hidden}
a{color:var(--cyan)}::selection{background:var(--pink);color:#fff}
.scan{pointer-events:none;position:fixed;inset:0;z-index:50;background:repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 1px,transparent 1px 3px);mix-blend-mode:overlay}
.city{position:fixed;inset:auto 0 0 0;height:46vh;z-index:0;pointer-events:none;overflow:hidden}
.sun{position:absolute;left:50%;bottom:22vh;width:min(62vw,520px);aspect-ratio:1;transform:translateX(-50%);border-radius:50%;
  background:linear-gradient(180deg,var(--sun) 0%,var(--orange) 45%,var(--pink) 80%);
  -webkit-mask:linear-gradient(180deg,#000 52%,transparent 52% 56%,#000 56% 63%,transparent 63% 67%,#000 67% 73%,transparent 73% 78%,#000 78% 83%,transparent 83% 89%,#000 89%);
          mask:linear-gradient(180deg,#000 52%,transparent 52% 56%,#000 56% 63%,transparent 63% 67%,#000 67% 73%,transparent 73% 78%,#000 78% 83%,transparent 83% 89%,#000 89%);
  filter:drop-shadow(0 0 60px rgba(255,61,139,.55));opacity:.9}
.grid{position:absolute;left:-50%;right:-50%;bottom:0;height:24vh;transform:perspective(320px) rotateX(62deg);transform-origin:bottom;
  background:linear-gradient(transparent 0 94%,rgba(51,240,255,.55) 94%) 0 0/100% 34px,linear-gradient(90deg,transparent 0 97%,rgba(255,61,139,.5) 97%) 0 0/56px 100%;
  animation:drive 1.6s linear infinite;-webkit-mask:linear-gradient(transparent,#000 40%);mask:linear-gradient(transparent,#000 40%)}
@keyframes drive{to{background-position:0 34px,0 0}}
.palm{position:absolute;bottom:18vh;width:min(28vw,220px);color:#12051f;filter:drop-shadow(0 0 1px rgba(255,61,139,.6))}
.palm.l{left:-2vw;transform:rotate(-6deg)}.palm.r{right:-3vw;transform:scaleX(-1) rotate(-8deg);width:min(24vw,190px)}
.palm.l2{left:12vw;width:min(14vw,120px);bottom:20vh;opacity:.85}
main{position:relative;z-index:2;width:100%;max-width:1080px;margin:0 auto;padding:40px 16px 120px}
.logo{font:400 clamp(64px,16vw,168px)/.82 var(--display);letter-spacing:.02em;margin:0;transform:skew(-8deg);
  background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 4px 0 rgba(139,92,246,.9)) drop-shadow(0 0 28px rgba(255,61,139,.55))}
.logo.sm{font-size:44px;filter:drop-shadow(0 2px 0 rgba(139,92,246,.9))}
.kicker{font:600 13px/1 var(--ui);letter-spacing:.38em;text-transform:uppercase;color:var(--cyan);text-shadow:0 0 12px rgba(51,240,255,.7)}
.tag{font:italic 600 clamp(18px,3.4vw,26px)/1.25 var(--ui);color:var(--ink);max-width:640px;margin:18px 0 0}
h1,h2,h3{font-family:var(--display);font-weight:400;letter-spacing:.04em;line-height:1;margin:0}
h1{font-size:clamp(40px,7vw,64px)}h2{font-size:34px;margin:40px 0 14px}h3{font-size:24px}
.grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.panel{position:relative;background:var(--glass);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);
  border:1px solid var(--line);padding:24px;clip-path:polygon(0 0,calc(100% - 22px) 0,100% 22px,100% 100%,22px 100%,0 calc(100% - 22px));}
.panel::before{content:"";position:absolute;inset:0;padding:1px;background:linear-gradient(135deg,rgba(255,61,139,.9),transparent 40%,transparent 60%,rgba(51,240,255,.8));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.stack{display:flex;flex-direction:column;gap:14px}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}
.muted{color:var(--muted)}.small{font-size:14px}.warn{color:var(--sun)}.bad{color:var(--red)}.good{color:var(--lime)}
input,select{font:500 18px var(--ui);color:var(--ink);background:rgba(7,3,15,.7);border:1px solid rgba(255,255,255,.18);padding:14px 16px;min-width:0;flex:1;outline:none;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%);transition:border-color .2s,box-shadow .2s}
input:focus,select:focus{border-color:var(--cyan);box-shadow:0 0 0 1px var(--cyan),0 0 24px rgba(51,240,255,.35)}
select option{background:var(--night2)}
.btn,button{font:700 16px var(--ui);letter-spacing:.14em;text-transform:uppercase;color:#1a0420;background:var(--grad);border:0;cursor:pointer;padding:15px 26px;
  clip-path:polygon(12px 0,100% 0,calc(100% - 12px) 100%,0 100%);transition:transform .15s,filter .2s;text-decoration:none;display:inline-block}
.btn:hover,button:hover{filter:brightness(1.1) drop-shadow(0 0 18px rgba(255,61,139,.7));transform:translateY(-1px)}
button.ghost,.btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
button.danger{background:linear-gradient(100deg,#ff4d6d,#ff2e2e);color:#fff}button.mini{padding:7px 14px;font-size:12px}
.code-in{font:600 34px var(--mono);letter-spacing:.5em;text-align:center}
pre,code{font:13px/1.5 var(--mono)}pre{margin:0;background:rgba(0,0,0,.45);border:1px solid var(--line);padding:14px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:#e9dcff}
.copy{position:relative}.copy button{position:absolute;top:6px;right:6px}
.chip{display:inline-flex;align-items:center;gap:6px;font:600 12px var(--ui);letter-spacing:.12em;text-transform:uppercase;padding:5px 10px;border:1px solid var(--line);background:var(--glass2)}
.chip i{width:8px;height:8px;border-radius:50%;background:var(--lime);box-shadow:0 0 10px var(--lime)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px}
.district{--c:var(--pink);border-top:3px solid var(--c)}.district h3{color:var(--c);text-shadow:0 0 16px var(--c)}
.d-budget{--c:var(--lime)}.d-workout{--c:var(--orange)}.d-health{--c:var(--cyan)}.d-food{--c:var(--pink)}
details{border:1px solid var(--line);background:var(--glass2);padding:12px 16px;margin:8px 0}summary{cursor:pointer;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:14px}th{font:600 12px var(--ui);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);text-align:left}
td,th{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
.tablewrap{overflow-x:auto}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:12px}
.kpi{padding:16px;background:var(--glass2);border:1px solid var(--line);border-left:3px solid var(--violet)}
.kpi b{display:block;font:400 34px/1 var(--display);letter-spacing:.03em}.kpi span{font:600 11px var(--ui);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.kpi small{display:block;color:var(--muted);margin-top:4px}
.kpi.good{border-left-color:var(--lime)}.kpi.warn{border-left-color:var(--sun)}.kpi.bad{border-left-color:var(--red)}
.bars{display:flex;flex-direction:column;gap:10px}.bar{display:grid;grid-template-columns:minmax(90px,180px) 1fr auto;gap:12px;align-items:center;font-size:14px}
.bar .track{height:12px;background:rgba(255,255,255,.07);overflow:hidden}.bar .fill{height:100%;background:var(--grad2);box-shadow:0 0 12px rgba(255,61,139,.5)}
.bar.good .fill{background:linear-gradient(90deg,#22c55e,var(--lime))}.bar.warn .fill{background:linear-gradient(90deg,var(--orange),var(--sun))}.bar.bad .fill{background:linear-gradient(90deg,#ff2e2e,var(--red))}
.notice{border-left:3px solid var(--sun);padding:10px 14px;background:rgba(255,209,102,.08)}
.flash{border-left:3px solid var(--lime);padding:14px;background:rgba(125,255,178,.08)}
.fade{animation:rise .7s cubic-bezier(.2,.8,.2,1) both}.fade.d2{animation-delay:.12s}.fade.d3{animation-delay:.24s}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
.glitch{position:relative}.glitch::after{content:attr(data-text);position:absolute;inset:0;transform:translate(3px,-2px);color:var(--cyan);opacity:.35;mix-blend-mode:screen;animation:flick 4s infinite steps(1)}
@keyframes flick{0%,92%,100%{opacity:0}93%,95%{opacity:.5}}
footer{position:relative;z-index:2;text-align:center;color:var(--muted);font-size:13px;padding:0 16px 32px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media (max-width:640px){.panel{padding:18px}.bar{grid-template-columns:1fr auto}.bar .track{grid-column:1/-1;grid-row:2}}
@media print{
  :root{--ink:#111;--muted:#555;--line:#ddd;--glass:#fff;--glass2:#fafafa}
  html,body{background:#fff!important;color:#111}.city,.scan,.noprint{display:none!important}
  .panel{clip-path:none;backdrop-filter:none;border:1px solid #ddd}.panel::before{display:none}
  .logo,.grad{-webkit-text-fill-color:#c2185b;color:#c2185b;filter:none}.kpi b{color:#111}
  main{padding:0}h2{break-after:avoid}.panel,.kpi,tr{break-inside:avoid}
}
`;

export interface LayoutOptions {
  title: string;
  body: string;
  /** "hero" draws the full sunset city, "app" a quieter backdrop, "report" is print-friendly. */
  variant?: "hero" | "app" | "report";
  head?: string;
}

export function layout({ title, body, variant = "app", head = "" }: LayoutOptions): string {
  const city =
    variant === "report"
      ? ""
      : `<div class="city" aria-hidden="true">${variant === "hero" ? `<div class="sun"></div>` : ""}<div class="grid"></div>
<div class="palm l">${PALM}</div><div class="palm l2">${PALM}</div><div class="palm r">${PALM}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="color-scheme" content="dark">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ff3d8b"/><stop offset="1" stop-color="#ffd166"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="#160a2b"/><text x="32" y="48" font-family="Impact,sans-serif" font-size="46" text-anchor="middle" fill="url(#g)">Q</text></svg>`)}">
<style>${THEME_CSS}</style>${head}</head><body>${variant === "report" ? "" : '<div class="scan" aria-hidden="true"></div>'}${city}
<main>${body}</main><footer class="noprint">QUEMO · your life, tracked from any chat</footer>
<script>document.addEventListener("click",e=>{const b=e.target.closest("[data-copy]");if(!b)return;const t=document.getElementById(b.dataset.copy);navigator.clipboard.writeText(t.innerText).then(()=>{const o=b.textContent;b.textContent="Copied";setTimeout(()=>b.textContent=o,1200)})})</script>
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

/** A <pre> block with a copy button. */
export function copyBlock(id: string, content: string): string {
  return `<div class="copy"><pre id="${escapeHtml(id)}">${escapeHtml(content)}</pre><button type="button" class="ghost mini noprint" data-copy="${escapeHtml(id)}">Copy</button></div>`;
}
