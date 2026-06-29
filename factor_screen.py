#!/usr/bin/env python3
"""Universe-scale multi-factor equity screen.

Scores a large equity universe on five robust return premia (Value, Momentum,
Quality, Low Vol, Skin in Game), ranks each factor cross-sectionally, maps to a
1..K integer scale, and writes a styled Excel workbook with live formulas.

Scoring is algorithmic (no hand-scoring): every factor becomes a real metric,
is winsorized + percentile-ranked within a scope (region or global), composite
factors average their available components, and the percentile is mapped to an
integer score via ceil(p * K).

Run `python factor_screen.py --help` for the CLI. The `demo` and `csv` sources
require no network access; `yfinance` is imported lazily and only used for the
optional live source.
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from typing import Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------- #
# Factor definitions (exact, do not substitute).
# Each factor maps to one or more (metric, direction) components. Direction +1
# means a higher raw value earns a higher score; the high score end (K) is
# always the academically favoured end.
# --------------------------------------------------------------------------- #
FACTORS: "Dict[str, List[tuple]]" = {
    "Value": [
        ("earnings_yield", +1),   # 1 / PE
        ("book_to_price", +1),    # 1 / PB
        ("ebit_ev_yield", +1),    # 1 / EV_EBITDA
    ],
    "Momentum": [
        ("mom_12_1", +1),         # 12m total return, skipping the latest month
    ],
    "Quality": [
        ("roe", +1),
        ("gp_assets", +1),        # grossProfits / totalAssets
        ("debt_to_equity", -1),   # lower leverage is better
    ],
    "Low Vol": [
        ("vol_annual", -1),       # annualised stdev of daily returns
    ],
    "Skin in Game": [
        ("insider_pct", +1),      # insider / founder / promoter ownership, 0..1
    ],
}

FACTOR_NAMES: List[str] = list(FACTORS.keys())

# Vendor primitives that can stand in for the three Value yields.
DERIVATIONS = {
    "earnings_yield": "pe",
    "book_to_price": "pb",
    "ebit_ev_yield": "ev_ebitda",
}

# Every metric column the engine knows how to consume from a CSV.
ALL_METRIC_COLUMNS = [
    "pe", "pb", "ev_ebitda",
    "earnings_yield", "book_to_price", "ebit_ev_yield",
    "mom_12_1", "roe", "gp_assets", "debt_to_equity", "vol_annual", "insider_pct",
]

DEFAULT_REGIONS = ["US", "DE", "CN", "IN"]


# --------------------------------------------------------------------------- #
# Metric derivation
# --------------------------------------------------------------------------- #
def _safe_inverse(s: pd.Series) -> pd.Series:
    """1 / x with safe handling: only positive, finite values survive."""
    s = pd.to_numeric(s, errors="coerce").astype(float)
    out = 1.0 / s.replace(0, np.nan)
    out = out.where(np.isfinite(out))
    out = out.where(s > 0)
    return out


def derive_metrics(df: pd.DataFrame) -> pd.DataFrame:
    """Derive earnings_yield / book_to_price / ebit_ev_yield from vendor
    primitives (pe, pb, ev_ebitda) when the derived column is not already
    supplied. The supplied derived column always wins."""
    df = df.copy()
    for derived, primitive in DERIVATIONS.items():
        if derived not in df.columns and primitive in df.columns:
            df[derived] = _safe_inverse(df[primitive])
    return df


# --------------------------------------------------------------------------- #
# Cross-sectional ranking
# --------------------------------------------------------------------------- #
def _winsorize(s: pd.Series, lower: float = 0.01, upper: float = 0.99) -> pd.Series:
    """Clip to the [lower, upper] quantiles (ignoring NaN)."""
    if s.notna().sum() == 0:
        return s
    lo = s.quantile(lower)
    hi = s.quantile(upper)
    return s.clip(lower=lo, upper=hi)


def component_percentile(values: pd.Series, direction: int, scope: pd.Series) -> pd.Series:
    """Winsorize at 1st/99th pct, then percentile-rank in (0, 1] within each
    scope group. Direction -1 negates first, so "low is good" maps to a high
    percentile. NaN inputs stay NaN (missing data is never imputed)."""
    s = pd.to_numeric(values, errors="coerce").astype(float)
    if direction < 0:
        s = -s
    out = pd.Series(np.nan, index=s.index, dtype=float)
    for _key, idx in s.groupby(scope, dropna=False).groups.items():
        g = s.loc[idx]
        if g.notna().sum() == 0:
            continue
        gw = _winsorize(g)
        out.loc[idx] = gw.rank(pct=True, method="average")
    return out


def score_from_percentile(p: float, scale: int) -> Optional[int]:
    """Map a composite percentile in (0, 1] to an integer score in [1, K]."""
    if p is None or (isinstance(p, float) and math.isnan(p)):
        return None
    return int(min(max(math.ceil(p * scale), 1), scale))


# --------------------------------------------------------------------------- #
# Scoring engine
# --------------------------------------------------------------------------- #
def score_universe(
    df: pd.DataFrame,
    scale: int = 10,
    rank_scope: str = "region",
    weights: Optional[Sequence[float]] = None,
) -> pd.DataFrame:
    """Score every name on the five factors.

    Returns a DataFrame with: ticker, name, region, the five factor scores,
    Coverage, Total, Total (cov-adj) and Weighted. Factor scores are integers
    in [1, K] or NaN when the factor had no real component.
    """
    if weights is None:
        weights = [1.0] * len(FACTOR_NAMES)
    weights = np.asarray(weights, dtype=float)
    if weights.shape[0] != len(FACTOR_NAMES):
        raise ValueError(f"weights must have {len(FACTOR_NAMES)} entries")

    df = derive_metrics(df).reset_index(drop=True)

    for required in ("ticker", "name", "region"):
        if required not in df.columns:
            raise ValueError(f"missing required column: {required}")

    if rank_scope == "global":
        scope = pd.Series("__global__", index=df.index)
    elif rank_scope == "region":
        scope = df["region"].astype(object)
    else:
        raise ValueError("rank_scope must be 'region' or 'global'")

    factor_scores: Dict[str, pd.Series] = {}
    for factor, comps in FACTORS.items():
        comp_pcts = []
        for metric, direction in comps:
            if metric in df.columns:
                comp_pcts.append(component_percentile(df[metric], direction, scope))
        if comp_pcts:
            mat = pd.concat(comp_pcts, axis=1)
            # Average only the components that have data; NaN if all missing.
            avg = mat.mean(axis=1, skipna=True)
            score = avg.map(lambda p: score_from_percentile(p, scale))
            factor_scores[factor] = pd.to_numeric(score, errors="coerce")
        else:
            factor_scores[factor] = pd.Series(np.nan, index=df.index, dtype=float)

    fs = pd.DataFrame(factor_scores, columns=FACTOR_NAMES)

    coverage = fs.notna().sum(axis=1).astype(int)
    total = fs.sum(axis=1, min_count=1)
    cov_adj = total * len(FACTOR_NAMES) / coverage.replace(0, np.nan)

    wmat = fs.values * weights  # NaN where a factor score is missing
    weighted = np.nansum(wmat, axis=1)
    weighted[np.all(np.isnan(wmat), axis=1)] = np.nan

    out = pd.DataFrame(
        {
            "ticker": df["ticker"].values,
            "name": df["name"].values,
            "region": df["region"].values,
        }
    )
    for f in FACTOR_NAMES:
        out[f] = fs[f].values
    out["Coverage"] = coverage.values
    out["Total"] = total.values
    out["Total (cov-adj)"] = cov_adj.values
    out["Weighted"] = weighted
    return out


# --------------------------------------------------------------------------- #
# Coverage report
# --------------------------------------------------------------------------- #
def coverage_report(scored: pd.DataFrame) -> Dict[str, float]:
    """Percent of rows with real data per factor, and percent with full 5/5."""
    n = len(scored)
    report: Dict[str, float] = {}
    if n == 0:
        return report
    for f in FACTOR_NAMES:
        report[f] = 100.0 * scored[f].notna().sum() / n
    report["full_5_5"] = 100.0 * (scored["Coverage"] == len(FACTOR_NAMES)).sum() / n
    return report


def print_coverage_report(scored: pd.DataFrame) -> None:
    rep = coverage_report(scored)
    print(f"\nCoverage report ({len(scored)} names):")
    for f in FACTOR_NAMES:
        print(f"  {f:<14} {rep.get(f, 0.0):5.1f}% with real data")
    print(f"  {'Full 5/5':<14} {rep.get('full_5_5', 0.0):5.1f}% with all five factors")


# --------------------------------------------------------------------------- #
# Adapters
# --------------------------------------------------------------------------- #
_REGION_FLAVORS = {
    # mean levels per region; "ins" = insider/promoter ownership fraction.
    "US": dict(pe=22, pb=4.0, ev_ebitda=14, mom=0.09, roe=0.16, gp=0.32, de=0.8, vol=0.30, ins=0.06),
    "DE": dict(pe=16, pb=2.2, ev_ebitda=9, mom=0.04, roe=0.11, gp=0.24, de=1.1, vol=0.28, ins=0.18),
    "CN": dict(pe=14, pb=1.8, ev_ebitda=8, mom=0.05, roe=0.12, gp=0.22, de=0.9, vol=0.40, ins=0.45),
    "IN": dict(pe=26, pb=3.5, ev_ebitda=16, mom=0.11, roe=0.18, gp=0.28, de=0.7, vol=0.34, ins=0.52),
}


def make_demo(counts: Dict[str, int], seed: int = 42, missing: float = 0.10) -> pd.DataFrame:
    """Synthetic, region-flavoured universe with deliberately missing cells.

    Provides vendor primitives (pe, pb, ev_ebitda) plus the remaining metrics so
    the derivation path is exercised. About `missing` fraction of metric cells
    are blanked to create varied coverage.
    """
    rng = np.random.default_rng(seed)
    frames = []
    for region, n in counts.items():
        if n <= 0:
            continue
        fl = _REGION_FLAVORS.get(region, _REGION_FLAVORS["US"])
        idx = np.arange(n)
        data = {
            "ticker": [f"{region}{i:05d}" for i in idx],
            "name": [f"{region} Company {i}" for i in idx],
            "region": region,
            "pe": np.abs(rng.lognormal(np.log(fl["pe"]), 0.5, n)),
            "pb": np.abs(rng.lognormal(np.log(fl["pb"]), 0.5, n)),
            "ev_ebitda": np.abs(rng.lognormal(np.log(fl["ev_ebitda"]), 0.5, n)),
            "mom_12_1": rng.normal(fl["mom"], 0.30, n),
            "roe": rng.normal(fl["roe"], 0.12, n),
            "gp_assets": np.clip(rng.normal(fl["gp"], 0.12, n), 0.0, None),
            "debt_to_equity": np.clip(rng.normal(fl["de"], 0.6, n), 0.0, None),
            "vol_annual": np.clip(rng.normal(fl["vol"], 0.10, n), 0.05, None),
            "insider_pct": np.clip(rng.normal(fl["ins"], 0.12, n), 0.0, 1.0),
        }
        frame = pd.DataFrame(data)
        # Blank out random metric cells to create realistic missing coverage.
        for col in ALL_METRIC_COLUMNS:
            if col in frame.columns:
                mask = rng.random(n) < missing
                frame.loc[mask, col] = np.nan
        frames.append(frame)
    if not frames:
        return pd.DataFrame(columns=["ticker", "name", "region"])
    return pd.concat(frames, ignore_index=True)


def load_csv(path: str) -> pd.DataFrame:
    """Load a user CSV. Required: ticker, name, region. Any subset of the
    optional metric columns is used; unknown columns are ignored."""
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    for required in ("ticker", "name", "region"):
        if required not in df.columns:
            raise ValueError(f"CSV missing required column: {required}")
    keep = ["ticker", "name", "region"] + [c for c in ALL_METRIC_COLUMNS if c in df.columns]
    return df[keep].copy()


def load_yfinance(tickers: Sequence[str], regions: Optional[Dict[str, str]] = None,
                  cache_dir: str = ".yf_cache", workers: int = 8) -> pd.DataFrame:
    """Live source (local only). Imported lazily so the demo/csv paths never
    require yfinance to be installed. Bulk-downloads prices to derive mom_12_1
    and vol_annual, then fetches fundamentals via a threaded, on-disk-cached,
    resumable Ticker.get_info()."""
    import json
    import time
    from concurrent.futures import ThreadPoolExecutor

    try:
        import yfinance as yf  # noqa: F401  (lazy)
    except ImportError as exc:  # pragma: no cover - network/local only
        raise RuntimeError(
            "yfinance is not installed; install it for --source yfinance, "
            "or use --source demo/csv which need no network."
        ) from exc

    regions = regions or {}
    os.makedirs(cache_dir, exist_ok=True)

    # --- prices -> momentum + volatility ---
    prices = yf.download(list(tickers), period="14mo", auto_adjust=True,
                         progress=False, threads=True)
    close = prices["Close"] if "Close" in prices else prices
    mom, vol = {}, {}
    for t in tickers:
        try:
            s = close[t].dropna()
        except Exception:
            continue
        if len(s) < 260:
            continue
        # 12m return skipping the most recent month (~21 trading days).
        mom[t] = float(s.iloc[-22] / s.iloc[-253] - 1.0)
        rets = s.pct_change().dropna().iloc[-252:]
        vol[t] = float(rets.std() * math.sqrt(252))

    # --- fundamentals (threaded, cached, resumable) ---
    def fetch_info(t):
        cache_file = os.path.join(cache_dir, f"{t.replace('/', '_')}.json")
        if os.path.exists(cache_file):
            try:
                with open(cache_file) as fh:
                    return t, json.load(fh)
            except Exception:
                pass
        info = {}
        for attempt in range(3):
            try:
                info = yf.Ticker(t).get_info() or {}
                break
            except Exception:
                time.sleep(1.5 * (attempt + 1))
        try:
            with open(cache_file, "w") as fh:
                json.dump(info, fh)
        except Exception:
            pass
        return t, info

    infos = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for t, info in ex.map(fetch_info, tickers):
            infos[t] = info

    rows = []
    for t in tickers:
        info = infos.get(t, {}) or {}
        gp = info.get("grossProfits")
        ta = info.get("totalAssets")
        gp_assets = (gp / ta) if (gp and ta) else np.nan
        de = info.get("debtToEquity")
        rows.append({
            "ticker": t,
            "name": info.get("shortName") or info.get("longName") or t,
            "region": regions.get(t, "US"),
            "pe": info.get("trailingPE"),
            "pb": info.get("priceToBook"),
            "ev_ebitda": info.get("enterpriseToEbitda"),
            "mom_12_1": mom.get(t, np.nan),
            "roe": info.get("returnOnEquity"),
            "gp_assets": gp_assets,
            # yfinance reports debtToEquity as a percentage.
            "debt_to_equity": (de / 100.0) if de is not None else np.nan,
            "vol_annual": vol.get(t, np.nan),
            "insider_pct": info.get("heldPercentInsiders"),
        })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# Excel workbook
# --------------------------------------------------------------------------- #
_METHODOLOGY_NOTES = [
    "Multi-factor equity screen — methodology & caveats",
    "",
    "Scoring is algorithmic: each factor becomes a real metric, is winsorized at the",
    "1st/99th percentile, percentile-ranked within the chosen scope (region by default,",
    "or global), and the composite percentile p is mapped to an integer score via",
    "ceil(p * K), clipped to [1, K]. Composite factors (Value, Quality) average the",
    "percentile ranks of whichever components have data; missing components are skipped,",
    "never imputed.",
    "",
    "How to read the Scores sheet:",
    " - Total, Total (cov-adj), Weighted and Coverage are LIVE Excel formulas. Edit any",
    "   factor score (or the blue weights row) and the workbook recalculates.",
    " - Weighted = SUMPRODUCT of the five factor scores with the editable weights row.",
    " - Total (cov-adj) = Total * 5 / Coverage, to normalise for missing factors.",
    "",
    "Caveats:",
    " 1. Filter Coverage >= 4 before trusting a rank. Thin data makes the raw Total",
    "    misleading: a name scored on two factors is not comparable to one scored on five.",
    " 2. Skin-in-the-Game is a weak proxy. insider_pct does not isolate founder-CEOs, and",
    "    high promoter holding in India/China can signal entrenchment, not alignment.",
    " 3. Momentum and Low Vol depend on current prices, so the screen must be re-run live.",
    "    Do not treat a cached snapshot as current.",
    " 4. Anomaly premia decay materially post-publication, and most documented anomalies",
    "    fail to replicate out of sample. At ~5000 names you are deep in illiquid micro-caps",
    "    full of value traps. Treat this as ONE filter, sized small, not a strategy.",
    " 5. Mainland China A-shares are excluded by default on governance grounds. 'China' here",
    "    means HK-listed names plus ADRs, which carry their own VIE / political tail risk",
    "    (not scored here).",
]


def write_workbook(scored: pd.DataFrame, path: str, scale: int = 10,
                   weights: Optional[Sequence[float]] = None) -> str:
    """Write the styled .xlsx workbook (Scores, Top 50, Region summary,
    Methodology). Total / Total (cov-adj) / Weighted / Coverage are written as
    live Excel formulas so hand-edits recalculate."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.formatting.rule import ColorScaleRule
    from openpyxl.utils import get_column_letter

    if weights is None:
        weights = [1.0] * len(FACTOR_NAMES)

    ARIAL = "Arial"
    HEADER_FILL = PatternFill("solid", fgColor="1F3864")
    HEADER_FONT = Font(name=ARIAL, bold=True, color="FFFFFF")
    INPUT_FONT = Font(name=ARIAL, bold=True, color="0000FF")   # blue = inputs
    VALUE_FONT = Font(name=ARIAL, color="000000")
    BOLD_FONT = Font(name=ARIAL, bold=True, color="000000")
    CENTER = Alignment(horizontal="center")

    scored = scored.sort_values("Total", ascending=False, na_position="last").reset_index(drop=True)

    wb = Workbook()

    # ---- Scores sheet -----------------------------------------------------
    ws = wb.active
    ws.title = "Scores"
    ws.sheet_view.showGridLines = False

    headers = (["Rank", "Ticker", "Name", "Region"] + FACTOR_NAMES
               + ["Coverage", "Total", "Total (cov-adj)", "Weighted"])
    n_factor = len(FACTOR_NAMES)
    # Column map: A Rank, B Ticker, C Name, D Region, E..(E+nf-1) factors,
    # then Coverage, Total, Total (cov-adj), Weighted.
    first_factor_col = 5                       # E
    last_factor_col = first_factor_col + n_factor - 1
    cov_col = last_factor_col + 1
    total_col = cov_col + 1
    covadj_col = total_col + 1
    weighted_col = covadj_col + 1
    fL = get_column_letter(first_factor_col)
    lL = get_column_letter(last_factor_col)

    HEADER_ROW = 2
    DATA_START = 3

    # Editable weights row (row 1), sitting above the factor headers.
    ws.cell(row=1, column=4, value="Weights").font = BOLD_FONT
    for j, w in enumerate(weights):
        c = ws.cell(row=1, column=first_factor_col + j, value=float(w))
        c.font = INPUT_FONT
        c.alignment = CENTER

    # Header row.
    for col, name in enumerate(headers, start=1):
        c = ws.cell(row=HEADER_ROW, column=col, value=name)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = CENTER

    # Data rows.
    for i, rd in enumerate(scored.to_dict("records"), start=0):
        r = DATA_START + i
        ws.cell(row=r, column=1, value=i + 1).font = VALUE_FONT          # Rank
        ws.cell(row=r, column=2, value=rd["ticker"]).font = VALUE_FONT
        ws.cell(row=r, column=3, value=rd["name"]).font = VALUE_FONT
        ws.cell(row=r, column=4, value=rd["region"]).font = VALUE_FONT
        for j, f in enumerate(FACTOR_NAMES):
            val = rd[f]
            cell = ws.cell(row=r, column=first_factor_col + j)
            if pd.notna(val):
                cell.value = int(val)
            cell.font = VALUE_FONT
            cell.number_format = "0"
            cell.alignment = CENTER
        # Live formulas.
        cov = ws.cell(row=r, column=cov_col, value=f"=COUNT({fL}{r}:{lL}{r})")
        cov.font = VALUE_FONT
        cov.alignment = CENTER
        tot = ws.cell(row=r, column=total_col, value=f"=SUM({fL}{r}:{lL}{r})")
        tot.font = BOLD_FONT
        tot.alignment = CENTER
        covL = get_column_letter(cov_col)
        totL = get_column_letter(total_col)
        adj = ws.cell(
            row=r, column=covadj_col,
            value=f'=IF({covL}{r}=0,"",{totL}{r}*{n_factor}/{covL}{r})',
        )
        adj.font = VALUE_FONT
        adj.number_format = "0.00"
        adj.alignment = CENTER
        wgt = ws.cell(
            row=r, column=weighted_col,
            value=f"=SUMPRODUCT(${fL}$1:${lL}$1,{fL}{r}:{lL}{r})",
        )
        wgt.font = VALUE_FONT
        wgt.number_format = "0.00"
        wgt.alignment = CENTER

    last_row = DATA_START + len(scored) - 1
    if len(scored) == 0:
        last_row = DATA_START

    # Conditional 3-colour scales on the factor block and on Total.
    scale_rule = lambda: ColorScaleRule(
        start_type="num", start_value=1, start_color="F8696B",
        mid_type="num", mid_value=(scale + 1) / 2, mid_color="FFEB84",
        end_type="num", end_value=scale, end_color="63BE7B",
    )
    ws.conditional_formatting.add(f"{fL}{DATA_START}:{lL}{last_row}", scale_rule())
    totL = get_column_letter(total_col)
    ws.conditional_formatting.add(
        f"{totL}{DATA_START}:{totL}{last_row}",
        ColorScaleRule(start_type="min", start_color="F8696B",
                       mid_type="percentile", mid_value=50, mid_color="FFEB84",
                       end_type="max", end_color="63BE7B"),
    )

    # Freeze headers + first 4 columns; autofilter; column widths.
    ws.freeze_panes = f"{get_column_letter(first_factor_col)}{DATA_START}"
    ws.auto_filter.ref = f"A{HEADER_ROW}:{get_column_letter(weighted_col)}{max(last_row, HEADER_ROW)}"
    widths = {1: 6, 2: 12, 3: 26, 4: 8}
    for col in range(first_factor_col, weighted_col + 1):
        widths[col] = 15
    for col, w in widths.items():
        ws.column_dimensions[get_column_letter(col)].width = w

    # ---- Top 50 sheet -----------------------------------------------------
    top = scored.head(50).reset_index(drop=True)
    ws2 = wb.create_sheet("Top 50")
    ws2.sheet_view.showGridLines = False
    for col, name in enumerate(headers, start=1):
        c = ws2.cell(row=1, column=col, value=name)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = CENTER
    for i, rd in enumerate(top.to_dict("records"), start=0):
        r = 2 + i
        ws2.cell(row=r, column=1, value=i + 1).font = VALUE_FONT
        ws2.cell(row=r, column=2, value=rd["ticker"]).font = VALUE_FONT
        ws2.cell(row=r, column=3, value=rd["name"]).font = VALUE_FONT
        ws2.cell(row=r, column=4, value=rd["region"]).font = VALUE_FONT
        for j, f in enumerate(FACTOR_NAMES):
            val = rd[f]
            c = ws2.cell(row=r, column=first_factor_col + j)
            if pd.notna(val):
                c.value = int(val)
            c.font = VALUE_FONT
            c.alignment = CENTER
        ws2.cell(row=r, column=cov_col, value=int(rd["Coverage"])).font = VALUE_FONT
        tval = rd["Total"]
        ws2.cell(row=r, column=total_col,
                 value=(float(tval) if pd.notna(tval) else None)).font = BOLD_FONT
        aval = rd["Total (cov-adj)"]
        ca = ws2.cell(row=r, column=covadj_col,
                      value=(round(float(aval), 2) if pd.notna(aval) else None))
        ca.number_format = "0.00"
        wval = rd["Weighted"]
        wc = ws2.cell(row=r, column=weighted_col,
                      value=(round(float(wval), 2) if pd.notna(wval) else None))
        wc.number_format = "0.00"
    for col, w in widths.items():
        ws2.column_dimensions[get_column_letter(col)].width = w
    ws2.freeze_panes = "A2"

    # ---- Region summary sheet --------------------------------------------
    ws3 = wb.create_sheet("Region summary")
    ws3.sheet_view.showGridLines = False
    sum_headers = ["Region", "Count"] + [f"Mean {f}" for f in FACTOR_NAMES] + \
                  ["Mean Total", "Median Coverage"]
    for col, name in enumerate(sum_headers, start=1):
        c = ws3.cell(row=1, column=col, value=name)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = CENTER
    rr = 2
    for region, g in scored.groupby("region"):
        ws3.cell(row=rr, column=1, value=region).font = VALUE_FONT
        ws3.cell(row=rr, column=2, value=int(len(g))).font = VALUE_FONT
        for j, f in enumerate(FACTOR_NAMES):
            m = g[f].mean()
            c = ws3.cell(row=rr, column=3 + j,
                         value=(round(float(m), 2) if pd.notna(m) else None))
            c.number_format = "0.00"
            c.font = VALUE_FONT
        mt = g["Total"].mean()
        c = ws3.cell(row=rr, column=3 + n_factor,
                     value=(round(float(mt), 2) if pd.notna(mt) else None))
        c.number_format = "0.00"
        c.font = VALUE_FONT
        mc = g["Coverage"].median()
        ws3.cell(row=rr, column=4 + n_factor,
                 value=(float(mc) if pd.notna(mc) else None)).font = VALUE_FONT
        rr += 1
    for col in range(1, len(sum_headers) + 1):
        ws3.column_dimensions[get_column_letter(col)].width = 15

    # ---- Methodology sheet ------------------------------------------------
    ws4 = wb.create_sheet("Methodology")
    ws4.sheet_view.showGridLines = False
    for i, line in enumerate(_METHODOLOGY_NOTES, start=1):
        c = ws4.cell(row=i, column=1, value=line)
        c.font = BOLD_FONT if i == 1 else VALUE_FONT
    ws4.column_dimensions["A"].width = 95

    # Recalculate on load so Excel/LibreOffice refresh the formulas.
    wb.calculation.fullCalcOnLoad = True

    wb.save(path)
    return path


