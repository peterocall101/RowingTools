#!/usr/bin/env python3
"""Extract ROWS data from all linked heatmap HTML files and write data/all_results.json."""
import json, os, re, sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))

HEATMAPS = [
    {'file': 'heatmap-metsun26.html',    'comp': 'metsun26',      'date': '2026-05-31'},
    {'file': 'heatmap-metsat26.html',    'comp': 'metsat26',      'date': '2026-05-30'},
    {'file': 'heatmap-nsr26.html',       'comp': 'nsr26',         'date': '2026-05-24'},
    {'file': 'heatmap-poplar26.html',    'comp': 'poplar26',      'date': '2026-05-17'},
    {'file': 'heatmap-nottm26.html',     'comp': 'nottm26',       'date': '2026-05-09'},
    {'file': 'heatmap-wallingford26.html','comp': 'wallingford26','date': '2026-05-04'},
    {'file': 'heatmap-brcc25.html',      'comp': 'brcc25',        'date': '2025-07-20'},
    {'file': 'heatmap-metsun25.html',    'comp': 'metsun25',      'date': '2025-06-01'},
    {'file': 'heatmap-metsat25.html',    'comp': 'metsat25',      'date': '2025-05-31'},
    {'file': 'heatmap-wallingford25.html','comp': 'wallingford25','date': '2025-05-04'},
]

def norm_club(name):
    name = re.sub(r'\s*\([A-Za-z]\)\s*$', '', name or '').strip()
    return name

def canon_display(name):
    name = norm_club(name)
    name = re.sub(r'\bUniv\b', 'University', name)
    name = re.sub(r'\bColl\b', 'College', name)
    name = re.sub(r'\bSch\b', 'School', name)
    name = re.sub(r'\s+(Rowing Club|Boat Club|RC|BC|ARC)\s*$', '', name, flags=re.IGNORECASE).strip()
    return name

def extract_title(content):
    m = re.search(r'<title>([^<]+)</title>', content)
    if not m:
        return ''
    return re.sub(r'\s*Results\b.*', '', m.group(1), flags=re.IGNORECASE).strip()

def extract_rows(content):
    m = re.search(r'const ROWS=(\[.+\]);', content)
    if not m:
        return []
    return json.loads(m.group(1))

def main():
    out = []
    for h in HEATMAPS:
        path = os.path.join(ROOT, h['file'])
        if not os.path.exists(path):
            print(f'  skip {h["file"]} (not found)', file=sys.stderr)
            continue
        with open(path, encoding='utf-8') as f:
            content = f.read()
        title = extract_title(content)
        rows = extract_rows(content)
        results = []
        for r in rows:
            for lane in r['lanes']:
                if lane.get('pct') is not None and lane['pct'] >= 50 and lane.get('time'):
                    results.append({
                        'crew': lane['crew'],
                        'club': canon_display(lane['club']),
                        'event': r['event'],
                        'round': r['round'],
                        'time': lane['time'],
                        'pct': lane['pct'],
                        'boat': r.get('boat', ''),
                    })
        results.sort(key=lambda x: -x['pct'])
        print(f'  {h["comp"]}: {title} - {len(results)} results')
        out.append({'comp': h['comp'], 'title': title, 'date': h['date'], 'url': h['file'], 'results': results})

    dest = os.path.join(ROOT, 'data', 'all_results.json')
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'Written {dest}')

if __name__ == '__main__':
    main()
