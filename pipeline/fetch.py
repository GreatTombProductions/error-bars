#!/usr/bin/env python3
"""Fetch ACS 2024 5-year estimates + margins of error for every US county,
census tract, and block group (50 states + DC + Puerto Rico).

Source: api.census.gov /data/2024/acs/acs5 (detailed tables, 2020-2024).
Requests: one for the state list, one for all counties, then per state one
tract request and one block-group request (multi-level wildcards) -- 106
requests total for the full country.

Resumable: raw files already on disk are skipped. Receipts for every request
(bytes, sha256, rows, fetched_at; API key redacted) accumulate in
data/raw/receipts.json -- committed as the snapshot pin.

Usage:
    python3 pipeline/fetch.py                 # full country (resumable)
    python3 pipeline/fetch.py --states 50,11  # only these state FIPS
    python3 pipeline/fetch.py --force         # refetch existing files
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from variables import API_BASE, VARS, get_param  # noqa: E402

PROJECT = Path(__file__).resolve().parents[1]
RAW = PROJECT / "data" / "raw"
RECEIPTS = RAW / "receipts.json"
KEY_PATH = Path("/home/ray/.greattomb/census-api-key")
CROSSWALK_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
PACE_SECONDS = 0.4


def _key() -> str:
    env = os.environ.get("CENSUS_API_KEY")
    if env:
        return env.strip()
    if KEY_PATH.exists():
        return KEY_PATH.read_text().strip()
    return ""


def _url(for_value: str, *in_values: str) -> str:
    params = [("get", get_param()), ("for", for_value)]
    params += [("in", v) for v in in_values]
    key = _key()
    if key:
        params.append(("key", key))
    return API_BASE + "?" + urllib.parse.urlencode(params)


def _url_redacted(url: str) -> str:
    return url.replace(_key(), "REDACTED") if _key() else url


def _fetch(url: str, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                return r.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last = exc
            wait = 3 * (attempt + 1)
            print(f"    retry in {wait}s after {exc!r}", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"fetch failed after {attempts} attempts: {last!r}")


def _load_receipts() -> dict:
    if RECEIPTS.exists():
        return json.loads(RECEIPTS.read_text())
    return {
        "source": API_BASE,
        "vintage": "2024 ACS 5-year (2020-2024)",
        "variables": [v["id"] for v in VARS],
        "requests": [],
    }


def _save_receipts(doc: dict) -> None:
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    tmp = RECEIPTS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=1))
    tmp.replace(RECEIPTS)


def _record(doc: dict, level: str, path: str, url: str, raw: bytes, rows: int) -> None:
    entry = {
        "level": level,
        "path": path,
        "url": _url_redacted(url),
        "bytes": len(raw),
        "rows": rows,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    doc["requests"] = [r for r in doc["requests"] if not (r["level"] == level and r["path"] == path)]
    doc["requests"].append(entry)
    _save_receipts(doc)


def _fetch_level(doc: dict, level: str, rel: str, url: str, force: bool) -> tuple[int, bool]:
    target = RAW / rel
    if target.exists() and not force:
        raw = target.read_bytes()
        rows = len(json.loads(raw)) - 1
        print(f"  [{level}] {rel} exists ({rows} rows) -- skipped", flush=True)
        return rows, False
    print(f"  [{level}] fetching {_url_redacted(url)[:130]}...", flush=True)
    t0 = time.time()
    raw = _fetch(url)
    payload = json.loads(raw)
    if not isinstance(payload, list) or not payload:
        raise RuntimeError(f"unexpected payload for {rel}: {payload!r}"[:300])
    rows = len(payload) - 1
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    _record(doc, level, rel, url, raw, rows)
    print(f"  [{level}] {rel}: {rows} rows, {len(raw)} bytes in {time.time()-t0:.1f}s", flush=True)
    time.sleep(PACE_SECONDS)
    return rows, True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", default="", help="comma-separated state FIPS to fetch (default: all)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    doc = _load_receipts()
    only = {s.strip() for s in args.states.split(",") if s.strip()}

    # 1. State list
    url = _url("state:*")
    _fetch_level(doc, "state", "states.json", url, args.force)

    # 2. All counties in one request
    url = _url("county:*", "state:*")
    _fetch_level(doc, "county", "counties.json", url, args.force)

    # 2b. ZCTA-to-county crosswalk (2020 relationship file, plain text)
    crosswalk = RAW / "zcta_county_rel.txt"
    have_receipt = any(r["path"] == "zcta_county_rel.txt" for r in doc["requests"])
    if crosswalk.exists() and have_receipt and not args.force:
        print("  [crosswalk] zcta_county_rel.txt exists with receipt -- skipped", flush=True)
    else:
        print(f"  [crosswalk] fetching {CROSSWALK_URL}", flush=True)
        raw = _fetch(CROSSWALK_URL)
        crosswalk.write_bytes(raw)
        _record(doc, "crosswalk", "zcta_county_rel.txt", CROSSWALK_URL, raw, raw.count(b"\n") - 1)
        print(f"  [crosswalk] zcta_county_rel.txt: {len(raw)} bytes", flush=True)
        time.sleep(PACE_SECONDS)

    payload = json.loads((RAW / "states.json").read_text())
    header = payload[0]
    si = header.index("state")
    states = [(row[0], row[si]) for row in payload[1:]]
    fips = [st for _, st in states]
    if only:
        fips = [f for f in fips if f in only]

    # 3. Per state: tracts, then block groups
    for i, st in enumerate(fips, 1):
        name = next(nm for nm, f in states if f == st)
        print(f"[{i}/{len(fips)}] {st} {name}", flush=True)
        url = _url("tract:*", f"state:{st}", "county:*")
        _fetch_level(doc, "tract", f"tracts/{st}.json", url, args.force)
        url = _url("block group:*", f"state:{st}", "county:*", "tract:*")
        _fetch_level(doc, "blockgroup", f"blockgroups/{st}.json", url, args.force)

    done = len(fips)
    print(f"done: {done} states processed; total requests recorded: {len(doc['requests'])}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
