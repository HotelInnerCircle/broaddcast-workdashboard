/**
 * What may be put in a To: header, and what may be put in a Subject:.
 *
 * Both are hardening rather than features, so both are pinned. The address rule
 * exists because mail address parsers disagree with each other about exotic
 * input, and the disagreement is exploitable: an allow-list checked against one
 * reading of `user@good.com(@evil.com)` while delivery follows the other sends
 * the message to the wrong domain. The subject rule exists because a company name
 * typed by a user reaches a mail header, and a header is one line.
 *
 * A regex in this file was mangled by shell quoting once before - it reached disk
 * with its backslashes eaten and silently matched nothing - so these tests check
 * the pattern's behaviour against literal strings rather than trusting a reading
 * of the source.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { SMTP_HOST: "", SMTP_PORT: 587, EMAIL_FROM: "a@b.com", isProd: true } }));
vi.mock("@/lib/api/errors", () => ({
  Errors: { bad: (code: string, msg: string) => Object.assign(new Error(msg), { code, status: 400 }) },
}));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: async () => undefined }) } }));

const { sendMail } = await import("@/lib/email");

const send = (to: string, subject = "Hello") => sendMail({ to, subject, html: "<p>hi</p>", text: "hi" });

describe("who an email may be addressed to", () => {
  it.each([
    "someone@example.com",
    "first.last@example.co.in",
    "user+tag@example.com",
    "a@b.co",
    "with-dash@sub.domain.example.com",
    "o'brien@example.com",
  ])("accepts %s", async (address) => {
    await expect(send(address)).resolves.toBeUndefined();
  });

  it.each([
    ["a display name", '"Someone" <someone@example.com>'],
    ["angle brackets", "<someone@example.com>"],
    ["a second address", "someone@example.com, other@evil.com"],
    ["a semicolon list", "someone@example.com; other@evil.com"],
    ["an RFC 5322 comment", "someone@good.com(@evil.com)"],
    ["a comment before the domain", "someone@(evil.com)good.com"],
    ["a newline, which would start a new header", "someone@example.com\r\nBcc: other@evil.com"],
    ["a bare newline", "someone@example.com\nBcc: other@evil.com"],
    ["a non-ASCII homograph domain", "someone@exаmple.com"],
    ["a punycode-looking unicode local part", "sοmeone@example.com"],
    ["no domain at all", "someone"],
    ["no local part", "@example.com"],
    ["a trailing dot", "someone@example.com."],
    ["a leading dot in the domain", "someone@.example.com"],
    ["two @ signs", "someone@example@com"],
    ["a space inside", "some one@example.com"],
    ["a tab", "someone@exa\tmple.com"],
    ["nothing", ""],
    ["only spaces", "   "],
  ])("refuses %s", async (_why, address) => {
    await expect(send(address)).rejects.toThrow(/cannot be sent to/);
  });

  it("refuses an address longer than SMTP has to carry", async () => {
    await expect(send(`${"a".repeat(250)}@example.com`)).rejects.toThrow(/cannot be sent to/);
  });

  it("does not spend long deciding, even on a hostile string", async () => {
    // A pattern with nested quantifiers can be made to backtrack for minutes.
    // This one is anchored and has no nested quantifier over the same character
    // set, so a long near-match fails immediately rather than eventually.
    const began = Date.now();
    await expect(send(`${"a".repeat(64)}${"!".repeat(64)}@${"b".repeat(64)}`)).rejects.toThrow();
    expect(Date.now() - began).toBeLessThan(500);
  });
});

describe("what a subject may contain", () => {
  it("folds a newline in a subject to a space, so it cannot start a header", async () => {
    // The company name in an invitation subject is typed by whoever made the
    // company, so this is reachable input, not a hypothetical.
    await expect(send("someone@example.com", "Invite\r\nBcc: other@evil.com")).resolves.toBeUndefined();
  });

  it("leaves an ordinary subject alone", async () => {
    await expect(send("someone@example.com", "Rahul invited you to join Broaddcast")).resolves.toBeUndefined();
  });
});
