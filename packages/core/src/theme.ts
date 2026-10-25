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

export const THEME_CSS = `
:root{
  color-scheme:light dark;
  --bg:#f6f6f7;--text:#111114;--muted:#5d5d68;--faint:#8b8b96;
  --surface:rgba(255,255,255,.58);--surface-2:rgba(255,255,255,.78);--solid:#ffffff;
  --border:rgba(17,17,20,.08);--border-2:rgba(17,17,20,.14);--hi:rgba(255,255,255,.75);
  --accent:#ff5a1f;--accent-ink:#c2410c;--accent-soft:rgba(255,90,31,.10);
  --ok:#15803d;--ok-soft:rgba(21,128,61,.10);--warn:#a16207;--warn-soft:rgba(161,98,7,.10);--bad:#b91c1c;--bad-soft:rgba(185,28,28,.08);
  --ink:#111114;--on-ink:#fafafa;
  --shadow:none;
  --blob-a:#ff7a45;--blob-b:#ffc78a;--blob-c:#ffd9c7;--blob-o:.22;
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
  --shadow:none;
  --blob-a:#ff5a1f;--blob-b:#7c2d12;--blob-c:#431407;--blob-o:.16;
}}
*{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100dvh;color:var(--text);font:15px/1.6 var(--sans);letter-spacing:-.006em;background:var(--bg);overflow-x:hidden;-webkit-font-smoothing:antialiased}
a{color:var(--accent-ink);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
::selection{background:var(--accent);color:#fff}

/* ambient light: three blurred orbs drifting behind everything */
.aurora{position:fixed;inset:-20vmax;z-index:0;pointer-events:none;filter:blur(120px);opacity:var(--blob-o)}
.aurora i{position:absolute;border-radius:50%;display:block}
.aurora i:nth-child(1){width:44vmax;height:30vmax;left:46%;top:2%;background:var(--blob-a);animation:driftA 40s ease-in-out infinite alternate}
.aurora i:nth-child(2){width:36vmax;height:26vmax;left:30%;top:8%;background:var(--blob-b);animation:driftB 48s ease-in-out infinite alternate}
.aurora i:nth-child(3){display:none}
.aurora.quiet{opacity:calc(var(--blob-o) * .6)}
@keyframes driftA{to{transform:translate(-6vmax,3vmax)}}
@keyframes driftB{to{transform:translate(6vmax,2vmax)}}
@keyframes driftC{to{transform:translate(14vmax,-6vmax) scale(1.12)}}
.grain{display:none}

.shell{position:relative;z-index:2;width:100%;max-width:760px;margin:0 auto;padding:0 20px}
.wide .shell,.wide footer.foot{max-width:1000px}
nav.top{display:flex;align-items:center;justify-content:space-between;height:68px}
.wordmark{display:inline-flex;align-items:center;gap:9px;font-weight:500;font-size:16px;letter-spacing:-.02em;color:var(--text)}
.wordmark:hover{text-decoration:none}
.mark{width:10px;height:10px;border-radius:50%;background:var(--accent)}

h1,h2,h3{margin:0;font-weight:500;letter-spacing:-.03em;color:var(--text)}
h1{font-size:clamp(32px,4.2vw,44px);line-height:1.1}
h2{font-size:15px;line-height:1.4;letter-spacing:-.01em}
h3{font-size:15px;line-height:1.4;letter-spacing:-.01em}
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
@media (prefers-reduced-transparency:reduce){.glass{background:var(--solid);-webkit-backdrop-filter:none;backdrop-filter:none}.aurora{display:none}}

/* forms */
.field{display:grid;gap:7px}
label,.label{font-size:13px;font-weight:500;color:var(--text)}
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
.btn,button{font:inherit;font-size:14.5px;font-weight:550;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;cursor:pointer;
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
.bar .fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blob-b),var(--accent))}
.bar.good .fill{background:var(--ok)}.bar.warn .fill{background:var(--warn)}.bar.bad .fill{background:var(--bad)}
.bar .val{color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px}

/* hairline lists */
.rows{display:grid}
.rows>*{padding:18px 0;border-top:1px solid var(--border)}
.rows>*:last-child{border-bottom:1px solid var(--border)}
section.block{display:grid;gap:14px;padding:40px 0 0}

/* entry motion */
.rise{animation:rise .6s var(--ease) both}
.rise.d1{animation-delay:.06s}.rise.d2{animation-delay:.14s}.rise.d3{animation-delay:.22s}.rise.d4{animation-delay:.3s}
@keyframes rise{from{opacity:0;transform:translateY(6px)}}
.float{}
@keyframes float{50%{transform:translateY(-6px)}}

footer.foot{position:relative;z-index:2;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:760px;margin:0 auto;padding:40px 20px 36px;color:var(--faint);font-size:13px}
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
<style>${THEME_CSS}</style>${head}</head><body${variant === "report" ? ' class="wide"' : ""}>
<div class="aurora${variant === "hero" ? "" : " quiet"}" aria-hidden="true"><i></i><i></i><i></i></div>
${bare ? "" : `<div class="shell"><nav class="top">${wordmark()}<a class="small muted" href="https://github.com/chxmxii/quemo" rel="noopener">GitHub</a></nav></div>`}
<main class="shell">${body}</main>
<footer class="foot noprint"><span>quemo</span><a href="https://github.com/chxmxii/quemo" rel="noopener">Open source</a></footer>
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