# --------------------------------------------------------------------------- #
# LibreOffice headless recalc validation
# --------------------------------------------------------------------------- #
def libreoffice_available() -> bool:
    from shutil import which
    return which("soffice") is not None or which("libreoffice") is not None


def recalc_with_libreoffice(path: str, timeout: int = 180) -> str:
    """Recalculate the workbook headless with LibreOffice (which honours
    fullCalcOnLoad) and return the path to a recalculated .xlsx whose formula
    cells now carry cached results. Raises if LibreOffice is unavailable."""
    import subprocess
    import tempfile
    from shutil import which

    soffice = which("soffice") or which("libreoffice")
    if soffice is None:
        raise RuntimeError("LibreOffice not available")

    outdir = tempfile.mkdtemp(prefix="lorecalc_")
    profile = tempfile.mkdtemp(prefix="loprofile_")
    cmd = [
        soffice, "--headless", "--norestore", "--invisible", "--nologo",
        f"-env:UserInstallation=file://{profile}",
        "--convert-to", "xlsx:Calc MS Excel 2007 XML",
        "--outdir", outdir, os.path.abspath(path),
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=timeout)
    base = os.path.splitext(os.path.basename(path))[0] + ".xlsx"
    recalced = os.path.join(outdir, base)
    if not os.path.exists(recalced):
        raise RuntimeError(f"LibreOffice did not produce {recalced}")
    return recalced


