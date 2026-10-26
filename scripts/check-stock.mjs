// Weekly stock and link check.
//
// For every product color in data/products.json, ask the store whether that
// color is still for sale, and record the answer in data/stock.json:
//   in       still for sale
//   out      the color is sold out or no longer offered
//   gone     the product page no longer exists (dead link)
//   unknown  the store couldn't be reached or the answer was unclear
// The build hides "out" and "gone". "unknown" keeps the last known answer, so a
// store that is briefly down never empties the shopping list.
//
// Run: node scripts/check-stock.mjs

import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("..", import.meta.url);
const PRODUCTS = new URL("data/products.json", ROOT);
const STOCK = new URL("data/stock.json", ROOT);
const REPORT = new URL("data/stock-report.md", ROOT);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const CONCURRENCY_PER_STORE = 3;
const TIMEOUT_MS = 25000;

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");

// DXL shortens names ("Carhartt Brn", "Tigers Eye Hthr"); expand the common ones before comparing.
const ABBR = { brn: "brown", hthr: "heather", htr: "heather", htrr: "heather", hthrd: "heathered", grn: "green", blk: "black" };
const expand = (s) =>
  String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => ABBR[w] || w)
    .join("");
const sameColor = (a, b) => {
  const [x, y] = [norm(a), norm(b)];
  if (!x || !y) return false;
  if (x === y || expand(a) === expand(b)) return true;
  return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
};

async function get(url, { json = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: json ? "application/json" : "text/html,*/*", "accept-language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: ctl.signal,
    });
    const body = await res.text();
    return { status: res.status, finalUrl: res.url, body };
  } finally {
    clearTimeout(t);
  }
}

const colorUrl = (p, c) => (c[2] ? (c[2].startsWith("http") ? c[2] : p.u + c[2]) : p.u);

// ---------- Shopify stores (most brands) ----------
// Some brands put every color on one page, others give each color its own page,
// so each color is checked against the page its own link points to.
async function checkShopify(p) {
  const pages = {};
  return Promise.all(
    p.c.map(async (c) => {
      const url = new URL(colorUrl(p, c));
      const vid = url.searchParams.get("variant");
      url.search = "";
      pages[url.href] ||= readShopifyPage(url.href, colorUrl(p, c));
      const pg = await pages[url.href];
      if (pg.result) return pg.result;
      return pg.feed ? fromFeed(pg.feed, c, vid) : fromOffers(pg.offers, c);
    }),
  );
}

async function readShopifyPage(base, original) {
  // /products/<handle>.js lists every variant and whether it can be bought
  const r = await get(base.replace(/\/$/, "") + ".js", { json: true });
  if (r.status === 200) {
    try {
      return { feed: JSON.parse(r.body) };
    } catch {}
  }
  // custom storefronts (e.g. BYLT) have no feed; read the page's schema.org offers instead
  const h = await get(original);
  if (h.status === 404 || h.status === 410) return { result: { s: "gone", why: "product page removed" } };
  if (h.status !== 200) return { result: { s: "unknown", why: `store answered ${h.status}` } };
  const offers = schemaOffers(h.body);
  if (!offers.length) return { result: { s: "unknown", why: "no stock information on the page" } };
  return { offers };
}

function fromFeed(prod, c, vid) {
  const opts = (prod.options || []).map((o) => (typeof o === "string" ? o : o.name));
  const colorIdx = opts.findIndex((o) => /colou?r/i.test(o));
  const variants = prod.variants || [];
  const anyInStock = (vs) => (vs.some((v) => v.available) ? { s: "in" } : { s: "out", why: "sold out in every size" });
  if (colorIdx < 0) return anyInStock(variants); // the whole page is this one color

  const colorOf = (v) => v.options?.[colorIdx] ?? v[`option${colorIdx + 1}`];
  const names = [...new Set(variants.map(colorOf))];
  const byId = vid && variants.find((v) => String(v.id) === vid);
  const name = byId ? colorOf(byId) : names.find((n) => sameColor(n, c[1]));
  if (name == null) {
    if (vid) return { s: "out", why: "this color was removed from the product" };
    return { s: "unknown", why: `color "${c[1]}" not matched` };
  }
  return anyInStock(variants.filter((v) => colorOf(v) === name));
}

function schemaOffers(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let j;
    try {
      j = JSON.parse(m[1]);
    } catch {
      continue;
    }
    for (const node of [j].flat()) {
      if (node?.["@type"] !== "Product") continue;
      for (const o of [node.offers || []].flat()) {
        let color = null;
        try {
          color = new URL(o.url).searchParams.get("Color");
        } catch {}
        out.push({ color: color && color.replace(/-/g, " "), inStock: /InStock|LimitedAvailability/i.test(o.availability || "") });
      }
    }
  }
  return out;
}

