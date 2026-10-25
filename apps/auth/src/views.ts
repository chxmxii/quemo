import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { copyBlock, escapeHtml as e, layout, localTime, TOOLS, wordmark, type Profile, type ToolId } from "@quemo/core";
import { API_KEY_PREFIX, safeNext, TOOL_IDS } from "./lib";

export const TOOL_META: Record<ToolId, { icon: string; short: string; prompts: [string, string] }> = {
  budget: { icon: "ph-wallet", short: "Budget", prompts: ["Spent 23 euros on groceries at Rewe", "How is my budget looking this month?"] },
  workout: { icon: "ph-barbell", short: "Workout", prompts: ["Bench 4x8 at 70 kg, then rows", "What are my personal records?"] },
  health: { icon: "ph-pill", short: "Health", prompts: ["Took my morning meds", "Blood pressure 128 over 84 today"] },
  food: { icon: "ph-bowl-food", short: "Food", prompts: ["Chicken wrap and a coke for lunch", "How much protein do I have left?"] },
};

export function page(title: string, body: string, variant: "hero" | "app" = "app", bare = false): string {
  return layout({ title, body, variant, bare });
}

const centered = (inner: string) => `<div style="min-height:calc(100dvh - 180px);display:grid;place-items:center;padding:24px 0">${inner}</div>`;

// ---------- sign in / sign up ----------

