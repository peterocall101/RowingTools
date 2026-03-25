"""
gmt_processor.py
Rowing Tools - GMT% Calculator (Python edition)

Stage 1: Takes a CSV of results, calculates GMT% against all benchmarks,
outputs a ranked table.

Usage:
    python gmt_processor.py --input results.csv --output top_performances.csv
    python gmt_processor.py --input results.csv --top 20
    python gmt_processor.py --sample   (runs with built-in sample data)

CSV format expected:
    label, time, boat_class, henley_event (optional)

    label       : free text e.g. "Men's 8+ A Final - Leander"
    time        : race time in m:ss.s format e.g. 6:40.2
    boat_class  : M8+, M4-, W4x etc (see benchmarks.py for full list)
    henley_event: optional key e.g. M4-_wyf (see benchmarks.py HRR keys)
"""

import argparse
import csv
import sys
from io import StringIO
from benchmarks import WBT, MET_AVG, HRR


# ── TIME UTILITIES ────────────────────────────────────────────────────────────

def parse_time(t: str) -> float | None:
    """Convert m:ss.s string to total seconds. Returns None if invalid."""
    if not t:
        return None
    t = t.strip().replace(",", ".")
    try:
        parts = t.split(":")
        if len(parts) != 2:
            return None
        minutes = int(parts[0])
        seconds = float(parts[1])
        return minutes * 60 + seconds
    except (ValueError, IndexError):
        return None


