// clock.cpp - game time built from esp_timer_get_time().
//
// How it works:
//  * esp_timer_get_time() is a 64-bit microsecond counter since boot. It will
//    not wrap for ~292,000 years, so a plain subtraction gives the time since
//    the previous update.
//  * Each update adds that delta to a sub-second remainder and carries every
//    whole second into gameSeconds. The fractional part is kept, so no time is
//    lost or rounded away however irregular the loop timing is.
//  * gameSeconds and msCounter are uint32_t and wrap modulo 2^32 on purpose.
//    All consumers use unsigned subtraction (now - plantedAt), which stays
//    correct across the wrap as long as the intervals are < 2^32.
#include "clock.h"
#include <esp_timer.h>

static int64_t  lastUs       = 0;  // esp_timer value at the previous update
static uint32_t gameSeconds  = 0;
static uint32_t secRemUs     = 0;  // microseconds not yet carried into gameSeconds (< 1e6)
static uint32_t msCounter    = 0;
static uint32_t msRemUs      = 0;  // microseconds not yet carried into msCounter (< 1000)

void clockBegin(uint32_t startGameSeconds) {
    gameSeconds = startGameSeconds;
    secRemUs = 0;
    msCounter = 0;
    msRemUs = 0;
    lastUs = esp_timer_get_time();
}

// Adds `deltaUs` to a counter in `unitUs` steps, keeping the remainder.
static void carry(uint64_t deltaUs, uint32_t unitUs, uint32_t& counter, uint32_t& remUs) {
    const uint64_t total = remUs + deltaUs;
    counter += static_cast<uint32_t>(total / unitUs);  // modulo 2^32 by design
    remUs = static_cast<uint32_t>(total % unitUs);
}

void clockUpdate() {
    const int64_t nowUs = esp_timer_get_time();
    const int64_t delta = nowUs - lastUs;
    lastUs = nowUs;
    if (delta <= 0) return;   // defensive: the timer is monotonic
    carry(static_cast<uint64_t>(delta), 1000000u, gameSeconds, secRemUs);
    carry(static_cast<uint64_t>(delta), 1000u, msCounter, msRemUs);
}

uint32_t now()      { return gameSeconds; }
uint32_t uptimeMs() { return msCounter; }
