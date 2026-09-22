import { brand } from "@/config/brand";

function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;color:${brand.primaryHex}">${brand.name}</td></tr>
<tr><td style="padding-top:20px;font-size:18px;font-weight:600">${title}</td></tr>
<tr><td style="padding-top:12px;font-size:14px;line-height:1.6;color:#334155">${body}</td></tr>
<tr><td style="padding-top:28px;font-size:12px;color:#94a3b8">You are receiving this email because an action was taken in ${brand.name}. If you did not expect it, you can ignore it.</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="background:${brand.primaryHex};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${label}</a></p>
<p style="font-size:12px;color:#64748b">Or paste this link into your browser:<br>${href}</p>`;

export function inviteEmail(p: { companyName: string; inviterName: string; role: string; link: string; expiresInDays: number }) {
  return {
    subject: `${p.inviterName} invited you to join ${p.companyName} on ${brand.name}`,
    html: layout(
      `You have been invited to ${p.companyName}`,
      `<p>${p.inviterName} invited you to join <strong>${p.companyName}</strong> as <strong>${p.role}</strong>.</p>
       <p>Set your name and password to activate your account. This link expires in ${p.expiresInDays} days.</p>${button(p.link, "Accept invitation")}`,
    ),
    text: `${p.inviterName} invited you to join ${p.companyName} on ${brand.name} as ${p.role}. Accept here (expires in ${p.expiresInDays} days): ${p.link}`,
  };
}

export function passwordResetEmail(p: { name: string; link: string }) {
  return {
    subject: `Reset your ${brand.name} password`,
    html: layout(
      "Reset your password",
      `<p>Hi ${p.name},</p><p>We received a request to reset your password. The link below is valid for 1 hour and can be used once.</p>${button(p.link, "Reset password")}`,
    ),
    text: `Hi ${p.name}, reset your ${brand.name} password (valid for 1 hour): ${p.link}`,
  };
}
