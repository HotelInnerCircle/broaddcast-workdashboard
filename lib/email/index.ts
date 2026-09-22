import nodemailer from "nodemailer";
import { appendFile, mkdir } from "node:fs/promises";
import { env } from "@/lib/env";

export interface Mail { to: string; subject: string; html: string; text: string }

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/**
 * Nodemailer over SMTP (spec 3.5). Without SMTP_HOST (development) emails are logged
 * to the console and appended to .dev/outbox.jsonl so scripts can read tokens.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!env.SMTP_HOST) {
    console.log(`\n[email:dev] To: ${mail.to}\n[email:dev] Subject: ${mail.subject}\n[email:dev] ${mail.text}\n`);
    if (!env.isProd) {
      try {
        await mkdir(".dev", { recursive: true });
        await appendFile(".dev/outbox.jsonl", JSON.stringify({ at: new Date().toISOString(), ...mail }) + "\n");
      } catch { /* best effort */ }
    }
    return;
  }
  await getTransporter().sendMail({ from: env.EMAIL_FROM, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
}
