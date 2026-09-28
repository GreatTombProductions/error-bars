#!/usr/bin/env python3
"""Shared variable contract for the Error Bars pipeline.

The order of VARS is the FIELD-ORDER CONTRACT for every compact record array
built by build.py and consumed by frontend/stats.js:

    row = [geoid, E0, M0, E1, M1, ..., E10, M10]

where (Ei, Mi) are the estimate and 90%-confidence margin of error for
VARS[i]. Do not reorder without updating both sides (build.py docstring and
frontend/stats.js accessor conventions).

`bg`: whether the detailed table is published at block-group grain. ACS does
not publish B17001 (poverty) at block-group grain; the API returns null there.
The frontend renders those cells as "not published at this grain".
"""

VINTAGE = "2024"
API_BASE = f"https://api.census.gov/data/{VINTAGE}/acs/acs5"
VINTAGE_LABEL = "2024 ACS 5-year estimates (2020-2024)"

VARS = [
    {"key": "total_pop",     "id": "B01003_001", "label": "Total population",                 "kind": "count",  "unit": "persons", "bg": True},
    {"key": "median_age",    "id": "B01002_001", "label": "Median age",                       "kind": "median", "unit": "years",   "bg": True},
    {"key": "hu_total",      "id": "B25001_001", "label": "Total housing units",              "kind": "count",  "unit": "units",   "bg": True},
    {"key": "owner_occ",     "id": "B25003_002", "label": "Owner-occupied housing units",     "kind": "count",  "unit": "units",   "bg": True},
    {"key": "renter_occ",    "id": "B25003_003", "label": "Renter-occupied housing units",    "kind": "count",  "unit": "units",   "bg": True},
    {"key": "med_rent",      "id": "B25064_001", "label": "Median gross rent",                "kind": "median", "unit": "dollars", "bg": True},
    {"key": "med_value",     "id": "B25077_001", "label": "Median home value",                "kind": "median", "unit": "dollars", "bg": True},
    {"key": "med_hh_income", "id": "B19013_001", "label": "Median household income",          "kind": "median", "unit": "dollars", "bg": True},
    {"key": "pov_below",     "id": "B17001_002", "label": "Population below poverty level",   "kind": "count",  "unit": "persons", "bg": False},
    {"key": "unemployed",    "id": "B23025_005", "label": "Unemployed (civilian labor force)","kind": "count",  "unit": "persons", "bg": True},
    {"key": "labor_force",   "id": "B23025_003", "label": "Civilian labor force",             "kind": "count",  "unit": "persons", "bg": True},
]

KEYS = [v["key"] for v in VARS]


def get_param() -> str:
    """The Census API `get=` value: NAME + all estimates + all margins."""
    return ",".join(["NAME"] + [v["id"] + "E" for v in VARS] + [v["id"] + "M" for v in VARS])


def meta_for_frontend() -> dict:
    """Variable metadata as shipped to the frontend (data/meta.json)."""
    return {
        "variables": [
            {
                "key": v["key"],
                "id": v["id"],
                "label": v["label"],
                "kind": v["kind"],
                "unit": v["unit"],
                "bg": v["bg"],
            }
            for v in VARS
        ]
    }
