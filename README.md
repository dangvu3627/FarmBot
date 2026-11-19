# FarmBot – ESP32 farming console

A small farming game for a classic ESP32 with a 128x64 SSD1306 OLED and a
rotary encoder. Built with PlatformIO and the Arduino framework.

## Development

1. Install PlatformIO: `brew install platformio` (or `pip3 install platformio`).
2. Build and flash from the project folder:

   ```
   pio run -e esp32dev                  # build only
   pio run -e esp32dev -t upload        # build and flash, dev grow times (default)
   pio run -e esp32dev_real -t upload   # build and flash, real grow times
   pio run -e esp32dev_sim              # Wokwi build (see "Testing in Wokwi")
   pio test -e native                   # PC unit tests: game rules and web protocol
   pio device monitor                   # serial monitor, 115200 baud
   ```

   Some boards need the **BOOT** button held when the upload starts.

### Web version (connects to the console)

`web/` is a 3D browser view of the console's farm. **The console is the
source of truth**: it runs the game, and the page shows its farm and sends it
your clicks. You can play on either one, and both show the same farm.

1. Turn on the console. It makes its own Wi-Fi network, **FarmBot**
   (password `farmbot123`, set by `AP_SSID` / `AP_PASSWORD` in
   `include/config.h`).
2. Serve the page from your laptop: `cd web && python3 -m http.server 8000`.
3. Join the FarmBot Wi-Fi and open http://localhost:8000. The page connects
   to `ws://192.168.4.1/ws` by itself.

While on the FarmBot Wi-Fi your laptop has no internet. That's expected, and
the page doesn't need it. See [web/README.md](web/README.md) for what the page
does while the console is off, and for developing against the mock console
(`tools/mock_console.py`) without hardware.

Only one browser can play at a time. The first one keeps the console, and
others show "Console busy" until it lets go: a closed tab frees the console
within 10 s, and a tab left hidden for a minute does too.

The OLED status bar shows a small wedge after the coins: an **outline** when
the hotspot is up and no browser is connected, **filled** when one is.

### Dev vs real grow times

The compile-time flag `FARM_GROW_REAL` in `include/crops.h` sets the grow
times.

| Crop | Seed | Sells for | Dev (default) | Real (`FARM_GROW_REAL=1`) |
|---|---|---|---|---|
| Wheat | $1 | $2 | 10 s | 60 s |
| Carrot | $2 | $4 | 20 s | 180 s |
| Pumpkin | $4 | $8 | 30 s | 600 s |

Use the `esp32dev_real` environment, or add `-D FARM_GROW_REAL=1` to
`build_flags` in `env:esp32dev`. To change a crop, edit its row in `crops.h`.

### Settings

Pins, debounce, long-press time, frame rate, save intervals and the hotspot
name and password are all in `include/config.h`. If the cursor moves the wrong way, set
`ENC_DIRECTION = -1`. If one click moves two tiles, or a click needs two
detents, set `ENC_COUNTS_PER_DETENT` to match your encoder (usually 4 or 2).

## Controls

The rotary encoder is the only control.

| Screen | Turn | Short press (< 1 s) | Long press (1 s) |
|---|---|---|---|
| Farm | Move the cursor one tile (wraps) | Plant the selected seed on an empty tile, or harvest a ripe one | Open the seed menu |
| Seed menu | Move the highlight (wraps) | Select the highlighted seed and close | Close without changing the seed |

A short press acts when you **release** the knob, because the console can't
tell a short press from a long one until then. A long press acts once you have
held for 1 s (`LONG_PRESS_MS` in `config.h`).

The on/off switch is a plain switch in the battery's positive wire. It cuts the
board's power and has no firmware.

### Wiring

| Part | ESP32 pin |
|---|---|
| OLED SDA / SCL | GPIO 21 / 22 |
| OLED VCC / GND | 3V3 / GND |
| Encoder CLK (A) / DT (B) | GPIO 32 / 33 |
| Encoder SW (push) | GPIO 25 |
| Encoder VCC / GND | 3V3 / GND |
| On/off switch | Battery + → switch → board 5V/VIN |

## File architecture