function fromOffers(offers, c) {
  const colored = offers.some((o) => o.color);
  const mine = colored ? offers.filter((o) => sameColor(o.color, c[1])) : offers;
  if (!mine.length) return { s: "out", why: "this color is no longer offered" };
  return mine.some((o) => o.inStock) ? { s: "in" } : { s: "out", why: "sold out in every size" };
}

// ---------- UNIQLO: its stock API by product code + color code ----------
async function checkUniqlo(p) {
  const m = p.u.match(/products\/([A-Z0-9-]+)\/(\d+)/);
  if (!m) return p.c.map(() => ({ s: "unknown", why: "unrecognised UNIQLO link" }));
  const api = `https://www.uniqlo.com/us/api/commerce/v5/en/products/${m[1]}/price-groups/${m[2]}/l2s?withPrices=true&withStocks=true`;
  const r = await get(api, { json: true });
  if (r.status !== 200) return p.c.map(() => ({ s: "unknown", why: `store answered ${r.status}` }));
  let j;
  try {
    j = JSON.parse(r.body);
  } catch {
    return p.c.map(() => ({ s: "unknown", why: "store sent an unreadable answer" }));
  }
  if (j.status !== "ok") {
    // UNIQLO answers an error body for products it no longer sells
    return p.c.map(() => ({ s: "gone", why: "product no longer listed" }));
  }
  const l2s = j.result?.l2s || [];
  const stocks = j.result?.stocks || {};
  if (!l2s.length) return p.c.map(() => ({ s: "gone", why: "product no longer listed" }));
  return p.c.map((c) => {
    const code =
      new URL(colorUrl(p, c)).searchParams.get("colorDisplayCode") || (String(c[1]).match(/^(\d{2})\b/) || [])[1];
    if (!code) return { s: "unknown", why: "no UNIQLO color code" };
    const mine = l2s.filter((l) => l.color?.displayCode === code);
    if (!mine.length) return { s: "out", why: "this color was removed from the product" };
    const ok = mine.some((l) => {
      const st = stocks[l.l2Id];
      return st && st.statusCode !== "STOCK_OUT" && st.quantity !== 0;
    });
    return ok ? { s: "in" } : { s: "out", why: "sold out in every size" };
  });
}

// ---------- DXL: product data is embedded in the page (__NEXT_DATA__) ----------
async function checkDxl(p) {
  // DXL variants share one page; occasionally a color has its own page, so fetch each distinct URL once.
  const urls = [...new Set(p.c.map((c) => colorUrl(p, c)))];
  const pages = {};
  for (const u of urls) pages[u] = await readDxlPage(u);
  return p.c.map((c) => {
    const pg = pages[colorUrl(p, c)];
    if (pg.result) return pg.result;
    const child = pg.children.find((ch) => sameColor(ch.attributes?.ecommColor, c[1]));
    if (!child) {
      const any = pg.children.some((ch) => ch.variants?.some((v) => v.isOnStock));
      return any ? { s: "out", why: "this color is no longer offered" } : { s: "out", why: "sold out" };
    }
    return child.variants?.some((v) => v.isOnStock) ? { s: "in" } : { s: "out", why: "sold out in every size" };
  });
}

