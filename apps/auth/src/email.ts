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
      subject: `${code} is your quemo code`,
      text: `Your quemo sign-in code: ${code}\n\nOr open this link: ${link}\n\nIt expires in 15 minutes. If you didn't ask for it, you can ignore this email.`,
      html: `<div style="background:#f6f6f7;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111114">
<div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #ececef;border-radius:20px;padding:32px">
<div style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;border-radius:10px;background:#ff5a1f;color:#fff;font-weight:600;font-size:17px">q</div>
<h1 style="font-size:22px;letter-spacing:-.02em;margin:20px 0 6px;font-weight:600">Your sign-in code</h1>
<p style="margin:0 0 20px;color:#5d5d68;font-size:15px">Enter it on the quemo page you just opened.</p>
<div style="font:600 32px/1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:10px;background:#f6f6f7;border-radius:12px;padding:18px;text-align:center">${escapeHtml(code)}</div>
<p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#111114;color:#fafafa;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">Or sign in with one click</a></p>
<p style="margin:24px 0 0;color:#8b8b96;font-size:12.5px">Expires in 15 minutes. If you didn't ask for it, you can ignore this email.</p></div></div>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed (${res.status}): ${await res.text()}`);
}
