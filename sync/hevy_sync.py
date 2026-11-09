"""Pull workout summaries from the Hevy public API into data/raw/hevy.json.

Needs HEVY_API_KEY in .env (Hevy Pro: Settings > Developer). Skipped quietly
if no key is set, so the rest of the pipeline still runs.
"""
import json
import os
import pathlib

import requests
from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "hevy.json"
API = "https://api.hevyapp.com/v1/workouts"


def main(max_pages=20):
    load_dotenv(ROOT / ".env")
    key = os.getenv("HEVY_API_KEY")
    if not key:
        print("HEVY_API_KEY not set, skipping Hevy")
        return
    workouts, page = [], 1
    while page <= max_pages:
        r = requests.get(API, params={"page": page, "pageSize": 10}, headers={"api-key": key}, timeout=30)
        r.raise_for_status()
        body = r.json()
        workouts += [{"title": w["title"], "start_time": w["start_time"], "end_time": w["end_time"]}
                     for w in body.get("workouts", [])]
        if page >= body.get("page_count", 1):
            break
        page += 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(workouts))
    print(f"{len(workouts)} Hevy workouts")


if __name__ == "__main__":
    main()
