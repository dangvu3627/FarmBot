# FarmBot – ESP32 farming console

## Build, flash, test

```
pio run -e esp32dev -t upload        # dev grow times (default)
pio run -e esp32dev_real -t upload   # real grow times
pio test -e native                   # PC unit tests for game.cpp
```

## Dev vs real grow times

There is one compile-time flag, `FARM_GROW_REAL`, read in `include/crops.h`.

- Not defined, or `0`: dev times (10 s / 20 s / 30 s). This is the default.
- `-D FARM_GROW_REAL=1`: real times (60 s / 180 s / 600 s).

Use the `esp32dev_real` environment, or add the flag to `build_flags` in
`env:esp32dev`. To change a crop's times, edit its `FARM_GROW(dev, real)` entry
in `crops.h`.

## Files

| File | Role |
|---|---|
| `include/config.h` | All pins, encoder tuning, timing and save intervals |
| `include/crops.h` | Crop table and grow-time switch |
| `include/game.h`, `src/game.cpp` | Pure rules (no Arduino); unit-tested |
| `include/clock.h`, `src/clock.cpp` | The only code that reads hardware time |
| `include/save.h`, `src/save.cpp` | Versioned, CRC-32-checked blob in NVS |
| `include/input.h`, `src/input.cpp` | Encoder detents and debounced buttons |
| `include/render.h`, `src/render.cpp` | U8g2 full-buffer drawing, dirty-flag redraw |
| `src/main.cpp` | ~30 Hz loop, FARM / SEED_MENU state machine |
| `test/test_game/test_main.cpp` | Unity tests |

Headers are in `include/` so that the `native` test build can find them. That
build compiles only `game.cpp`.

## Encoder library: ESP32Encoder

ESP32Encoder counts quadrature edges in the ESP32's PCNT peripheral, in
hardware, with a glitch filter of about 12.8 µs. Edges are counted even while
the loop is busy sending the 1 KB frame over I2C or writing to NVS, so the loop
never misses a step. Contact bounce shows up as +1/−1 pairs that cancel out.
`input.cpp` turns counts into whole detents and keeps the remainder, so a
half-turn is never dropped and never counted twice.

## Assumptions

1. **Encoder resolution.** The encoder gives 4 edges per detent (EC11 style).
   If yours gives 2, set `ENC_COUNTS_PER_DETENT = 2`. If it turns the wrong
   way, set `ENC_DIRECTION = -1`.
2. **Progress after a power cycle is restored to the last save, not to the
   moment power was cut.** With no battery or power-loss code (out of scope),
   nothing can save at power-off. Up to 5 minutes of growth can be lost, plus
   any event that happened within 60 s of the previous write. The first event
   after boot saves at once. Lower `SAVE_PERIODIC_S` in `config.h` if you want
   finer restore points, at the cost of more flash wear.
3. **The game clock resumes from the saved `gameSeconds`.** Time spent powered
   off does not count, as the spec says.
4. **Stage boundaries.** A stage changes at the first whole second ≥ G/3, 2G/3
   and G. The comparison is exact (`elapsed*3 >= G`), with no rounding.
5. **Status bar percent** is `elapsed*100/G`, floored. It reads 0–99 while
   growing and changes to `+$payout` when the crop is ripe.
6. **Pressing the encoder with too few coins does nothing.** There is no
   message or sound.
7. **Seed menu.** It opens with the current seed highlighted, and selection
   wraps at both ends. Grow time is shown as `Nm` when it is whole minutes,
   otherwise as `Ns`. Dev builds show `10s`, real builds show `1m`.
8. **Save validation.** The saved data must have the expected size, the current
   `SAVE_VERSION` and a correct CRC-32. The crop indices must also be in range.
   If any check fails, the console starts a fresh farm. Bump `SAVE_VERSION`
   whenever the layout or the crop table order changes.
9. **Redraw.** The screen is redrawn after input, after any tile's stage
   changes, or when the cursor tile's percent changes. The percent check makes
   the screen redraw about once a second while the cursor is on a growing tile.
10. **Time for debounce and frame pacing** comes from `uptimeMs()` in
    `clock.cpp`. This follows the rule that only the clock module reads time.
11. **The loop runs every ~1 ms** (`delay(1)`), so buttons are sampled often
    enough for the 25 ms debounce. Game logic runs every 33 ms.
12. **C++17.** It is enabled for both builds.
