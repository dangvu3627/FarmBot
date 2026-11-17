// input.h - debounced input events. The rotary encoder is the only control:
// turn, short press, and long press.
#pragma once
#include <stdint.h>

struct InputEvents {
    int32_t steps;   // encoder detents since the last take: + right, - left
    bool    press;   // short press: sent on release, if released before LONG_PRESS_MS
    bool    hold;    // long press: sent once while still held, at LONG_PRESS_MS
};

void        inputBegin();
void        inputUpdate();   // call every loop pass: samples and debounces the switch
InputEvents inputTake();     // call once per frame: returns and clears events
