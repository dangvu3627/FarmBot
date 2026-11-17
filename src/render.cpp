// render.cpp - U8g2 full-buffer drawing. Layout (128x64):
//   y 0..7   status bar: coins left, cursor-tile info right
//   y 8..63  8 x 4 grid of 16 x 14 px plots
#include "render.h"
#include <Arduino.h>
#include <U8g2lib.h>
#include <stdio.h>
#include "config.h"

namespace {

U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, PIN_I2C_SCL, PIN_I2C_SDA);
bool dirty = true;

constexpr int STATUS_H = 8;
constexpr int PLOT_W = 16;
constexpr int PLOT_H = 14;
constexpr int MENU_X = 10, MENU_Y = 13, MENU_W = 108, MENU_ROW_H = 10;

// ---- plant sprites ---------------------------------------------------------
// All coordinates relative to the plot's top-left (x, y). Soil line at y+12.

void drawSoil(int x, int y) {
    for (int i = 2; i < 14; i += 2) u8g2.drawPixel(x + i, y + 12);
}

void drawSeed(int cx, int gy)   { u8g2.drawBox(cx, gy - 2, 2, 2); }

void drawSprout(int cx, int gy) {
    u8g2.drawVLine(cx, gy - 4, 4);
    u8g2.drawPixel(cx - 1, gy - 4);
    u8g2.drawPixel(cx + 1, gy - 5);
}

void drawGrowing(int cx, int gy) {
    u8g2.drawVLine(cx, gy - 8, 8);
    u8g2.drawLine(cx, gy - 3, cx - 3, gy - 6);
    u8g2.drawLine(cx, gy - 5, cx + 3, gy - 8);
}

void drawWheat(int cx, int gy) {
    for (int dx = -2; dx <= 2; dx += 4) {        // two stalks with grain heads
        u8g2.drawVLine(cx + dx, gy - 6, 6);
        u8g2.drawBox(cx + dx - 1, gy - 10, 3, 4);
    }
}

void drawCarrot(int cx, int gy) {
    u8g2.drawTriangle(cx - 3, gy - 4, cx + 4, gy - 4, cx, gy + 1);  // root
    u8g2.drawLine(cx, gy - 4, cx - 3, gy - 9);                        // leaves
    u8g2.drawLine(cx, gy - 4, cx, gy - 10);
    u8g2.drawLine(cx, gy - 4, cx + 3, gy - 9);
}

void drawPumpkin(int cx, int gy) {
    u8g2.drawFilledEllipse(cx, gy - 4, 5, 4);
    u8g2.setDrawColor(0);
    u8g2.drawVLine(cx, gy - 6, 5);               // rib groove
    u8g2.setDrawColor(1);
    u8g2.drawVLine(cx, gy - 10, 3);              // stem
}

void drawPlant(int x, int y, const Tile& t, Stage s) {
    const int cx = x + 7, gy = y + 12;
    switch (s) {
        case Stage::Seed:    drawSeed(cx, gy); break;
        case Stage::Sprout:  drawSprout(cx, gy); break;
        case Stage::Growing: drawGrowing(cx, gy); break;
        case Stage::Ripe:
            if (t.crop == 0)      drawWheat(cx, gy);
            else if (t.crop == 1) drawCarrot(cx, gy);
            else                  drawPumpkin(cx, gy);   // pumpkin and any added crop
            break;
        case Stage::Empty: break;
    }
}

// ---- status bar ------------------------------------------------------------

void formatTileInfo(char* buf, size_t n, const Game& g, const Tile& t, uint32_t now) {
    const Stage s = tileStage(t, now);
    if (s == Stage::Empty) {
        snprintf(buf, n, "EMPTY $%u", CROPS[g.selected].seedCost);
    } else if (s == Stage::Ripe) {
        snprintf(buf, n, "%s +$%u", CROPS[t.crop].name, CROPS[t.crop].sellPrice);
    } else {
        snprintf(buf, n, "%s %u%%", CROPS[t.crop].name, tilePercent(t, now));
    }
}

void drawStatus(const View& v) {
    char buf[24];
    snprintf(buf, sizeof(buf), "$%lu", static_cast<unsigned long>(v.game->coins));
    u8g2.drawStr(0, 0, buf);
    formatTileInfo(buf, sizeof(buf), *v.game, v.game->tiles[v.cursor], v.now);
    u8g2.drawStr(128 - u8g2.getStrWidth(buf), 0, buf);
}

// ---- grid ------------------------------------------------------------------

void drawGrid(const View& v) {
    for (uint8_t i = 0; i < TILE_COUNT; ++i) {
        const int x = (i % GRID_COLS) * PLOT_W;
        const int y = STATUS_H + (i / GRID_COLS) * PLOT_H;
        const Tile& t = v.game->tiles[i];
        drawSoil(x, y);
        drawPlant(x, y, t, tileStage(t, v.now));
        if (i == v.cursor) u8g2.drawRFrame(x, y, PLOT_W, PLOT_H, 2);
    }
}

// ---- seed menu -------------------------------------------------------------

// "1m" for whole minutes, otherwise "10s".
void formatGrowTime(char* buf, size_t n, uint32_t s) {
    if (s >= 60 && s % 60 == 0) snprintf(buf, n, "%lum", static_cast<unsigned long>(s / 60));
    else                        snprintf(buf, n, "%lus", static_cast<unsigned long>(s));
}

void drawMenuRow(uint8_t row, bool highlight) {
    const CropDef& c = CROPS[row];
    char t[12], line[32];
    formatGrowTime(t, sizeof(t), c.growSeconds);
    snprintf(line, sizeof(line), "%s $%u>$%u %s", c.name, c.seedCost, c.sellPrice, t);
    const int y = MENU_Y + 11 + row * MENU_ROW_H;
    if (highlight) {
        u8g2.drawBox(MENU_X + 2, y - 1, MENU_W - 4, MENU_ROW_H - 1);
        u8g2.setDrawColor(0);
    }
    u8g2.drawStr(MENU_X + 4, y, line);
    u8g2.setDrawColor(1);
}

void drawMenu(const View& v) {
    const int h = 12 + CROP_COUNT * MENU_ROW_H;
    u8g2.setDrawColor(0);
    u8g2.drawBox(MENU_X, MENU_Y, MENU_W, h);     // clear the area under the box
    u8g2.setDrawColor(1);
    u8g2.drawFrame(MENU_X, MENU_Y, MENU_W, h);
    u8g2.drawStr(MENU_X + 4, MENU_Y + 2, "SEEDS");
    for (uint8_t r = 0; r < CROP_COUNT; ++r) drawMenuRow(r, r == v.menuRow);
}

}  // namespace

void renderBegin() {
    u8g2.setI2CAddress(OLED_I2C_ADDR << 1);   // U8g2 wants the 8-bit form
    u8g2.setBusClock(OLED_I2C_HZ);
    u8g2.begin();
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.setFontPosTop();
    dirty = true;
}

void renderMarkDirty() { dirty = true; }

void renderIfDirty(const View& v) {
    if (!dirty) return;
    dirty = false;
    u8g2.clearBuffer();
    drawStatus(v);
    drawGrid(v);
    if (v.menuOpen) drawMenu(v);
    u8g2.sendBuffer();   // ~25 ms at 400 kHz; only happens on change
}
