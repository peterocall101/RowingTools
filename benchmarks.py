"""
benchmarks.py
Loads benchmark data from the versioned JSON file in /data/.
This ensures Python and HTML tools always use identical figures.

Default: benchmarks_v1.json
To use a different version: load_benchmarks('benchmarks_v2.json')
"""

import json
import os

_DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')


def load_benchmarks(filename='benchmarks_v1.json'):
    path = os.path.join(_DATA_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Benchmark file not found: {path}")
    with open(path) as f:
        return json.load(f)


def _build_met_averages(met_raw):
    result = {}
    for boat, data in met_raw.items():
        vals = []
        for yr in data['years'].values():
            if 'sat' in yr:
                vals.append(yr['sat'])
            if 'sun' in yr:
                vals.append(yr['sun'])
        if vals:
            result[boat] = {
                'label': data['label'],
                'avg_seconds': sum(vals) / len(vals),
                'n': len(vals),
            }
    return result


def _build_hrr(hrr_raw, henley_factor=2000/2112):
    result = {}
    for key, data in hrr_raw.items():
        vals = list(data['years'].values())
        avg_henley = sum(vals) / len(vals)
        result[key] = {
            'label': data['label'],
            'boat': data['boat'],
            'avg_henley_seconds': avg_henley,
            'benchmark_2k_seconds': avg_henley * henley_factor,
            'n': len(vals),
        }
    return result


_v1 = load_benchmarks('benchmarks_v1.json')

BENCHMARK_VERSION = _v1['_meta']['version']
BENCHMARK_LABEL   = _v1['_meta']['label']
BENCHMARK_DATE    = _v1['_meta']['frozen_date']

WBT     = _v1['wbt']
MET_AVG = _build_met_averages(_v1['met_raw'])
HRR     = _build_hrr(_v1['hrr_raw'])


if __name__ == '__main__':
    print(f"Benchmark version : {BENCHMARK_VERSION}")
    print(f"Label             : {BENCHMARK_LABEL}")
    print(f"Frozen date       : {BENCHMARK_DATE}")
    print(f"WBT events        : {len(WBT)}")
    print(f"Met avg events    : {len(MET_AVG)}")
    print(f"Henley events     : {len(HRR)}")
