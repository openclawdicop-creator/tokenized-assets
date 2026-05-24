import { readFile, writeFile } from "node:fs/promises";

const manifestPath = "assets-manifest.json";
const outputPath = "assets-data.json";
const marketBase = "https://api.nasdaq.com/api/quote";
const excludedUnderlyingSymbols = new Set(["OUSG", "USDY"]);

function parseMoney(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[1]}-${match[2]}`;
  return null;
}

function estimateDividendFields(dividends) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = dividends
    .map((row) => ({
      ex: parseDate(row.exOrEffDate),
      pay: parseDate(row.paymentDate),
      amount: parseMoney(row.amount)
    }))
    .filter((row) => row.ex && row.amount != null)
    .sort((a, b) => b.ex.localeCompare(a.ex));

  if (!rows.length) {
    return {
      lastExDate: null,
      lastPaymentDate: null,
      lastDividendValue: null,
      nextExDate: null,
      nextPaymentDate: null,
      nextDividendValue: null
    };
  }

  const pastRows = rows.filter((row) => row.ex <= today);
  const futureRows = rows.filter((row) => row.ex > today);
  const last = pastRows[0] || rows[0];
  const intervals = [];

  for (let i = 0; i < Math.min(rows.length - 1, 4); i += 1) {
    const current = new Date(`${rows[i].ex}T00:00:00Z`);
    const previous = new Date(`${rows[i + 1].ex}T00:00:00Z`);
    const diff = Math.round((current - previous) / 86400000);
    if (diff > 0) intervals.push(diff);
  }

  const medianInterval = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)] || 90;
  const paymentLag = last.pay ? Math.max(1, Math.round((new Date(`${last.pay}T00:00:00Z`) - new Date(`${last.ex}T00:00:00Z`)) / 86400000)) : 3;
  const nextOfficial = futureRows[0] || null;

  const nextEx = nextOfficial?.ex ? new Date(`${nextOfficial.ex}T00:00:00Z`) : new Date(`${last.ex}T00:00:00Z`);
  if (!nextOfficial?.ex) nextEx.setDate(nextEx.getDate() + medianInterval);

  const nextPay = nextOfficial?.pay ? new Date(`${nextOfficial.pay}T00:00:00Z`) : new Date(nextEx);
  if (!nextOfficial?.pay) nextPay.setDate(nextPay.getDate() + paymentLag);

  return {
    lastExDate: last.ex,
    lastPaymentDate: last.pay,
    lastDividendValue: last.amount,
    nextExDate: nextEx.toISOString().slice(0, 10),
    nextPaymentDate: nextPay.toISOString().slice(0, 10),
    nextDividendValue: nextOfficial?.amount ?? last.amount
  };
}

async function readManifest() {
  const content = await readFile(manifestPath, "utf8");
  return JSON.parse(content);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/"
    }
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

async function fetchFirstMarketJson(ticker, route) {
  const assetClasses = ["stocks", "etf"];
  let lastError = null;

  for (const assetClass of assetClasses) {
    try {
      const payload = await fetchJson(`${marketBase}/${encodeURIComponent(ticker)}/${route}?assetclass=${assetClass}`);
      if (payload?.data) return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`No market data for ${ticker}`);
}

async function fetchMarket(ticker) {
  const [info, dividends] = await Promise.all([
    fetchFirstMarketJson(ticker, "info"),
    fetchFirstMarketJson(ticker, "dividends").catch(() => null)
  ]);

  const rows = dividends?.data?.dividends?.rows ?? [];
  return {
    price: parseMoney(info?.data?.primaryData?.lastSalePrice),
    ...estimateDividendFields(rows)
  };
}

async function main() {
  const manifest = (await readManifest()).filter((asset) => !excludedUnderlyingSymbols.has(asset.underlyingSymbol));
  const tickers = [...new Set(manifest.map((asset) => asset.underlyingSymbol))];
  const marketByTicker = new Map();
  let index = 0;
  const concurrency = 8;

  async function worker() {
    while (index < tickers.length) {
      const ticker = tickers[index];
      index += 1;
      try {
        marketByTicker.set(ticker, await fetchMarket(ticker));
      } catch {
        marketByTicker.set(ticker, {
          price: null,
          lastExDate: null,
          lastPaymentDate: null,
          lastDividendValue: null,
          nextExDate: null,
          nextPaymentDate: null,
          nextDividendValue: null
        });
      }
      if (index % 10 === 0) {
        console.log(`Processed ${Math.min(index, tickers.length)}/${tickers.length} tickers`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tickers.length) }, () => worker()));

  const data = manifest.map((asset) => ({
    ...asset,
    ...(marketByTicker.get(asset.underlyingSymbol) || {}),
    loading: false
  }));

  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Wrote ${data.length} assets to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
