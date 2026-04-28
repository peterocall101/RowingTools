"""
brcc25_scraper.py
Fetches missing event finals from rowresults.co.uk/brcc25 JSON API,
calculates GMT% vs WBT, and merges into brcc25_data.json.

No Selenium or Claude API required - uses the rowresults JSON endpoints directly.

Usage:
    python brcc25_scraper.py
    python brcc25_scraper.py --dry-run   (print new data, do not write)

Run from any directory - uses absolute paths.
"""

import argparse
import json
import os
import re
import sys
import time

try:
    import requests
except ImportError:
    print("Error: 'requests' not installed. Run: pip install requests")
    sys.exit(1)

BASE      = "https://rowresults.co.uk"
COMP      = "brcc25"
REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA_JSON = os.path.join(REPO_ROOT, 'gmt_processor', 'outputs', 'brcc25_data.json')
BM_JSON   = os.path.join(REPO_ROOT, 'data', 'benchmarks_v1.json')

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": BASE,
}

# ── EVENT → RACE NUMBER MAPPING ───────────────────────────────────────────────
# Keyed by (event_name, round_label). round_label is what we store in brcc25_data.json.
# Race numbers from raceinfo.php?c=brcc25, confirmed April 2026.
# "Final" from rowresults mapped to "Final A" for single-final events.

EVENTS = {
    # event_name: {"day": ..., "boat_class": ..., "rounds": {"Final X": race_number}}
    # Race numbers verified against raceinfo.php?c=brcc25 (April 2026).
    # W Ch 4- omitted - event did not run (no entries in raceinfo).
    "Mxd Ch 8+": {
        "day": "Saturday",
        "boat_class": "M8+",
        "rounds": {"Final A": 297},
    },
    "O Club 2-": {
        "day": "Sunday",
        "boat_class": "M2-",
        "rounds": {"Final A": 384},
    },
    "W Club 4-": {
        "day": "Friday",
        "boat_class": "W4-",
        "rounds": {"Final A": 97},
    },
    "Mxd Club 4+": {
        "day": "Saturday",
        "boat_class": "M4+",
        "rounds": {"Final A": 268},
    },
    "W Club 8+": {
        "day": "Saturday",
        "boat_class": "W8+",
        "rounds": {"Final A": 271},
    },
    "O J18 1x": {
        "day": "Friday",
        "boat_class": "M1x",
        "rounds": {"Final F": 50, "Final E": 51, "Final D": 52,
                   "Final C": 71, "Final B": 72, "Final A": 73},
    },
    "W J18 1x": {
        "day": "Saturday",
        "boat_class": "W1x",
        "rounds": {
            "Final F": 256, "Final E": 257, "Final D": 258,
            "Final C": 275, "Final B": 276, "Final A": 277,
        },
    },
    "O J18 2x": {
        "day": "Saturday",
        "boat_class": "M2x",
        "rounds": {
            "Final F": 259, "Final E": 260, "Final D": 261,
            "Final C": 281, "Final B": 282, "Final A": 283,
        },
    },
    "W J18 2x": {
        "day": "Friday",
        "boat_class": "W2x",
        "rounds": {"Final F": 53, "Final E": 54, "Final D": 55,
                   "Final C": 75, "Final B": 76, "Final A": 77},
    },
    "O J18 2-": {
        "day": "Saturday",
        "boat_class": "M2-",
        "rounds": {"Final C": 287, "Final B": 288, "Final A": 289},
    },
    "W J18 2-": {
        "day": "Friday",
        "boat_class": "W2-",
        "rounds": {"Final D": 62, "Final C": 87, "Final B": 88, "Final A": 89},
    },
    "O J18 4-": {
        "day": "Friday",
        "boat_class": "M4-",
        "rounds": {"Final A": 93},
    },
    "W J18 4-": {
        "day": "Saturday",
        "boat_class": "W4-",
        "rounds": {"Final A": 294},
    },
    "O J18 4x": {
        "day": "Sunday",
        "boat_class": "M4x",
        "rounds": {"Final D": 355, "Final C": 375, "Final B": 376, "Final A": 377},
    },
    "W J18 4x": {
        "day": "Sunday",
        "boat_class": "W4x",
        "rounds": {"Final D": 365, "Final C": 396, "Final B": 397, "Final A": 398},
    },
    "O J18 8+": {
        "day": "Saturday",
        "boat_class": "M8+",
        "rounds": {"Final A": 298},
    },
    "W J18 8+": {
        "day": "Saturday",
        "boat_class": "W8+",
        "rounds": {"Final A": 264},
    },
}


# ── BENCHMARK LOADING ─────────────────────────────────────────────────────────

def load_wbt():
    with open(BM_JSON) as f:
        data = json.load(f)
    wbt = {}
    for key, val in data['wbt'].items():
        t = val['time']
        m = re.match(r'^(\d+):(\d+\.\d+)$', t)
        if m:
            wbt[key] = int(m.group(1)) * 60 + float(m.group(2))
    return wbt


