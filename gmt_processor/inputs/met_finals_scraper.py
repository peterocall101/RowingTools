"""
met_finals_scraper.py
Rowing Tools - Met Regatta finals depth scraper

Fetches A/B/C final results directly from the rowresults.co.uk JSON API for
each race - no Selenium or Claude API required. Takes the 2nd-slowest finisher
time per boat class per final type ("minimum standard to reach that final"),
which guards against outliers from a crew that had an equipment issue.

Only Championship events are included, to match the existing met_raw benchmark.

Outputs JSON ready to paste into benchmarks_v3.json as met_a_slowest,
met_b_slowest, met_c_slowest sections.

Usage:
    python met_finals_scraper.py
    python met_finals_scraper.py --output met_finals_data.json
    python met_finals_scraper.py --include-2024

Competition codes covered by default (matching met_raw): 2021-2025 exc. 2024.
"""

import argparse
import json
import re
import sys
import time

try:
    import requests
except ImportError:
    print("Error: 'requests' not installed. Run: pip install requests")
    sys.exit(1)

BASE = "https://rowresults.co.uk"

# Competition codes and their year/day, in chronological order.
# 2024 excluded by default to match met_raw (can be included with --include-2024).
COMPETITIONS = [
    ("met21sat", 2021, "sat"),
    ("met21sun", 2021, "sun"),
    ("metsat",   2022, "sat"),
    ("metsun",   2022, "sun"),
    ("metsat23", 2023, "sat"),
    ("metsun23", 2023, "sun"),
    ("metsat24", 2024, "sat"),
    ("metsun24", 2024, "sun"),
    ("metsat25", 2025, "sat"),
    ("metsun25", 2025, "sun"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": BASE,
}

# ── BOAT CLASS MAPPING ────────────────────────────────────────────────────────

def parse_boat_class(event_name: str) -> str | None:
    """Map a Met Regatta event name to a standard boat class code.
    Returns None if the event is not a senior Championship event or unrecognised.

    Examples:
      "Op 4- Championship" -> "M4-"
      "W 8+ Ch"            -> "W8+"
      "Op Lwt 1x"          -> "LM1x"
      "W Lwt 2x"           -> "LW2x"
    """
    name = event_name.strip()

    # Only Championship events - accept "Championship" or "Ch" suffix,
    # but also bare events that have no category qualifier at all
    # (some boat classes only run one category at Met, e.g. W 2-)
    has_championship = bool(re.search(r'\bCh(ampionship)?\b', name, re.IGNORECASE))
    has_other_category = bool(re.search(r'\b(Academic|Club|Sch|Jun)\b', name, re.IGNORECASE))
    if has_other_category:
        return None
    # If explicit Championship marker present or no category qualifier at all, continue

    # Junior events excluded
    if re.search(r'\bJ\d{2}\b', name):
        return None

    # Gender prefix
    if re.match(r'W\b', name):
        gender = "W"
    elif re.match(r'Op\b', name, re.IGNORECASE):
        gender = "M"
    else:
        return None

    # Lightweight
    lwt = bool(re.search(r'\bLwt\b', name, re.IGNORECASE))

    # Boat class
    boat_map = {
        "8+": "8+",
        "4-": "4-",
        "4x-": "4x",
        "4x": "4x",
        "4+": "4+",
        "2-": "2-",
        "2x": "2x",
        "2+": "2+",
        "1x": "1x",
    }
    boat = None
    for pattern, code in boat_map.items():
        if re.search(re.escape(pattern), name):
            boat = code
            break
    if boat is None:
        return None

    prefix = ("L" if lwt else "") + gender
    return prefix + boat


# ── DATA FETCHING ─────────────────────────────────────────────────────────────

def fetch_race_list(comp_code: str) -> list[dict]:
    ts = int(time.time() * 1000)
    url = f"{BASE}/raceinfo.php?c={comp_code}&_={ts}"
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json().get("data", [])


def fetch_race_lanes(comp_code: str, race_number: int) -> dict | None:
    url = f"{BASE}/results/{comp_code}/Race{race_number}.json"
    r = requests.get(url, headers={**HEADERS, "Referer": f"{BASE}/{comp_code}"}, timeout=15)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def parse_time_to_seconds(t: str) -> float | None:
    if not t or t.strip().upper() in ("DNS", "DNF", "DNA", "DSQ", "SCR", ""):
        return None
    t = t.strip()
    m = re.match(r'^(\d+):(\d{2})\.(\d+)$', t)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2)) + float(f"0.{m.group(3)}")
    m = re.match(r'^(\d+)\.(\d+)$', t)
    if m:
        return float(t)
    return None


# ── PROCESSING ────────────────────────────────────────────────────────────────