```
platformio.ini        build environments: esp32dev, esp32dev_real, native
include/config.h      pins and hardware/timing settings
include/crops.h       crop table and dev/real grow-time switch
include/game.h        ┐ pure game rules: stages, plant, harvest, coins.
src/game.cpp          ┘ No Arduino calls; every function takes `now`.
include/clock.h       ┐ game clock in seconds, built from esp_timer.
src/clock.cpp         ┘ The only code that reads hardware time.
include/save.h        ┐ one versioned, CRC-32-checked save in NVS
src/save.cpp          ┘ (Preferences), written on events and every 5 min
include/input.h       ┐ encoder steps via ESP32Encoder (hardware PCNT),
src/input.cpp         ┘ debounced push switch with short/long press
include/render.h      ┐ U8g2 drawing: status bar (with Wi-Fi glyph), 8x4 plot
src/render.cpp        ┘ grid, cursor, seed menu; redraws only on change
include/protocol.h    ┐ web message format (JSON, protocol v1). Pure, so it
src/protocol.cpp      ┘ runs in the PC tests like game.cpp
include/net.h         ┐ FarmBot hotspot + one WebSocket client at /ws; async
src/net.cpp           ┘ callbacks only queue commands, loop() applies them
src/main.cpp          ~30 Hz loop and FARM / SEED_MENU state machine
test/                 PC unit tests (pio test -e native)
tools/mock_console.py a stand-in console for web development (no hardware)
tools/protocol_fixtures.json  golden messages the firmware and mock must match
diagram.json          Wokwi wiring
wokwi.toml            Wokwi firmware paths and the web-link port forward
```

Data flows one way each frame: `clock` → `input` → web commands (`net`) →
`game` (via `main`) → `save` → `net` publish → `render`. All game changes
happen in that loop, including the ones that come from the web.

Saving: a plant, harvest or seed change (from the console or the web) is
saved at most 30 s later (`SAVE_MIN_INTERVAL_S`), and everything is saved
every 5 min. Cutting the power loses at most the last 30 s.

## Testing in Wokwi

Wokwi simulates the ESP32, OLED and encoder, so you can play without hardware.
`diagram.json` holds the parts and wiring.

### VS Code (recommended)

1. Install the **Wokwi Simulator** extension and follow its prompt to get a
   free license.
2. Open this folder in VS Code and build: `pio run -e esp32dev_sim`
3. Press F1 and run **Wokwi: Start Simulator**.

Rebuild after every code change, then restart the simulator.

The sim build (`FARM_NET_SIM`) joins Wokwi's `Wokwi-GUEST` network instead of
making the FarmBot hotspot, because a real laptop can't join a simulated
hotspot. `wokwi.toml` forwards `localhost:8180` to the simulated console, so
with the web server running, open
http://localhost:8000/?console=localhost:8180 to play the simulated console
from the 3D page.

### wokwi.com (browser)

1. Start a new **ESP32** project with the **Arduino** template.
2. Replace the `diagram.json` tab with this project's `diagram.json`.
3. Replace `sketch.ino` with a single comment line. Don't paste `main.cpp`
   into it, because the Arduino tools rewrite `.ino` files.
4. Add every file from `src/` and `include/` with **+**, keeping the same
   names.
5. Add `libraries.txt` containing:
   ```
   U8g2
   ESP32Encoder
   ```
6. Press **Play**.

wokwi.com can't forward ports to your laptop, so the web link only works in
VS Code. The firmware still needs its libraries there: add `Async TCP`,
`ESP Async WebServer` (both by ESP32Async) and `ArduinoJson` to
`libraries.txt`, and add `#define FARM_NET_SIM 1` at the top of `net.cpp`.

On wokwi.com, switch to real grow times by changing
`#define FARM_GROW_REAL 0` to `1` in `crops.h`.

### Using the simulator

- Click the arrows on the encoder to turn it one click.
- Click the knob for a short press. Hold the mouse button on it for 1 s for a
  long press.
- Stopping and starting the simulation works like the power switch.
- Quick check: plant wheat, wait 10 s, and the tile turns ripe. Harvesting adds
  $2.
