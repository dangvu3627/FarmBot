# FarmBot Web – 3D view of the console

The FarmBot farm in the browser, drawn in 3D with Three.js. Each crop is built
from the console's pixel sprites. It's mouse first and works with the keyboard
too.

**The ESP32 console is the source of truth.** It runs the game. This page
shows the console's farm and sends it your clicks, and it changes nothing
until the console answers. You can play on the console and on the page at the
same time: both show the same coins, plots, game time and selected seed.

## Run it

The page uses JavaScript modules, which browsers only load over HTTP, so
opening `index.html` straight from disk won't work. Start a local server from
this folder:

```
cd web
python3 -m http.server 8000
```

Then:

1. Turn on the console. It makes the Wi-Fi network **FarmBot** (password
   `farmbot123`, set in the firmware's `include/config.h`).
2. Join that network on this computer.
3. Open http://localhost:8000. The page connects to the console at
   `ws://192.168.4.1/ws` by itself.

Serve the page over `http`, as above. Browsers block an `https` page from
opening `ws://` to a local address.

There is no build step and no `npm install`. Three.js r170 is included in
`vendor/three/`. Only the fonts load from the internet, and on the FarmBot
Wi-Fi there is none, so the page falls back to system fonts.

### Other consoles: `?console=`

`?console=host:port` points the page somewhere other than the hotspot:

| Console | Start it | Open |
|---|---|---|
| Real console (default) | power it on, join FarmBot Wi-Fi | http://localhost:8000 |
| Mock console | `python3 tools/mock_console.py` (from the project folder) | http://localhost:8000/?console=localhost:8765 |
| Wokwi simulation | `pio run -e esp32dev_sim`, then start Wokwi in VS Code | http://localhost:8000/?console=localhost:8180 |

The mock console is a small Python script (standard library only) that speaks
the same protocol with the same rules. Useful flags: `--console-actions` (a
fake player plants and harvests on the "console", to see the toasts),
`--real` (real grow times) and `--self-test` (checks its messages against
`tools/protocol_fixtures.json`). Stop it with Ctrl+C to see the offline view,
then start it again to see the page reconnect.

## What the page shows

The pill in the header tells you which of these it is in:

| Pill | What it means | Can you play? |
|---|---|---|
| **Console live** | Connected. Clicks go to the console. | Yes |
| **Offline · last seen 14:02** | The console is off or out of reach. You see the last farm it sent, dimmed, with growth frozen, because the console's time stops while it's off. The page reconnects by itself. | No |
| **Console busy** | Another browser has the console. Only one can play at a time. The page keeps trying every few seconds. | No |
| **Demo · join FarmBot Wi-Fi** | This browser has never seen a console. A demo farm plays itself behind the instructions. | No |
| **Update needed** | The console's firmware and this page use different protocol versions. | No |

The last farm is kept in the browser (localStorage, one per console address),
so reloading while the console is off still shows it.

A tab that stays hidden for a minute lets go of the console, so a forgotten
tab can't keep another browser out. It reconnects when you show it again.

## Controls

| Input | Does |
|---|---|
| Hover a plot | Selects it; the info bar shows its crop, stage and time left |
| Click a plot | Plants the selected seed on an empty plot, or harvests a ripe one (gold ring) |
| Drag | Turns the camera |
| Scroll | Zooms |
| **Shop** button | Opens the seed shop; click a seed to select it (you pay when you plant). This also changes the console's seed. |
| Arrow keys | Move the selection (left/right step through plots, up/down jump a row) |
| `Enter` / `Space` | Plant or harvest the selected plot |
| `1`–`3` | Pick wheat, carrot or pumpkin |

A bar above each planted plot shows its growth: green while growing, gold
when ripe. When the console plants or harvests, a toast says so ("Console
harvested carrot · +$4").

There is no New farm button. To start over, erase the console's flash (for
example `pio run -e esp32dev -t erase`, then upload again).

## File architecture

```
index.html           page layout, the Three.js import map, demo overlay
css/style.css        styles: dark field palette, Silkscreen + Inter
js/crops.js          crop table; replaced by the console's hello message
js/game.js           pure rules, ported from the firmware's game.cpp; used
                     for display (stages, %) and by the demo
js/clock.js          game seconds: synced to the console, frozen offline,
                     local in the demo. The only module that reads time.
js/net.js            WebSocket link: connect, ping, timeouts, retries, busy
js/demo.js           the self-playing demo farm for first visits
js/sprites.js        the firmware's 16x14 sprites as coloured pixels with depth
js/scene.js          Three.js farm: plots, voxel crops, camera, mouse picking
js/environment.js    scenery: light, grass, flowers, fence, trees, pond, pollen
js/plot-bars.js      growth bars floating above planted plots
js/ui.js             header and status pill, shop dialog, info bar, toasts
js/main.js           wiring, offline cache, keyboard and the frame loop
vendor/three/        Three.js r170 (MIT, see LICENSE) and OrbitControls
```

Each frame runs in this order: `clock` → (demo moves) → `scene` (3D) → `ui`
(HTML). Console messages arrive between frames and replace the farm.

The message format is in `.plans/console-web-link-spec.md` (section 3).
