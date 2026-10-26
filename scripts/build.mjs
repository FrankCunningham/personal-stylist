// Build the app into dist/: take the page template, drop every product color the
// weekly check marked sold out ("out") or dead ("gone"), and inject the data.
//
// Run: node scripts/build.mjs

import { readFile, writeFile, mkdir, cp } from "node:fs/promises";

const ROOT = new URL("..", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, ROOT), "utf8"));

const template = await readFile(new URL("src/template.html", ROOT), "utf8");
const css = await readFile(new URL("src/app.css", ROOT), "utf8");
const appJs = await readFile(new URL("src/app.js", ROOT), "utf8");
const P = await read("data/products.json");
const { looks, defaultOutfit } = await read("data/looks.json");
let stock = { checkedAt: null, items: {} };
try {
  stock = await read("data/stock.json");
} catch {}

const hidden = (id, i) => ["out", "gone"].includes(stock.items?.[`${id}:${i}`]?.s);

// Keep only colors still for sale; remember where each old color index moved to.
const remap = {};
const live = {};
for (const [id, p] of Object.entries(P)) {
  const keep = [];
  p.c.forEach((c, i) => {
    if (!hidden(id, i)) {
      remap[`${id}:${i}`] = keep.length;
      keep.push(c);
    }
  });
  if (keep.length) live[id] = { ...p, c: keep };
}

// Looks reference pieces as [id, colorIndex]; drop any look with a sold-out piece.
const move = (x) => (x[0] === "none" ? x : remap[`${x[0]}:${x[1]}`] === undefined ? null : [x[0], remap[`${x[0]}:${x[1]}`]]);
const liveLooks = looks
  .map(([name, note, ...pieces]) => {
    const moved = pieces.map(move);
    return moved.every(Boolean) ? [name, note, ...moved] : null;
  })
  .filter(Boolean);

let def = Object.fromEntries(Object.entries(defaultOutfit).map(([k, x]) => [k, move(x)]));
if (Object.values(def).some((x) => !x)) {
  if (!liveLooks.length) throw new Error("Every stylist look has a sold-out piece; add new looks to data/looks.json.");
  const [, , t, l, b, s] = liveLooks[0];
  def = { t, l, b, s };
}

const checked = stock.checkedAt
  ? new Date(stock.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "not yet run";

const data = [
  `const P=${JSON.stringify(live)};`,
  `const LOOKS=${JSON.stringify(liveLooks)};`,
  `const DEFAULT_OUTFIT=${JSON.stringify(def)};`,
].join("\n");

const html = template
  .replace("/*__CSS__*/", () => css)
  .replace("/*__DATA__*/", () => data)
  .replace("/*__APPJS__*/", () => appJs)
  .replaceAll("<!--__CHECKED__-->", checked);

await mkdir(new URL("dist/", ROOT), { recursive: true });
await writeFile(new URL("dist/index.html", ROOT), html);
await cp(new URL("public/", ROOT), new URL("dist/", ROOT), { recursive: true });

const colors = (o) => Object.values(o).reduce((n, p) => n + p.c.length, 0);
console.log(
  `Built dist/index.html: ${Object.keys(live).length}/${Object.keys(P).length} products, ` +
    `${colors(live)}/${colors(P)} colors, ${liveLooks.length}/${looks.length} looks. Stock checked: ${checked}.`,
);
