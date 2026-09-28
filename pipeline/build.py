#!/usr/bin/env python3
"""Build the Error Bars static dataset from raw ACS payloads.

Inputs (data/raw/): states.json, counties.json, tracts/<st>.json,
blockgroups/<st>.json, zcta_county_rel.txt, receipts.json.

Outputs (data/generated/):
  meta.json       -- vintage, variable contract, counts, receipt summary
  states.json     -- [[fips, name, abbr], ...]
  counties.json   -- [[geoid, name, state_fips, abbr, E0, M0, ...], ...]
  c/<geoid>.json  -- per-county shard: {"v":1, "t":[[...tract rows]], "b":[[...bg rows]]}
  i/<letter>.json -- county search index: [[geoid, name, abbr], ...] (a-z + other)
  zips.json       -- {"00601": ["72001", ...]} ZCTA -> counties (land-area share desc)
  receipts.json   -- copy of the fetch receipts (staged to the site as data/receipts.json)

COMPACT ROW CONTRACT (field order is load-bearing; mirrored in frontend/stats.js):

    row = [geoid, E0, M0, E1, M1, ..., E10, M10]

where (Ei, Mi) = estimate + 90% MOE for pipeline/variables.py VARS[i].
Missing / jam values are null. County rows carry 4 leading strings
(geoid, name, state_fips, abbr) before the numeric block.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from variables import VARS, VINTAGE, API_BASE, VINTAGE_LABEL, meta_for_frontend  # noqa: E402

PROJECT = Path(__file__).resolve().parents[1]
RAW = PROJECT / "data" / "raw"
GEN = PROJECT / "data" / "generated"

STATE_ABBR = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
    "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
    "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
    "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
    "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
    "55": "WI", "56": "WY", "72": "PR",
}

JAM_THRESHOLD = 100_000_000  # |v| above this is an ACS jam sentinel (e.g. -666666666)


def num(value):
    """Normalize an ACS cell: numeric, or None for missing/jam."""
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        try:
            f = float(value)
        except ValueError:
            return None
    else:
        f = float(value)
    if abs(f) >= JAM_THRESHOLD:
        return None
    if f.is_integer():
        return int(f)
    return round(f, 1)


def load_payload(path: Path):
    payload = json.loads(path.read_text())
    header = payload[0]
    return header, payload[1:]


def idx_for(header, name):
    return header.index(name)


def rows_to_compact(header, rows, geo_cols, geo_builder, require_len):
    e_idx = [idx_for(header, v["id"] + "E") for v in VARS]
    m_idx = [idx_for(header, v["id"] + "M") for v in VARS]
    g_idx = [idx_for(header, c) for c in geo_cols]
    out = []
    for row in rows:
        geoid = geo_builder([row[i] for i in g_idx])
        if geoid is None:
            continue
        record = [geoid]
        for ei, mi in zip(e_idx, m_idx):
            record.append(num(row[ei]))
            record.append(num(row[mi]))
        assert len(record) == require_len, f"row width {len(record)} != {require_len} for {geoid}"
        out.append(record)
    return out


def parse_county_name(full: str) -> tuple[str, str]:
    # "Los Angeles County, California" -> ("Los Angeles County", "California")
    if ", " in full:
        name, state_name = full.rsplit(", ", 1)
        return name, state_name
    return full, ""


def main() -> int:
    GEN.mkdir(parents=True, exist_ok=True)
    (GEN / "c").mkdir(exist_ok=True)
    (GEN / "i").mkdir(exist_ok=True)

    # ---- states ----
    header, rows = load_payload(RAW / "states.json")
    si = idx_for(header, "state")
    states = []
    for row in rows:
        fips, name = row[si], row[0]
        abbr = STATE_ABBR.get(fips)
        if abbr is None:
            print(f"  [skip] non-ACS state fips {fips} ({name})")
            continue
        states.append([fips, name, abbr])
    states.sort(key=lambda r: r[1])
    (GEN / "states.json").write_text(json.dumps(states, separators=(",", ":")))
    print(f"states: {len(states)}")

    # ---- counties ----
    header, rows = load_payload(RAW / "counties.json")
    name_i = 0
    si = idx_for(header, "state")
    ci = idx_for(header, "county")
    e_idx = [idx_for(header, v["id"] + "E") for v in VARS]
    m_idx = [idx_for(header, v["id"] + "M") for v in VARS]
    counties = []
    for row in rows:
        geoid = row[si] + row[ci]
        if geoid[:2] not in STATE_ABBR:
            continue
        name, _ = parse_county_name(row[name_i])
        record = [geoid, name, geoid[:2], STATE_ABBR[geoid[:2]]]
        for ei, mi in zip(e_idx, m_idx):
            record.append(num(row[ei]))
            record.append(num(row[mi]))
        counties.append(record)
    counties.sort(key=lambda r: r[0])
    (GEN / "counties.json").write_text(json.dumps(counties, separators=(",", ":")))
    county_ids = {r[0] for r in counties}
    print(f"counties: {len(counties)}")

    # ---- tracts + block groups, sharded per county ----
    tract_total, bg_total, shards = 0, 0, 0
    shard_data: dict[str, dict] = {}
    for path in sorted((RAW / "tracts").glob("*.json")):
        header, rows = load_payload(path)
        tracts = rows_to_compact(header, rows, ["state", "county", "tract"],
                                 lambda g: g[0] + g[1] + g[2], require_len=1 + 2 * len(VARS))
        for rec in tracts:
            shard_data.setdefault(rec[0][:5], {"t": [], "b": []})["t"].append(rec)
        tract_total += len(tracts)
    for path in sorted((RAW / "blockgroups").glob("*.json")):
        header, rows = load_payload(path)
        bgs = rows_to_compact(header, rows, ["state", "county", "tract", "block group"],
                              lambda g: g[0] + g[1] + g[2] + g[3], require_len=1 + 2 * len(VARS))
        for rec in bgs:
            shard_data.setdefault(rec[0][:5], {"t": [], "b": []})["b"].append(rec)
        bg_total += len(bgs)
    for geoid, payload in sorted(shard_data.items()):
        if geoid not in county_ids:
            print(f"  [warn] shard for unknown county {geoid} has {len(payload['t'])}t/{len(payload['b'])}b")
        payload["v"] = 1
        (GEN / "c" / f"{geoid}.json").write_text(json.dumps(payload, separators=(",", ":")))
        shards += 1
    print(f"tracts: {tract_total}; block groups: {bg_total}; shards: {shards}")

    # ---- letter index ----
    letters: dict[str, list] = {}
    for geoid, name, _sfips, abbr, *_ in counties:
        key = name[0].upper() if name[:1].isalpha() else "other"
        key = key if key.isalpha() else "other"
        letters.setdefault(key.lower(), []).append([geoid, name, abbr])
    for key, entries in letters.items():
        (GEN / "i" / f"{key}.json").write_text(json.dumps(entries, separators=(",", ":")))
    print(f"index letters: {len(letters)}")

    # ---- zips ----
    zips: dict[str, list[tuple[int, str]]] = {}
    dropped = 0
    rel = RAW / "zcta_county_rel.txt"
    with rel.open(encoding="utf-8-sig") as f:
        head = f.readline().split("|")
        zi = head.index("GEOID_ZCTA5_20")
        ci = head.index("GEOID_COUNTY_20")
        ai = head.index("AREALAND_PART")
        for line in f:
            parts = line.rstrip("\n").split("|")
            if len(parts) <= max(zi, ci, ai):
                continue
            zcta, county = parts[zi].strip(), parts[ci].strip()
            if not zcta or not county:
                continue
            if county not in county_ids:
                dropped += 1
                continue
            try:
                area = int(parts[ai] or 0)
            except ValueError:
                area = 0
            zips.setdefault(zcta, []).append((area, county))
    zip_map = {z: [c for _a, c in sorted(v, reverse=True)[:4]] for z, v in sorted(zips.items())}
    (GEN / "zips.json").write_text(json.dumps(zip_map, separators=(",", ":")))
    print(f"zips: {len(zip_map)} (dropped parts for unknown counties: {dropped})")

    # ---- receipts copy + meta ----
    receipts = json.loads((RAW / "receipts.json").read_text())
    (GEN / "receipts.json").write_text(json.dumps(receipts, indent=1))

    meta = {
        "name": "Error Bars",
        "vintage": VINTAGE_LABEL,
        "vintage_year": VINTAGE,
        "api": API_BASE,
        "retrieved_at": receipts.get("updated_at"),
        "counts": {
            "states": len(states),
            "counties": len(counties),
            "tracts": tract_total,
            "blockgroups": bg_total,
            "zips": len(zip_map),
            "requests": len(receipts.get("requests", [])),
        },
        "receipt": {
            "source": receipts.get("source"),
            "requests": len(receipts.get("requests", [])),
            "updated_at": receipts.get("updated_at"),
            "variables": receipts.get("variables", []),
        },
    }
    meta.update(meta_for_frontend())
    (GEN / "meta.json").write_text(json.dumps(meta, indent=1))
    print("meta written")
    print(json.dumps(meta["counts"], indent=1))

    assert len(counties) > 3000, "county count too low"
    assert tract_total > 80000, "tract count too low"
    assert bg_total > 230000, "block-group count too low"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
