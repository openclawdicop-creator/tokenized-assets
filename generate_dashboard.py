from __future__ import annotations

import argparse
import concurrent.futures
import html
import json
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
INDEX_PATH = ROOT / "index.html"
DATA_PATH = ROOT / "assets-data.json"
MANIFEST_PATH = ROOT / "assets-manifest.json"

XSTOCKS_URL = "https://xstocks.fi/products"
ONDO_SITEMAP_URL = "https://app.ondo.finance/sitemap.xml"
ONDO_ASSET_URL = "https://app.ondo.finance/assets/{slug}"
NASDAQ_BASE_URL = "https://api.nasdaq.com/api/quote/{ticker}/{route}?assetclass={asset_class}"

EXCLUDED_UNDERLYINGS = {"OUSG", "USDY"}
HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}


def fetch_text(url: str, *, retries: int = 3, timeout: int = 30) -> str:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            request = Request(url, headers=HTTP_HEADERS)
            with urlopen(request, timeout=timeout) as response:
                raw = response.read()
                charset = response.headers.get_content_charset() or "utf-8"
                return raw.decode(charset, errors="replace")
        except (HTTPError, URLError, TimeoutError) as error:
            last_error = error
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def fetch_json(url: str) -> dict[str, Any]:
    return json.loads(fetch_text(url))


def parse_money(value: Any) -> float | None:
    if value is None or value == "":
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_date(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    match = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", text)
    if match:
        month, day, year = match.groups()
        return f"{year}-{month}-{day}"
    return None


def parse_xstocks() -> list[dict[str, Any]]:
    page = fetch_text(XSTOCKS_URL)
    pattern = re.compile(
        r'<h2 class="TableRow_symbol__HiqZZ">([^<]+)</h2>'
        r'<div class="TableRow_name__TZ6Nw">([^<]+)</div>'
    )
    assets: list[dict[str, Any]] = []
    for token_symbol, name in pattern.findall(page):
        underlying = re.sub(r"x$", "", token_symbol, flags=re.IGNORECASE)
        assets.append(
            {
                "platform": "xStocks",
                "tokenSymbol": token_symbol,
                "underlyingSymbol": underlying,
                "name": html.unescape(name),
            }
        )
    return assets


def parse_ondo_slugs() -> list[str]:
    sitemap = fetch_text(ONDO_SITEMAP_URL)
    return re.findall(r"<loc>https://app\.ondo\.finance/assets/([^<]+)</loc>", sitemap)


def parse_ondo_asset(slug: str) -> dict[str, Any]:
    page = fetch_text(ONDO_ASSET_URL.format(slug=slug))
    ticker_match = re.search(r'"ticker":"([^"]+)"', page)
    display_name_match = re.search(r'"displayName":"([^"]+)"', page)
    underlying_name_match = re.search(r'"underlyingName":"([^"]+)"', page)
    price_match = re.search(r'"price":"([^"]+)"', page)

    ticker = ticker_match.group(1) if ticker_match else re.sub(r"on$", "", slug, flags=re.IGNORECASE).upper()
    name = (
        display_name_match.group(1)
        if display_name_match
        else underlying_name_match.group(1)
        if underlying_name_match
        else ticker
    )

    return {
        "platform": "Ondo",
        "tokenSymbol": f"{ticker}on",
        "underlyingSymbol": ticker,
        "name": html.unescape(name),
        "priceHint": float(price_match.group(1)) if price_match else None,
        "slug": slug,
    }


def parse_ondo_assets(max_workers: int) -> list[dict[str, Any]]:
    slugs = parse_ondo_slugs()
    assets: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(parse_ondo_asset, slug): slug for slug in slugs}
        for future in concurrent.futures.as_completed(futures):
            slug = futures[future]
            try:
                assets.append(future.result())
            except Exception as error:
                print(f"Warning: skipped Ondo asset {slug}: {error}", file=sys.stderr)
    return assets


