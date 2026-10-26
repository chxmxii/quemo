import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { copyBlock, escapeHtml as e, layout, localTime, revealWords, TOOLS, wordmark, type Profile, type ToolId } from "@quemo/core";
import { API_KEY_PREFIX, safeNext, TOOL_IDS } from "./lib";

export function page(title: string, body: string, variant: "hero" | "app" = "app", bare = false, fill = body.startsWith("<section data-fill")): string {
  return layout({ title, body, variant, bare, fill });
}

// ---------- sign in / sign up ----------

const narrow = (inner: string) => `<section data-fill class="rise center" style="max-width:440px;margin:0 auto;padding:96px 0;display:grid;gap:28px">${inner}</section>`;

export function signInView(next: string | null, error?: string, tool?: ToolId, email = ""): string {
  const body = `<section class="center" style="max-width:560px;margin:0 auto;display:grid;gap:34px;padding:80px 0">
  <div style="display:grid;gap:18px">
    ${tool ? `<p class="small muted rise">Connecting ${e(TOOLS[tool].name)}</p>` : ""}
    <h1 class="brand">Quemo</h1>
    <p class="tagline thin reveal" style="color:var(--text)" aria-label="Track your money, workouts, health and meals from any chat.">${revealWords("Track your", 3)} <span class="w rotator" style="--i:5"><span>money.</span><span>workouts.</span><span>health.</span><span>meals.</span></span></p>
    <p class="lede thin rise d3">Just tell Claude, ChatGPT or any MCP app.</p>
  </div>
  <form method="post" action="/auth/email" class="rise d4" style="display:grid;gap:12px;max-width:400px;margin:0 auto">
    <input type="hidden" name="next" value="${e(safeNext(next))}"><input type="hidden" name="tz" id="tz">
    <div class="beam"><input id="email" type="email" name="email" value="${e(email)}" placeholder="you@company.com" aria-label="Email" autocomplete="email" required autofocus style="text-align:center"></div>
    ${error ? `<p class="small" style="color:var(--bad)">${e(error)}</p>` : ""}
    <button>Get my code<i class="ph ph-arrow-right"></i></button>
  </form>
  <script>try{document.getElementById("tz").value=Intl.DateTimeFormat().resolvedOptions().timeZone}catch{}</script>
</section>`;
  return layout({ title: "quemo", body, variant: "hero", bare: true, fill: true });
}

export function checkInboxView(email: string, next: string, notice?: string): string {
  return page(
    "Check your inbox",
    narrow(`<div style="display:grid;gap:12px">
    <h1 class="reveal">${revealWords("Check your inbox.")}</h1>
    <p class="lede rise d2">We sent a 6-digit code and a link to ${e(email)}.</p>
  </div>
  <form method="post" action="/auth/code" style="display:grid;gap:10px">
    <input type="hidden" name="email" value="${e(email)}"><input type="hidden" name="next" value="${e(next)}">
    <label for="code">Code</label>
    <div class="beam" style="max-width:340px"><input id="code" class="otp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="6" required autofocus></div>
    ${notice ? `<p class="small" style="color:var(--warn)">${e(notice)}</p>` : ""}
    <button style="margin-top:4px;justify-self:center">Continue<i class="ph ph-arrow-right"></i></button>
  </form>
  <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
    <form method="post" action="/auth/email">
      <input type="hidden" name="email" value="${e(email)}"><input type="hidden" name="next" value="${e(next)}">
      <button class="ghost sm">Resend code</button>
    </form>
    <a class="btn ghost sm" href="/?${new URLSearchParams({ email, next }).toString()}">Use a different email</a>
  </div>`),
  );
}

export function confirmView(token: string, next: string): string {
  return page(
    "Sign in",
    narrow(`<h1 class="reveal">${revealWords("Almost there.")}</h1>
  <form method="post" action="/auth/verify">
    <input type="hidden" name="token" value="${e(token)}"><input type="hidden" name="next" value="${e(safeNext(next))}">
    <button>Continue to quemo<i class="ph ph-arrow-right"></i></button>
  </form>`),
  );
}

