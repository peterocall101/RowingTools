"""
Generate a human-readable review of how all club names in all_results.json
resolve after normalization and alias application, plus near-duplicate candidates.
Mirrors the JS logic in clubs.html exactly.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA = ROOT / "data"


def norm_club(n):
    n = (n or "").replace("`", "'")
    n = re.sub(r"\s*\([A-Za-z]\)\s*$", "", n).strip()
    return n


def canon_display(n):
    n = norm_club(n)
    n = re.sub(r"\bUniv\b", "University", n)
    n = re.sub(r"\bColl\b", "College", n)
    n = re.sub(r"\bSch\b", "School", n)
    n = re.sub(r"\s+(Rowing Club|Boat Club|RC|BC|ARC)\s*$", "", n, flags=re.IGNORECASE).strip()
    return n


def canon(n):
    return canon_display(n).lower()


def resolve(n, aliases):
    disp = canon_display(n)
    key = canon(n)
    if key in aliases:
        disp = aliases[key]
        key = canon(disp)
    return disp, key


def edit_distance(a, b):
    """Levenshtein distance."""
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            curr.append(min(prev[j] + (ca != cb), curr[-1] + 1, prev[j + 1] + 1))
        prev = curr
    return prev[-1]


def token_overlap(a, b):
    """Jaccard similarity on word tokens."""
    ta = set(a.lower().split())
    tb = set(b.lower().split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def near_duplicate_score(a, b):
    """Combined similarity score - higher = more likely duplicate."""
    tok = token_overlap(a, b)
    ed = edit_distance(a.lower(), b.lower())
    max_len = max(len(a), len(b))
    ed_ratio = 1 - (ed / max_len) if max_len else 0
    return 0.6 * tok + 0.4 * ed_ratio


def main():
    with open(DATA / "all_results.json", encoding="utf-8") as f:
        data = json.load(f)
    with open(DATA / "club_aliases.json", encoding="utf-8") as f:
        aliases = json.load(f)

    # Collect all unique raw club names (excluding composite "A/B" entries)
    raw_names = set()
    for reg in data:
        for r in reg.get("results", []):
            club = r.get("club", "")
            if "/" not in club and club.strip():
                raw_names.add(club.strip())

    # Group raw names by canonical key
    groups = defaultdict(lambda: {"disp": None, "raws": set()})
    for raw in raw_names:
        disp, key = resolve(raw, aliases)
        groups[key]["disp"] = disp
        groups[key]["raws"].add(raw)

    merged = {k: v for k, v in groups.items() if len(v["raws"]) > 1}
    singles = {k: v for k, v in groups.items() if len(v["raws"]) == 1}

    # --- Near-duplicate detection across canonical display names ---
    canonical_names = [(k, v["disp"]) for k, v in groups.items()]
    candidates = []
    for i in range(len(canonical_names)):
        for j in range(i + 1, len(canonical_names)):
            ka, a = canonical_names[i]
            kb, b = canonical_names[j]
            score = near_duplicate_score(a, b)
            if score >= 0.6:
                candidates.append((score, a, b))
    candidates.sort(reverse=True)

    # --- Write output ---
    lines = []
    lines.append("# Club Alias Review")
    lines.append(f"# {len(groups)} canonical clubs  |  {len(merged)} merged groups  |  {len(singles)} singletons")
    lines.append("")

    lines.append(f"## Merged clubs ({len(merged)} groups)\n")
    for key in sorted(merged, key=lambda k: merged[k]["disp"].lower()):
        v = merged[key]
        raws_sorted = sorted(v["raws"], key=str.lower)
        lines.append(f"### {v['disp']}")
        for raw in raws_sorted:
            marker = "  = " if raw == v["disp"] else "  ~ "
            lines.append(f"{marker}{raw}")
        lines.append("")

    lines.append(f"## Near-duplicate candidates ({len(candidates)} pairs)\n")
    lines.append("<!-- Score 1.0 = identical tokens. Review each pair: if they are the same club,")
    lines.append("     tell Claude which is the canonical name and it will update club_aliases.json. -->")
    lines.append("")
    for score, a, b in candidates:
        lines.append(f"- [{score:.2f}] **{a}**  vs  **{b}**")
    lines.append("")

    lines.append(f"## Singleton clubs ({len(singles)} clubs)\n")
    for key in sorted(singles, key=lambda k: singles[k]["disp"].lower()):
        v = singles[key]
        raw = next(iter(v["raws"]))
        if raw != v["disp"]:
            lines.append(f"- {v['disp']}  ← {raw}")
        else:
            lines.append(f"- {v['disp']}")

    out = ROOT / "club_aliases_review.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"Written: {out}")
    print(f"  {len(merged)} merged groups, {len(singles)} singletons, {len(candidates)} near-duplicate candidates")


if __name__ == "__main__":
    main()
