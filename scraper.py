"""
scraper.py
Rowing Tools - Stage 2 results scraper

Fetches final results from three source types:
  1. rowresults.co.uk  - JavaScript rendered, uses Selenium headless Chrome
  2. Google Sheets     - exports as CSV via URL swap
  3. Static HTML       - e.g. wallingford-regatta.org.uk, uses requests + BeautifulSoup

Then sends raw text to Claude API to extract structured results (finals only),
pipes them through the GMT calculator and outputs a ranked table.

Usage:
    python scraper.py --url "https://rowresults.co.uk/metsat25"
    python scraper.py --url "https://docs.google.com/spreadsheets/d/1AUep.../edit"
    python scraper.py --url "https://wallingford-regatta.org.uk/results/"
    python scraper.py --url "https://rowresults.co.uk/metsat25" --output met_sat_25.csv
    python scraper.py --url "https://rowresults.co.uk/metsat25" --top 20

Requirements:
    pip install selenium anthropic pandas requests beautifulsoup4

    For Selenium you also need ChromeDriver matching your Chrome version:
    https://googlechromelabs.github.io/chrome-for-testing/

API key:
    Set environment variable: export ANTHROPIC_API_KEY=your_key_here
    Or create a .env file with: ANTHROPIC_API_KEY=your_key_here
"""

import argparse
import os
import sys
import re
import time
import csv
from io import StringIO

# ── DEPENDENCY IMPORTS ────────────────────────────────────────────────────────
# Each is imported inside the function that needs it so missing packages give
# a clear error message pointing at the specific source type

def _import_requests():
    try:
        import requests
        return requests
    except ImportError:
        print("  Error: 'requests' not installed. Run: pip install requests")
        sys.exit(1)

def _import_bs4():
    try:
        from bs4 import BeautifulSoup
        return BeautifulSoup
    except ImportError:
        print("  Error: 'beautifulsoup4' not installed. Run: pip install beautifulsoup4")
        sys.exit(1)

def _import_selenium():
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.by import By
        return webdriver, Options, WebDriverWait, EC, By
    except ImportError:
        print("  Error: 'selenium' not installed. Run: pip install selenium")
        print("  Also install ChromeDriver: https://googlechromelabs.github.io/chrome-for-testing/")
        sys.exit(1)

def _import_anthropic():
    try:
        import anthropic
        return anthropic
    except ImportError:
        print("  Error: 'anthropic' not installed. Run: pip install anthropic")
        sys.exit(1)

# ── SOURCE DETECTION ──────────────────────────────────────────────────────────

def detect_source_type(url: str) -> str:
    """Identify which fetching strategy to use based on the URL."""
    if "docs.google.com/spreadsheets" in url:
        return "google_sheets"
    if "rowresults.co.uk" in url:
        return "rowresults"
    return "static_html"


# ── FETCHERS ──────────────────────────────────────────────────────────────────

def fetch_google_sheets(url: str) -> str:
    """
    Export a public Google Sheet as CSV by swapping the URL pattern.
    Works for any publicly shared sheet.
    """
    requests = _import_requests()

    # Extract sheet ID and gid
    match = re.search(r'/spreadsheets/d/([a-zA-Z0-9_-]+)', url)
    if not match:
        print("  Error: could not extract sheet ID from URL")
        sys.exit(1)
    sheet_id = match.group(1)

    gid_match = re.search(r'gid=(\d+)', url)
    gid = gid_match.group(1) if gid_match else "0"

    export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    print(f"  Fetching Google Sheet as CSV...")

    response = requests.get(export_url, timeout=15)
    if response.status_code != 200:
        print(f"  Error: HTTP {response.status_code}. Is the sheet publicly shared?")
        sys.exit(1)

    print(f"  Fetched {len(response.text)} characters")
    return response.text


