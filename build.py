"""Build docs/data.json for The Prosperity Gap.

    python build.py

Fetches GDP per person for Canada and the United States (OECD), and GDP and
population by province (Statistics Canada) and by state (US Bureau of Economic
Analysis), then writes one data file the page reads. Standard library only, so
the daily GitHub Action needs no installs.

If any source fails or returns something implausible, the script stops without
touching docs/data.json, so the live page keeps its last good numbers.
"""

import csv
import io
import json
import sys
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "docs" / "data.json"
UA = {"User-Agent": "prosperity-gap/0.1 (research use)"}

OECD = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NAMAIN10@{flow},/all?format=csvfilewithlabels"
WDS = "https://www150.statcan.gc.ca/t1/wds/rest/"
BEA = "https://apps.bea.gov/regional/zip/{}.zip"

PROVINCES = ["Newfoundland and Labrador", "Prince Edward Island", "Nova Scotia", "New Brunswick", "Quebec",
             "Ontario", "Manitoba", "Saskatchewan", "Alberta", "British Columbia"]
TERRITORIES = ["Yukon", "Northwest Territories", "Nunavut"]
SHORT = {"Newfoundland and Labrador": "N.L.", "Prince Edward Island": "P.E.I.", "Nova Scotia": "N.S.",
         "New Brunswick": "N.B.", "Quebec": "Que.", "Ontario": "Ont.", "Manitoba": "Man.", "Saskatchewan": "Sask.",
         "Alberta": "Alta.", "British Columbia": "B.C.", "Yukon": "Y.T.", "Northwest Territories": "N.W.T.",
         "Nunavut": "Nvt."}


def get(url, data=None, timeout=180):
    headers = dict(UA, **({"Content-Type": "application/json"} if data else {}))
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def source(name, url, note=""):
    return {"source": name, "url": url, "retrieved": date.today().isoformat(), "notes": note}


# --- OECD: national GDP per person and conversion rates ---

def oecd_rows(flow):
    text = get(OECD.format(flow=flow)).decode("utf-8")
    return [r for r in csv.DictReader(io.StringIO(text)) if r["REF_AREA"] in ("CAN", "USA")]


def oecd_series(rows, transaction, status=None):
    """{area: {year: value}}. Stops if a year appears twice, rather than letting the last row win."""
    out = {"CAN": {}, "USA": {}}
    for r in rows:
        if r["TRANSACTION"] == transaction and r["OBS_VALUE"]:
            year = int(r["TIME_PERIOD"])
            if year in out[r["REF_AREA"]]:
                sys.exit(f"Not publishing: OECD returned two {transaction} values for {r['REF_AREA']} {year}.")
            out[r["REF_AREA"]][year] = float(r["OBS_VALUE"])
            if status is not None:
                status[(r["REF_AREA"], year)] = r.get("OBS_STATUS", "")
    return out


# --- Statistics Canada: provincial GDP and population ---

def statcan(pid, rest, n):
    """Latest n annual values for each province and territory, matched by name."""
    meta = json.loads(get(WDS + "getCubeMetadata", [{"productId": pid}]))[0]["object"]
    members = {m["memberNameEn"]: m["memberId"] for m in meta["dimension"][0]["member"]}
    places = PROVINCES + TERRITORIES
    payload = [{"productId": pid, "coordinate": f"{members[p]}.{rest}", "latestN": n} for p in places]
    res = json.loads(get(WDS + "getDataFromCubePidCoordAndLatestNPeriods", payload))
    # Responses don't come back in request order; key them by geography id.
    by_id = {o["object"]["coordinate"].split(".")[0]:
             {int(q["refPer"][:4]): q["value"] for q in o["object"]["vectorDataPoint"] if q["value"] is not None}
             for o in res}
    return {p: by_id[str(members[p])] for p in places}, meta["cubeTitleEn"]


# --- BEA: state GDP and population ---

def bea(table, member, line):
    """{FIPS: (name, {year: value})} for the 50 states, DC and the US total."""
    zf = zipfile.ZipFile(io.BytesIO(get(BEA.format(table), timeout=300)))
    name = next(n for n in zf.namelist() if n.startswith(member + "__ALL_AREAS"))
    out = {}
    for r in csv.DictReader(io.TextIOWrapper(zf.open(name), encoding="latin-1")):
        if r.get("GeoName") is None:
            continue
        fips = r["GeoFIPS"].strip().strip('"').strip()
        # States and DC are 01000-56000; BEA regions (91000+) are left out.
        if (r.get("LineCode") or "").strip() == line and fips.isdigit() and fips.endswith("000") and int(fips) <= 56000:
            years = {}
            for k, v in r.items():
                if k and k.isdigit() and v:
                    try:
                        years[int(k)] = float(v)
                    except ValueError:  # BEA footnote codes such as (D), (NA), (L)
                        pass
            out[fips] = (r["GeoName"].replace("*", "").strip(), years)
    return out


