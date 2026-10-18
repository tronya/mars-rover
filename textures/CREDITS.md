# Texture credits

All textures here are from [Poly Haven](https://polyhaven.com) under CC0 (public domain).

| File | Source |
| --- | --- |
| `red_laterite_soil_stones_*` | https://polyhaven.com/a/red_laterite_soil_stones |
| `moon_dusted_02_*` | https://polyhaven.com/a/moon_dusted_02 |
| `forest_ground_04_*` | https://polyhaven.com/a/forest_ground_04 |
| `rock_boulder_dry_*` | https://polyhaven.com/a/rock_boulder_dry |

## Real Mars terrain

`mars/jezero-height.bin`, `mars/jezero-albedo.png`: derived from the USGS Mars 2020 Terrain Relative
Navigation CTX DTM mosaic (20 m/px) and CTX orthoimage mosaic (6 m/px) of Jezero crater.
Bland, M. T., Galuszka, D. M., Hare, T. M., Mayer, D. P., Redding, B. L., Wheeler, B. H., 2024,
Mars Sample Return Terrain Relative Navigation HiRISE DTM and Orthoimage Mosaics, USGS Data Release,
https://doi.org/10.5066/P13CPYYU. Rebuild with `node tools/prep-dem.mjs` (sources go in `tools/cache/`).

`mars/gale-height.bin`, `mars/gale-albedo.bin`: cropped from the HRSC DTM mosaic of Gale crater,
Persaud, D. M. et al. 2021, CC BY 4.0, https://doi.org/10.5281/zenodo.5808354 (30 m/px, MOLA/HRSC
referenced). The albedo is derived from slope (there is no orthoimage in that source).
Rebuild with `node tools/prep-gale.mjs` (source in `tools/cache/gale-hrsc.tif`).

`mars/olympus-height.bin`, `mars/olympus-albedo.bin`: a 40 km window on the flank of Olympus Mons from the
MOLA/HRSC blended DEM, 200 m/px (USGS Astrogeology, public domain, Fergason, R. L. et al. 2018,
https://doi.org/10.5066/P9MZCD1V), resampled to 50 m/px; the albedo is derived from slope.
Rebuild with `node tools/prep-region.mjs olympus -132.65 16.15 40` (reads only the window over HTTP range requests).
