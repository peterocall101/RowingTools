#!/usr/bin/env python3
"""Scrape Henley Royal Regatta results + course records into JSON for the Henley page.

Outputs:
  data/henley_records.json        - per-event progression of records to Barrier/Fawley/Finish
                                    (year-by-year; the page picks the fastest entry with
                                    year < the selected year as that year's baseline)
  data/henley_<year>.json         - every race that year, normalised (splits, winner/loser, loserLeading)

HRR data quirks handled here:
  * The record-holders page only shows the CURRENT record to each marker, so a fresh scrape
    drops any time that was beaten since last time. We therefore MERGE each scrape into the
    existing file (see merge_records) to keep the full progression - otherwise the baseline
    for the year a record was broken vanishes and that year's record-setters wrongly show "-".
  * In results, each split time belongs to the LEADING crew at that marker. Usually that's the
    eventual winner, but when `loserLeading` is true the loser was ahead there, so the split is
    the loser's time (this is the "star" shown on hrr.co.uk).

Usage:
  python gmt_processor/inputs/scrape_henley.py --year 2025
"""
import argparse, html as H, json, os, re, sys
import requests

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; RowingTools/1.0)'}
RECORDS_URL = 'https://www.hrr.co.uk/record-holders/'
RESULTS_URL = 'https://www.hrr.co.uk/results/?result-page={page}&race-year={year}&race-day={day}'


