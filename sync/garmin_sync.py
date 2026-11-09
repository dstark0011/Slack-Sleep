"""Pull sleep, stress, steps and activities from Garmin Connect into data/raw/.

Uses the free, unofficial garminconnect library. Login tokens are cached in
GARMIN_TOKENSTORE so you only enter your password (and any MFA code) once.

    python sync/garmin_sync.py            # last N days from config.json
    python sync/garmin_sync.py --days 14  # just the last fortnight
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import time

from dotenv import load_dotenv
from garminconnect import Garmin

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
RUN_TYPES = {"running", "treadmill_running", "trail_running", "road_biking", "cycling", "indoor_cycling"}


def load_config():
    path = ROOT / "config.json"
    if not path.exists():
        path = ROOT / "config.example.json"
    return json.loads(path.read_text())


def login():
    load_dotenv(ROOT / ".env")
    store = os.path.expanduser(os.getenv("GARMIN_TOKENSTORE", ".garth"))
    if not os.path.isabs(store):
        store = str(ROOT / store)
    try:
        client = Garmin()
        client.login(store)
        return client
    except Exception:
        client = Garmin(os.environ["GARMIN_EMAIL"], os.environ["GARMIN_PASSWORD"])
        client.login()
        client.garth.dump(store)
        return client


def cached(path, fetch, refresh=False):
    """Fetch once and keep the JSON; past days don't change, so re-runs are fast."""
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    data = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    time.sleep(0.4)  # be polite to Garmin's servers
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int)
    args = ap.parse_args()
    cfg = load_config()
    days = args.days or cfg["days_to_sync"]
    client = login()

    today = dt.date.today()
    start = today - dt.timedelta(days=days)
    for i in range(days + 1):
        d = (start + dt.timedelta(days=i)).isoformat()
        recent = (today - dt.date.fromisoformat(d)).days <= 2  # re-pull the last couple of days
        cached(RAW / "sleep" / f"{d}.json", lambda: client.get_sleep_data(d), refresh=recent)
        cached(RAW / "stress" / f"{d}.json", lambda: client.get_stress_data(d), refresh=recent)
        cached(RAW / "stats" / f"{d}.json", lambda: client.get_stats(d), refresh=recent)
        print("synced", d)

    acts = client.get_activities_by_date(start.isoformat(), today.isoformat())
    (RAW / "activities.json").write_text(json.dumps(acts))
    for a in acts:
        if a.get("activityType", {}).get("typeKey") in RUN_TYPES:
            aid = a["activityId"]
            cached(RAW / "zones" / f"{aid}.json", lambda: client.get_activity_hr_in_timezones(aid))
    print(f"{len(acts)} activities")


if __name__ == "__main__":
    main()
