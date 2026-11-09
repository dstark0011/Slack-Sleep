# Slack

A personal sleep analysis app. It pulls your Garmin sleep, stress and
activity data plus Hevy workouts, scores each night against your own
baselines (not population averages), and works out what actually moves your
sleep. Named after slack water: the still point of the tide.

Free to run: no paid APIs, everything is computed locally.

## What's in the app

- **Night**: Restoration score, overnight sleep profile with heart rate, what
  happened the day before, and a breakdown of every point in the score.
- **Week**: weekly report with nightly scores, sleep debt, bedtime
  consistency, best and toughest nights, focus for next week, and a copyable
  text summary.
- **Drivers**: each factor (runs by zone 4–5 time, stress at sea and at home,
  travel, late lights-out, walks, climbing, gym, cold plunge, steps) ranked by
  effect, with sample sizes and confidence. Includes your best bedtime window
  and a playbook built from your strongest effects.
- **Trends**: HRV and resting HR, Restoration vs Garmin, deep sleep, rolling
  sleep debt and sleep window, with offshore and away periods shaded. Plus
  long-term analysis: trend per week, month-by-month table, and
  rotation-by-rotation comparison.
- **Journal**: tag what the watch can't see (alcohol, caffeine, late meals)
  and see their effect once you have three or more tagged nights.

## Android app

The `android/` folder is a native app that reads your Garmin data on the
phone itself, through Health Connect, and shows the same screens. No PC, no
server, works offshore as long as Garmin Connect has synced.

1. In Garmin Connect on your phone: Settings › Connected apps › Health
   Connect, and allow sleep, heart rate, steps, floors and activities.
   In Hevy, turn on Health Connect too so strength sessions come through.
2. Push this repo to GitHub. The **Build Android APK** workflow runs
   automatically (or start it from the Actions tab).
3. Open the finished run, download **slack-apk**, unzip it and open
   `app-debug.apk` on your phone (allow installing from your browser or
   Files app when asked).
4. Open Slack and tap Allow on the Health Connect screen.

New builds install over the old one, so your journal tags are kept.

What Health Connect doesn't share: Garmin's sleep score, daytime stress and
Body Battery. The app hides those and drops the stress drivers. Tag
**Slept at sea**, **Away from home** and **Travel day** in the Journal so
location-based drivers still work. For full Garmin detail, keep using the PC
sync below.

## PC sync (full Garmin detail)

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # add Garmin login and optional Hevy API key
cp config.example.json config.json
./sync.sh                       # first run asks Garmin for MFA if enabled
```

Then open `dist/slack.html` in a browser (it works offline), or open
`web/index.html` while developing.

## Nightly sync

Run it every morning after your watch syncs, for example with cron:

```cron
30 7 * * * cd /path/to/slack && ./sync.sh --days 3 >> sync.log 2>&1
```

Past days are cached in `data/raw/`, so daily runs only fetch the last few
days.

## Config

`config.json` controls location detection and thresholds:

- `home_areas`: Garmin activity name prefixes that mean you're home.
  Activities elsewhere mark the day as away.
- `offshore_markers`: text in Hevy workout titles that marks a day at sea
  (gaps of up to 5 days between marked days are filled in).
- `offshore_periods` / `travel_days`: manual overrides when detection is wrong.
- `hard_run_z45_minutes`: what counts as a hard run.

## Layout

```
sync/garmin_sync.py      pull from Garmin Connect (unofficial garminconnect library)
sync/hevy_sync.py        pull from the Hevy public API
sync/build_features.py   one row per night, joined with the day before
scripts/build_dist.py    inline everything into dist/slack.html
web/                     the app (plain HTML, CSS, JS; no build step)
android/                 Android app: Health Connect reader + the web UI in a WebView
.github/workflows/       builds the APK on every push
data/                    your data, gitignored
```

## Caveats

Driver effects are differences in averages between comparable nights, not
proof of cause. Most runs so far are in the evening, so run timing and run
intensity can't yet be separated. Where heart rate zone data is missing,
zone 4–5 time is estimated from average heart rate and flagged as estimated.

## Roadmap

- Overnight recorder in the Android app (sound events, movement, smart alarm)
- Automatic at-sea detection from phone location at bedtime
- Daylio CSV import for mood and activities