# ── TIME PARSING ──────────────────────────────────────────────────────────────

def parse_time(t: str) -> float | None:
    if not t or t.strip().upper() in ('DNS', 'DNF', 'DNA', 'DSQ', 'SCR', ''):
        return None
    t = t.strip()
    m = re.match(r'^(\d+):(\d{2})\.(\d+)$', t)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2)) + float(f"0.{m.group(3)}")
    return None


def format_time(secs: float) -> str:
    mins = int(secs // 60)
    s = secs - mins * 60
    return f"{mins:02d}:{s:05.2f}"


# ── FETCHING ──────────────────────────────────────────────────────────────────

def fetch_race(race_number: int) -> dict | None:
    url = f"{BASE}/results/{COMP}/Race{race_number}.json"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code == 404:
            print(f"    Race {race_number}: 404 not found")
            return None
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"    Race {race_number}: error - {e}")
        return None


# ── PROCESSING ────────────────────────────────────────────────────────────────

def process_race(race_number: int, boat_class: str, wbt: dict) -> list[dict]:
    """Fetch a race and return sorted list of lane dicts for brcc25_data.json."""
    data = fetch_race(race_number)
    if not data or 'lanes' not in data:
        print(f"    Race {race_number}: no lane data")
        return []

    lanes = data['lanes']
    wbt_secs = wbt.get(boat_class)

    entries = []
    for lane in lanes:
        finish_raw = str(lane.get('Finish', '') or '')
        try:
            posn = int(lane.get('Posn') or 99)
        except (ValueError, TypeError):
            posn = 99
        crew_code = str(lane.get('CrewCode', '') or '').strip()
        club_name = str(lane.get('ClubName', '') or '').strip()

        # Skip empty lanes (no crew assigned)
        if not crew_code and not club_name:
            continue

        time_secs = parse_time(finish_raw)

        if time_secs and wbt_secs:
            pct = round((wbt_secs / time_secs) * 100, 1)
        else:
            pct = None

        # Normalise time display - keep original string if valid, else "DNA"
        if time_secs:
            time_str = format_time(time_secs)
        else:
            time_str = 'DNA'

        entries.append({
            'posn': posn,
            'crew': crew_code,
            'club': club_name,
            'time': time_str,
            'pct':  pct,
        })

    # Sort by finish position
    entries.sort(key=lambda x: x['posn'])

    # Drop posn field before returning
    return [{'crew': e['crew'], 'club': e['club'], 'time': e['time'], 'pct': e['pct']}
            for e in entries]


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Fetch missing brcc25 events from rowresults")
    parser.add_argument('--dry-run', action='store_true',
                        help='Print new data without writing to JSON')
    args = parser.parse_args()

    wbt = load_wbt()
    print(f"Loaded WBT for {len(wbt)} boat classes\n")

    # Load existing data
    with open(DATA_JSON) as f:
        saved = json.load(f)

    rows_by_event = saved['rows_by_event']
    boat_class_map = saved['boat_class']

    already_present = [ev for ev in EVENTS if ev in rows_by_event]
    if already_present:
        print(f"Already in data (will skip): {already_present}\n")

    new_events = {ev: cfg for ev, cfg in EVENTS.items() if ev not in rows_by_event}
    print(f"Fetching {len(new_events)} missing events...\n")

    for event_name, cfg in new_events.items():
        print(f"  {event_name}  ({cfg['boat_class']})")
        day = cfg['day']
        boat = cfg['boat_class']
        rounds_out = {}

        for round_label, race_num in cfg['rounds'].items():
            print(f"    {round_label} -> Race {race_num}")
            entries = process_race(race_num, boat, wbt)
            if entries:
                rounds_out[round_label] = entries
                print(f"      {len(entries)} lanes fetched")
            time.sleep(0.15)

        if not rounds_out:
            print(f"  WARNING: no data fetched for {event_name}, skipping\n")
            continue

        rows_by_event[event_name] = {"day": day, "rounds": rounds_out}
        boat_class_map[event_name] = boat
        print()

    if args.dry_run:
        print("\n--- DRY RUN: new entries ---")
        for ev in new_events:
            if ev in rows_by_event:
                print(f"\n{ev}:")
                print(json.dumps(rows_by_event[ev], indent=2))
        return

    # Write back
    saved['rows_by_event'] = rows_by_event
    saved['boat_class'] = boat_class_map

    with open(DATA_JSON, 'w', encoding='utf-8') as f:
        json.dump(saved, f, separators=(',', ':'), ensure_ascii=False)

    print(f"Written: {DATA_JSON}")
    print(f"Total events now: {len(rows_by_event)}")


if __name__ == '__main__':
    main()
