"""Turn data/raw/ into one row per night for the app.

Each night is joined with what happened the DAY BEFORE it (stress, runs,
walks, climbing, gym, cold plunge, steps) plus where you slept and whether
it was a travel night. Writes data/nights.json and data/slack-data.js.

Row layout (keep in sync with web/app.js):
  date, start, end, garmin_score, sleep_s, deep_s, light_s, rem_s, awake_s,
  awake_count, sleep_stress, rhr, hrv, day_stress, high_stress_pct,
  z45_min, z45_estimated, run_hour, walk_min, elev_m, lifted, plunged,
  steps, location (home|off|away), travel (0|1)
"""
import datetime as dt
import json
import pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"


def cfg():
    p = ROOT / "config.json"
    return json.loads((p if p.exists() else ROOT / "config.example.json").read_text())


def load(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def day(d, k):
    return (dt.date.fromisoformat(d) + dt.timedelta(days=k)).isoformat()


def fill_gaps(days, max_gap):
    """Mark days between two marked days as marked when the gap is short."""
    s = sorted(days)
    out = set(s)
    for a, b in zip(s, s[1:]):
        gap = (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days
        if 1 < gap <= max_gap:
            out |= {day(a, i) for i in range(1, gap)}
    return out


def main():
    c = cfg()
    acts = load(RAW / "activities.json", [])
    hevy = load(RAW / "hevy.json", [])

    per_day = defaultdict(lambda: {"z45": 0, "est": 0, "hour": None, "walk": 0, "elev": 0, "plunge": 0, "names": []})
    for a in acts:
        d, hour = a["startTimeLocal"][:10], int(a["startTimeLocal"][11:13])
        t = a.get("activityType", {}).get("typeKey", "")
        name = a.get("activityName", "")
        p = per_day[d]
        p["names"].append(name)
        p["elev"] += a.get("elevationGain") or 0
        if t in ("walking", "hiking"):
            p["walk"] += (a.get("duration") or 0) / 60
        if "plunge" in name.lower() or "cold" in name.lower():
            p["plunge"] = 1
        zones = load(RAW / "zones" / f"{a['activityId']}.json")
        if zones:
            p["z45"] += sum(z["secsInZone"] for z in zones if z["zoneNumber"] >= 4) / 60
            p["hour"] = hour
        elif t in ("running", "treadmill_running", "trail_running"):
            hard = (a.get("averageHR") or 0) >= c["zone4_floor_bpm"]
            p["z45"] += (a.get("duration") or 0) / 60 * (0.5 if hard else 0.15)
            p["est"], p["hour"] = 1, hour

    lift_days = {w["start_time"][:10] for w in hevy}
    marker_days = {w["start_time"][:10] for w in hevy if any(m in w["title"] for m in c["offshore_markers"])}
    for a, b in c["offshore_periods"]:
        n = (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days
        marker_days |= {day(a, i) for i in range(n + 1)}
    offshore = fill_gaps(marker_days, 5)
    away_days = {d for d, p in per_day.items() if d not in offshore and any(
        nm and not any(nm.startswith(h) for h in c["home_areas"]) and "plunge" not in nm.lower()
        and "shower" not in nm.lower() and "sauna" not in nm.lower() and not nm.startswith(("Treadmill", "Evening", "Morning"))
        for nm in p["names"])}
    away = fill_gaps(away_days, 2)
    loc = lambda d: "off" if d in offshore else "away" if d in away else "home"

    changes = set()
    for f in sorted((RAW / "sleep").glob("*.json")):
        d = f.stem
        if (loc(day(d, -1)) == "off") != (loc(d) == "off"):
            changes |= {day(d, -1), d, day(d, 1)}
    travel = changes | set(c["travel_days"])

    rows, detail = [], {}
    for f in sorted((RAW / "sleep").glob("*.json")):
        s = load(f)
        dto = s.get("dailySleepDTO") or {}
        if not dto.get("sleepTimeSeconds") or dto["sleepTimeSeconds"] < 3 * 3600:
            continue  # skip watch-off or near-empty nights
        d, prev = f.stem, day(f.stem, -1)
        stress = load(RAW / "stress" / f"{prev}.json", {}) or {}
        vals = [v for _, v in (stress.get("stressValuesArray") or []) if v is not None and v >= 0]
        hi = round(100 * sum(v >= 76 for v in vals) / len(vals), 1) if vals else None
        stats = load(RAW / "stats" / f"{prev}.json", {}) or {}
        p = per_day.get(prev, per_day.default_factory())
        rows.append([
            d, dto["sleepStartTimestampGMT"] // 1000, dto["sleepEndTimestampGMT"] // 1000,
            ((dto.get("sleepScores") or {}).get("overall") or {}).get("value") or 0,
            dto["sleepTimeSeconds"], dto.get("deepSleepSeconds") or 0, dto.get("lightSleepSeconds") or 0,
            dto.get("remSleepSeconds") or 0, dto.get("awakeSleepSeconds") or 0, dto.get("awakeCount") or 0,
            round(dto.get("avgSleepStress") or 0), s.get("restingHeartRate") or 0, round(s.get("avgOvernightHrv") or 0),
            stress.get("avgStressLevel"), hi, round(p["z45"], 1), p["est"], p["hour"],
            round(p["walk"]), round(p["elev"]), int(prev in lift_days), p["plunge"], stats.get("totalSteps"),
            loc(prev), int(d in travel),
        ])
        last = (s, d)

    if rows:
        s, d = last
        iso = lambda x: int(dt.datetime.fromisoformat(x.replace(".0", "")).replace(tzinfo=dt.timezone.utc).timestamp())
        bb = [x["value"] for x in s.get("sleepBodyBattery") or []]
        detail[d] = {
            "start": s["dailySleepDTO"]["sleepStartTimestampGMT"] // 1000,
            "end": s["dailySleepDTO"]["sleepEndTimestampGMT"] // 1000,
            "levels": [[iso(x["startGMT"]), iso(x["endGMT"]), int(x["activityLevel"])] for x in s.get("sleepLevels") or []],
            "hr": [[x["startGMT"] // 1000, x["value"]] for x in (s.get("sleepHeartRate") or [])[::2] if x["value"]],
            "bb": [bb[0], bb[-1]] if bb else [0, 0],
        }

    (ROOT / "data" / "nights.json").write_text(json.dumps(rows, separators=(",", ":")))
    (ROOT / "data" / "slack-data.js").write_text(
        "window.SLACK_DATA = " + json.dumps({"need": c["sleep_need_minutes"], "nights": rows, "detail": detail},
                                             separators=(",", ":")) + ";\n")
    print(f"{len(rows)} nights written")


if __name__ == "__main__":
    main()