def fetch_first_market_json(ticker: str, route: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for asset_class in ("stocks", "etf"):
        url = NASDAQ_BASE_URL.format(
            ticker=quote(ticker, safe=""),
            route=route,
            asset_class=asset_class,
        )
        try:
            payload = fetch_json(url)
            if payload.get("data"):
                return payload
        except Exception as error:
            last_error = error
    raise RuntimeError(f"No Nasdaq {route} data for {ticker}: {last_error}")


def estimate_dividend_fields(rows: list[dict[str, Any]]) -> dict[str, Any]:
    parsed_rows = []
    today = date.today()
    for row in rows:
        ex_date = parse_date(row.get("exOrEffDate"))
        amount = parse_money(row.get("amount"))
        if ex_date and amount is not None:
            parsed_rows.append(
                {
                    "ex": ex_date,
                    "pay": parse_date(row.get("paymentDate")),
                    "amount": amount,
                }
            )

    if not parsed_rows:
        return {
            "lastExDate": None,
            "lastPaymentDate": None,
            "lastDividendValue": None,
            "nextExDate": None,
            "nextPaymentDate": None,
            "nextDividendValue": None,
        }

    parsed_rows.sort(key=lambda item: item["ex"], reverse=True)
    past_rows = [row for row in parsed_rows if datetime.fromisoformat(row["ex"]).date() <= today]
    future_rows = [row for row in parsed_rows if datetime.fromisoformat(row["ex"]).date() >= today]
    last = past_rows[0] if past_rows else parsed_rows[0]

    interval_days = None
    ex_dates = [datetime.fromisoformat(row["ex"]).date() for row in parsed_rows]
    intervals = [
        (current - previous).days
        for current, previous in zip(ex_dates, ex_dates[1:5])
        if (current - previous).days > 0
    ]
    if intervals:
        interval_days = int(round(sum(intervals) / len(intervals)))
    if not interval_days or interval_days <= 0:
        interval_days = 90

    payment_lag = None
    if last["pay"]:
        payment_lag = max(
            1,
            (
                datetime.fromisoformat(last["pay"]).date()
                - datetime.fromisoformat(last["ex"]).date()
            ).days,
        )
    if not payment_lag:
        payment_lag = 3

    next_official = future_rows[0] if future_rows else None
    if next_official:
        next_ex = datetime.fromisoformat(next_official["ex"]).date()
        next_pay = (
            datetime.fromisoformat(next_official["pay"]).date()
            if next_official["pay"]
            else next_ex + timedelta(days=payment_lag)
        )
        next_amount = next_official["amount"]
    else:
        next_ex = datetime.fromisoformat(last["ex"]).date()
        while next_ex < today:
            next_ex += timedelta(days=interval_days)
        next_pay = next_ex + timedelta(days=payment_lag)
        next_amount = last["amount"]

    return {
        "lastExDate": last["ex"],
        "lastPaymentDate": last["pay"],
        "lastDividendValue": last["amount"],
        "nextExDate": next_ex.isoformat(),
        "nextPaymentDate": next_pay.isoformat(),
        "nextDividendValue": next_amount,
    }


def empty_market_data() -> dict[str, Any]:
    return {
        "price": None,
        "lastExDate": None,
        "lastPaymentDate": None,
        "lastDividendValue": None,
        "nextExDate": None,
        "nextPaymentDate": None,
        "nextDividendValue": None,
    }


def fetch_market(ticker: str) -> dict[str, Any]:
    info = fetch_first_market_json(ticker, "info")
    try:
        dividends = fetch_first_market_json(ticker, "dividends")
        dividend_rows = dividends.get("data", {}).get("dividends", {}).get("rows", []) or []
    except Exception:
        dividend_rows = []

    price = parse_money(
        info.get("data", {})
        .get("primaryData", {})
        .get("lastSalePrice")
    )
    return {
        "price": price,
        **estimate_dividend_fields(dividend_rows),
    }


def build_manifest(max_workers: int) -> list[dict[str, Any]]:
    print("Fetching xStocks products...")
    xstocks = parse_xstocks()
    print(f"Found {len(xstocks)} xStocks products.")

    print("Fetching Ondo assets...")
    ondo = parse_ondo_assets(max_workers=max_workers)
    print(f"Found {len(ondo)} Ondo assets.")

    manifest = [
        asset
        for asset in [*xstocks, *ondo]
        if asset["underlyingSymbol"] not in EXCLUDED_UNDERLYINGS
    ]
    manifest.sort(key=lambda asset: (asset["platform"], asset["tokenSymbol"].lower()))
    return manifest


def build_dataset(manifest: list[dict[str, Any]], max_workers: int) -> list[dict[str, Any]]:
    tickers = sorted({asset["underlyingSymbol"] for asset in manifest})
    market_by_ticker: dict[str, dict[str, Any]] = {}
    completed = 0

    print(f"Fetching market data for {len(tickers)} tickers...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_market, ticker): ticker for ticker in tickers}
        for future in concurrent.futures.as_completed(futures):
            ticker = futures[future]
            try:
                market_by_ticker[ticker] = future.result()
            except Exception as error:
                print(f"Warning: no market data for {ticker}: {error}", file=sys.stderr)
                market_by_ticker[ticker] = empty_market_data()

            completed += 1
            if completed % 25 == 0 or completed == len(tickers):
                print(f"Processed {completed}/{len(tickers)} tickers.")

    dataset = []
    for asset in manifest:
        dataset.append(
            {
                **asset,
                **market_by_ticker.get(asset["underlyingSymbol"], empty_market_data()),
                "loading": False,
            }
        )
    return dataset


def update_index(dataset: list[dict[str, Any]]) -> None:
    generated_at = datetime.now().astimezone().strftime("%d/%m/%Y %H:%M")
    marker = '<script id="assets-data" type="application/json">'
    html_text = INDEX_PATH.read_text(encoding="utf-8-sig")
    html_text = html_text.replace("__UPDATED_AT__", generated_at)

    meta_marker = '<script id="dashboard-meta" type="application/json">'
    meta_json = json.dumps({"generatedAt": generated_at}, ensure_ascii=False)
    if meta_marker in html_text:
        meta_start = html_text.find(meta_marker)
        meta_start_content = meta_start + len(meta_marker)
        meta_end_content = html_text.find("</script>", meta_start_content)
        html_text = (
            html_text[:meta_start_content]
            + meta_json
            + html_text[meta_end_content:]
        )
    else:
        insert_at = html_text.find(marker)
        if insert_at == -1:
            raise RuntimeError("Could not find the assets-data script tag in index.html")
        html_text = (
            html_text[:insert_at]
            + f'<script id="dashboard-meta" type="application/json">{meta_json}</script>\n  '
            + html_text[insert_at:]
        )

    start = html_text.find(marker)
    if start == -1:
        raise RuntimeError("Could not find the assets-data script tag in index.html")
    start_content = start + len(marker)
    end_content = html_text.find("</script>", start_content)
    if end_content == -1:
        raise RuntimeError("Could not find the closing assets-data script tag in index.html")

    data_json = json.dumps(dataset, ensure_ascii=False, indent=2)
    updated = html_text[:start_content] + data_json + "\n" + html_text[end_content:]
    INDEX_PATH.write_text(updated, encoding="utf-8-sig")


def main() -> int:
    parser = argparse.ArgumentParser(description="Regenerate the tokenized stocks dashboard data.")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent requests. Default: 8.")
    parser.add_argument("--skip-manifest", action="store_true", help="Reuse assets-manifest.json and only refresh market data.")
    args = parser.parse_args()

    if args.skip_manifest:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        manifest = [
            asset
            for asset in manifest
            if asset["underlyingSymbol"] not in EXCLUDED_UNDERLYINGS
        ]
    else:
        manifest = build_manifest(max_workers=args.workers)
        MANIFEST_PATH.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {len(manifest)} assets to {MANIFEST_PATH.name}.")

    dataset = build_dataset(manifest, max_workers=args.workers)
    DATA_PATH.write_text(
        json.dumps(dataset, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    update_index(dataset)

    missing_prices = sum(1 for asset in dataset if asset.get("price") is None)
    print(f"Wrote {len(dataset)} assets to {DATA_PATH.name}.")
    print(f"Updated {INDEX_PATH.name}.")
    print(f"Assets without price: {missing_prices}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
