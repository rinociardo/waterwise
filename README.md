# WaterWise

A per-plant watering advisor. It runs a soil-water balance for every plant
individually, driven by reference evapotranspiration and rainfall, and corrected
by whatever you read with a soil moisture gauge. Installable to a phone home
screen, works offline in the yard.

No build step, no dependencies, no backend. Plain ES modules.

---

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "WaterWise: per-plant watering model"
git branch -M main
git remote add origin git@github.com:<you>/waterwise.git
git push -u origin main
```

Then **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.

It appears at `https://<you>.github.io/waterwise/` within a minute or two.
HTTPS is required for the service worker and for geolocation; Pages gives you
that for free.

**Install to your phone:** open the URL, then Share → Add to Home Screen (iOS)
or the install prompt (Android). After the first load it works with no signal —
the last weather fetch is cached, and there is a seasonal-climatology fallback
underneath that.

## Run locally

```bash
python3 -m http.server 8080     # or: npm run serve
```

ES modules need a real server; opening `index.html` from the filesystem will
fail on CORS.

## Tests

```bash
node tests/run.js               # or: npm test
```

Or open `tests/tests.html` in a browser. Unit assertions plus behavioural checks
that the model reproduces the nursery's published cadence and that an
established plant needs water far less often than a new one.

---

## The model

Each plant is a bucket. Water leaves as evapotranspiration, arrives as rain and
irrigation, and you water when depletion crosses a threshold.

```
reservoir      = AWC × ball_depth × ball_area × 0.623 × buffer
reachable      = reservoir × root_access(t)
use_per_day    = ET0 × ball_area × 0.623 × k_estab(t) × k_site
rain_gain      = (rain > 0.1") ? rain × (1 − interception) × ball_area × 0.623 : 0
depletion     += use − gain − irrigation × apply_eff
due            = depletion ≥ MAD × reachable
```

`0.623` is gallons per inch of water per square foot.

### The two terms that matter

**`k_estab`** — a newly transplanted plant has a canopy far larger than the root
system left to supply it, so it drinks much faster than its root-ball volume
suggests. It starts at the silhouette-to-ball-area ratio (about 3 for a 12-foot
Cryptomeria) and decays toward 1.0 with τ ≈ 400 days.

**`root_access`** — a balled-and-burlapped plant lost most of its fine roots in
the nursery field, so it cannot reach most of the water sitting in its own ball.
Starts at 0.45 for B&B, 0.90 for container stock, recovering on the same time
constant.

Together these reproduce the whole establishment curve from one formula instead
of hardcoded phase tables: every-2-to-3-days now, weekly next year, drought-only
once established.

### Verification

With the September constants the model produces a 3-day interval for the
Cryptomeria, Thuja and hydrangeas and 4 days for the junipers, against the
nursery's published "every 2–3 days". A full refill of all 34 plants comes to
about 171 gallons against the nursery table's 197 — the model is slightly
tighter because it accounts for rain and for what each plant has actually used.

### The log is the source of truth

Plant state is **derived**, never incrementally mutated. Logging a watering
appends an entry and then `rebuild()` zeroes every plant and replays the whole
weather history, applying each logged round on its own date.

That is what makes backdating correct. Subtracting water from today's depletion
is only right if the water went in today — file a round for last Sunday and the
five days of evapotranspiration since then have to be re-applied *after* it.
Deleting or correcting an entry works for free, for the same reason.

`kSite` is the exception: it is accumulated learning rather than a consequence
of the weather, so it is not replayed. Replaying the readings would teach the
model the same lesson again every time you edit anything.

### Soil moisture readings

The bucket is an **open-loop integrator** and drifts. A gauge reading is a noisy
state measurement that corrects it, in two separate ways:

1. **State** — the reading pulls current depletion toward the observed band.
2. **Bias** — consistent disagreement in one direction moves that plant's
   `k_site`, which absorbs shade, compaction, drainage, wind and root damage
   without ever needing to model them.

Readings are **ordinal**, never numeric. A $15 conductivity meter's dial is
arbitrary and drifts with fertiliser salts, so the UI offers four buttons —
Wet / Moist / Slightly dry / Dry — and nothing else.

Watch the agreement rate on the Log screen. Rising agreement means the model has
learned your yard.

**Never enter a reading you did not take.** The gauge channel is the only
ground truth in the system, and the agreement rate is the only evidence the
model is working. Feeding it invented observations to quiet a plant corrupts
both, and it silently drives that plant's kSite toward its floor. When a plant
nags too often, say what is actually true instead: give it its own `mad`, or
mute it.

### Per-plant thresholds, and muting

`mad` is a global default, but drought tolerance is a property of the plant.
Any plant may carry its own `mad`, and the switchgrass does — 0.65 against the
yard's 0.33, because a #1 pot holds a sixth of a gallon and a prairie plant
genuinely rides out drying that would stress a freshly dug conifer. That takes
it from roughly two days to three.

`muted: true` keeps a plant fully tracked — depletion, doses, history — but
never lists it as due. Use it for anything you would rather judge by eye.

---

## Where your data lives

**In the browser that entered it, and nowhere else.** There is no account, no
login and no server. Plants, log, gauge readings, learned kSite, map positions
and settings all sit in that browser's `localStorage`, under the page's origin.

Consequences, plainly:

- **Each browser is its own yard.** Your phone and your laptop are two separate
  installs of the same code with two separate sets of data. Watering logged on
  the phone does not appear on the laptop, ever.
- **Nobody else sees your data.** If you send the Pages URL to a neighbour, they
  get the app with the original 35 plants and an empty log. Nothing of yours
  crosses over — and nothing of theirs comes back.
