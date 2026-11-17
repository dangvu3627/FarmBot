// save.h - persistent save in NVS (Preferences).
#pragma once
#include <stdint.h>
#include "game.h"

bool saveBegin();
// Fills g and gameSeconds from NVS. Returns false (and leaves both untouched)
// if the save is missing, the wrong version/size, or fails its checksum.
bool saveLoad(Game& g, uint32_t& gameSeconds);
// Marks that a save-worthy event happened (plant, harvest, menu confirm).
void saveRequest();
// Call every frame: writes when an event save or the periodic save is due.
void saveService(const Game& g, uint32_t now);
