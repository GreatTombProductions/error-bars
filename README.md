# Error Bars

Small-area statistics with their margins.

The U.S. Census Bureau publishes a margin of error with every American Community Survey
estimate. Dashboards, market reports, ranking sites, and property platforms usually drop it.
Error Bars puts it back: every statistic is shown as **estimate ± margin**, with the implied
90%-confidence range, a reliability flag, and a checker that tells you whether a number you
found elsewhere is statistically distinguishable from the Census estimate.

**Live:** https://greattombproductions.github.io/error-bars/

## Data

- **Estimates + margins:** 2024 ACS 5-year detailed tables (`api.census.gov/data/2024/acs/acs5`),
  covering all counties, census tracts, and block groups in the 50 states, DC, and Puerto Rico.
- **ZIP → county lookup:** Census 2020 ZCTA-to-county relationship file (land-area overlap).
- Every fetch is receipt-tracked (bytes, rows, SHA-256, timestamp) in `data/raw/receipts.json`;
  the receipts render on the deployed method page.

Variables: total population, median age, total housing units, owner/renter-occupied units,
median gross rent, median home value, median household income, population below poverty
(tract+ only — see below), unemployed, civilian labor force.

## Grain notes

- ACS does not publish some tables at block-group level (poverty, for example). Those cells
  say so instead of showing a guessed value. Missing ≠ zero.
- Reliability flags follow Census guidance for counts (CV below 15% reliable; 15–30% caution;
  above 30% unreliable; standard error = margin ÷ 1.645). For medians there is no official CV
  rule, so the flag is an explicitly labeled display heuristic.

## Layout

```
pipeline/variables.py   shared variable + field-order contract
pipeline/fetch.py       API fetches (resumable, receipted) -> data/raw/
pipeline/build.py       raw -> data/generated/ (shards, indexes, meta)
frontend/               static site (no build step, no backend)
tests/                  data contract + stats math + Playwright smoke
deploy.sh               gates + stage + push to gh-pages
```

## Refresh

```bash
python3 pipeline/fetch.py      # re-run only after a vintage bump or to re-pin
python3 pipeline/build.py
./deploy.sh
```

The upstream updates yearly (each fall's 5-year release). The receipts pin the exact snapshot
the site serves.

## License

MIT (code). Census Bureau data is public domain.
