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
   pio device monitor                   # serial monitor, 115200 baud
   ```

   Some boards need the **BOOT** button held when the upload starts.

### Web version

`web/` has a 3D browser version of the game with the same rules. To run it:
`cd web && python3 -m http.server 8000`, then open http://localhost:8000.
See [web/README.md](web/README.md).

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

Pins, debounce, long-press time, frame rate and save intervals are all in
`include/config.h`. If the cursor moves the wrong way, set
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
include/render.h      ┐ U8g2 drawing: status bar, 8x4 plot grid, cursor,
src/render.cpp        ┘ seed menu; redraws only when something changed
src/main.cpp          ~30 Hz loop and FARM / SEED_MENU state machine
diagram.json          Wokwi wiring
wokwi.toml            Wokwi firmware paths
```

Data flows one way each frame: `clock` → `input` → `game` (via `main`) →
`save` → `render`.

## Testing in Wokwi

Wokwi simulates the ESP32, OLED and encoder, so you can play without hardware.
`diagram.json` holds the parts and wiring.

### VS Code (recommended)

1. Install the **Wokwi Simulator** extension and follow its prompt to get a
   free license.
2. Open this folder in VS Code and build: `pio run -e esp32dev`
3. Press F1 and run **Wokwi: Start Simulator**.

Rebuild after every code change, then restart the simulator.

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

On wokwi.com, switch to real grow times by changing
`#define FARM_GROW_REAL 0` to `1` in `crops.h`.

### Using the simulator

- Click the arrows on the encoder to turn it one click.
- Click the knob for a short press. Hold the mouse button on it for 1 s for a
  long press.
- Stopping and starting the simulation works like the power switch.
- Quick check: plant wheat, wait 10 s, and the tile turns ripe. Harvesting adds
  $2.
