// crops.h - the crop table. Edit rows here; nothing else needs to change.
#pragma once
#include <stdint.h>

// Grow-time switch. Default is the dev build (short times).
// Build with -D FARM_GROW_REAL=1 (or `pio run -e esp32dev_real`) for real times.
#ifndef FARM_GROW_REAL
#define FARM_GROW_REAL 0
#endif

#if FARM_GROW_REAL
#define FARM_GROW(devSeconds, realSeconds) (realSeconds)
#else
#define FARM_GROW(devSeconds, realSeconds) (devSeconds)
#endif

struct CropDef {
    const char* name;      // upper case, shown on screen
    uint16_t    seedCost;  // coins to plant
    uint16_t    sellPrice; // coins on harvest
    uint32_t    growSeconds;
};

constexpr CropDef CROPS[] = {
    //  name       seed  sell  grow (dev, real)
    { "WHEAT",     1,    2,    FARM_GROW(10, 60)  },
    { "CARROT",    2,    4,    FARM_GROW(20, 180) },
    { "PUMPKIN",   4,    8,    FARM_GROW(30, 600) },
};

constexpr uint8_t CROP_COUNT = sizeof(CROPS) / sizeof(CROPS[0]);
static_assert(CROP_COUNT > 0 && CROP_COUNT <= 127, "crop index must fit in int8_t");
