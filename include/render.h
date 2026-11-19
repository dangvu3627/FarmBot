// render.h - draws the farm, status bar and seed menu on the SSD1306.
#pragma once
#include <stdint.h>
#include "game.h"
#include "net.h"

struct View {
    const Game* game;
    uint8_t     cursor;
    bool        menuOpen;
    uint8_t     menuRow;
    uint32_t    now;
    NetStatus   net;        // Wi-Fi glyph after the coins
};

void renderBegin();
void renderMarkDirty();
// Draws and sends one frame only if something marked the screen dirty.
void renderIfDirty(const View& v);
