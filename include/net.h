// net.h - the web link: Wi-Fi hotspot + one WebSocket client at /ws.
//
// Threading: the async web server runs its callbacks on its own task. Those
// callbacks never touch the Game; they only queue decoded commands. All game
// changes happen in loop() through netDrain(), so game.cpp stays
// single-threaded. Real hardware makes the "FarmBot" hotspot; the
// FARM_NET_SIM build joins Wokwi-GUEST instead.
#pragma once
#include <stdint.h>
#include "game.h"

enum class NetStatus : uint8_t { Down, Up, Client };   // OLED glyph: none, outline, filled

void      netBegin();
// Applies queued web commands to g and replies to each. Returns true when the
// selected seed changed (main moves the open seed menu's highlight).
bool      netDrain(Game& g, uint32_t now);
// main calls this after an encoder plant/harvest so the web shows it.
void      netNotifyLocal(PressResult r, uint8_t tile, int8_t crop, uint16_t amount);
// Sends hello on connect, pending events, and state when the game changed or
// the heartbeat is due. Drops a client that has been silent too long.
void      netPublish(const Game& g, uint32_t now);
NetStatus netStatus();
