// input.cpp - encoder via ESP32Encoder (hardware PCNT), buttons via a
// stable-for-25-ms debouncer.
//
// Why ESP32Encoder: it counts quadrature edges in the ESP32's pulse-counter
// (PCNT) peripheral, in hardware, with a glitch filter. No edge is missed
// even if the loop is busy drawing or writing NVS, and contact bounce shows up
// as +1/-1 pairs that cancel out. We never write interrupt code ourselves.
#include "input.h"
#include <Arduino.h>
#include <ESP32Encoder.h>
#include "clock.h"
#include "config.h"

namespace {

ESP32Encoder encoder;
int64_t detentBase = 0;   // encoder count at the last whole detent we reported

// Reports a press once the pin has held a new level for BUTTON_DEBOUNCE_MS.
struct Debouncer {
    uint8_t  pin;
    bool     stableDown;
    bool     rawDown;
    uint32_t rawChangedMs;
    bool     pressed;     // latched event, cleared by inputTake()

    void update(uint32_t ms) {
        const bool down = digitalRead(pin) == LOW;   // active low
        if (down != rawDown) {
            rawDown = down;
            rawChangedMs = ms;
        } else if (down != stableDown && ms - rawChangedMs >= BUTTON_DEBOUNCE_MS) {
            stableDown = down;
            if (down) pressed = true;   // fire on the press edge only
        }
    }
};

Debouncer encSwitch{PIN_ENC_SW, false, false, 0, false};
Debouncer buttonB{PIN_BTN_B, false, false, 0, false};

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
    pinMode(PIN_BTN_B, INPUT_PULLUP);
    ESP32Encoder::useInternalWeakPullResistors = puType::up;
    encoder.attachFullQuad(PIN_ENC_A, PIN_ENC_B);
    encoder.setFilter(ENC_FILTER_APB_CYCLES);
    encoder.clearCount();
    detentBase = 0;
}

void inputUpdate() {
    const uint32_t ms = uptimeMs();
    encSwitch.update(ms);
    buttonB.update(ms);
}

InputEvents inputTake() {
    InputEvents ev{takeDetents(), encSwitch.pressed, buttonB.pressed};
    encSwitch.pressed = false;
    buttonB.pressed = false;
    return ev;
}
