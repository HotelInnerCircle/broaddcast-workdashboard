/**
 * A142: the admin's dashboard says each thing once.
 *
 * It had grown four ways to reach /employees on one screen, three to the audit
 * log, and the headcount printed three times under three different labels. Two
 * of those were a "Quick links" card whose every entry was already on the page
 * twice over.
 *
 * The rule this holds: outside the rail and the "Everything in one place"
 * gateway - which repeat the menu on purpose - no destination appears twice on
 * the admin's dashboard. Counted from what is actually on screen, because the
 * phone home sits in the same markup at desktop widths and counting the DOM
 * would report duplicates nobody can see at once.
 */
import { signedIn, shot, wait, waitForText } from "../harness.mjs";

export const name = "admin-screen";
export const description = "the admin's dashboard says each thing once";

/** Every link a person can actually see, with the ones that may repeat marked. */
const visibleLinks = (page) => page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("http") || href === "#") continue;
    const box = a.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (getComputedStyle(a).visibility === "hidden") continue;
    out.push({
      href,
      text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
      inRail: Boolean(a.closest("aside, nav")),
      inGateway: Boolean(a.closest("[data-gateway]")),
      // A card showing data about something may link to it: that is the card's
      // own action, not a second menu. Marked in the markup so the rule stays a
      // rule - what is forbidden is two *launchers* offering the same place.
      isCta: a.hasAttribute("data-cta") || Boolean(a.closest("[data-cta]")),
    });
  }
  return out;
});

const duplicates = (links) => {
  const by = new Map();
  for (const l of links.filter((l) => !l.inRail && !l.inGateway && !l.isCta)) {
    by.set(l.href, [...(by.get(l.href) ?? []), l.text]);
  }
  return [...by.entries()].filter(([, texts]) => texts.length > 1);
};

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);

  /* ---------- the desktop screen ---------- */
  await admin.setViewportSize({ width: 1440, height: 1200 });
  await admin.goto(`${lab.base}/admin/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("the admin dashboard loads", await waitForText(admin, /Everything in one place/i, 45_000));
  await wait(1500);

  const desktop = await visibleLinks(admin);
  const dDupes = duplicates(desktop);
  check("nothing outside the rail and the gateway is linked twice", dDupes.length === 0,
    JSON.stringify(dDupes));

  check("the Quick links card is gone", !desktop.some((l) => l.text === "Subscription & billing"),
    JSON.stringify(desktop.filter((l) => /billing/i.test(l.text))));

  /*
   * The gateway is built from the rail, so it quite rightly lists Dashboard -
   * but on the dashboard that is a link to where you already are.
   */
  check("the gateway does not offer the page you are on",
    !desktop.some((l) => l.inGateway && l.href === "/admin/dashboard"),
    JSON.stringify(desktop.filter((l) => l.href === "/admin/dashboard")));
  check("though the rail still does, as it does on every other page",
    desktop.some((l) => l.inRail && l.href === "/admin/dashboard"));

  /*
   * And the headcount is not printed three times under three labels. The number
   * belongs to Headcount and to Plan usage, which frame it differently on
   * purpose; the People tile now says what the screen is for instead.
   */
  const body = (await admin.textContent("body")) ?? "";
  check("the People tile says what it is for rather than repeating a count",
    /who works here/i.test(body), body.slice(0, 120));
  check("and nothing still claims two different things are 'active today'",
    !/active today/i.test(body), (body.match(/.{0,40}active today.{0,20}/i) ?? [])[0] ?? "");
  await shot(admin, "admin-dashboard-deduped");

  /* ---------- the phone ---------- */
  const phone = await browser.newContext({
    viewport: { width: 390, height: 840 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    storageState: await admin.context().storageState(),
  });
  const small = await phone.newPage();
  await small.goto(`${lab.base}/admin/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForText(small, /Today/i, 45_000);
  await wait(1200);

  const onPhone = await visibleLinks(small);
  const pDupes = duplicates(onPhone);
  check("the phone home links each place once", pDupes.length === 0, JSON.stringify(pDupes));
  check("there is still a way to everybody's day from the phone",
    onPhone.some((l) => l.href === "/attendance"), JSON.stringify(onPhone.map((l) => l.href)));
  await shot(small, "admin-phone-deduped");
  await phone.close();
}