def process_competition(comp_code: str, year: int, day: str) -> list[dict]:
    """Return list of {boat_class, final_type, year, day, time_seconds} dicts."""
    print(f"  {comp_code} ({year} {day}): fetching race list...")
    try:
        races = fetch_race_list(comp_code)
    except Exception as e:
        print(f"    Error fetching race list: {e}")
        return []

    entries = []
    finals = [r for r in races if re.search(r'Final\s+[ABC]\b', str(r.get("Round", "")))]
    print(f"    {len(races)} total races, {len(finals)} A/B/C finals")

    for race in finals:
        # Determine final type
        round_str = str(race.get("Round", ""))
        m = re.search(r'Final\s+([ABC])\b', round_str)
        if not m:
            continue
        final_type = m.group(1)

        event_name = str(race.get("Event") or race.get("RaceName") or "")
        boat_class = parse_boat_class(event_name)
        if boat_class is None:
            continue

        race_number = race.get("Race")
        if not race_number:
            continue

        try:
            race_data = fetch_race_lanes(comp_code, race_number)
        except Exception as e:
            print(f"    Warning: could not fetch Race{race_number}.json: {e}")
            continue

        if not race_data or "lanes" not in race_data:
            continue

        for lane in race_data["lanes"]:
            t = parse_time_to_seconds(str(lane.get("Finish", "")))
            if t is not None:
                entries.append({
                    "boat_class": boat_class,
                    "final_type": final_type,
                    "year": year,
                    "day": day,
                    "time": t,
                    "crew": lane.get("CrewCode", ""),
                })

        time.sleep(0.15)  # be polite

    return entries


# ── AGGREGATION ───────────────────────────────────────────────────────────────

def aggregate(all_entries: list[dict]) -> dict:
    """Group by (boat_class, final_type, year, day), take 2nd slowest time."""
    grouped: dict[tuple, list[float]] = {}
    for e in all_entries:
        key = (e["boat_class"], e["final_type"], e["year"], e["day"])
        grouped.setdefault(key, []).append(e["time"])

    result: dict[str, dict] = {"A": {}, "B": {}, "C": {}}

    for (boat, ftype, year, day), times in grouped.items():
        if ftype not in result:
            continue
        times_sorted = sorted(times, reverse=True)  # slowest first
        if len(times_sorted) >= 2:
            chosen = times_sorted[1]
        else:
            chosen = times_sorted[0]
            print(f"  Warning: only 1 finisher for {boat} {ftype}-final {year} {day}")

        result[ftype].setdefault(boat, {}).setdefault(year, {})[day] = round(chosen, 2)

    return result


# ── OUTPUT FORMATTING ─────────────────────────────────────────────────────────

BOAT_LABELS = {
    "M8+": "Open Championship 8+",   "W8+": "Women's Championship 8+",
    "M4-": "Open Championship 4-",   "W4-": "Women's Championship 4-",
    "M4x": "Open Championship 4x",   "W4x": "Women's Championship 4x",
    "M4+": "Open Championship 4+",   "W4+": "Women's Championship 4+",
    "M2-": "Open Championship 2-",   "W2-": "Women's Championship 2-",
    "M2x": "Open Championship 2x",   "W2x": "Women's Championship 2x",
    "M2+": "Open Championship 2+",
    "M1x": "Open Championship 1x",   "W1x": "Women's Championship 1x",
    "LM4-": "Lwt Open Championship 4-",  "LM2x": "Lwt Open Championship 2x",
    "LM1x": "Lwt Open Championship 1x",  "LW2x": "Lwt Women's Championship 2x",
    "LW1x": "Lwt Women's Championship 1x",
}

def format_for_benchmarks(aggregated: dict) -> dict:
    sections = {}
    for ftype in ("A", "B", "C"):
        boats = aggregated.get(ftype, {})
        key = f"met_{'abc'['ABC'.index(ftype)]}_slowest"
        section = {}
        for boat in sorted(boats):
            section[boat] = {
                "label": BOAT_LABELS.get(boat, boat),
                "years": {str(yr): days for yr, days in sorted(boats[boat].items())}
            }
        sections[key] = section
    return sections


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Scrape Met Regatta A/B/C final depth times (no API key needed)"
    )
    parser.add_argument("--output", "-o",
                        help="Write JSON output to file (default: print to stdout)")
    parser.add_argument("--include-2024", action="store_true",
                        help="Include 2024 data (excluded by default to match met_raw)")
    args = parser.parse_args()

    comps = [(c, y, d) for c, y, d in COMPETITIONS if y != 2024 or args.include_2024]

    print(f"\nProcessing {len(comps)} competitions...\n")
    all_entries = []
    for comp_code, year, day in comps:
        entries = process_competition(comp_code, year, day)
        all_entries.extend(entries)
        print(f"    -> {len(entries)} finisher entries collected\n")

    if not all_entries:
        print("No entries found.")
        sys.exit(1)

    print(f"Total entries: {len(all_entries)}")
    aggregated = aggregate(all_entries)

    for ftype in ("A", "B", "C"):
        boats = aggregated.get(ftype, {})
        print(f"  Final {ftype}: {len(boats)} boat classes")

    output = format_for_benchmarks(aggregated)
    json_str = json.dumps(output, indent=2)

    if args.output:
        with open(args.output, "w") as f:
            f.write(json_str)
        print(f"\nWritten to {args.output}")
    else:
        print("\n--- BENCHMARK JSON ---")
        print(json_str)
        print("--- END ---")


if __name__ == "__main__":
    main()
