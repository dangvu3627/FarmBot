# FarmBot Web – 3D version

The FarmBot game in the browser, with the same rules, crops and prices as the
ESP32 console. The farm is drawn in 3D with Three.js, and each crop is built
from the console's pixel sprites. It's mouse first and works with the keyboard
too.

## Run it

The page uses JavaScript modules, which browsers only load over HTTP, so
opening `index.html` straight from disk won't work. Start a local server from
this folder:

```
cd web
python3 -m http.server 8000
```

Open http://localhost:8000. To play with real grow times instead of dev
times, open http://localhost:8000/?real.

There is no build step and no `npm install`. Three.js r170 is included in
`vendor/three/`. Only the fonts load from the internet; without a connection
the page falls back to system fonts.

## Controls

| Input | Does |
|---|---|
| Hover a plot | Selects it; the info bar shows its crop, stage and time left |
| Click a plot | Plants the selected seed on an empty plot, or harvests a ripe one (gold ring) |
| Drag | Turns the camera |
| Scroll | Zooms |
| Seed panel | Picks the seed to plant |
| Arrow keys | Move the selection (left/right step through plots, up/down jump a row) |
| `Enter` / `Space` | Plant or harvest the selected plot |
| `1`–`3` | Pick wheat, carrot or pumpkin |

The game saves in this browser after every action, every 5 seconds, and when
you close or hide the tab. Game time only runs while the page is open. **New
farm** starts over.

## File architecture

```
index.html           page layout (design B) and the Three.js import map
css/style.css        styles: dark field palette, Silkscreen + Inter
js/crops.js          crop table; ?real switches to real grow times
js/game.js           pure rules, ported from the firmware's game.cpp
js/clock.js          game seconds; the only module that reads time
js/save.js           versioned save in localStorage
js/sprites.js        the firmware's 16x14 sprites as coloured pixels with depth
js/scene.js          Three.js farm: plots, voxel crops, camera, mouse picking
js/ui.js             header, info bar and seed panel
js/main.js           wiring, keyboard and the frame loop
vendor/three/        Three.js r170 (MIT, see LICENSE) and OrbitControls
```

Each frame runs in this order: `clock` → `game` rules → `scene` (3D) → `ui`
(HTML) → `save`.
