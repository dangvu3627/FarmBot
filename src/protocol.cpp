// protocol.cpp - see protocol.h.
#include "protocol.h"
#include <ArduinoJson.h>
#include <string.h>

namespace {

size_t finish(const JsonDocument& doc, char* buf, size_t n) {
    if (doc.overflowed() || measureJson(doc) >= n) return 0;   // keep room for '\0'
    return serializeJson(doc, buf, n);
}

Outcome fail(Reason r) { return Outcome{r, PressResult::None, 0, NO_CROP, 0}; }

}  // namespace

bool decodeCommand(const char* data, size_t len, Command& out) {
    JsonDocument doc;
    if (deserializeJson(doc, data, len) != DeserializationError::Ok) return false;
    const char* t = doc["t"];
    if (t == nullptr) return false;

    if (strcmp(t, "ping") == 0) {
        out = Command{CmdType::Ping, 0, 0};
        return true;
    }
    CmdType type;
    const char* argKey;
    if (strcmp(t, "press") == 0)       { type = CmdType::Press;  argKey = "tile"; }
    else if (strcmp(t, "select") == 0) { type = CmdType::Select; argKey = "crop"; }
    else return false;

    if (!doc["id"].is<uint32_t>() || !doc[argKey].is<int32_t>()) return false;
    out = Command{type, doc["id"].as<uint32_t>(), doc[argKey].as<int32_t>()};
    return true;
}

Outcome applyCommand(Game& g, const Command& c, uint32_t now) {
    if (c.type == CmdType::Select) {
        if (c.arg < 0 || c.arg >= CROP_COUNT) return fail(Reason::BadCrop);
        g.selected = static_cast<uint8_t>(c.arg);
        return fail(Reason::Ok);   // success with no plant/harvest
    }
    if (c.type != CmdType::Press) return fail(Reason::Ok);
    if (c.arg < 0 || c.arg >= TILE_COUNT) return fail(Reason::BadTile);

    const uint8_t idx = static_cast<uint8_t>(c.arg);
    const int8_t cropBefore = g.tiles[idx].crop;
    switch (tileStage(g.tiles[idx], now)) {
        case Stage::Empty:
            if (!canAfford(g, g.selected)) return fail(Reason::NoCoins);
            plant(g, idx, g.selected, now);
            return Outcome{Reason::Ok, PressResult::Planted, idx, g.tiles[idx].crop,
                           CROPS[g.selected].seedCost};
        case Stage::Ripe:
            harvest(g, idx, now);
            return Outcome{Reason::Ok, PressResult::Harvested, idx, cropBefore,
                           CROPS[cropBefore].sellPrice};
        default:
            return fail(Reason::NotRipe);
    }
}

const char* reasonName(Reason r) {
    switch (r) {
        case Reason::NotRipe: return "not_ripe";
        case Reason::NoCoins: return "no_coins";
        case Reason::BadTile: return "bad_tile";
        case Reason::BadCrop: return "bad_crop";
        case Reason::Busy:    return "busy";
        default:              return "";
    }
}

size_t encodeHello(char* buf, size_t n) {
    JsonDocument doc;
    doc["t"] = "hello";
    doc["proto"] = PROTO_VERSION;
    doc["growMode"] = FARM_GROW_REAL ? "real" : "dev";
    doc["cols"] = GRID_COLS;
    doc["rows"] = GRID_ROWS;
    JsonArray crops = doc["crops"].to<JsonArray>();
    for (const CropDef& c : CROPS) {
        JsonObject o = crops.add<JsonObject>();
        o["name"] = c.name;
        o["seedCost"] = c.seedCost;
        o["sellPrice"] = c.sellPrice;
        o["growSeconds"] = c.growSeconds;
    }
    return finish(doc, buf, n);
}

size_t encodeState(const Game& g, uint32_t now, char* buf, size_t n) {
    JsonDocument doc;
    doc["t"] = "state";
    doc["now"] = now;
    doc["coins"] = g.coins;
    doc["selected"] = g.selected;
    JsonArray tiles = doc["tiles"].to<JsonArray>();
    for (const Tile& t : g.tiles) {
        JsonArray pair = tiles.add<JsonArray>();
        pair.add(t.crop);
        pair.add(t.plantedAt);
    }
    return finish(doc, buf, n);
}

size_t encodeEvent(const Outcome& o, bool fromWeb, char* buf, size_t n) {
    JsonDocument doc;
    doc["t"] = "event";
    doc["kind"] = o.press == PressResult::Harvested ? "harvested" : "planted";
    doc["tile"] = o.tile;
    doc["crop"] = o.crop;
    doc["amount"] = o.amount;
    doc["from"] = fromWeb ? "web" : "console";
    return finish(doc, buf, n);
}

size_t encodeResult(uint32_t id, Reason r, char* buf, size_t n) {
    JsonDocument doc;
    doc["t"] = "result";
    doc["id"] = id;
    doc["ok"] = r == Reason::Ok;
    if (r != Reason::Ok) doc["reason"] = reasonName(r);
    return finish(doc, buf, n);
}

size_t encodeBusy(char* buf, size_t n) {
    JsonDocument doc;
    doc["t"] = "busy";
    return finish(doc, buf, n);
}