export function messageView(title: string, message: string): string {
  return page(title, narrow(`<div style="display:grid;gap:12px"><h1 class="reveal">${revealWords(`${title}.`)}</h1><p class="lede">${e(message)}</p></div><a class="btn ghost" href="/" style="justify-self:center">Back</a>`));
}

// ---------- OAuth consent ----------

export function consentView(details: ConsentDescription, tool: ToolId | undefined, email: string, handle: string): string {
  const t = tool ? TOOLS[tool] : null;
  return page(
    `Connect ${details.clientName}`,
    narrow(`<div style="display:grid;gap:12px">
    <h1 class="reveal" aria-label="Allow ${e(details.clientName)}?">${revealWords(`Allow ${details.clientName}?`)}</h1>
    <p class="lede">It will be able to read and update your ${t ? e(t.name) : "quemo"} data, and nothing from your other tools.</p>
  </div>
  <div class="rows stagger small">
    <div style="display:grid;gap:2px"><span class="label">Account</span><span>${e(email)}</span></div>
    <div style="display:grid;gap:2px"><span class="label">Sends access to</span><span>${e(details.redirectHost)}</span></div>
    <div style="display:grid;gap:2px"><span class="label">Publisher</span><span>${details.clientDomain ? e(details.clientDomain) : "Not verified"}</span></div>
  </div>
  ${details.redirectIsLoopback ? `<p class="small" style="color:var(--warn)">This sends access to an app on your computer. Only continue if you just started connecting from it.</p>` : ""}
  <form method="post" style="display:flex;gap:10px;justify-content:center">
    <input type="hidden" name="handle" value="${e(handle)}">
    <button name="decision" value="approve">Allow</button>
    <button name="decision" value="deny" class="ghost">Deny</button>
  </form>`),
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

  const tools = TOOL_IDS.map((t) => {
    const n = connected.get(t) ?? 0;
    return `<div class="tool" style="display:grid;gap:12px;justify-items:center">
  <div style="display:grid;gap:2px"><span style="font-weight:500">${e(TOOLS[t].name)}</span><span class="small muted">${n ? `<span class="dot"></span>${n} app${n > 1 ? "s" : ""} linked` : "Not linked yet"}</span></div>
  ${copyBlock(`url-${t}`, urls[t])}
</div>`;
  }).join("");

  const tabLabels = [
    ["claude", "Claude"],
    ["chatgpt", "ChatGPT"],
    ["code", "Claude Code"],
    ["http", "Other apps"],
    ["stdio", "Local"],
  ];

  const keyRows = keys
    .map(
      (k) => `<div style="display:grid;gap:10px;justify-items:center">
  <div style="display:grid;gap:2px"><span>${e(k.name)}</span><span class="small muted mono">${e(k.prefix)}... used ${fmt(k.last_used_at).toLowerCase()}</span></div>
  <form method="post" action="/dashboard/keys/revoke"><input type="hidden" name="id" value="${e(k.id)}"><button class="ghost sm">Revoke</button></form>
</div>`,
    )
    .join("");

  const body = `<section class="rise center" style="padding:9vh 0 0;display:grid;gap:10px">
  <h1 class="reveal">${revealWords(`${greeting(user.timezone)}${user.name ? `, ${user.name}` : ""}.`)}</h1>
  <p class="lede rise d2">Add a tool's link to your AI app, then just talk to it.</p>
</section>
${newKey ? `<section class="block center"><h2>New API key</h2><p class="small muted">Shown once. Works with all four tools.</p>${copyBlock("newkey", newKey)}</section>` : ""}
${flash && !newKey ? `<p class="small" style="padding-top:24px;color:var(--ok)">${e(flash)}</p>` : ""}

<section class="block center"><h2>Tools</h2><div class="rows stagger">${tools}</div></section>

<section class="block center"><h2>Connect</h2>
  <div class="tabs">
    ${tabLabels.map(([id], i) => `<input type="radio" name="client" id="tab-${id}"${i === 0 ? " checked" : ""}>`).join("")}
    <div class="tablist" role="tablist">${tabLabels.map(([id, l]) => `<label for="tab-${id}">${l}</label>`).join("")}</div>
    <div class="tabpanel"><p class="muted">Settings, Connectors, Add custom connector. Paste a tool link and sign in with your email.</p></div>
    <div class="tabpanel"><p class="muted">Settings, Apps and Connectors, Advanced, Developer mode, Create. Paste a tool link and choose OAuth.</p></div>
    <div class="tabpanel">${copyBlock("cc", claudeCode)}<p class="small muted">Then run /mcp to sign in.</p></div>
    <div class="tabpanel">${copyBlock("http", httpJson)}<p class="small muted">Cursor, Windsurf, VS Code and any HTTP MCP client. Needs an API key.</p></div>
    <div class="tabpanel">${copyBlock("stdio", stdioJson)}<p class="small muted">For apps that only run local servers.</p></div>
  </div>
</section>

<section class="block center"><h2>Profile</h2>
  <form method="post" action="/dashboard/profile" style="display:grid;gap:14px">
    <div class="pgrid" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">
      <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" value="${e(user.name ?? "")}" maxlength="80"></div>
      <div class="field"><label for="p-tz">Time zone</label><input id="p-tz" name="timezone" value="${e(user.timezone)}" list="tzs" required></div>
      <div class="field"><label for="p-cur">Currency</label><input id="p-cur" name="currency" value="${e(user.currency)}" maxlength="3" pattern="[A-Za-z]{3}" required></div>
      <div class="field"><label for="p-units">Units</label><select id="p-units" name="units"><option value="metric"${user.units === "metric" ? " selected" : ""}>Metric</option><option value="imperial"${user.units === "imperial" ? " selected" : ""}>Imperial</option></select></div>
    </div>
    <datalist id="tzs"></datalist>
    <button class="ghost" style="justify-self:center">Save</button>
  </form>
</section>

<section class="block center"><h2>API keys</h2>
  <p class="small muted">Only for apps that can't sign in with OAuth.</p>
  ${keys.length ? `<div class="rows">${keyRows}</div>` : ""}
  <form method="post" action="/dashboard/keys" style="display:flex;gap:10px;flex-wrap:wrap">
    <input name="name" placeholder="Key name" aria-label="Key name" maxlength="60" required style="flex:1;min-width:200px"><button class="ghost">Create key</button>
  </form>
</section>

<section class="block center" style="padding-bottom:24px">
  <details><summary class="small" style="cursor:pointer;color:var(--muted)">Delete account</summary>
  <form method="post" action="/dashboard/delete" style="display:grid;gap:10px;margin-top:14px;max-width:420px">
    <p class="small muted">Removes your account and all data in every tool.</p>
    <label for="del">Type your email to confirm</label>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><input id="del" name="confirm" required style="flex:1;min-width:200px"><button class="danger">Delete</button></div>
  </form></details>
</section>
<style>
@media (max-width:760px){.pgrid{grid-template-columns:1fr 1fr!important}}
</style>
<script>try{const l=document.getElementById("tzs");for(const z of Intl.supportedValuesOf("timeZone")){const o=document.createElement("option");o.value=z;l.appendChild(o)}}catch{}</script>`;

  const nav = `<nav class="top">${wordmark("/dashboard")}
  <form method="post" action="/logout" style="display:flex;align-items:center;gap:12px;justify-content:center;flex-wrap:wrap"><span class="small muted">${e(user.email)}</span><button class="ghost sm">Sign out</button></form></nav>`;
  return page("quemo", `${nav}${body}`, "app", true);
}
