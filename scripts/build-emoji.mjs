/**
 * Generates `lib/emoji-data.json` - the emoji catalogue the chat picker uses (A73).
 *
 * `unicode-emoji-json` is a dev dependency only: this script trims it to what the picker needs
 * (character, name, search keywords, group) and writes one compact file, so the browser downloads
 * ~60 KB instead of the ~400 KB source and nothing emoji-related is in the main bundle.
 *
 * Run with `npm run build:emoji` after bumping the dependency.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const byGroup = JSON.parse(readFileSync(join(root, "node_modules/unicode-emoji-json/data-by-group.json"), "utf8"));

/** The eight tabs WhatsApp shows, in its order. Anything outside them is dropped. */
const GROUPS = [
  ["Smileys & Emotion", "Smileys"],
  ["People & Body", "People"],
  ["Animals & Nature", "Nature"],
  ["Food & Drink", "Food"],
  ["Travel & Places", "Travel"],
  ["Activities", "Activities"],
  ["Objects", "Objects"],
  ["Symbols", "Symbols"],
  ["Flags", "Flags"],
];

const groups = [];
let total = 0;
// The file is an array of { name, slug, emojis: [...] } - index it by group name.
const index = new Map(Object.values(byGroup).map((g) => [g.name, g.emojis]));
for (const [source, label] of GROUPS) {
  const items = index.get(source);
  if (!items) { console.warn(`! no emoji for group "${source}"`); continue; }
  const list = items.map((e) => {
    // The name is the searchable text; slug adds the words people actually type ("thumbs up").
    const words = [...new Set(`${e.name} ${e.slug.replace(/_/g, " ")}`.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean))];
    return [e.emoji, e.name, words.join(" ")];
  });
  total += list.length;
  groups.push({ label, emoji: list });
}

const out = join(root, "lib/emoji-data.json");
writeFileSync(out, JSON.stringify({ groups }));
console.log(`wrote ${out}: ${total} emoji in ${groups.length} groups, ${(readFileSync(out).length / 1024).toFixed(0)} KB`);
