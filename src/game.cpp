// game.cpp - pure rules. See game.h.
#include "game.h"

static bool validCrop(int32_t c) { return c >= 0 && c < CROP_COUNT; }

// Seconds since planting. Unsigned subtraction is modulo 2^32, so this stays
// correct when `now` has wrapped past 0xFFFFFFFF and plantedAt has not.
static uint32_t elapsed(const Tile& t, uint32_t now) {
    return static_cast<uint32_t>(now - t.plantedAt);
}

void gameReset(Game& g) {
    g.coins = START_COINS;
    g.selected = START_CROP;
    for (Tile& t : g.tiles) {
        t.crop = NO_CROP;
        t.plantedAt = 0;
    }
}

bool gameIsValid(const Game& g) {
    if (!validCrop(g.selected)) return false;
    for (const Tile& t : g.tiles) {
        if (t.crop != NO_CROP && !validCrop(t.crop)) return false;
    }
    return true;
}

// Stage boundaries: elapsed >= grow/3 -> sprout, >= 2*grow/3 -> growing,
// >= grow -> ripe. Compared as elapsed*3 >= grow*k in 64-bit so there is no
// rounding and no overflow.
Stage tileStage(const Tile& t, uint32_t now) {
    if (!validCrop(t.crop)) return Stage::Empty;
    const uint64_t grow = CROPS[t.crop].growSeconds;
    const uint64_t e = elapsed(t, now);
    if (e >= grow)         return Stage::Ripe;
    if (e * 3 >= grow * 2) return Stage::Growing;
    if (e * 3 >= grow)     return Stage::Sprout;
    return Stage::Seed;
}

uint8_t tilePercent(const Tile& t, uint32_t now) {
    if (!validCrop(t.crop)) return 0;
    const uint64_t grow = CROPS[t.crop].growSeconds;
    const uint64_t e = elapsed(t, now);
    if (e >= grow) return 100;
    return static_cast<uint8_t>(e * 100 / grow);   // < 100 while growing
}

bool canAfford(const Game& g, uint8_t crop) {
    return validCrop(crop) && g.coins >= CROPS[crop].seedCost;
}

bool plant(Game& g, uint8_t idx, uint8_t crop, uint32_t now) {
    if (idx >= TILE_COUNT || !canAfford(g, crop)) return false;
    Tile& t = g.tiles[idx];
    if (t.crop != NO_CROP) return false;
    g.coins -= CROPS[crop].seedCost;
    t.crop = static_cast<int8_t>(crop);
    t.plantedAt = now;
    return true;
}

bool harvest(Game& g, uint8_t idx, uint32_t now) {
    if (idx >= TILE_COUNT) return false;
    Tile& t = g.tiles[idx];
    if (tileStage(t, now) != Stage::Ripe) return false;
    const uint32_t pay = CROPS[t.crop].sellPrice;
    g.coins = (g.coins > UINT32_MAX - pay) ? UINT32_MAX : g.coins + pay;  // saturate
    t.crop = NO_CROP;
    t.plantedAt = 0;
    return true;
}

PressResult pressTile(Game& g, uint8_t idx, uint32_t now) {
    if (idx >= TILE_COUNT) return PressResult::None;
    switch (tileStage(g.tiles[idx], now)) {
        case Stage::Empty:
            return plant(g, idx, g.selected, now) ? PressResult::Planted : PressResult::None;
        case Stage::Ripe:
            return harvest(g, idx, now) ? PressResult::Harvested : PressResult::None;
        default:
            return PressResult::None;
    }
}

uint8_t wrapIndex(uint8_t cur, int32_t steps, uint8_t n) {
    if (n == 0) return 0;
    int32_t v = (static_cast<int32_t>(cur) + steps % n) % n;
    if (v < 0) v += n;
    return static_cast<uint8_t>(v);
}
