#!/usr/bin/env python3
"""Build a REAL multi-factor screen from public data and emit CSV + Excel.

This pulls real, public S&P 500 data hosted on GitHub (no paid APIs, no
network to Yahoo/Stooq which are blocked in this environment), maps it onto the
factor_screen schema, runs the real scoring engine, and writes:

  data/real_sp500_input.csv    -- the pulled + derived real metrics (audit trail)
  data/real_sp500_scores.csv   -- the ranked screen output
  data/real_sp500_scores.xlsx  -- the styled workbook

Sources (real data):
  - constituents-financials.csv : real Price/Earnings, Price/Book, EPS, EBITDA,
        Market Cap, sector for the S&P 500.
        github.com/datasets/s-and-p-500-companies-financials
  - all_stocks_5yr.csv : real daily OHLCV for the S&P 500, 2013-02-08..2018-02-07.
        github.com/plotly/datasets (the Kaggle "S&P 500 stock data" snapshot)

Both snapshots are contemporaneous (~early 2018), so the cross-section is
coherent. Momentum and Low Vol are therefore "as of" 2018-02-07 -- real, but a
historical snapshot, not live. See the README caveats.

Factor coverage from these free sources:
  Value     <- earnings_yield (1/PE), book_to_price (1/PB)        [real]
  Momentum  <- mom_12_1 from real daily prices                    [real]
  Quality   <- roe = EPS * PB / Price (real ROE proxy)            [real]
  Low Vol   <- vol_annual from real daily returns                 [real]
  Skin in Game : no free real source -> left blank (Coverage 4/5).
"""
from __future__ import annotations

import math
import os
import subprocess
import tempfile

import numpy as np
import pandas as pd

import factor_screen as fs

FIN_URL = ("https://raw.githubusercontent.com/datasets/"
           "s-and-p-500-companies-financials/master/data/constituents-financials.csv")
PRICES_URL = "https://raw.githubusercontent.com/plotly/datasets/master/all_stocks_5yr.csv"

AS_OF = "2018-02-07"  # last date in the price snapshot
DATA_DIR = "data"


def _fetch(url: str) -> pd.DataFrame:
    """Download with curl (robust for large files through the proxy) and parse.
    Retries with exponential backoff on transient failures."""
    print(f"  fetching {url}")
    tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
    tmp.close()
    last = None
    for attempt in range(4):
        try:
            subprocess.run(
                ["curl", "-sS", "--fail", "--retry", "3", "-m", "180", "-o", tmp.name, url],
                check=True, capture_output=True,
            )
            df = pd.read_csv(tmp.name)
            os.unlink(tmp.name)
            return df
        except Exception as exc:  # noqa: BLE001
            last = exc
            import time
            time.sleep(2 ** attempt)
    raise RuntimeError(f"failed to fetch {url}: {last}")


def momentum_and_vol(prices: pd.DataFrame) -> pd.DataFrame:
    """Compute real mom_12_1 (12m total return skipping the last ~month) and
    vol_annual (annualised stdev of daily returns over ~252d) per ticker."""
    prices = prices.sort_values(["Name", "date"])
    out = []
    for ticker, g in prices.groupby("Name"):
        close = g["close"].dropna().to_numpy()
        if len(close) < 273:
            continue
        # 12 months back (~252 td) to 1 month back (~21 td), skipping last month.
        mom = float(close[-22] / close[-253] - 1.0)
        rets = np.diff(close[-253:]) / close[-253:-1]
        vol = float(np.std(rets, ddof=1) * math.sqrt(252))
        out.append({"ticker": ticker, "mom_12_1": mom, "vol_annual": vol})
    return pd.DataFrame(out)


def build_input() -> pd.DataFrame:
    print("Pulling real S&P 500 data from public GitHub datasets...")
    fin = _fetch(FIN_URL)
    prices = _fetch(PRICES_URL)
    print(f"  financials: {len(fin)} names | prices: {prices['Name'].nunique()} tickers "
          f"({prices['date'].min()}..{prices['date'].max()})")

    fin = fin.rename(columns={"Symbol": "ticker", "Name": "name"})
    pe = pd.to_numeric(fin["Price/Earnings"], errors="coerce")
    pb = pd.to_numeric(fin["Price/Book"], errors="coerce")
    eps = pd.to_numeric(fin["Earnings/Share"], errors="coerce")
    price = pd.to_numeric(fin["Price"], errors="coerce")

    # Real ROE proxy: BookValuePerShare = Price / (Price/Book); ROE = EPS / BVPS
    #               = EPS * (Price/Book) / Price. Real EPS, real PB, real Price.
    with np.errstate(divide="ignore", invalid="ignore"):
        roe = eps * pb / price
    roe = roe.where(np.isfinite(roe) & (price > 0) & (pb > 0))

    base = pd.DataFrame({
        "ticker": fin["ticker"],
        "name": fin["name"],
        "region": "US",
        "pe": pe,
        "pb": pb,
        "roe": roe,
    })

    mv = momentum_and_vol(prices)
    merged = base.merge(mv, on="ticker", how="inner")  # keep names with both
    merged = merged.dropna(subset=["pe", "pb"], how="all").reset_index(drop=True)
    print(f"  merged real universe: {len(merged)} names with prices + fundamentals")
    return merged


def main() -> int:
    os.makedirs(DATA_DIR, exist_ok=True)
    real = build_input()

    input_csv = os.path.join(DATA_DIR, "real_sp500_input.csv")
    real.to_csv(input_csv, index=False)
    print(f"\nWrote real input metrics -> {input_csv}")

    scored = fs.score_universe(real, scale=10, rank_scope="region")

    scores_csv = os.path.join(DATA_DIR, "real_sp500_scores.csv")
    ranked = scored.sort_values("Total", ascending=False).reset_index(drop=True)
    ranked.insert(0, "Rank", np.arange(1, len(ranked) + 1))
    ranked.to_csv(scores_csv, index=False)
    print(f"Wrote ranked scores (CSV)   -> {scores_csv}")

    scores_xlsx = os.path.join(DATA_DIR, "real_sp500_scores.xlsx")
    fs.write_workbook(scored, scores_xlsx, scale=10)
    print(f"Wrote ranked scores (Excel) -> {scores_xlsx}")

    fs.print_coverage_report(scored)
    errors = fs.validate_formulas(scores_xlsx, scale=10)
    print(f"\nFormula validation: {len(errors)} errors")

    print(f"\nAs-of date for momentum/volatility: {AS_OF} (historical snapshot)")
    print("\nTop 15 by Total:")
    cols = ["Rank", "ticker", "name"] + fs.FACTOR_NAMES + ["Coverage", "Total"]
    print(ranked[cols].head(15).to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
