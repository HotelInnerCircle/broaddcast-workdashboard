import nodemailer, { type Transporter } from "nodemailer";
import { appendFile, mkdir } from "node:fs/promises";
import { env } from "@/lib/env";
import { Errors } from "@/lib/api/errors";

export interface Mail { to: string; subject: string; html: string; text: string }

/**
 * One plain ASCII address and nothing else - no display name, no angle brackets,
 * no comma-separated list, no RFC 5322 comments, no non-ASCII.
 *
 * Address parsers are far more permissive than anybody wants them to be, and the
 * permissiveness is where the bugs live: a domain allow-list can be walked past
 * with a punycode homograph or with an RFC 5322 comment - `user@good.com(@evil.com)`
 * parses as two different domains depending on who is reading - and a long list of
 * addresses has been a quadratic-time denial of service more than once. None of
 * that can be expressed in what this accepts, so whatever parses the address next
 * never sees anything interesting, whichever version of it is installed.
 *
 * Written as explicit character classes rather than shorthand: the shorthand form
 * of this file's patterns has been mangled by a layer of shell quoting before now,
 * and a regex that silently stops matching is worse than one that is verbose.
 */
const PLAIN_ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:[.][A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:[.][A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

function recipientOf(to: string): string {
  const value = to.trim();
  // 254 characters is the longest address SMTP is obliged to carry (RFC 5321).
  if (!value || value.length > 254 || !PLAIN_ADDRESS.test(value)) {
    throw Errors.bad("INVALID_RECIPIENT", "That email address cannot be sent to");
  }
  return value;
}

/**
 * A header is one line.
 *
 * A company name and a person's name both reach the subject of an invitation, and
 * both are typed by a user. A carriage return inside one would end the Subject
 * header and begin another - a Bcc, say - which is how mail ends up somewhere
 * nobody asked for. Folding those characters to spaces removes the possibility
 * instead of trusting the encoder downstream to notice.
 */
const HEADER_BREAK = new RegExp("[\\r\\n]+", "g");
const oneLine = (s: string) => s.replace(HEADER_BREAK, " ").trim();

let transporter: Transporter | null = null;

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
  const to = recipientOf(mail.to);
  const subject = oneLine(mail.subject);
  if (!env.SMTP_HOST) {
    console.log(`\n[email:dev] To: ${to}\n[email:dev] Subject: ${subject}\n[email:dev] ${mail.text}\n`);
    if (!env.isProd) {
      try {
        await mkdir(".dev", { recursive: true });
        await appendFile(".dev/outbox.jsonl", JSON.stringify({ at: new Date().toISOString(), ...mail, to, subject }) + "\n");
      } catch { /* best effort */ }
    }
    return;
  }
  await getTransporter().sendMail({ from: env.EMAIL_FROM, to, subject, html: mail.html, text: mail.text });
}
