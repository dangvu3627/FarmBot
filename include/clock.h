// clock.h - the ONLY module that reads hardware time.
//
// now()      : game seconds. Counts only while the console is powered on and
//              resumes from the saved value after a restart.
// uptimeMs() : free-running milliseconds since boot for debounce and frame
//              pacing. Wraps after ~49 days; compare with (a - b) only.
#pragma once
#include <stdint.h>

void     clockBegin(uint32_t startGameSeconds);
void     clockUpdate();     // call once per loop pass, before anything reads time
uint32_t now();
uint32_t uptimeMs();