def format_time(seconds: float) -> str:
    """Convert seconds to m:ss.ss string."""
    m = int(seconds // 60)
    s = seconds - m * 60
    return f"{m}:{s:05.2f}"


# ── GMT CALCULATION ───────────────────────────────────────────────────────────

def calc_gmt_wbt(time_secs: float, boat: str) -> float | None:
    """GMT% vs World Best Time."""
    if boat not in WBT:
        return None
    benchmark = parse_time(WBT[boat]["time"])
    if not benchmark:
        return None
    return (benchmark / time_secs) * 100


def calc_gmt_met(time_secs: float, boat: str) -> float | None:
    """GMT% vs Met Regatta average."""
    if boat not in MET_AVG:
        return None
    return (MET_AVG[boat]["avg_seconds"] / time_secs) * 100


def calc_gmt_hrr(time_secs: float, henley_key: str) -> float | None:
    """GMT% vs Henley qualification benchmark (2000m equivalent)."""
    if not henley_key or henley_key not in HRR:
        return None
    return (HRR[henley_key]["benchmark_2k_seconds"] / time_secs) * 100


def score_band(pct: float | None) -> str:
    """Return a descriptive band for a GMT% score."""
    if pct is None:
        return "-"
    if pct >= 87:
        return "Elite"
    if pct >= 80:
        return "High club"
    if pct >= 72:
        return "Competitive club"
    return "Developing"


# ── PROCESS RESULTS ───────────────────────────────────────────────────────────

def process_results(rows: list[dict]) -> list[dict]:
    """
    Takes a list of result dicts and returns enriched dicts with GMT scores.
    Each row should have: label, time, boat_class, henley_event (optional)
    """
    processed = []
    for i, row in enumerate(rows, 1):
        label = row.get("label", "").strip()
        time_str = row.get("time", "").strip()
        boat = row.get("boat_class", "").strip()
        henley_key = row.get("henley_event", "").strip()

        time_secs = parse_time(time_str)

        if not time_secs:
            print(f"  Warning: Row {i} '{label}' - could not parse time '{time_str}', skipping")
            continue

        wbt_pct = calc_gmt_wbt(time_secs, boat)
        met_pct = calc_gmt_met(time_secs, boat)
        hrr_pct = calc_gmt_hrr(time_secs, henley_key)

        processed.append({
            "label":         label,
            "time":          time_str,
            "boat_class":    boat,
            "boat_label":    WBT.get(boat, {}).get("label", boat),
            "wbt_pct":       round(wbt_pct, 2) if wbt_pct else None,
            "met_pct":       round(met_pct, 2) if met_pct else None,
            "hrr_pct":       round(hrr_pct, 2) if hrr_pct else None,
            "henley_event":  HRR.get(henley_key, {}).get("label", "") if henley_key else "",
            "score_band":    score_band(wbt_pct),
        })

    return processed


def rank_results(processed: list[dict], sort_by: str = "wbt_pct") -> list[dict]:
    """Sort results by chosen metric, highest first. Nulls go to bottom."""
    def sort_key(r):
        val = r.get(sort_by)
        return (0, -val) if val is not None else (1, 0)

    ranked = sorted(processed, key=sort_key)
    for i, r in enumerate(ranked, 1):
        r["rank"] = i
    return ranked


# ── OUTPUT ────────────────────────────────────────────────────────────────────

def print_table(ranked: list[dict], top_n: int = None):
    """Print a formatted table to stdout."""
    rows = ranked[:top_n] if top_n else ranked

    col_widths = {
        "rank":     4,
        "label":    35,
        "time":     8,
        "boat":     22,
        "wbt":      8,
        "met":      8,
        "hrr":      8,
        "band":     16,
    }

    def fmt_pct(v):
        return f"{v:.1f}%" if v is not None else "-"

    header = (
        f"{'#':<{col_widths['rank']}}"
        f"{'Label':<{col_widths['label']}}"
        f"{'Time':<{col_widths['time']}}"
        f"{'Boat class':<{col_widths['boat']}}"
        f"{'WBT %':>{col_widths['wbt']}}"
        f"{'Met %':>{col_widths['met']}}"
        f"{'Henley %':>{col_widths['hrr']}}"
        f"  {'Band':<{col_widths['band']}}"
    )
    sep = "-" * len(header)

    print(f"\n{'ROWING TOOLS - GMT% RESULTS':^{len(header)}}")
    print(sep)
    print(header)
    print(sep)

    for r in rows:
        print(
            f"{r['rank']:<{col_widths['rank']}}"
            f"{r['label'][:34]:<{col_widths['label']}}"
            f"{r['time']:<{col_widths['time']}}"
            f"{r['boat_label'][:21]:<{col_widths['boat']}}"
            f"{fmt_pct(r['wbt_pct']):>{col_widths['wbt']}}"
            f"{fmt_pct(r['met_pct']):>{col_widths['met']}}"
            f"{fmt_pct(r['hrr_pct']):>{col_widths['hrr']}}"
            f"  {r['score_band']:<{col_widths['band']}}"
        )

    print(sep)
    print(f"  {len(rows)} result(s) shown\n")


def save_csv(ranked: list[dict], output_path: str):
    """Save ranked results to CSV."""
    fields = ["rank", "label", "time", "boat_class", "boat_label",
              "wbt_pct", "met_pct", "hrr_pct", "henley_event", "score_band"]

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(ranked)

    print(f"  Saved to {output_path}")


# ── SAMPLE DATA ───────────────────────────────────────────────────────────────

SAMPLE_DATA = """label,time,boat_class,henley_event
Men's 8+ A Final - Leander,5:45.2,M8+,M8+_thames
Men's 8+ A Final - Thames RC,5:48.1,M8+,M8+_thames
Men's 8+ A Final - Molesey BC,5:51.4,M8+,M8+_thames
Women's 8+ A Final - Oxford Brookes,6:22.5,W8+,W8+_warg
Women's 8+ A Final - Thames RC,6:28.3,W8+,W8+_warg
Men's 4- A Final - Cambridge Univ,5:58.1,M4-,M4-_vis
Men's 4- A Final - Leander,6:02.4,M4-,M4-_wyf
Men's 4- A Final - Oxford Brookes,6:40.2,M4-,M4-_wyf
Women's 4x A Final - Wycliffe,6:38.0,W4x,W4x_dj
Men's 1x A Final - Will Young,7:12.5,M1x,
Women's 1x A Final - UTRC,7:55.2,W1x,
Men's 4+ A Final - Upper Thames,6:32.1,M4+,M4+_brit
"""


# ── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Rowing Tools GMT% Calculator - processes regatta results"
    )
    parser.add_argument("--input",  "-i", help="Input CSV file path")
    parser.add_argument("--output", "-o", help="Output CSV file path (optional)")
    parser.add_argument("--top",    "-t", type=int, help="Show top N results only")
    parser.add_argument("--sort",   "-s", default="wbt_pct",
                        choices=["wbt_pct", "met_pct", "hrr_pct", "time"],
                        help="Sort metric (default: wbt_pct)")
    parser.add_argument("--sample", action="store_true",
                        help="Run with built-in sample data")
    args = parser.parse_args()

    # Load data
    if args.sample:
        print("\n  Running with sample data...")
        reader = csv.DictReader(StringIO(SAMPLE_DATA.strip()))
        rows = list(reader)
    elif args.input:
        try:
            with open(args.input, newline="") as f:
                reader = csv.DictReader(f)
                rows = list(reader)
            print(f"\n  Loaded {len(rows)} rows from {args.input}")
        except FileNotFoundError:
            print(f"  Error: file '{args.input}' not found")
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(0)

    # Process and rank
    processed = process_results(rows)
    ranked = rank_results(processed, sort_by=args.sort)

    # Output
    print_table(ranked, top_n=args.top)

    if args.output:
        save_csv(ranked, args.output)


if __name__ == "__main__":
    main()
