# Universe-scale multi-factor equity screen

`factor_screen.py` scores a large equity universe (target: ~5000 US + ~500
German + China + India) on five robust return premia and writes a styled Excel
workbook. Scoring is **algorithmic** — every factor becomes a real metric, is
ranked cross-sectionally, mapped to a 1..K integer scale, and summed. No
hand-scoring, so it scales to thousands of names.

> ⚠️ Read the **Caveats** below before trusting any rank. This is one filter,
> sized small — not a strategy.

## Install

```bash
pip install pandas numpy openpyxl pytest
# yfinance is optional and only needed for --source yfinance:
pip install yfinance
```

Python 3.11+. No paid dependencies. The `demo` and `csv` sources run with **no
network access**; `yfinance` is imported lazily so it never breaks the other
paths.

## Quick start

```bash
# Offline proof-of-scale: 6,300 synthetic names -> styled workbook
python factor_screen.py --source demo --counts US=5000,DE=500,CN=300,IN=500 \
    --out screen.xlsx

# Score your own universe (CSV or Excel — format chosen by extension)
python factor_screen.py --source csv --csv my_universe.csv --out screen.xlsx
python factor_screen.py --source csv --csv examples/sample_universe.xlsx --out screen.xlsx

# Live prices + fundamentals (local only, slow & rate-limited)
python factor_screen.py --source yfinance --tickers-file tickers.txt --out screen.xlsx
```

## A real, ranked screen (committed)

`build_real_screen.py` builds a screen from **real, public S&P 500 data** and
writes the results to `data/`:

| File | What |
|------|------|
| `data/real_sp500_input.csv`  | the pulled + derived real metrics (audit trail) |
| `data/real_sp500_scores.csv` | the ranked screen output |
| `data/real_sp500_scores.xlsx`| the styled workbook |

```bash
python build_real_screen.py
```

Sources (no paid APIs; live finance APIs like Yahoo/Stooq are blocked in this
environment, so data is pulled from public GitHub mirrors):

- **Fundamentals** — `datasets/s-and-p-500-companies-financials` → real
  Price/Earnings, Price/Book, EPS, Price for ~500 S&P 500 names.
- **Prices** — `plotly/datasets/all_stocks_5yr.csv` → real daily OHLCV,
  2013-02-08 … **2018-02-07** (the Kaggle "S&P 500 stock data" snapshot).

Real factor coverage (362 names with both prices and fundamentals):

| Factor | Real metric used |
|--------|------------------|
| Value     | earnings_yield (1/PE), book_to_price (1/PB) |
| Momentum  | mom_12_1 from real daily prices |
| Quality   | roe = EPS·PB/Price (real ROE proxy) |
| Low Vol   | vol_annual from real daily returns |
| Skin in Game | no free real source → left blank (**Coverage 4/5**) |

> The two snapshots are contemporaneous (~early 2018), so the cross-section is
> coherent — but momentum/volatility are **as of 2018-02-07**, real yet
> historical, not live. To screen *today*, supply a current CSV (or use
> `--source yfinance` where market APIs are reachable).

## The five factors

| Factor        | Raw metric(s) → direction                                                    |
|---------------|------------------------------------------------------------------------------|
| Value         | earnings_yield (1/PE) +1, book_to_price (1/PB) +1, ebit_ev_yield (1/EV_EBITDA) +1 |
| Momentum      | mom_12_1 +1 — 12m total return skipping the most recent month                |
| Quality       | roe +1, gp_assets (grossProfits/totalAssets) +1, debt_to_equity −1           |
| Low Vol       | vol_annual −1 — annualised stdev of daily returns (~252d)                    |
| Skin in Game  | insider_pct +1 — insider/founder/promoter ownership fraction, 0..1           |

Direction +1 means a higher raw value scores higher; the high-score end (K) is
always the academically favoured end. For Low Vol and the debt component of
Quality the metric is negated before ranking so "low is good" maps to a high
score.

## Scoring (the crux)

1. **Rank scope** — `region` (default; rank within each region so no market is
   uniformly "cheap") or `global`, via `--rank-scope`.
2. **Per component**, within scope: winsorize at the 1st/99th percentile, then
   compute a percentile rank in (0, 1]. Direction −1 negates first.
3. **Composite factors** (Value, Quality) average the percentile ranks of the
   components that have data. Missing components are **skipped, never imputed**.
4. **Map** the composite percentile `p` to an integer: `ceil(p * K)` clipped to
   `[1, K]`. `K` is set by `--scale` (default 10).
5. **Coverage** — per row, count how many of the five factors had at least one
   real component.
6. **Totals**
   - `Total` = equal-weight sum of the five factor scores (`min_count=1`).
   - `Total (cov-adj)` = `Total * 5 / Coverage` (normalises for missing factors).
   - `Weighted` = dot product of the five scores with an editable weight vector.

## CSV schema

Required columns: `ticker`, `name`, `region`.

Optional metric columns (use any subset — the engine scores what is present):

```
pe, pb, ev_ebitda            # vendor primitives; auto-derived into the yields
earnings_yield, book_to_price, ebit_ev_yield   # or supply the derived yields directly
mom_12_1
roe, gp_assets, debt_to_equity
vol_annual
insider_pct
```

