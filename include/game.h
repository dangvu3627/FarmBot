// game.h - pure game rules. No Arduino, no hardware, no clock reads:
// every time-dependent call takes `now` (game seconds) as a parameter,
// so this module builds and runs in PC unit tests.
#pragma once
#include <stdint.h>
#include "crops.h"

constexpr uint8_t  GRID_COLS   = 8;
constexpr uint8_t  GRID_ROWS   = 4;
constexpr uint8_t  TILE_COUNT  = GRID_COLS * GRID_ROWS;
constexpr int8_t   NO_CROP     = -1;
constexpr uint32_t START_COINS = 12;
constexpr uint8_t  START_CROP  = 0;   // wheat

enum class Stage : uint8_t { Empty, Seed, Sprout, Growing, Ripe };

// A tile stores only what it needs; the stage is always derived from time.
struct Tile {
    int8_t   crop;       // index into CROPS, or NO_CROP
    uint32_t plantedAt;  // game seconds when planted
};

struct Game {
    uint32_t coins;
    uint8_t  selected;   // crop the player will plant
    Tile     tiles[TILE_COUNT];
};

enum class PressResult : uint8_t { None, Planted, Harvested };

void     gameReset(Game& g);
bool     gameIsValid(const Game& g);

Stage    tileStage(const Tile& t, uint32_t now);
uint8_t  tilePercent(const Tile& t, uint32_t now);   // 0..100

bool     canAfford(const Game& g, uint8_t crop);
bool     plant(Game& g, uint8_t idx, uint8_t crop, uint32_t now);
bool     harvest(Game& g, uint8_t idx, uint32_t now);
// Encoder-press rule: plant the selected seed on empty, harvest ripe, else nothing.
PressResult pressTile(Game& g, uint8_t idx, uint32_t now);

// (cur + steps) wrapped into [0, n). Used for cursor and menu movement.
uint8_t  wrapIndex(uint8_t cur, int32_t steps, uint8_t n);
