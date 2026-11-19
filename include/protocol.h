// protocol.h - the console <-> web message format (protocol v1).
//
// Pure: no Arduino, no networking, no clock reads. net.cpp moves the bytes;
// this module turns game state into JSON and JSON commands into game changes,
// so it builds and runs in the PC unit tests. See
// .plans/console-web-link-spec.md section 3 for the message table.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include "game.h"

constexpr uint8_t PROTO_VERSION = 1;

// A command from the web. Pings carry no id.
enum class CmdType : uint8_t { Press, Select, Ping };

struct Command {
    CmdType  type;
    uint32_t id;    // client counter, echoed in the result
    int32_t  arg;   // tile for Press, crop for Select
};

enum class Reason : uint8_t { Ok, NotRipe, NoCoins, BadTile, BadCrop, Busy };

// What applying a command did. `press` is None for selects and failures.
struct Outcome {
    Reason      reason;
    PressResult press;
    uint8_t     tile;
    int8_t      crop;     // crop planted or harvested
    uint16_t    amount;   // coins spent (planted) or earned (harvested)
};

// Parses one text frame. False for bad JSON, an unknown `t`, or a missing or
// wrongly typed field. Range checks happen in applyCommand, so a bad tile
// still gets a result with a reason.
bool        decodeCommand(const char* data, size_t len, Command& out);

// Applies a Press or Select with the shared game rules. Press uses the shared
// selected seed, exactly like the encoder's short press.
Outcome     applyCommand(Game& g, const Command& c, uint32_t now);

const char* reasonName(Reason r);   // "not_ripe", ... ; "" for Ok

// Encoders write compact JSON into buf and return its length, or 0 if it did
// not fit.
size_t encodeHello(char* buf, size_t n);
size_t encodeState(const Game& g, uint32_t now, char* buf, size_t n);
size_t encodeEvent(const Outcome& o, bool fromWeb, char* buf, size_t n);
size_t encodeResult(uint32_t id, Reason r, char* buf, size_t n);
size_t encodeBusy(char* buf, size_t n);

constexpr size_t PROTO_STATE_MAX = 640;   // a full state is ~420 bytes
