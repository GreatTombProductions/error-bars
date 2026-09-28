#!/usr/bin/env python3
"""Data contract tests for the Error Bars generated dataset.

Run: python3 -m pytest tests/test_data_contract.py -q
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

PROJECT = Path(__file__).resolve().parents[1]
GEN = PROJECT / "data" / "generated"
RAW = PROJECT / "data" / "raw"

sys.path.insert(0, str(PROJECT / "pipeline"))
from variables import VARS  # noqa: E402

N_VARS = len(VARS)
ROW_WIDTH = 1 + 2 * N_VARS  # geoid + E/M pairs


def load(name: str):
    return json.loads((GEN / name).read_text())


def test_meta_contract():
    meta = load("meta.json")
    assert "2024" in meta["vintage"]
    assert "acs5" in meta["api"]
    counts = meta["counts"]
    assert counts["states"] == 52
    assert counts["counties"] > 3000
    assert counts["tracts"] > 80000
    assert counts["blockgroups"] > 230000
    assert counts["zips"] > 30000
    assert counts["requests"] >= 107
    assert len(meta["variables"]) == N_VARS
    keys = [v["key"] for v in meta["variables"]]
    assert keys == [v["key"] for v in VARS]
    # block-group availability flag must match the pipeline contract
    assert [v["bg"] for v in meta["variables"]] == [v["bg"] for v in VARS]


def test_states():
    states = load("states.json")
    assert len(states) == 52
    fips = {s[0] for s in states}
    assert "06" in fips and "11" in fips and "72" in fips
    assert all(len(s) == 3 for s in states)


def test_counties():
    counties = load("counties.json")
    assert len(counties) == load("meta.json")["counts"]["counties"]
    for row in counties[:50] + counties[-50:]:
        assert len(row) == 4 + 2 * N_VARS, f"bad width for {row[0]}"
        geoid, name, sfips, abbr = row[:4]
        assert re.fullmatch(r"\d{5}", geoid)
        assert geoid[:2] == sfips
        assert name and abbr
    # LA County lives at 06037 and has a plausible population
    la = next(r for r in counties if r[0] == "06037")
    assert la[1] == "Los Angeles County"
    assert 9_000_000 < la[4] < 11_000_000
    # Population margins: this vintage marks most county population margins
    # "not applicable" (jam) -- the parse must null them, and both categories
    # must exist (jam handling + real margins both present).
    real = sum(1 for r in counties if r[5] is not None)
    assert 0 < real < len(counties), "expected a mix of published and jam population margins"
    assert la[5] is None, "LA population margin should be jam -> null"
    assert la[6] is not None, "LA median-age margin should be present"


def test_letter_index():
    counties = load("counties.json")
    total = 0
    files = 0
    for path in (GEN / "i").glob("*.json"):
        rows = json.loads(path.read_text())
        files += 1
        total += len(rows)
        for r in rows:
            assert len(r) == 3
            assert re.fullmatch(r"\d{5}", r[0])
    assert files >= 20
    assert total == len(counties)


def test_zips():
    zips = load("zips.json")
    assert len(zips) > 30000
    sample = ["90001", "10001", "60601", "00601"]
    for z in sample:
        assert z in zips, f"missing {z}"
        assert zips[z] and all(re.fullmatch(r"\d{5}", c) for c in zips[z])
    assert zips["90001"][0] == "06037"  # LA
    assert zips["10001"][0] in ("36061", "36085", "36047", "36081", "36005")  # NYC boroughs


def test_shards():
    counties = load("counties.json")
    county_ids = {r[0] for r in counties}
    assert len(list((GEN / "c").glob("*.json"))) >= len(counties) - 5  # near-total coverage
    for geoid in ("06037", "17031", "11001", "48201"):
        assert geoid in county_ids
        shard = json.loads((GEN / "c" / f"{geoid}.json").read_text())
        assert shard["v"] == 1
        assert len(shard["t"]) > 0, geoid
        tract_keys = set()
        for row in shard["t"]:
            assert len(row) == ROW_WIDTH, f"tract row width {len(row)} in {geoid}"
            assert re.fullmatch(r"\d{11}", row[0])
            tract_keys.add(row[0])
        if geoid == "06037":
            # tract-level population margins ARE published (unlike most counties)
            assert all(row[2] is not None for row in shard["t"])
        assert len(shard["b"]) > 0, geoid
        for row in shard["b"]:
            assert len(row) == ROW_WIDTH, f"bg row width {len(row)} in {geoid}"
            assert re.fullmatch(r"\d{12}", row[0])
            assert row[0][:11] in tract_keys, f"orphan block group {row[0]}"


def test_poverty_grain_rule():
    """B17001 is not published at block-group grain: bg rows must carry null
    poverty, tract rows must carry values (spot check on a real county)."""
    pov = next(i for i, v in enumerate(VARS) if v["key"] == "pov_below")
    shard = json.loads((GEN / "c" / "17031.json").read_text())
    bg_vals = [row[1 + 2 * pov] for row in shard["b"]]
    tract_vals = [row[1 + 2 * pov] for row in shard["t"]]
    assert all(v is None for v in bg_vals), "block-group poverty should be null everywhere"
    assert any(v is not None for v in tract_vals), "tract poverty should have values"


def test_receipts_redacted_and_complete():
    receipts = json.loads((RAW / "receipts.json").read_text())
    assert len(receipts["requests"]) >= 107
    levels = {r["level"] for r in receipts["requests"]}
    assert levels == {"state", "county", "crosswalk", "tract", "blockgroup"}
    for r in receipts["requests"]:
        assert re.fullmatch(r"[0-9a-f]{64}", r["sha256"])
        assert r["bytes"] > 0 and r["rows"] > 0
        assert not re.search(r"key=(?!REDACTED)", r["url"]), "API key leaked into receipts"
        assert ("api.census.gov" in r["url"]) or ("www2.census.gov" in r["url"])


def test_numeric_plausibility():
    """Sample of county rows: counts non-negative, medians positive, no jam sentinels."""
    counties = load("counties.json")
    for row in counties:
        nums = [x for x in row[4:] if x is not None]
        assert all(abs(x) < 100_000_000 for x in nums), f"jam sentinel left in {row[0]}"
    for row in counties:
        pop, pop_moe = row[4], row[5]
        if pop is not None:
            assert pop >= 0


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