- **GitHub cannot sync it.** Pages is static hosting: it hands out files and
  cannot receive anything. A push updates the *code* for every browser on the
  next load; it never touches data in either direction. There is no mechanism
  by which a change made in the app could travel back to the repository.
- **It can be lost.** Clearing site data takes it. So does Safari's storage
  eviction, which drops `localStorage` for sites not opened in seven days —
  unless the app is installed to the home screen, which exempts it. Install it.

The one bridge between browsers is **Export JSON / Import JSON** on the Settings
tab. Export on the phone, import on the laptop, and the laptop becomes an exact
copy — import replaces state wholesale, it does not merge. So treat one device
as the source of truth and the other as a copy; two devices both being edited
and then imported over each other will lose whichever set of changes went first.

### Backups

Every fortnight, Today shows a single line offering **Download backup**. It
writes `waterwise-YYYY-MM-DD.json` — the same file Export produces — and resets
the clock. `Not now` silences it for another two weeks without saving anything.

The download is deliberately not automatic. Browsers block file writes no click
asked for, and an app that quietly drops a file in Downloads every fortnight is
one you end up fighting. Settings shows the date of the last backup.

If sync ever becomes worth the trouble, the shape is a Cloudflare Worker with
KV holding one JSON blob behind a shared secret — the same backend the valve
controller in **Next** would want anyway. It is a real piece of infrastructure
with a real failure mode, which is why it is not here yet.

## Updating

Unzip over the top from the **parent** directory:

```bash
unzip -o waterwise.zip
```

`-o` overwrites without asking. It only replaces files present in the archive,
so `photos/*.jpg` and anything else you have added survives. Your data is not in
the files at all — plants, log, readings and learned kSite live in the browser's
localStorage — so updating the code never touches it.

The plant list reconciles itself on every load (`mergeSeed` in `store.js`).
Seed data is code and refreshes: dimensions, blurbs, photos, nursery doses, and
newly added plants. User state is data and survives: kSite, depletion, delivery
choice, watering history. When anything changes, the season is replayed from the
log so the new figures are consistent, and a note on Today says what moved.

Only `Reset everything` in Settings discards data.

## Photos

Drop one image per variety into `photos/`, named after the plant key —
`juniper.jpg` covers all eight Skyrockets, so eleven files cover all
thirty-four plants. See `photos/README.md` for the list. Around 400x400 is
plenty; these get cached for offline use. Missing files are not an error, and
the app hides any image that fails to load.

## The map

Positions are metres on a **local grid** with the origin at the north-west
corner of the plot — x runs east, y runs south — edited by dragging. They are
deliberately not latitude and longitude.

All 35 start pre-placed. `LAYOUT` in `plants.js` is read off the nursery's
planting plan, rotated so north is up and the house is along the south edge:
the big specimens at the north-east, the Cornus run west along the north
boundary, the mixed bed in the north-west corner, the winterberry-and-
switchgrass group down the west edge, and the juniper-and-Panicum bed by the
south-east door. It is right to the bed and right to the order within each run —
juniper 3 really is the third one along — but not surveyed. Drag to correct.
Positions are user state, so once you have moved a plant, seed updates leave it
alone.

Consumer phone GNSS lands within roughly 5 m under open sky, and better only
under ideal conditions; sub-metre needs RTK corrections and external hardware.
Plants here sit 1–3 m apart, so satellite fixes carry more error than the
spacing they would be recording — the map would be noise. Dragging is accurate
enough for the job the map actually does, which is telling juniper 3 from
juniper 6. For a real survey, measure along a baseline with a tape and type the
offsets in.

Circle size is canopy spread; colour is water remaining, matching the bars.

## Adding and removing plants

`+ Add a plant` on the Plants tab copies the shape of any existing plant, so a
ninth juniper takes a name and nothing else. Added plants carry `custom: true`
and survive seed updates untouched.

Deleting a plant from the original list records it in `removedSeedIds`, so
`mergeSeed` does not helpfully resurrect it on the next update. A restore
button at the top of the Plants tab reverses that. Deleting also purges that
plant's log entries, since an orphaned entry would distort the by-date view.

## Files

| | |
|---|---|
| `js/model.js`   | the water balance. Pure, no DOM, unit-tested |
| `js/plants.js`  | the 34-plant seed dataset |
| `js/weather.js` | Open-Meteo fetch, cache, climatology fallback |
| `js/store.js`   | persistence and the daily integration step |
| `js/app.js`     | UI |
| `sw.js`         | offline shell, network-first. **Bump `CACHE` when you change a shell file** |
| `photos/`       | one image per variety, optional |

## Weather

[Open-Meteo](https://open-meteo.com/en/docs) returns
`et0_fao_evapotranspiration` directly — FAO-56 Penman-Monteith, which already
folds in radiation, temperature, humidity and wind. No API key for
non-commercial use, `past_days` up to 92.

That is why this is a small program: the hard input is free.

## Tuning

Everything in `DEFAULT_CFG` is editable from the Settings screen. The two worth
touching first:

- **`awc`** — 0.18 for clay loam, 0.20 silt loam, 0.08 sand. If your soil is
  sandier than assumed, everything waters too rarely.
- **`mad`** — 0.33 by default, deliberately conservative for establishing
  plants. Raise toward 0.5 once things are established.

## Next

A Cloudflare Worker running this same model server-side, so a valve controller
and this app share one brain. Emitter count is the per-plant dose; run time is
the global multiplier; one valve is enough.
