// PC unit tests for the pure game rules. Run: pio test -e native
#include <unity.h>
#include "game.h"

static Game g;

void setUp() { gameReset(g); }
void tearDown() {}

static constexpr uint8_t WHEAT = 0, CARROT = 1, PUMPKIN = 2;

static Tile tileAt(uint8_t crop, uint32_t plantedAt) {
    return Tile{static_cast<int8_t>(crop), plantedAt};
}

// ---- stages ----------------------------------------------------------------

static void test_empty_tile_is_empty() {
    TEST_ASSERT_EQUAL(Stage::Empty, tileStage(g.tiles[0], 12345));
}

// Pumpkin's grow time (30 dev / 600 real) divides by 3, so the boundaries fall
// on exact seconds: the stage must change exactly at G/3, 2G/3 and G.
static void test_stage_boundaries_exact_thirds() {
    const uint32_t G = CROPS[PUMPKIN].growSeconds;
    TEST_ASSERT_EQUAL_UINT32(0, G % 3);
    const uint32_t p = 1000;
    const Tile t = tileAt(PUMPKIN, p);
    TEST_ASSERT_EQUAL(Stage::Seed,    tileStage(t, p));
    TEST_ASSERT_EQUAL(Stage::Seed,    tileStage(t, p + G / 3 - 1));
    TEST_ASSERT_EQUAL(Stage::Sprout,  tileStage(t, p + G / 3));
    TEST_ASSERT_EQUAL(Stage::Sprout,  tileStage(t, p + 2 * G / 3 - 1));
    TEST_ASSERT_EQUAL(Stage::Growing, tileStage(t, p + 2 * G / 3));
    TEST_ASSERT_EQUAL(Stage::Growing, tileStage(t, p + G - 1));
    TEST_ASSERT_EQUAL(Stage::Ripe,    tileStage(t, p + G));
    TEST_ASSERT_EQUAL(Stage::Ripe,    tileStage(t, p + 10 * G));
}

// Every crop, including ones whose time isn't a multiple of 3: the stage
// changes at the first whole second >= the exact fraction.
static void test_stage_boundaries_all_crops() {
    for (uint8_t c = 0; c < CROP_COUNT; ++c) {
        const uint32_t G = CROPS[c].growSeconds;
        const uint32_t b1 = (G + 2) / 3;          // ceil(G/3)
        const uint32_t b2 = (2 * G + 2) / 3;      // ceil(2G/3)
        const Tile t = tileAt(c, 0);
        TEST_ASSERT_EQUAL(Stage::Seed,    tileStage(t, b1 - 1));
        TEST_ASSERT_EQUAL(Stage::Sprout,  tileStage(t, b1));
        TEST_ASSERT_EQUAL(Stage::Sprout,  tileStage(t, b2 - 1));
        TEST_ASSERT_EQUAL(Stage::Growing, tileStage(t, b2));
        TEST_ASSERT_EQUAL(Stage::Growing, tileStage(t, G - 1));
        TEST_ASSERT_EQUAL(Stage::Ripe,    tileStage(t, G));
    }
}

static void test_percent() {
    const uint32_t G = CROPS[CARROT].growSeconds;
    const Tile t = tileAt(CARROT, 0);
    TEST_ASSERT_EQUAL_UINT8(0, tilePercent(t, 0));
    TEST_ASSERT_EQUAL_UINT8(50, tilePercent(t, G / 2));
    TEST_ASSERT_LESS_THAN_UINT8(100, tilePercent(t, G - 1));
    TEST_ASSERT_EQUAL_UINT8(100, tilePercent(t, G));
}

// ---- planting --------------------------------------------------------------

static void test_start_state() {
    TEST_ASSERT_EQUAL_UINT32(12, g.coins);
    TEST_ASSERT_EQUAL_UINT8(WHEAT, g.selected);
    TEST_ASSERT_TRUE(gameIsValid(g));
}

static void test_plant_spends_seed_cost() {
    TEST_ASSERT_TRUE(plant(g, 3, CARROT, 50));
    TEST_ASSERT_EQUAL_UINT32(12 - CROPS[CARROT].seedCost, g.coins);
    TEST_ASSERT_EQUAL_INT8(CARROT, g.tiles[3].crop);
    TEST_ASSERT_EQUAL_UINT32(50, g.tiles[3].plantedAt);
}

static void test_plant_with_too_few_coins_fails() {
    g.coins = CROPS[PUMPKIN].seedCost - 1;
    TEST_ASSERT_FALSE(canAfford(g, PUMPKIN));
    TEST_ASSERT_FALSE(plant(g, 0, PUMPKIN, 0));
    TEST_ASSERT_EQUAL_UINT32(CROPS[PUMPKIN].seedCost - 1, g.coins);
    TEST_ASSERT_EQUAL_INT8(NO_CROP, g.tiles[0].crop);

    g.coins = CROPS[PUMPKIN].seedCost;           // exactly enough works
    TEST_ASSERT_TRUE(plant(g, 0, PUMPKIN, 0));
    TEST_ASSERT_EQUAL_UINT32(0, g.coins);
}