def norm_event(name):
    """Canonical key to match a results trophy name to a records accordion heading."""
    n = (name or '').lower().replace('&amp;', '&')
    n = n.replace('the ', ' ').replace("'", '').replace('’', '')
    n = re.sub(r'[^a-z0-9 ]', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n


def dot_time_to_secs(t):
    """'6.53' (6 min 53 s) -> 413.0 ; '2.52' -> 172.0. Returns None if unparseable."""
    if not t:
        return None
    t = t.replace('^', '').strip()
    m = re.match(r'^(\d+)[.:](\d{2}(?:\.\d+)?)$', t)
    if not m:
        return None
    secs = int(m.group(1)) * 60 + float(m.group(2))
    return secs if secs > 0 else None


def colon_time_to_secs(t):
    """'01:59' -> 119.0 ; '06:52' -> 412.0. Returns None if unparseable."""
    if not t:
        return None
    t = t.strip()
    m = re.match(r'^(\d+):(\d{2}(?:\.\d+)?)$', t)
    if not m:
        return None
    secs = int(m.group(1)) * 60 + float(m.group(2))
    return secs if secs > 0 else None  # "00:00" = no time recorded


# ── RECORDS ───────────────────────────────────────────────────────────────────
def parse_records(html):
    """Return {norm_event: {event, barrier:[...], fawley:[...], finish:[...]}} where each
    marker is the full chronological progression of records to that point - a list of
    {year, secs, display}. The page picks the baseline for a given year as the fastest
    entry with year < that year (the record "going into" the regatta)."""
    # Accordion heading names (in document order) and their rich-content blocks.
    names = re.findall(r'data-toggle="collapse"[^>]*>\s*<span>([^<]+)</span>', html)
    blocks = re.findall(r'accordion-item-content rich-content">(.*?)</div>', html, re.S)
    out = {}
    for name, block in zip(names, blocks):
        event = H.unescape(name).strip()
        entries = re.split(r'<hr\s*/?>', block)
        prog = {'barrier': [], 'fawley': [], 'finish': []}
        for e in entries:
            ym = re.search(r'Year\s*:[^<]*</strong>[^\d]*(\d{4})', e, re.S | re.I)
            year = int(ym.group(1)) if ym else None
            for marker in ('barrier', 'fawley', 'finish'):
                m = re.search(marker.capitalize() + r'\s*:.*?</strong>(.*?)(?:<br|</p>)', e, re.S | re.I)
                if not m:
                    continue
                raw = re.sub(r'<[^>]+>', '', m.group(1))
                raw = H.unescape(raw).replace('\xa0', ' ').strip()
                secs = dot_time_to_secs(raw)
                if secs is not None:
                    prog[marker].append({'year': year, 'secs': secs, 'display': raw.replace('^', '').strip()})
        rec = {'event': event}
        for marker in ('barrier', 'fawley', 'finish'):
            rec[marker] = sorted(prog[marker], key=lambda x: x['secs'])
        if any(rec[m] for m in ('barrier', 'fawley', 'finish')):
            out[norm_event(event)] = rec
    return out


# ── RESULTS ───────────────────────────────────────────────────────────────────
def extract_results_json(html):
    """Pull the initial-results JSON array out of the <historical-results> element."""
    m = re.search(r'initial-results="(\[.*?\])"\s', html, re.S)
    if not m:
        return []
    return json.loads(H.unescape(m.group(1)))


def split_obj(s):
    if not isinstance(s, dict):
        return None
    return {
        'secs': colon_time_to_secs(s.get('split')),
        'display': s.get('split'),
        'newRecord': bool(s.get('newRecord')),
        'equalsRecord': bool(s.get('equalsRecord')),
        'loserLeading': bool(s.get('loserLeading')),
    }


def normalise_race(r):
    trophy = r.get('trophy') or {}
    winner = r.get('winner') or {}
    loser = r.get('loser') or {}
    return {
        'id': r.get('id'),
        'number': r.get('number'),
        'event': trophy.get('name'),
        'eventShort': trophy.get('shortName'),
        'eventKey': norm_event(trophy.get('name')),
        'class': (trophy.get('class') or {}).get('name'),
        'round': r.get('round'),
        'station': r.get('station'),
        'winner': winner.get('name'),
        'winnerShort': winner.get('shortName'),
        'loser': loser.get('name'),
        'loserShort': loser.get('shortName'),
        'withdrawn': bool(r.get('withdrawn')),
        'verdict': r.get('verdict'),
        'day': r.get('raceDay'),
        'year': r.get('raceYear'),
        'dateTime': r.get('raceDateTime'),
        'barrier': split_obj(r.get('barrier')),
        'fawley': split_obj(r.get('fawley')),
        'finish': split_obj(r.get('finish')),
    }


def scrape_results(year, max_days=8, max_pages=20):
    seen, races = set(), []
    for day in range(1, max_days + 1):
        got_day = 0
        for page in range(1, max_pages + 1):
            url = RESULTS_URL.format(page=page, year=year, day=day)
            html = requests.get(url, timeout=30, headers=HEADERS).text
            batch = extract_results_json(html)
            new = [b for b in batch if b.get('id') not in seen]
            if not new:
                break
            for b in new:
                seen.add(b['id'])
                races.append(normalise_race(b))
            got_day += len(new)
            # Don't infer "last page" from a short batch: HRR omits withdrawn/walkover
            # races from each page, so a non-final page can hold fewer than 20 rows
            # (e.g. Friday page 1 had 17). Keep paging until a page returns no new
            # races - the empty-results page (`not new` above) is the real terminator.
        print(f'  day {day}: {got_day} races', file=sys.stderr)
        if got_day == 0 and day > 1:
            break
    return races


def load_records():
    dest_r = os.path.join(ROOT, 'data', 'henley_records.json')
    if os.path.exists(dest_r):
        with open(dest_r, encoding='utf-8') as f:
            return json.load(f)
    return {}


def merge_records(existing, fresh):
    """Union the fresh scrape into the existing progression so beaten records are kept.

    HRR's record-holders page only shows the CURRENT record to each marker, so a fresh
    scrape drops any time that was beaten since the last scrape. Without this merge, the
    previous (slower) record is lost and the "going into year Y" baseline for the year it
    was broken disappears - crews that set a new record then show "-" instead of >100%.
    Merging keeps the full year-by-year progression; the page still picks the fastest
    entry with year < the selected year as that year's baseline.
    """
    markers = ('barrier', 'fawley', 'finish')
    out = {}
    for key in set(existing) | set(fresh):
        e, f = existing.get(key, {}), fresh.get(key, {})
        rec = {'event': f.get('event') or e.get('event') or key}
        for m in markers:
            seen, entries = set(), []
            for arr in (e.get(m) or [], f.get(m) or []):
                for x in arr:
                    sig = (x.get('year'), x.get('secs'))
                    if sig in seen:
                        continue
                    seen.add(sig)
                    entries.append(x)
            rec[m] = sorted(entries, key=lambda x: (x['secs'], x['year'] or 0))
        out[key] = rec
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=2025)
    ap.add_argument('--results-only', action='store_true',
                    help='skip the records fetch/write and only update data/henley_<year>.json '
                         '(used by the automated 2026 updater, which must touch only the year file)')
    args = ap.parse_args()

    if args.results_only:
        recs = load_records()  # use the records already in the repo; do not re-write them
    else:
        print('Fetching records...', file=sys.stderr)
        fresh = parse_records(requests.get(RECORDS_URL, timeout=30, headers=HEADERS).text)
        recs = merge_records(load_records(), fresh)  # keep beaten records, don't clobber history
        dest_r = os.path.join(ROOT, 'data', 'henley_records.json')
        with open(dest_r, 'w', encoding='utf-8') as f:
            json.dump(recs, f, separators=(',', ':'))
        print(f'  {len(recs)} events with records -> {dest_r}', file=sys.stderr)

    print(f'Fetching {args.year} results...', file=sys.stderr)
    races = scrape_results(args.year)
    dest = os.path.join(ROOT, 'data', f'henley_{args.year}.json')
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(races, f, separators=(',', ':'))
    matched = sum(1 for r in races if r['eventKey'] in recs)
    print(f'  {len(races)} races ({matched} matched to a record event) -> {dest}', file=sys.stderr)


if __name__ == '__main__':
    main()