export function signInView(next: string | null, error?: string, tool?: ToolId): string {
  const prompts = TOOL_IDS.map(
    (t, i) => `<div class="glass spot rise d${i + 1}" style="padding:18px 20px;display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:center;${i % 2 ? "margin-left:36px" : ""}">
    <span style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-ink);font-size:20px"><i class="ph ${TOOL_META[t].icon}"></i></span>
    <div style="display:grid;gap:2px;min-width:0"><span class="small faint">${e(TOOLS[t].name)}</span><span style="font-weight:500">&ldquo;${e(TOOL_META[t].prompts[0])}&rdquo;</span></div>
  </div>`,
  ).join("");

  const body = `<section style="min-height:calc(100dvh - 180px);display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:56px;align-items:center;padding:24px 0 40px" class="hero">
  <div style="display:grid;gap:26px">
    ${tool ? `<span class="chip rise" style="width:max-content"><i class="ph ${TOOL_META[tool].icon}"></i>Connecting ${e(TOOLS[tool].name)}</span>` : ""}
    <h1 class="rise">Your life, logged<br>from <span class="accent">any chat.</span></h1>
    <p class="lede rise d1">Track money, training, meds and meals by talking to Claude, ChatGPT or any MCP app. One email, no password.</p>
    <form method="post" action="/auth/email" class="rise d2" style="display:grid;gap:8px;max-width:460px">
      <input type="hidden" name="next" value="${e(safeNext(next))}"><input type="hidden" name="tz" id="tz">
      <label for="email">Email</label>
      <div class="inline">
        <input id="email" type="email" name="email" placeholder="you@company.com" autocomplete="email" required autofocus>
        <button>Get my code<i class="ph ph-arrow-right"></i></button>
      </div>
      ${error ? `<p class="notice"><i class="ph ph-warning-circle"></i>${e(error)}</p>` : `<p class="hint">New here or coming back, it's the same step. We email you a 6-digit code.</p>`}
    </form>
  </div>
  <div class="float" style="display:grid;gap:14px">${prompts}</div>
</section>
<style>@media (max-width:860px){.hero{grid-template-columns:1fr!important;gap:36px!important}.hero .float>div{margin-left:0!important}}</style>
<script>try{document.getElementById("tz").value=Intl.DateTimeFormat().resolvedOptions().timeZone}catch{}</script>`;
  return page("quemo. Sign in", body, "hero");
}

export function checkInboxView(email: string, next: string, notice?: string): string {
  return page(
    "Check your inbox",
    centered(`<section class="glass pad rise" style="width:min(100%,480px);display:grid;gap:20px">
  <span style="width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-ink);font-size:24px"><i class="ph ph-envelope-simple-open"></i></span>
  <div style="display:grid;gap:8px"><h2>Check your inbox</h2>
  <p class="muted">We sent a code and a sign-in link to <strong style="color:var(--text)">${e(email)}</strong>. Use either one, even from another device.</p></div>
  ${notice ? `<p class="notice"><i class="ph ph-warning-circle"></i>${e(notice)}</p>` : ""}
  <form method="post" action="/auth/code" style="display:grid;gap:12px">
    <input type="hidden" name="email" value="${e(email)}"><input type="hidden" name="next" value="${e(next)}">
    <label for="code">6-digit code</label>
    <input id="code" class="otp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="6" required autofocus>
    <button style="justify-self:start">Verify and continue</button>
  </form>
  <form method="post" action="/auth/email" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:16px">
    <input type="hidden" name="email" value="${e(email)}"><input type="hidden" name="next" value="${e(next)}">
    <span class="small muted">Nothing yet? Check spam, or</span><button class="ghost sm">Resend code</button>
  </form>
</section>`),
  );
}

export function confirmView(token: string, next: string): string {
  return page(
    "Confirm sign-in",
    centered(`<section class="glass pad rise" style="width:min(100%,440px);display:grid;gap:18px">
  <span style="width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-ink);font-size:24px"><i class="ph ph-sign-in"></i></span>
  <h2>One click and you're in</h2>
  <form method="post" action="/auth/verify">
    <input type="hidden" name="token" value="${e(token)}"><input type="hidden" name="next" value="${e(safeNext(next))}">
    <button>Continue to quemo<i class="ph ph-arrow-right"></i></button>
  </form>
</section>`),
    "hero",
  );
}

export function messageView(title: string, message: string): string {
  return page(
    title,
    centered(`<section class="glass pad rise" style="width:min(100%,460px);display:grid;gap:16px">
  <span style="width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:var(--bad-soft);color:var(--bad);font-size:24px"><i class="ph ph-warning-octagon"></i></span>
  <h2>${e(title)}</h2><p class="muted">${e(message)}</p>
  <a class="btn ghost" href="/" style="justify-self:start">Back to sign in</a>
</section>`),
  );
}

// ---------- OAuth consent ----------

export function consentView(details: ConsentDescription, tool: ToolId | undefined, email: string, handle: string): string {
  const t = tool ? TOOLS[tool] : null;
  return page(
    `Connect ${details.clientName}`,
    centered(`<section class="glass pad rise" style="width:min(100%,520px);display:grid;gap:22px">
  <div style="display:flex;align-items:center;gap:12px">
    <span style="width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:var(--surface-2);border:1px solid var(--border);font-size:22px"><i class="ph ph-chats-circle"></i></span>
    <i class="ph ph-arrows-left-right faint"></i>
    <span style="width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-ink);font-size:22px"><i class="ph ${tool ? TOOL_META[tool].icon : "ph-squares-four"}"></i></span>
  </div>
  <div style="display:grid;gap:8px">
    <h2><span class="accent">${e(details.clientName)}</span> wants access to ${t ? e(t.name) : "quemo"}</h2>
    <p class="muted">Signed in as ${e(email)}.</p>
  </div>
  <ul style="margin:0;padding:0;list-style:none;display:grid;gap:10px">
    <li style="display:flex;gap:10px"><i class="ph ph-eye accent"></i><span>Read your ${t ? e(TOOL_META[tool!].short.toLowerCase()) : ""} data and reports</span></li>
    <li style="display:flex;gap:10px"><i class="ph ph-pencil-simple accent"></i><span>Add and change entries when you ask it to</span></li>
    <li style="display:flex;gap:10px"><i class="ph ph-shield-check accent"></i><span>Nothing from your other quemo tools</span></li>
  </ul>
  <p class="small muted">${details.clientDomain ? `Published by <strong style="color:var(--text)">${e(details.clientDomain)}</strong>.` : "This app registered itself, so its name is not verified."} Access goes to <strong style="color:var(--text)">${e(details.redirectHost)}</strong>.</p>
  ${details.redirectIsLoopback ? `<p class="notice"><i class="ph ph-warning-circle"></i><span>This sends access to an app on your computer. Only continue if you just started connecting from it.</span></p>` : ""}
  <form method="post" style="display:flex;gap:10px;flex-wrap:wrap">
    <input type="hidden" name="handle" value="${e(handle)}">
    <button name="decision" value="approve">Allow access</button>
    <button name="decision" value="deny" class="ghost">Deny</button>
  </form>
</section>`),
  );
}

// ---------- dashboard ----------

export interface DashboardData {
  user: Profile;
  keys: { id: string; name: string; prefix: string; created_at: number; last_used_at: number | null }[];
  connected: Map<ToolId, number>;
  urls: Record<ToolId, string>;
  flash?: string;
}

function greeting(tz: string): string {
  const h = Number(localTime(tz).slice(0, 2));
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function dashboardView({ user, keys, connected, urls, flash }: DashboardData): string {
  const newKey = flash?.startsWith(API_KEY_PREFIX) ? flash : undefined;
  const key = newKey ?? "qmk_YOUR_API_KEY";
  const fmt = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : "Never");

  const claudeCode = TOOL_IDS.map((t) => `claude mcp add --transport http quemo-${t} ${urls[t]}`).join("\n");
  const httpJson = JSON.stringify({ mcpServers: Object.fromEntries(TOOL_IDS.map((t) => [`quemo-${t}`, { url: urls[t], headers: { Authorization: `Bearer ${key}` } }])) }, null, 2);
  const stdioJson = JSON.stringify(
    { mcpServers: Object.fromEntries(TOOL_IDS.map((t) => [`quemo-${t}`, { command: "npx", args: ["-y", "mcp-remote", urls[t], "--header", `Authorization: Bearer ${key}`] }])) },
    null,
    2,
  );

  // Bento: budget is the wide lead tile, the others vary their glow corner.
  const glow = ["100% 0%", "0% 100%", "100% 100%", "0% 0%"];
  const tiles = TOOL_IDS.map((t, i) => {
    const n = connected.get(t) ?? 0;
    return `<article class="glass spot rise d${i + 1} tool" style="padding:22px;display:grid;gap:16px;align-content:start;${i === 0 || i === 3 ? "grid-column:span 2;" : ""}
      background-image:radial-gradient(70% 90% at ${glow[i]},var(--accent-soft),transparent 70%)">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
    <span style="width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:var(--surface-2);border:1px solid var(--border);color:var(--accent-ink);font-size:22px"><i class="ph ${TOOL_META[t].icon}"></i></span>
    ${n ? `<span class="chip live">${n} app${n > 1 ? "s" : ""} linked</span>` : `<span class="chip">Not linked yet</span>`}
  </div>
  <div style="display:grid;gap:4px"><h3>${e(TOOLS[t].name)}</h3><p class="small muted">${e(TOOLS[t].tagline)}</p></div>
  ${copyBlock(`url-${t}`, urls[t])}
  <p class="small faint">Try &ldquo;${e(TOOL_META[t].prompts[1])}&rdquo;</p>
</article>`;
  }).join("");

  const tab = (id: string, checked = false) => `<input type="radio" name="client" id="tab-${id}"${checked ? " checked" : ""}>`;
  const tabLabels = [
    ["claude", "Claude"],
    ["chatgpt", "ChatGPT"],
    ["code", "Claude Code"],
    ["http", "Cursor and others"],
    ["stdio", "Local apps"],
  ];

  const keyRows = keys.length
    ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Key</th><th>Last used</th><th></th></tr></thead><tbody>${keys
        .map(
          (k) => `<tr><td>${e(k.name)}</td><td class="mono">${e(k.prefix)}...</td><td class="muted">${fmt(k.last_used_at)}</td>
  <td class="r"><form method="post" action="/dashboard/keys/revoke"><input type="hidden" name="id" value="${e(k.id)}"><button class="ghost sm">Revoke</button></form></td></tr>`,
        )
        .join("")}</tbody></table></div>`
    : `<p class="small muted">No keys yet. You only need one if your app can't sign in with OAuth.</p>`;

  const body = `<div class="rise" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:28px 0 22px">
  <div style="display:grid;gap:6px">
    <h1 style="font-size:clamp(32px,4vw,44px)">${greeting(user.timezone)}${user.name ? `, ${e(user.name)}` : ""}.</h1>
    <p class="muted">Paste a tool's link into your AI app and start talking to it.</p>
  </div>
</div>
${newKey ? `<section class="glass pad rise" style="display:grid;gap:12px;margin-bottom:16px;border-color:var(--accent)"><h3>Your new API key</h3><p class="small muted">It works with all four tools. Copy it now, it won't be shown again.</p>${copyBlock("newkey", newKey)}</section>` : ""}
${flash && !newKey ? `<p class="flash rise" style="margin-bottom:16px"><i class="ph ph-check-circle"></i>${e(flash)}</p>` : ""}

<section class="bento" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px">${tiles}</section>

<section class="glass pad rise" style="margin-top:14px;display:grid;gap:18px">
  <div style="display:grid;gap:4px"><h2>Connect your AI</h2><p class="muted">Add each tool you want. Claude and ChatGPT sign in with your email, no key needed.</p></div>
  <div class="tabs">
    ${tabLabels.map(([id], i) => tab(id, i === 0)).join("")}
    <div class="tablist" role="tablist">${tabLabels.map(([id, l]) => `<label for="tab-${id}">${l}</label>`).join("")}</div>
    <div class="tabpanel"><p>In Claude (web, desktop or mobile): <strong>Settings, Connectors, Add custom connector</strong>. Paste a tool link from above, then sign in with your email when Claude asks.</p></div>
    <div class="tabpanel"><p>In ChatGPT: <strong>Settings, Apps and Connectors, Advanced</strong>, turn on Developer mode, then <strong>Create</strong>. Paste a tool link and pick OAuth.</p></div>
    <div class="tabpanel">${copyBlock("cc", claudeCode)}<p class="small muted">Then run /mcp in Claude Code to sign in.</p></div>
    <div class="tabpanel">${copyBlock("http", httpJson)}<p class="small muted">For Cursor, Windsurf, VS Code, LibreChat or any HTTP MCP client. Create a key below first.</p></div>
    <div class="tabpanel">${copyBlock("stdio", stdioJson)}<p class="small muted">For apps that only launch local servers.</p></div>
  </div>
</section>

<div class="split" style="display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:14px;margin-top:14px">
  <form method="post" action="/dashboard/profile" class="glass pad" style="display:grid;gap:16px;align-content:start">
    <div style="display:grid;gap:4px"><h2>Profile</h2><p class="small muted">Shared by every tool.</p></div>
    <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" value="${e(user.name ?? "")}" maxlength="80" placeholder="What your AI calls you"></div>
    <div class="field"><label for="p-tz">Time zone</label><input id="p-tz" name="timezone" value="${e(user.timezone)}" list="tzs" required></div>
    <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:12px">
      <div class="field"><label for="p-cur">Currency</label><input id="p-cur" name="currency" value="${e(user.currency)}" maxlength="3" pattern="[A-Za-z]{3}" required></div>
      <div class="field"><label for="p-units">Units</label><select id="p-units" name="units"><option value="metric"${user.units === "metric" ? " selected" : ""}>Metric (kg, ml)</option><option value="imperial"${user.units === "imperial" ? " selected" : ""}>Imperial (lb, oz)</option></select></div>
    </div>
    <datalist id="tzs"></datalist>
    <button style="justify-self:start">Save profile</button>
  </form>
  <section class="glass pad" style="display:grid;gap:16px;align-content:start">
    <div style="display:grid;gap:4px"><h2>API keys</h2><p class="small muted">For apps without OAuth. Sent as Authorization: Bearer &lt;key&gt;.</p></div>
    ${keyRows}
    <form method="post" action="/dashboard/keys" style="display:grid;gap:8px">
      <label for="k-name">New key name</label>
      <div class="inline"><input id="k-name" name="name" placeholder="Cursor on my laptop" maxlength="60" required><button>Create key</button></div>
    </form>
  </section>
</div>

<details class="glass pad" style="margin-top:14px">
  <summary style="cursor:pointer;font-weight:500;color:var(--bad)">Delete account</summary>
  <form method="post" action="/dashboard/delete" style="display:grid;gap:10px;margin-top:16px;max-width:480px">
    <p class="small muted">Removes your account and the data in all four tools. Linked apps lose access right away.</p>
    <label for="del">Type your email to confirm</label>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><input id="del" name="confirm" required style="flex:1;min-width:200px"><button class="danger">Delete forever</button></div>
  </form>
</details>
<style>
@media (max-width:900px){.bento{grid-template-columns:1fr 1fr!important}.split{grid-template-columns:1fr!important}}
@media (max-width:640px){.bento{grid-template-columns:1fr!important}.bento .tool{grid-column:auto!important}}
</style>
<script>try{const l=document.getElementById("tzs");for(const z of Intl.supportedValuesOf("timeZone")){const o=document.createElement("option");o.value=z;l.appendChild(o)}}catch{}</script>`;

  const nav = `<div style="display:flex;align-items:center;justify-content:space-between;height:68px">${wordmark("/dashboard")}
  <form method="post" action="/logout" style="display:flex;align-items:center;gap:10px"><span class="small muted email">${e(user.email)}</span><button class="ghost sm"><i class="ph ph-sign-out"></i>Sign out</button></form></div>
  <style>@media (max-width:560px){.email{display:none}}</style>`;
  return page("Dashboard · quemo", nav + body, "app", true);
}
