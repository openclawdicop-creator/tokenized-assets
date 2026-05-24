import { writeFile } from "node:fs/promises";

const xstocksUrl = "https://xstocks.fi/products";
const ondoSitemapUrl = "https://app.ondo.finance/sitemap.xml";

function htmlDecode(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return response.text();
}

function parseXStocks(html) {
  const pattern = /<h2 class="TableRow_symbol__HiqZZ">([^<]+)<\/h2><div class="TableRow_name__TZ6Nw">([^<]+)<\/div>/g;
  return [...html.matchAll(pattern)].map((match) => {
    const tokenSymbol = match[1];
    const underlyingSymbol = tokenSymbol.replace(/x$/i, "");
    return {
      platform: "xStocks",
      tokenSymbol,
      underlyingSymbol,
      name: htmlDecode(match[2])
    };
  });
}

function parseOndoSlugs(xml) {
  const pattern = /<loc>https:\/\/app\.ondo\.finance\/assets\/([^<]+)<\/loc>/g;
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

function parseOndoTicker(html, slug) {
  const tickerMatch = html.match(/"ticker":"([^"]+)"/);
  const displayNameMatch = html.match(/"displayName":"([^"]+)"/);
  const underlyingNameMatch = html.match(/"underlyingName":"([^"]+)"/);
  const priceMatch = html.match(/"price":"([^"]+)"/);
  const ticker = tickerMatch?.[1] || slug.replace(/on$/i, "").toUpperCase();

  return {
    platform: "Ondo",
    tokenSymbol: `${ticker}on`,
    underlyingSymbol: ticker,
    name: displayNameMatch?.[1] ? htmlDecode(displayNameMatch[1]) : htmlDecode(underlyingNameMatch?.[1] || ticker),
    priceHint: priceMatch?.[1] ? Number(priceMatch[1]) : null,
    slug
  };
}

async function main() {
  const xstocksHtml = await fetchText(xstocksUrl);
  const xstocks = parseXStocks(xstocksHtml);

  const sitemap = await fetchText(ondoSitemapUrl);
  const slugs = parseOndoSlugs(sitemap);

  const ondo = [];
  const concurrency = 8;
  let index = 0;

  async function worker() {
    while (index < slugs.length) {
      const slug = slugs[index];
      index += 1;
      const html = await fetchText(`https://app.ondo.finance/assets/${slug}`);
      ondo.push(parseOndoTicker(html, slug));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, slugs.length) }, () => worker()));

  const manifest = [...xstocks, ...ondo].sort((a, b) => {
    const platformOrder = a.platform.localeCompare(b.platform);
    if (platformOrder !== 0) return platformOrder;
    return a.tokenSymbol.localeCompare(b.tokenSymbol, "en", { sensitivity: "base" });
  });

  await writeFile("assets-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${manifest.length} assets to assets-manifest.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
