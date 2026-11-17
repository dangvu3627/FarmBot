// input.cpp - encoder via ESP32Encoder (hardware PCNT), push switch via a
// stable-for-25-ms debouncer with short/long press detection.
//
// Why ESP32Encoder: it counts quadrature edges in the ESP32's pulse-counter
// (PCNT) peripheral, in hardware, with a glitch filter. No edge is missed
// even if the loop is busy drawing or writing NVS, and contact bounce shows up
// as +1/-1 pairs that cancel out. We never write interrupt code ourselves.
//
// Short vs long press: a press can only be called "short" once it is released,
// so `press` is sent on release. `hold` is sent the moment the switch has been
// down for LONG_PRESS_MS, and that hold's release then sends nothing.
#include "input.h"
#include <Arduino.h>
#include <ESP32Encoder.h>
#include "clock.h"
#include "config.h"

namespace {

ESP32Encoder encoder;
int64_t detentBase = 0;   // encoder count at the last whole detent we reported

// Debounced switch level: a new level is accepted once it has held for
// BUTTON_DEBOUNCE_MS.
bool     stableDown = false;
bool     rawDown = false;
uint32_t rawChangedMs = 0;

uint32_t downSinceMs = 0;   // when the switch went (stably) down
bool     holdDone = false;  // this press already sent `hold`, or must send nothing
bool     evPress = false, evHold = false;   // latched until inputTake()

bool readDown() { return digitalRead(PIN_ENC_SW) == LOW; }   // active low

// Returns true when the debounced level changes.
bool debounce(uint32_t ms) {
    const bool down = readDown();
    if (down != rawDown) {
        rawDown = down;
        rawChangedMs = ms;
    } else if (down != stableDown && ms - rawChangedMs >= BUTTON_DEBOUNCE_MS) {
        stableDown = down;
        return true;
    }
    return false;
}

// Converts raw counts into whole detents. The remainder stays in the counter,
// so half-turns are neither dropped nor counted twice.
int32_t takeDetents() {
    const int64_t delta = encoder.getCount() - detentBase;
    const int64_t detents = delta / ENC_COUNTS_PER_DETENT;   // truncates toward 0
    detentBase += detents * ENC_COUNTS_PER_DETENT;
    return static_cast<int32_t>(detents) * ENC_DIRECTION;
}

}  // namespace

void inputBegin() {
    pinMode(PIN_ENC_SW, INPUT_PULLUP);
    rawDown = stableDown = readDown();
    holdDone = stableDown;   // held at power-on: ignore this press entirely

    ESP32Encoder::useInternalWeakPullResistors = puType::up;
    encoder.attachFullQuad(PIN_ENC_A, PIN_ENC_B);
    encoder.setFilter(ENC_FILTER_APB_CYCLES);
    encoder.clearCount();
    detentBase = 0;
}

void inputUpdate() {
    const uint32_t ms = uptimeMs();
    if (debounce(ms)) {
        if (stableDown) {
            downSinceMs = ms;
            holdDone = false;
        } else if (!holdDone) {
            evPress = true;   // released before LONG_PRESS_MS
        }
    } else if (stableDown && !holdDone && ms - downSinceMs >= LONG_PRESS_MS) {
        holdDone = true;
        evHold = true;
    }
}

InputEvents inputTake() {
    InputEvents ev{takeDetents(), evPress, evHold};
    evPress = evHold = false;
    return ev;
}
