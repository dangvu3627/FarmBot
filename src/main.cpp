// main.cpp - fixed ~30 Hz loop: input -> update -> draw if dirty.
#include <Arduino.h>
#include "clock.h"
#include "config.h"
#include "game.h"
#include "input.h"
#include "net.h"
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
    if (ev.press) {
        const Tile before = game.tiles[cursor];
        const PressResult r = pressTile(game, cursor, t);
        if (r != PressResult::None) {
            saveRequest();
            const int8_t crop = r == PressResult::Planted ? game.tiles[cursor].crop : before.crop;
            const uint16_t amount = r == PressResult::Planted ? CROPS[crop].seedCost : CROPS[crop].sellPrice;
            netNotifyLocal(r, cursor, crop, amount);
        }
    }
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

// Fingerprint of everything on screen that can change without an encoder
// event: each tile's stage, the cursor tile's percent, and (because the web
// can plant, harvest and pick seeds) coins, the selected seed and the Wi-Fi
// glyph. A change means redraw.
uint32_t viewKey(uint32_t t) {
    uint32_t k = 2166136261u;   // FNV-1a
    for (const Tile& tile : game.tiles) k = (k ^ static_cast<uint8_t>(tileStage(tile, t))) * 16777619u;
    k = (k ^ tilePercent(game.tiles[cursor], t)) * 16777619u;
    k = (k ^ game.coins) * 16777619u;
    k = (k ^ game.selected) * 16777619u;
    k = (k ^ menuRow) * 16777619u;
    return (k ^ static_cast<uint8_t>(netStatus())) * 16777619u;
}

void frame() {
    const uint32_t t = now();
    const InputEvents ev = inputTake();
    if (ev.steps != 0 || ev.press || ev.hold) renderMarkDirty();

    // Web commands first, so an encoder press this frame sees their result.
    const uint32_t coinsBefore = game.coins;
    const uint8_t seedBefore = game.selected;
    const bool webSelected = netDrain(game, t);
    if (game.coins != coinsBefore || game.selected != seedBefore) saveRequest();
    if (webSelected && mode == Mode::SeedMenu) menuRow = game.selected;

    if (mode == Mode::Farm) updateFarm(ev, t);
    else                    updateMenu(ev);

    const uint32_t key = viewKey(t);
    if (key != lastViewKey) {
        lastViewKey = key;
        renderMarkDirty();
    }
    saveService(game, t);
    netPublish(game, t);
    renderIfDirty(View{&game, cursor, mode == Mode::SeedMenu, menuRow, t, netStatus()});
}

}  // namespace

void setup() {
    setCpuFrequencyMhz(CPU_MHZ);
    Serial.begin(115200);

    uint32_t seconds = 0;
    saveBegin();
    if (!saveLoad(game, seconds)) {   // missing / old / corrupt -> fresh farm
        gameReset(game);
        seconds = 0;
    }
    clockBegin(seconds);
    inputBegin();
    renderBegin();
    netBegin();
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
