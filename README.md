# Personal Stylist

Your Deep Autumn wardrobe app. It has outfit ideas, an outfit builder, and a shopping list where every color was checked against your palette card.

**Open the app:** https://frankcunningham.github.io/personal-stylist/

On your phone you can add it to your home screen. On iPhone, open the link in Safari, tap the Share button, then tap **Add to Home Screen**.

## The weekly stock check

Every Monday morning a robot on GitHub visits every store in the app (DXL, UNIQLO, True Classic, Perry Ellis, BYLT, and the others). For each piece and each color, it asks the store whether it's still for sale.

- **Sold out or no longer offered:** the color is hidden from the app.
- **Link is dead (page removed):** the piece is hidden.
- **Back in stock later:** it shows up again on its own.
- **Store couldn't be reached that week:** nothing changes. The app keeps last week's answer, so a store being down never empties your list.

Before hiding anything, the robot checks a second time to make sure it wasn't a glitch. If every stylist look uses a piece that sold out, that look is hidden too, until the piece comes back.

## See what was hidden

Open [data/stock-report.md](data/stock-report.md). It lists what was hidden this week, what came back, and anything it couldn't confirm.

## Run the check yourself

1. Go to https://github.com/FrankCunningham/personal-stylist
2. Click the **Actions** tab at the top.
3. Click **Weekly stock check** on the left.
4. Click the **Run workflow** button on the right, then the green **Run workflow** button.
5. Wait about 2 minutes. A green check means it worked. Click the run to see the summary.

## Good to know

- "In stock" means the color is available in **at least one size**. It doesn't check your size specifically, so check the size on the store page before buying.
- Some stores (DXL especially) sometimes block automated visits. When that happens, the report says "Couldn't check" and those pieces keep last week's status.
- New pieces aren't added automatically. Adding new clothes still means a new styling session.

## For the technically curious

- `src/template.html` is the page. `data/products.json` holds the clothes, and `data/looks.json` holds the stylist looks.
- `scripts/check-stock.mjs` checks stock and writes `data/stock.json` and `data/stock-report.md`.
- `scripts/build.mjs` builds the app into `dist/` with hidden items removed.
- `.github/workflows/weekly-stock.yml` runs both every Monday and publishes to GitHub Pages.
