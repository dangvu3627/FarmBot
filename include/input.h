// input.h - debounced input events.
#pragma once
#include <stdint.h>

struct InputEvents {
    int32_t steps;   // encoder detents since the last take: + right, - left
    bool    press;   // encoder switch pressed
    bool    back;    // button B pressed
};

void        inputBegin();
void        inputUpdate();   // call every loop pass: samples and debounces buttons
InputEvents inputTake();     // call once per frame: returns and clears events