def fetch_static_html(url: str) -> str:
    """
    Fetch a static HTML page and return its text content.
    Works for wallingford-regatta.org.uk and similar.
    """
    requests = _import_requests()
    BeautifulSoup = _import_bs4()

    print(f"  Fetching static HTML page...")
    headers = {"User-Agent": "Mozilla/5.0 (compatible; RowingTools/1.0)"}
    response = requests.get(url, headers=headers, timeout=15)

    if response.status_code != 200:
        print(f"  Error: HTTP {response.status_code}")
        sys.exit(1)

    soup = BeautifulSoup(response.text, "html.parser")

    # Remove nav, header, footer, scripts — keep content
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)
    # Collapse excessive blank lines
    text = re.sub(r'\n{3,}', '\n\n', text)

    print(f"  Fetched {len(text)} characters")
    return text


def fetch_rowresults(url: str) -> str:
    """
    Fetch a rowresults.co.uk page using Selenium headless Chrome.
    Waits for the results table to render before extracting.
    """
    webdriver, Options, WebDriverWait, EC, By = _import_selenium()
    BeautifulSoup = _import_bs4()

    print(f"  Launching headless Chrome for rowresults.co.uk...")
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")

    driver = webdriver.Chrome(options=options)

    try:
        driver.get(url)

        # Wait for results table to populate — rowresults loads via JS
        print("  Waiting for results to render...")
        time.sleep(4)

        # Filter to Finals only via the dropdown if present
        try:
            from selenium.webdriver.support.ui import Select
            round_select = driver.find_element(By.XPATH, "//select[option[contains(text(),'Finals')]]")
            select = Select(round_select)
            select.select_by_visible_text("Finals")
            time.sleep(2)
            print("  Filtered to Finals")
        except Exception:
            print("  Could not find Finals filter, using all results")

        html = driver.page_source
    finally:
        driver.quit()

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav"]):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r'\n{3,}', '\n\n', text)

    print(f"  Fetched {len(text)} characters")
    return text


# ── CLAUDE EXTRACTION ─────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are extracting rowing regatta results from raw text.

Your job:
1. Find FINAL results only (ignore heats, eliminators, semis, time trials)
2. For each final, extract the WINNER only (position 1)
3. Map the event name to a standard boat class code
4. Return results as JSON array

Boat class codes to use:
M8+ = Men's eight, W8+ = Women's eight
M4- = Men's coxless four, W4- = Women's coxless four
M4x = Men's quad scull, W4x = Women's quad scull
M4+ = Men's coxed four, W4+ = Women's coxed four
M2- = Men's coxless pair, W2- = Women's coxless pair
M2x = Men's double scull, W2x = Women's double scull
M2+ = Men's coxed pair
M1x = Men's single scull, W1x = Women's single scull
LM4- = Lwt men's four, LM2x = Lwt men's double, LM1x = Lwt men's single
LW2x = Lwt women's double, LW1x = Lwt women's single

Rules:
- "Op" or "Open" = Men's (M prefix) unless clearly women's
- "W" or "Women" = Women's (W prefix)
- "Lwt" or "Lightweight" = add L prefix
- Championship/Club/Academic/Academic B distinctions do not change the boat class code
- If a time looks wrong (e.g. faster than WBT for that class) flag it with a note
- For the event_label use the full original event name from the results
- Times should be in m:ss.ss format e.g. 5:52.13

Return ONLY valid JSON, no preamble, no markdown, no explanation. Format:
[
  {
    "event_label": "Open Championship Eight - Final A",
    "boat_class": "M8+",
    "winner": "Thames RC",
    "time": "5:52.13",
    "note": ""
  }
]

If you cannot determine the boat class with confidence, use your best guess and add a note.
If the time is missing or unparseable, omit that result.