If a primitive (`pe`/`pb`/`ev_ebitda`) is supplied instead of the derived yield,
the engine derives `earnings_yield = 1/PE` etc. with safe handling (only
positive, finite values survive; everything else becomes blank). A supplied
derived column always wins over its primitive. Factors with no usable column are
left blank and reduce Coverage.

The same schema works as an **Excel** file — `load_csv` picks CSV vs. Excel by
extension (`.xlsx`/`.xls`/`.xlsm` → Excel). A ready-made example with a mix of
regions, vendor primitives and deliberate blanks ships at
[`examples/sample_universe.xlsx`](examples/sample_universe.xlsx).

Example minimal CSV:

```csv
ticker,name,region,pe,roe
AAPL,Apple,US,30,1.5
SAP.DE,SAP,DE,25,0.18
```

## Output workbook

- **Scores** — sorted by Total descending. Columns: Rank, Ticker, Name, Region,
  the five factor scores, Coverage, Total, Total (cov-adj), Weighted.
  - `Coverage`, `Total`, `Total (cov-adj)`, `Weighted` are **live Excel
    formulas** (`COUNT`, `SUM`, `IF(...*5/Coverage)`, `SUMPRODUCT`) so hand-edits
    recalculate.
  - An **editable weights row** (row 1, blue font) feeds the Weighted column.
    Defaults to all 1s, so Weighted == Total until you change a weight.
  - Factor scores are integer values; missing factors are blank so `COUNT`/`SUM`
    ignore them.
  - 3-colour conditional scale on the factor block and on Total; frozen panes
    (headers + first four columns stay visible); autofilter on the header row;
    gridlines hidden.
- **Top 50** — the 50 highest Totals.
- **Region summary** — per region: count, mean of each factor score, mean Total,
  median Coverage.
- **Methodology** — the caveats below as readable notes.

Styling follows industry convention: blue font for inputs (the weights), black
for formulas and values, a dark header fill, Arial throughout.

### Zero formula errors

The workbook is written with `fullCalcOnLoad` so Excel/LibreOffice refresh on
open. To validate, the tool recalculates headless with LibreOffice when
available and asserts there are no error cells. When LibreOffice cannot load
files (some minimal/CI installs lack filter/type-detection), it falls back to
**formula-string validation**: every Total / Coverage / cov-adj / Weighted
formula is re-derived in Python from the written values and checked for
well-formedness and for any error condition (e.g. unguarded division by zero —
`Total (cov-adj)` is `IF`-guarded so it never divides by zero).

## CLI flags

```
--source {demo,csv,yfinance}   data adapter (default demo)
--csv PATH                     CSV for --source csv
--tickers-file PATH            newline-delimited tickers for --source yfinance
--counts US=5000,DE=500,...    demo sizing
--scale 10                     integer score scale K
--rank-scope {region,global}   cross-sectional ranking scope
--weights 1,1,1,1,1            five factor weights (Value,Momentum,Quality,LowVol,Skin)
--out PATH                     output .xlsx
--seed 42                      demo RNG seed
--no-recalc                    skip the formula/recalc validation step
```

A coverage report prints to stdout: percent with real data per factor, and
percent with full 5/5 coverage.

## Caveats (encoded in the Methodology sheet)

- **Filter `Coverage >= 4` before trusting a rank.** Thin data makes the raw
  Total misleading: a name scored on two factors is not comparable to one scored
  on five. Use `Total (cov-adj)` when comparing across uneven coverage.
- **Skin-in-the-Game is a weak proxy.** `insider_pct` does not isolate
  founder-CEOs, and high promoter holding in India/China can signal
  entrenchment, not alignment.
- **Momentum and Low Vol need current prices**, so the screen must be re-run
  live — do not treat a cached snapshot as current.
- **Anomaly premia decay materially post-publication** and most documented
  anomalies fail to replicate out of sample. At ~5000 names you are deep in
  illiquid micro-caps full of value traps. Treat this as one filter, sized
  small, not a strategy.
- **Mainland China A-shares are excluded by default** on governance grounds.
  "China" here means HK-listed plus ADRs, which carry their own VIE / political
  tail risk (not scored).

## Tests

```bash
pytest tests/test_factor_screen.py -q
```

Covers: the scoring math on a hand-built fixture (direction flips, composite
averaging, ceil endpoints, coverage counting, derivation), region-neutral
ranking, the demo-at-scale workbook (sheets, row counts, zero formula errors),
CSV subset ingestion, and that `--weights` changes Weighted but not Total.

## yfinance adapter (local only)

`--source yfinance` bulk-downloads 14 months of prices (`yf.download`), derives
`mom_12_1` (12m return skipping the latest ~21 trading days) and `vol_annual`
(annualised daily-return stdev), and fetches fundamentals via a threaded,
on-disk-cached, resumable `Ticker.get_info()` (`trailingPE`, `priceToBook`,
`enterpriseToEbitda`, `returnOnEquity`, `grossProfits`/`totalAssets`,
`debtToEquity`, `heldPercentInsiders`). Expect this to be slow and rate-limited
at thousands of names. For yfinance ticker suffixes: `.DE` (Xetra), `.HK` (Hong
Kong), `.NS` (NSE India).