static void test_plant_on_occupied_tile_fails() {
    TEST_ASSERT_TRUE(plant(g, 0, WHEAT, 0));
    const uint32_t coins = g.coins;
    TEST_ASSERT_FALSE(plant(g, 0, WHEAT, 1));
    TEST_ASSERT_EQUAL_UINT32(coins, g.coins);
    TEST_ASSERT_EQUAL_UINT32(0, g.tiles[0].plantedAt);
}

// ---- harvesting ------------------------------------------------------------

static void test_harvest_unripe_does_nothing() {
    TEST_ASSERT_TRUE(plant(g, 5, WHEAT, 100));
    const uint32_t coins = g.coins;
    const uint32_t G = CROPS[WHEAT].growSeconds;
    TEST_ASSERT_FALSE(harvest(g, 5, 100 + G - 1));
    TEST_ASSERT_EQUAL_UINT32(coins, g.coins);
    TEST_ASSERT_EQUAL_INT8(WHEAT, g.tiles[5].crop);
    TEST_ASSERT_FALSE(harvest(g, 6, 100 + G));     // empty tile
}

static void test_harvest_payout_each_crop() {
    for (uint8_t c = 0; c < CROP_COUNT; ++c) {
        gameReset(g);
        TEST_ASSERT_TRUE(plant(g, 0, c, 0));
        const uint32_t before = g.coins;
        TEST_ASSERT_TRUE(harvest(g, 0, CROPS[c].growSeconds));
        TEST_ASSERT_EQUAL_UINT32(before + CROPS[c].sellPrice, g.coins);
        TEST_ASSERT_EQUAL_INT8(NO_CROP, g.tiles[0].crop);
    }
}

// Acceptance check: plant wheat, it is ripe 10 s later (dev), harvest adds $2.
static void test_wheat_acceptance() {
#if !FARM_GROW_REAL
    TEST_ASSERT_EQUAL_UINT32(10, CROPS[WHEAT].growSeconds);
#endif
    TEST_ASSERT_EQUAL(PressResult::Planted, pressTile(g, 0, 0));
    TEST_ASSERT_EQUAL_UINT32(11, g.coins);
    TEST_ASSERT_EQUAL(PressResult::None, pressTile(g, 0, CROPS[WHEAT].growSeconds - 1));
    TEST_ASSERT_EQUAL(PressResult::Harvested, pressTile(g, 0, CROPS[WHEAT].growSeconds));
    TEST_ASSERT_EQUAL_UINT32(13, g.coins);
}

// ---- rollover --------------------------------------------------------------

static void test_now_rollover() {
    const uint32_t G = CROPS[PUMPKIN].growSeconds;
    const uint32_t p = UINT32_MAX - 5;               // planted just before the wrap
    TEST_ASSERT_TRUE(plant(g, 0, PUMPKIN, p));
    const Tile& t = g.tiles[0];
    TEST_ASSERT_EQUAL(Stage::Seed,    tileStage(t, p + G / 3 - 1));   // wraps
    TEST_ASSERT_EQUAL(Stage::Sprout,  tileStage(t, p + G / 3));
    TEST_ASSERT_EQUAL(Stage::Growing, tileStage(t, p + 2 * G / 3));
    TEST_ASSERT_EQUAL(Stage::Growing, tileStage(t, p + G - 1));
    TEST_ASSERT_TRUE(p + G < p);                      // `now` really has wrapped
    TEST_ASSERT_FALSE(harvest(g, 0, p + G - 1));
    TEST_ASSERT_TRUE(harvest(g, 0, p + G));
}

// ---- misc ------------------------------------------------------------------

static void test_wrap_index() {
    TEST_ASSERT_EQUAL_UINT8(1,  wrapIndex(0, 1, TILE_COUNT));
    TEST_ASSERT_EQUAL_UINT8(31, wrapIndex(0, -1, TILE_COUNT));
    TEST_ASSERT_EQUAL_UINT8(0,  wrapIndex(31, 1, TILE_COUNT));
    TEST_ASSERT_EQUAL_UINT8(2,  wrapIndex(0, -1, CROP_COUNT));
    TEST_ASSERT_EQUAL_UINT8(1,  wrapIndex(0, 70, CROP_COUNT));   // 70 % 3
}

static void test_invalid_game_rejected() {
    g.selected = CROP_COUNT;
    TEST_ASSERT_FALSE(gameIsValid(g));
    gameReset(g);
    g.tiles[7].crop = CROP_COUNT;
    TEST_ASSERT_FALSE(gameIsValid(g));
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_empty_tile_is_empty);
    RUN_TEST(test_stage_boundaries_exact_thirds);
    RUN_TEST(test_stage_boundaries_all_crops);
    RUN_TEST(test_percent);
    RUN_TEST(test_start_state);
    RUN_TEST(test_plant_spends_seed_cost);
    RUN_TEST(test_plant_with_too_few_coins_fails);
    RUN_TEST(test_plant_on_occupied_tile_fails);
    RUN_TEST(test_harvest_unripe_does_nothing);
    RUN_TEST(test_harvest_payout_each_crop);
    RUN_TEST(test_wheat_acceptance);
    RUN_TEST(test_now_rollover);
    RUN_TEST(test_wrap_index);
    RUN_TEST(test_invalid_game_rejected);
    return UNITY_END();
}