Raw results text:
"""


def extract_with_claude(raw_text: str, api_key: str) -> list[dict]:
    """Send raw results text to Claude and get back structured JSON."""
    anthropic = _import_anthropic()

    client = anthropic.Anthropic(api_key=api_key)

    # Truncate if very long — Claude has context limits and we don't need
    # every character, just enough to find the finals
    if len(raw_text) > 80000:
        print(f"  Text is long ({len(raw_text)} chars), truncating to 80k...")
        raw_text = raw_text[:80000]

    print("  Sending to Claude for extraction...")

    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4000,
        messages=[{
            "role": "user",
            "content": EXTRACTION_PROMPT + raw_text
        }]
    )

    response_text = message.content[0].text.strip()

    # Strip markdown fences if Claude wrapped in them
    response_text = re.sub(r'^```json\s*', '', response_text)
    response_text = re.sub(r'^```\s*', '', response_text)
    response_text = re.sub(r'\s*```$', '', response_text)

    try:
        import json
        results = json.loads(response_text)
        print(f"  Claude extracted {len(results)} final results")
        return results
    except json.JSONDecodeError as e:
        print(f"  Error parsing Claude response as JSON: {e}")
        print(f"  Raw response: {response_text[:500]}")
        sys.exit(1)


# ── GMT PROCESSING ────────────────────────────────────────────────────────────

def process_and_rank(extracted: list[dict]) -> list[dict]:
    """Apply GMT calculations to extracted results and rank by WBT%."""
    # Import from the local benchmarks module
    sys.path.insert(0, os.path.dirname(__file__))
    from gmt_processor import process_results, rank_results

    # Convert Claude's output format to gmt_processor's expected format
    rows = []
    for r in extracted:
        rows.append({
            "label":       f"{r.get('event_label', '')} - {r.get('winner', '')}",
            "time":        r.get("time", ""),
            "boat_class":  r.get("boat_class", ""),
            "henley_event": "",  # not set at scrape time, can be added manually
        })

    processed = process_results(rows)
    ranked = rank_results(processed, sort_by="wbt_pct")
    return ranked


# ── OUTPUT ────────────────────────────────────────────────────────────────────

def print_table(ranked: list[dict], top_n: int = None, source_label: str = ""):
    """Print ranked results table."""
    from gmt_processor import print_table as _print_table
    if source_label:
        print(f"\n  Source: {source_label}")
    _print_table(ranked, top_n=top_n)


def save_csv(ranked: list[dict], output_path: str):
    """Save to CSV."""
    from gmt_processor import save_csv as _save_csv
    _save_csv(ranked, output_path)


# ── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Rowing Tools - fetch and process regatta results from a URL"
    )
    parser.add_argument("--url",    "-u", required=True, help="URL to fetch results from")
    parser.add_argument("--output", "-o", help="Save ranked results to CSV")
    parser.add_argument("--top",    "-t", type=int, help="Show top N results only")
    parser.add_argument("--raw",          action="store_true",
                        help="Print raw fetched text before sending to Claude (debug)")
    args = parser.parse_args()

    # API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        # Try .env file
        env_path = os.path.join(os.path.dirname(__file__), ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("ANTHROPIC_API_KEY="):
                        api_key = line.strip().split("=", 1)[1]
    if not api_key:
        print("  Error: ANTHROPIC_API_KEY not set.")
        print("  Either: export ANTHROPIC_API_KEY=your_key")
        print("  Or create a .env file with: ANTHROPIC_API_KEY=your_key")
        sys.exit(1)

    # Detect source and fetch
    source_type = detect_source_type(args.url)
    print(f"\n  Source type: {source_type}")

    if source_type == "google_sheets":
        raw_text = fetch_google_sheets(args.url)
    elif source_type == "rowresults":
        raw_text = fetch_rowresults(args.url)
    else:
        raw_text = fetch_static_html(args.url)

    if args.raw:
        print("\n--- RAW TEXT ---")
        print(raw_text[:3000])
        print("--- END RAW TEXT ---\n")

    # Extract with Claude
    extracted = extract_with_claude(raw_text, api_key)

    # Process GMTs and rank
    ranked = process_and_rank(extracted)

    # Output
    print_table(ranked, top_n=args.top, source_label=args.url)

    if args.output:
        save_csv(ranked, args.output)
        print(f"\n  Done. Results saved to {args.output}")


if __name__ == "__main__":
    main()
