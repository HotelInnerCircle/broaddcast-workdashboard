/**
 * A142: no two things in the menu may read the same.
 *
 * The sidebar is collapsed by default, so the shortened rail label is all most
 * people ever see. Two items reading the same word is not a cosmetic problem -
 * it is two different screens wearing one name. It has happened three times
 * now ("Swipe" twice in A90; "Clients", "Projects" and an "Attend"/"Attendance"
 * pair found in A142), every time from the innocent-looking first-word
 * fallback, and every time only after somebody noticed by eye.
 */
import { describe, it, expect } from "vitest";
import { navigationFor } from "@/config/navigation";
import { shortLabel } from "@/components/layout/sidebar";
import { ROLES, type Role } from "@/types";

const itemsFor = (role: Role) => navigationFor(role).flatMap((g) => g.items);

describe("the collapsed rail", () => {
  for (const role of ROLES) {
    it(`gives ${role} no two items with the same label`, () => {
      const seen = new Map<string, string[]>();
      for (const item of itemsFor(role)) {
        const short = shortLabel(item.label);
        seen.set(short, [...(seen.get(short) ?? []), `${item.label} (${item.href})`]);
      }
      const clashes = [...seen.entries()].filter(([, v]) => v.length > 1);
      expect(clashes, `rail labels used twice: ${JSON.stringify(clashes)}`).toEqual([]);
    });

    it(`gives ${role} no two items the same destination`, () => {
      const hrefs = itemsFor(role).map((i) => i.href);
      const twice = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
      expect(twice, `linked twice: ${JSON.stringify(twice)}`).toEqual([]);
    });

    it(`keeps every ${role} rail label short enough to read`, () => {
      // The rail is about 60px wide; past ~10 characters it is ellipsised, which
      // is its own way of making two items look alike.
      for (const item of itemsFor(role)) {
        const short = shortLabel(item.label);
        expect(short.length, `${item.label} -> "${short}"`).toBeLessThanOrEqual(10);
      }
    });
  }

  it("does not let a report wear the name of the thing it reports on", () => {
    // "Client Reports" shortened to "Clients", which is the clients screen.
    for (const [full, wrong] of [["Client Reports", "Clients"], ["Project Reports", "Projects"], ["Attendance Ledger", "Attendance"]]) {
      expect(shortLabel(full), full).not.toBe(wrong);
    }
  });
});