def main():
    sources = []

    # National: current-PPP levels (for the gap) and volumes (for growth).
    status = {}
    cur = oecd_series(oecd_rows("DF_TABLE1_EXPENDITURE_HCPC"), "B1GQ_POP", status)
    vol = oecd_series(oecd_rows("DF_TABLE1_EXPENDITURE_HVPVOB"), "B1GQ_POP")
    rates_rows = oecd_rows("DF_TABLE4")
    ppp = oecd_series(rates_rows, "PPP_B1GQ")["CAN"]
    fx = oecd_series(rates_rows, "EXC_A")["CAN"]
    sources += [
        source("OECD, Annual GDP per capita, US $, current prices, current PPPs (DF_TABLE1_EXPENDITURE_HCPC)",
               "https://data-explorer.oecd.org/", "Used for the level of the gap in each year."),
        source("OECD, Annual GDP per capita, US $, volume, constant PPPs, reference year 2020 (DF_TABLE1_EXPENDITURE_HVPVOB)",
               "https://data-explorer.oecd.org/", "Used for growth since a chosen year."),
        source("OECD, Annual purchasing power parities and exchange rates (DF_TABLE4)",
               "https://data-explorer.oecd.org/", "Purchasing power parity for GDP and average market exchange rate, Canadian dollars per US dollar."),
    ]
    years = sorted(set(cur["CAN"]) & set(cur["USA"]))

    # Provinces and states for the latest year both countries have published.
    gdp_p, t1 = statcan(36100222, "2.38.0.0.0.0.0.0.0", 3)     # current prices, GDP at market prices
    pop_p, t2 = statcan(17100005, "1.1.0.0.0.0.0.0.0", 5)      # July 1, all ages, total
    gdp_s = bea("SAGDP", "SAGDP2", "1")                        # all-industry GDP, millions of current dollars
    pop_s = bea("SAINC", "SAINC1", "2")                        # population, persons
    sources += [
        source(f"Statistics Canada, Table 36-10-0222-01: {t1}", "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3610022201",
               "Gross domestic product at market prices, current prices."),
        source(f"Statistics Canada, Table 17-10-0005-01: {t2}", "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1710000501",
               "Population on July 1."),
        source("US Bureau of Economic Analysis, SAGDP2: GDP by state, current dollars", BEA.format("SAGDP")),
        source("US Bureau of Economic Analysis, SAINC1: population by state", BEA.format("SAINC")),
    ]
    prov_year = min(max(v) for v in gdp_p.values())
    state_year = max(gdp_s["00000"][1])
    year = min(prov_year, state_year, max(ppp), max(fx))

    places = []
    for p in PROVINCES + TERRITORIES:
        cad = gdp_p[p][year] * 1e6 / pop_p[p][year]
        places.append({"name": p, "short": SHORT[p], "country": "CA", "territory": p in TERRITORIES,
                       "ppp": cad / ppp[year], "fx": cad / fx[year]})
    us_total = None
    for fips, (name, g) in gdp_s.items():
        v = g[year] * 1e6 / pop_s[fips][1][year]
        if fips == "00000":
            us_total = v
            continue
        places.append({"name": name, "country": "US", "dc": fips == "11000", "ppp": v, "fx": v})

    # Sanity checks: refuse to publish numbers that are obviously wrong.
    states = [x for x in places if x["country"] == "US" and not x.get("dc")]
    provs = [x for x in places if x["country"] == "CA" and not x["territory"]]
    canada_sum = (sum(gdp_p[p][year] for p in PROVINCES + TERRITORIES) * 1e6
                  / sum(pop_p[p][year] for p in PROVINCES + TERRITORIES) / ppp[year])
    latest = years[-1]
    us_bea, us_oecd = us_total, cur["USA"][year]
    checks = {
        "volume series cover every year": all(y in vol["CAN"] and y in vol["USA"] for y in years),
        "PPP for the latest year": latest in ppp,
        "PPP and exchange rate plausible": all(1.0 < v < 1.6 for v in (ppp[year], fx[year], ppp[latest])),
        "national share plausible": all(0.6 < cur["CAN"][y] / cur["USA"][y] < 1.0 for y in years if y >= 1990),
        "BEA US total within 3% of the OECD US figure": abs(us_bea / us_oecd - 1) < 0.03,
        "50 states": len(states) == 50,
        "10 provinces": len(provs) == 10,
        "state values plausible": all(30_000 < x["ppp"] < 200_000 for x in states),
        "province values plausible": all(30_000 < x["ppp"] < 200_000 for x in provs),
        "provinces add up to the OECD national figure": abs(canada_sum / cur["CAN"][year] - 1) < 0.04,
        "national series reach recent years": years[-1] >= date.today().year - 3,
    }
    failed = [k for k, ok in checks.items() if not ok]
    if failed:
        sys.exit(f"Not publishing: failed checks {failed}. docs/data.json left unchanged.")

    data = {
        "built": date.today().isoformat(),
        "national": {
            "years": years,
            "canada": [round(cur["CAN"][y]) for y in years],
            "us": [round(cur["USA"][y]) for y in years],
            "canada_volume": [round(vol["CAN"][y]) for y in years],
            "us_volume": [round(vol["USA"][y]) for y in years],
            "latest_estimated": [a for a in ("CAN", "USA") if status.get((a, years[-1])) == "E"],
            "ppp": {y: ppp[y] for y in years if y in ppp},
        },
        "regional": {"year": year, "places": places, "us_total": us_total,
                     "ppp": ppp[year], "fx": fx[year], "canada_from_provinces": canada_sum},
        "sources": sources,
    }
    # Only write when the figures change, so the daily job doesn't commit (or
    # move the page's "updated" date) when nothing new has been published.
    def comparable(d):
        d = json.loads(json.dumps(d))
        d.pop("built", None)
        for s in d.get("sources", []):
            s.pop("retrieved", None)
        return d
    if OUT.exists():
        old = json.loads(OUT.read_text(encoding="utf-8"))
        if comparable(old) == comparable(data):
            print("No change in the data; docs/data.json left as is.")
            return
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}: national {years[0]}-{latest}, "
          f"Canada {cur['CAN'][latest] / cur['USA'][latest]:.1%} of US in {latest}; "
          f"provinces and states for {year}.")


if __name__ == "__main__":
    main()
