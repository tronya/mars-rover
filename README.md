# Solar Rover

A solar-rover driving simulator in the browser. Three.js, no build step and no
dependencies: open `index.html` and play.

**Play:** <https://tronya.github.io/mars-rover/>

Drive from base **ALPHA** to base **BETA**. The graded road winds in an S-shaped
line about 10 km long; the straight line is half that, but across hills, craters
and boulders. By day you unfold the solar wings and charge; at night you drive on
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

## What's inside

| File | Purpose |
| --- | --- |
| `src/physics.js` | rigid body, suspension, tyres, grip, hover glider |
| `src/vehicle.js` | rover models, wheels, solar wings |
| `src/chassis.js` | chassis specs: range, terrain ability, steering |
| `src/terrain.js` | relief, the S-shaped road, streamed tiles, landmarks |
| `src/tracks.js` | tyre tracks |
| `src/base.js` | base with a beacon |
| `src/sky.js` | sky, day and night cycle |
| `src/post.js` | post-processing: AO, bloom, light shafts |
| `src/audio.js` | synthesized sound, no audio files |
| `src/minimap3d.js` | the relief map scene |
| `src/main.js` | scene, controls, power, HUD |

Physics runs in SI units with each planet's gravity (Mars 3.71 m/s²). The relief is
a function and only the visible part is built, in tiles around the rover, so a
10 km world runs without hitches.