async function readDxlPage(u) {
  const r = await get(u);
  if (r.status === 404 || r.status === 410 || /\/not-found/.test(r.finalUrl) || !/\/p\//.test(r.finalUrl))
    return { result: { s: "gone", why: "product page removed" } };
  if (r.status !== 200) return { result: { s: "unknown", why: `store answered ${r.status}` } };
  const m = r.body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { result: { s: "unknown", why: "page layout changed" } };
  try {
    const j = JSON.parse(m[1]);
    const src = (j.props?.pageProps?.data?.pageFolder?.dataSourceConfigurations || []).find((d) => d.preloadedValue?.childProducts);
    if (!src) return { result: { s: "unknown", why: "page layout changed" } };
    return { children: src.preloadedValue.childProducts };
  } catch {
    return { result: { s: "unknown", why: "page layout changed" } };
  }
}

// ---------- any other store: the link has to load ----------
async function checkGeneric(p) {
  const r = await get(p.u);
  if (r.status === 404 || r.status === 410) return p.c.map(() => ({ s: "gone", why: "product page removed" }));
  if (r.status !== 200) return p.c.map(() => ({ s: "unknown", why: `store answered ${r.status}` }));
  const soldOut = /"availability"\s*:\s*"https?:\/\/schema\.org\/(OutOfStock|Discontinued|SoldOut)"/i.test(r.body);
  return p.c.map(() => (soldOut ? { s: "out", why: "sold out" } : { s: "in" }));
}

function checkerFor(p) {
  const host = new URL(p.u).hostname;
  if (host.endsWith("dxl.com")) return checkDxl;
  if (host.endsWith("uniqlo.com")) return checkUniqlo;
  if (/\/products\//.test(p.u)) return checkShopify;
  return checkGeneric;
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

async function main() {
  const P = JSON.parse(await readFile(PRODUCTS, "utf8"));
  let prev = { items: {} };
  try {
    prev = JSON.parse(await readFile(STOCK, "utf8"));
  } catch {}

  const byStore = {};
  for (const [id, p] of Object.entries(P)) (byStore[p.s] ||= []).push([id, p]);

  const now = new Date().toISOString();
  const items = {};
  const storeSummary = {};

  await Promise.all(
    Object.entries(byStore).map(async ([store, list]) => {
      const results = await pool(list, CONCURRENCY_PER_STORE, async ([id, p]) => {
        try {
          let r = await checkerFor(p)(p);
          // Stores occasionally send a glitchy page, so confirm any "sold out" or
          // "dead link" with a second look before hiding it.
          if (r.some((x) => x.s === "out" || x.s === "gone")) {
            await new Promise((ok) => setTimeout(ok, 3000));
            const again = await checkerFor(p)(p);
            r = r.map((x, i) => (x.s === "out" || x.s === "gone") && again[i].s !== x.s ? { s: "unknown", why: "answers disagreed" } : x);
          }
          return [id, p, r];
        } catch (e) {
          return [id, p, p.c.map(() => ({ s: "unknown", why: `could not reach store (${e.name})` }))];
        }
      });

      // Safety brake: if a whole store says "gone" or "unknown" for everything, it is
      // blocking us or changed its site; keep last week's answers instead of hiding it all.
      const flat = results.flatMap(([, , r]) => r);
      const broken = flat.length > 3 && flat.every((r) => r.s === "gone" || r.s === "unknown");
      storeSummary[store] = { checked: flat.length, brake: broken };

      for (const [id, , r] of results) {
        r.forEach((res, i) => {
          const key = `${id}:${i}`;
          const old = prev.items?.[key];
          if (broken || res.s === "unknown") {
            items[key] = old
              ? { ...old, note: broken ? "store unreachable this week; kept last answer" : res.why }
              : { s: "in", since: now, note: res.why || "not confirmed yet" };
          } else {
            items[key] = { s: res.s, since: old && old.s === res.s ? old.since : now, ...(res.why ? { why: res.why } : {}) };
          }
          items[key].checked = now;
        });
      }
    }),
  );

  const sorted = Object.fromEntries(Object.keys(items).sort().map((k) => [k, items[k]]));
  await writeFile(STOCK, JSON.stringify({ checkedAt: now, stores: storeSummary, items: sorted }, null, 1) + "\n");
  await writeFile(REPORT, report(P, sorted, prev.items || {}, storeSummary, now));

  const n = (s) => Object.values(sorted).filter((x) => x.s === s).length;
  console.log(`Checked ${Object.keys(sorted).length} colors: ${n("in")} in stock, ${n("out")} sold out, ${n("gone")} dead links.`);
}

function report(P, items, prevItems, stores, now) {
  const name = (key) => {
    const [id, i] = key.split(":");
    const p = P[id];
    return `${p.b} ${p.n}, ${p.c[i][1]} (${p.s})`;
  };
  const hidden = Object.entries(items).filter(([, v]) => v.s !== "in");
  const newlyHidden = hidden.filter(([k]) => (prevItems[k]?.s ?? "in") === "in");
  const back = Object.entries(items).filter(([k, v]) => v.s === "in" && prevItems[k] && prevItems[k].s !== "in");
  const unsure = Object.entries(items).filter(([, v]) => v.s === "in" && v.note);
  let md = `# Weekly stock check\n\nLast run: ${now.slice(0, 10)}\n\n`;
  md += `- ${Object.keys(items).length - hidden.length} colors showing in the app\n- ${hidden.length} hidden (sold out or dead link)\n\n`;
  const brakes = Object.entries(stores).filter(([, s]) => s.brake);
  if (brakes.length) md += `**Couldn't check:** ${brakes.map(([s]) => s).join(", ")}. Those items kept last week's status.\n\n`;
  const list = (rows) => rows.map(([k, v]) => `- ${name(k)}${v.why ? ` — ${v.why}` : ""}`).join("\n") + "\n\n";
  if (newlyHidden.length) md += `## Hidden this week\n\n${list(newlyHidden)}`;
  if (back.length) md += `## Back in stock this week\n\n${list(back)}`;
  if (hidden.length) md += `## Everything currently hidden\n\n${list(hidden)}`;
  if (unsure.length) md += `## Still showing, but couldn't confirm\n\n${unsure.map(([k, v]) => `- ${name(k)} — ${v.note}`).join("\n")}\n`;
  return md;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
