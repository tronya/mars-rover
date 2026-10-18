# Solar Rover

A solar-rover driving simulator in the browser. Three.js, no build step and no
dependencies: open `index.html` and play.

**Play:** <https://tronya.github.io/mars-rover/>

Drive from base **ALPHA** to base **BETA**. On Mars the road is graded across real
terrain (see *Real Mars* below), 8–9 km long; the straight line is shorter, but
across slopes, craters and boulders. By day you unfold the solar wings and charge; at night you drive on
the batteries.

Planets: Mars, the Moon and Verdanta.

## Running locally

With Node (instant reload while editing):

```bash
npm install
npm run dev      # http://localhost:5173/
npm run build    # production build into dist/ (hashed file names)
```

Or with no tooling at all — the game also runs unbuilt from any static server
(ES modules don't load from `file://`):

```bash
python3 serve.py 5173
```

## Controls

| Keys | Action |
| --- | --- |
| `W` / `S` | throttle / brake, then reverse |
| `A` / `D` | steer — let go to straighten up |
| `Space` | handbrake |
| `Shift` | boost, drains the battery four times faster (glider: climb) |
| `Ctrl` | glider: descend |
| `E` | solar wings |
| `L` | lights: auto / off / sidelights / headlights |
| `R` / `H` | put back on its wheels / return to base |
| `P` | autopilot |
| `C` | camera mode |
| `M` | map |
| `O` | menu, sound settings and the key list |
| `K` | sound |

The map in the bottom-left corner shows the relief of the whole route. Click it to
open the big map: each short click on the ground places a waypoint. The autopilot
only drives through waypoints you placed; with none it just stays put. When the
battery runs low it stops, unfolds the wings, waits for a full charge, folds them
and drives on.

The strip at the top centre is a compass showing your heading.

## Real Mars

Mars is driven over measured ground, not an invented landscape. Pick the region in
the menu under **Settings → Місцевість Марса** (the page reloads):

| Region | Source | Resolution | What you drive |
| --- | --- | --- | --- |
| **Jezero** (default) | USGS Mars 2020 TRN CTX DTM and CTX orthoimage mosaic | 20 m | The floor of Jezero crater, up onto the river delta, 8.0 km |
| **Gale** | HRSC DTM mosaic of Gale crater (Persaud et al. 2021) | 30 m | From Bradbury Landing into the foothills of Aeolis Mons, 9.2 km |
| Classic | procedural | — | the original invented Mars |

The road is not hand-placed: `src/real-mars.js` finds the cheapest path between the
two bases over the real slopes. The ground between those pixels is detail we add on
top (small noise, rubble on slopes, soft dust on bright patches of the orbiter photo),
and the whole map stands on the horizon as a coarse mesh. Data credits and licences are
in `textures/CREDITS.md`. The compiled files the game reads are `textures/mars/*.bin`
and `*-meta.json`; they are in git, so playing needs nothing else.

To rebuild them (only if you want another window or region), download the sources into
`tools/cache/` (not in git; links are in `textures/CREDITS.md`) and run:

```bash
node tools/prep-dem.mjs     # Jezero: needs the CTX DTM and orthoimage .tif files
node tools/prep-gale.mjs    # Gale: needs gale-hrsc.tif (Zenodo 10.5281/zenodo.5808354)
node tools/prep-region.mjs olympus -132.65 16.15 40   # any lon/lat window of the 200 m MOLA/HRSC DEM, range-read
```

## Tests and tools

```bash
npm test                         # unit and physics tests, every planet and chassis
npm run playbot                  # a bot drives every chassis the whole road, ALPHA to BETA
node tools/playbot.mjs truck --rapier        # one chassis, on the Rapier physics
node tools/bench-load.mjs        # start-up time of each real region
node tools/verify.mjs            # npm test + the bot on both regions: the gate for a change
```

`TEST_REGION=gale` (or `classic`) picks the region for the tests and the bot;
`TEST_PLANET` and `TEST_CHASSIS` pick the planet and chassis. The bot steers with the
game's own autopilot law, so a chassis that cannot finish the road shows up as a failure.

For trying the late game without earning it: open the browser console and run `game.upgrades.maxOut()`, then reload. It maxes every upgrade and owns every vehicle, and the scrap you earned stays as it was. There is no button for it on purpose.

`node tools/queue.mjs` keeps a ticket queue in `pipeline/tickets.json` (next / done /
fail / status), used to hand out work in order during an unattended session.

## What's inside

| File | Purpose |
| --- | --- |
| `src/physics.js` | rigid body, suspension, tyres, grip, hover glider |
| `src/vehicle.js` | rover models, wheels, solar wings |
| `src/chassis.js` | chassis specs: range, terrain ability, steering |
| `src/terrain.js` | relief, the road, streamed tiles, landmarks |
| `src/real-mars.js` | real Mars: loads the DTM, finds the road, names the places |
| `src/loose.js` | loose stones the hull shoves aside, simulated with Rapier (WASM) |
| `src/tracks.js` | tyre tracks |
| `src/base.js` | base with a beacon |
| `src/sky.js` | sky, day and night cycle |
| `src/post.js` | post-processing: AO, bloom, light shafts |
| `src/audio.js` | synthesized sound, no audio files |
| `src/minimap3d.js` | the relief map scene |
| `src/main.js` | scene, controls, power, HUD |

Ground and rock surfaces use scanned CC0 textures from Poly Haven (`textures/CREDITS.md`).

Physics runs in SI units with each planet's gravity (Mars 3.71 m/s²). The relief is
a function and only the visible part is built, in tiles around the rover, so a
10 km world runs without hitches.

The unbuilt game (`serve.py`) still works; real Mars loads its data with a plain
`fetch`, so any static server will do.
