import { escapeHtml } from "@quemo/core";
import type { Env } from "./lib";

/** Sends the sign-in link + code. Without RESEND_API_KEY (local dev / tests) they are logged instead. */
export async function sendSignInEmail(env: Env, to: string, link: string, code: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[quemo] sign-in for ${to}: code ${code} · ${link}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: `${code} — your Quemo access code`,
      text: `Welcome to Quemo City.\n\nYour access code: ${code}\n\nOr open this link: ${link}\n\nIt expires in 15 minutes. Didn't ask for it? Ignore this email.`,
      html: `<div style="background:#07030f;padding:32px 16px;font-family:Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;background:#160a2b;border:1px solid #3b1f5e;padding:28px;color:#f7f0ff">
<div style="font:bold 40px Impact,Arial Narrow,sans-serif;letter-spacing:2px;color:#ff3d8b;font-style:italic">QUEMO</div>
<p style="color:#33f0ff;letter-spacing:4px;font-size:11px;text-transform:uppercase;margin:4px 0 24px">Access code</p>
<div style="font:bold 36px 'Courier New',monospace;letter-spacing:10px;background:#07030f;padding:16px;text-align:center;color:#ffd166">${escapeHtml(code)}</div>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#ff3d8b;color:#1a0420;padding:14px 22px;text-decoration:none;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Enter the city</a></p>
<p style="color:#b9a7d6;font-size:12px">Expires in 15 minutes. Didn't ask for it? Ignore this email.</p></div></div>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed (${res.status}): ${await res.text()}`);
}
