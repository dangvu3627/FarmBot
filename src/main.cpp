// main.cpp - fixed ~30 Hz loop: input -> update -> draw if dirty.
#include <Arduino.h>
#include "clock.h"
#include "config.h"
#include "game.h"
#include "input.h"
#include "render.h"
#include "save.h"

namespace {

enum class Mode : uint8_t { Farm, SeedMenu };

Game     game;
Mode     mode = Mode::Farm;
uint8_t  cursor = 0;
uint8_t  menuRow = 0;
uint32_t lastFrameMs = 0;
uint32_t lastViewKey = 0;

void updateFarm(const InputEvents& ev, uint32_t t) {
    cursor = wrapIndex(cursor, ev.steps, TILE_COUNT);
    if (ev.press && pressTile(game, cursor, t) != PressResult::None) saveRequest();
    if (ev.hold) {
        menuRow = game.selected;
        mode = Mode::SeedMenu;
    }
}

void updateMenu(const InputEvents& ev) {
    menuRow = wrapIndex(menuRow, ev.steps, CROP_COUNT);
    if (ev.press) {
        game.selected = menuRow;
        saveRequest();
        mode = Mode::Farm;
    } else if (ev.hold) {
        mode = Mode::Farm;   // close without changing the selection
    }
}

// Fingerprint of everything on screen that changes with time alone: each
// tile's stage and the cursor tile's percent. A change means redraw.
uint32_t viewKey(uint32_t t) {
    uint32_t k = 2166136261u;   // FNV-1a
    for (const Tile& tile : game.tiles) k = (k ^ static_cast<uint8_t>(tileStage(tile, t))) * 16777619u;
    return (k ^ tilePercent(game.tiles[cursor], t)) * 16777619u;
}

void frame() {
    const uint32_t t = now();
    const InputEvents ev = inputTake();
    if (ev.steps != 0 || ev.press || ev.hold) renderMarkDirty();

    if (mode == Mode::Farm) updateFarm(ev, t);
    else                    updateMenu(ev);

    const uint32_t key = viewKey(t);
    if (key != lastViewKey) {
        lastViewKey = key;
        renderMarkDirty();
    }
    saveService(game, t);
    renderIfDirty(View{&game, cursor, mode == Mode::SeedMenu, menuRow, t});
}

}  // namespace

void setup() {
    setCpuFrequencyMhz(CPU_MHZ);

    uint32_t seconds = 0;
    saveBegin();
    if (!saveLoad(game, seconds)) {   // missing / old / corrupt -> fresh farm
        gameReset(game);
        seconds = 0;
    }
    clockBegin(seconds);
    inputBegin();
    renderBegin();
    menuRow = game.selected;
    lastFrameMs = uptimeMs();
}

void loop() {
    clockUpdate();
    inputUpdate();   // sample the switch every pass (~1 ms) for clean debounce
    const uint32_t ms = uptimeMs();
    if (ms - lastFrameMs >= FRAME_MS) {
        lastFrameMs += FRAME_MS;
        if (ms - lastFrameMs >= FRAME_MS) lastFrameMs = ms;   // fell behind: don't burst
        frame();
    }
    delay(1);   // yield to the idle task; keeps the watchdog fed
}