def validate_formulas(path: str, scale: int = 10) -> List[str]:
    """Formula-string validation fallback for when LibreOffice cannot recalc.

    Parses the Scores sheet's formula cells, recomputes each (COUNT, SUM,
    Total cov-adj, SUMPRODUCT) in Python from the written factor values and the
    weights row, and confirms none would raise an Excel error (e.g. no
    unguarded division by zero) and that the formula strings have the expected
    shape. Returns a list of problems ([] means clean)."""
    from openpyxl import load_workbook

    wb = load_workbook(path)
    ws = wb["Scores"]
    n_factor = len(FACTOR_NAMES)
    first = 5
    last = first + n_factor - 1
    cov_col = last + 1
    total_col = cov_col + 1
    covadj_col = total_col + 1
    weighted_col = covadj_col + 1

    weights = [ws.cell(row=1, column=first + j).value for j in range(n_factor)]
    if any(w is None for w in weights):
        return ["weights row contains a blank cell"]

    problems: List[str] = []
    for r in range(3, ws.max_row + 1):
        factors = []
        for j in range(n_factor):
            v = ws.cell(row=r, column=first + j).value
            if v is not None and not (isinstance(v, (int, float)) and 1 <= v <= scale):
                problems.append(f"row {r} factor value out of range: {v!r}")
            factors.append(v)

        cov_f = ws.cell(row=r, column=cov_col).value
        tot_f = ws.cell(row=r, column=total_col).value
        adj_f = ws.cell(row=r, column=covadj_col).value
        wgt_f = ws.cell(row=r, column=weighted_col).value

        # Formula strings must have the expected shape.
        for got, needle in ((cov_f, "COUNT("), (tot_f, "SUM("),
                            (adj_f, "IF("), (wgt_f, "SUMPRODUCT(")):
            if not (isinstance(got, str) and got.startswith("=") and needle in got):
                problems.append(f"row {r} unexpected formula: {got!r}")

        # Recompute the results to prove no error would be produced.
        present = [f for f in factors if isinstance(f, (int, float))]
        count = len(present)
        total = sum(present) if present else None
        # cov-adj is guarded by IF(count=0,"",...) so it never divides by zero.
        if count > 0:
            _ = total * n_factor / count  # must not raise
        weighted = sum((f if isinstance(f, (int, float)) else 0) * w
                       for f, w in zip(factors, weights))
        if not math.isfinite(weighted):
            problems.append(f"row {r} non-finite Weighted")
    return problems


