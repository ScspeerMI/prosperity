# The Prosperity Gap

GDP per person in Canada and the United States, nationally since 1970 and by
province and state. Published at https://seanspeer.com/prosperity/.

- `build.py` fetches the data and writes `docs/data.json`. It uses only Python's
  standard library: `python build.py`.
- `docs/` is the page (GitHub Pages serves this folder).
- `.github/workflows/refresh.yml` runs `build.py` every day and commits
  `docs/data.json` if anything changed.

## Sources
- OECD: GDP per capita at current and constant purchasing-power parities, and
  Canada's purchasing-power parity and exchange rate.
- Statistics Canada: Table 36-10-0222-01 (provincial GDP) and Table 17-10-0005-01
  (population).
- US Bureau of Economic Analysis: SAGDP2 (state GDP) and SAINC1 (state population).

None of them needs an API key.

## Safety checks
`build.py` will not write new data unless all of these hold:
- there are 50 states and 10 provinces;
- every value is plausible;
- the provinces add up to within 4% of the OECD's national figure for Canada;
- the national series reaches a recent year.

If a check fails, the page keeps its last good numbers.

## Preview locally
```
python -m http.server 8769 --directory docs
```
Then open http://localhost:8769.