def find_error_cells(path: str) -> List[str]:
    """Return a list of "Sheet!A1=#ERR" descriptions for any Excel error cells.
    Reads cached formula results (data_only=True)."""
    from openpyxl import load_workbook

    err_tokens = {"#DIV/0!", "#N/A", "#NAME?", "#NULL!", "#NUM!", "#REF!", "#VALUE!", "#ERROR!"}
    wb = load_workbook(path, data_only=True)
    errors = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                if isinstance(v, str) and v.strip() in err_tokens:
                    errors.append(f"{ws.title}!{cell.coordinate}={v}")
    return errors


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def parse_counts(s: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        region, _, n = part.partition("=")
        counts[region.strip()] = int(n)
    return counts


def parse_weights(s: str) -> List[float]:
    vals = [float(x) for x in s.split(",") if x.strip() != ""]
    if len(vals) != len(FACTOR_NAMES):
        raise argparse.ArgumentTypeError(
            f"--weights needs {len(FACTOR_NAMES)} comma-separated numbers")
    return vals


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Universe-scale multi-factor equity screen.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--source", choices=["demo", "csv", "yfinance"], default="demo")
    p.add_argument("--csv", help="CSV path for --source csv")
    p.add_argument("--tickers-file", help="newline-delimited tickers for --source yfinance")
    p.add_argument("--counts", default="US=5000,DE=500,CN=300,IN=500",
                   help="demo sizing, e.g. US=5000,DE=500,CN=300,IN=500")
    p.add_argument("--scale", type=int, default=10, help="integer score scale K")
    p.add_argument("--rank-scope", choices=["region", "global"], default="region")
    p.add_argument("--weights", type=parse_weights, default=[1.0] * len(FACTOR_NAMES),
                   help="five comma-separated factor weights")
    p.add_argument("--out", default="factor_screen.xlsx", help="output .xlsx path")
    p.add_argument("--seed", type=int, default=42, help="demo RNG seed")
    p.add_argument("--no-recalc", action="store_true",
                   help="skip the LibreOffice recalc validation")
    return p


def load_source(args) -> pd.DataFrame:
    if args.source == "demo":
        return make_demo(parse_counts(args.counts), seed=args.seed)
    if args.source == "csv":
        if not args.csv:
            raise SystemExit("--source csv requires --csv PATH")
        return load_csv(args.csv)
    if args.source == "yfinance":
        if not args.tickers_file:
            raise SystemExit("--source yfinance requires --tickers-file PATH")
        with open(args.tickers_file) as fh:
            tickers = [t.strip() for t in fh if t.strip()]
        return load_yfinance(tickers)
    raise SystemExit(f"unknown source: {args.source}")


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    df = load_source(args)
    if len(df) == 0:
        raise SystemExit("no rows loaded from source")

    scored = score_universe(df, scale=args.scale,
                            rank_scope=args.rank_scope, weights=args.weights)
    write_workbook(scored, args.out, scale=args.scale, weights=args.weights)

    print(f"Scored {len(scored)} names -> {args.out}")
    print_coverage_report(scored)

    if not args.no_recalc:
        errors = None
        method = None
        if libreoffice_available():
            try:
                recalced = recalc_with_libreoffice(args.out)
                errors = find_error_cells(recalced)
                method = "LibreOffice recalc"
            except Exception as exc:  # environment dependent
                print(f"\n(LibreOffice recalc unavailable: {exc})")
        if errors is None:
            errors = validate_formulas(args.out, scale=args.scale)
            method = "formula-string validation"
        if errors:
            print(f"\nWARNING ({method}): {len(errors)} problem(s): {errors[:5]}")
            return 1
        print(f"\n{method}: 0 formula errors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
