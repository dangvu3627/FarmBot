// save.cpp - one versioned, checksummed blob in NVS.
#include "save.h"
#include <Preferences.h>
#include <string.h>
#include "config.h"

namespace {

constexpr char     NVS_NAMESPACE[] = "farm";
constexpr char     NVS_KEY[]       = "state";
constexpr uint16_t SAVE_VERSION    = 1;   // bump when the layout or meaning changes

// Fixed layout with explicit padding, so every byte is defined and the
// checksum covers no uninitialised padding. Tiles are stored as two arrays
// (crops, plantedAt) instead of an array of structs for the same reason.
struct SaveBlob {
    uint16_t version;
    uint16_t reserved;      // always 0
    uint32_t checksum;      // CRC-32 of the whole blob with this field = 0
    uint32_t gameSeconds;
    uint32_t coins;
    uint8_t  selected;
    int8_t   crops[TILE_COUNT];
    uint8_t  pad[3];        // always 0; keeps plantedAt 4-byte aligned
    uint32_t plantedAt[TILE_COUNT];
};
static_assert(sizeof(SaveBlob) == 52 + 4 * TILE_COUNT, "unexpected padding in SaveBlob");

Preferences prefs;
bool        prefsOpen = false;
bool        pending = false;          // an event save is waiting
bool        wroteThisSession = false;
uint32_t    lastWriteAt = 0;          // game seconds of the last write (or load)

// Standard reflected CRC-32 (poly 0xEDB88320), bitwise: small and table-free.
uint32_t crc32(const uint8_t* data, size_t len) {
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; ++i) {
        crc ^= data[i];
        for (int b = 0; b < 8; ++b) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

uint32_t blobChecksum(SaveBlob copy) {   // by value: zero the field in the copy
    copy.checksum = 0;
    return crc32(reinterpret_cast<const uint8_t*>(&copy), sizeof(copy));
}

void toBlob(const Game& g, uint32_t seconds, SaveBlob& b) {
    memset(&b, 0, sizeof(b));
    b.version = SAVE_VERSION;
    b.gameSeconds = seconds;
    b.coins = g.coins;
    b.selected = g.selected;
    for (uint8_t i = 0; i < TILE_COUNT; ++i) {
        b.crops[i] = g.tiles[i].crop;
        b.plantedAt[i] = g.tiles[i].plantedAt;
    }
    b.checksum = blobChecksum(b);
}

void fromBlob(const SaveBlob& b, Game& g) {
    g.coins = b.coins;
    g.selected = b.selected;
    for (uint8_t i = 0; i < TILE_COUNT; ++i) {
        g.tiles[i].crop = b.crops[i];
        g.tiles[i].plantedAt = b.plantedAt[i];
    }
}

void writeNow(const Game& g, uint32_t now) {
    SaveBlob b;
    toBlob(g, now, b);
    if (prefsOpen && prefs.putBytes(NVS_KEY, &b, sizeof(b)) == sizeof(b)) {
        pending = false;
        wroteThisSession = true;
        lastWriteAt = now;
    }
    // On failure `pending` stays set and the next frame retries after the
    // interval check; nothing else to do without a UI for errors.
}

}  // namespace

bool saveBegin() {
    prefsOpen = prefs.begin(NVS_NAMESPACE, /*readOnly=*/false);
    return prefsOpen;
}

// Validation runs in order, and any failure means "start a fresh farm":
//  1. key exists and its length equals sizeof(SaveBlob)  (missing / layout change)
//  2. version matches SAVE_VERSION                       (old firmware's save)
//  3. CRC-32 matches                                     (torn write / corruption)
//  4. decoded game passes gameIsValid()                  (indices in range)
bool saveLoad(Game& g, uint32_t& gameSeconds) {
    if (!prefsOpen || !prefs.isKey(NVS_KEY)) return false;
    if (prefs.getBytesLength(NVS_KEY) != sizeof(SaveBlob)) return false;
    SaveBlob b;
    if (prefs.getBytes(NVS_KEY, &b, sizeof(b)) != sizeof(b)) return false;
    if (b.version != SAVE_VERSION) return false;
    if (b.checksum != blobChecksum(b)) return false;

    Game loaded;
    fromBlob(b, loaded);
    if (!gameIsValid(loaded)) return false;

    g = loaded;
    gameSeconds = b.gameSeconds;
    lastWriteAt = b.gameSeconds;
    return true;
}

void saveRequest() { pending = true; }

void saveService(const Game& g, uint32_t now) {
    const uint32_t since = now - lastWriteAt;   // wrap-safe
    // The first event after boot saves at once; later ones wait out the interval.
    const bool eventDue = pending && (!wroteThisSession || since >= SAVE_MIN_INTERVAL_S);
    const bool periodicDue = since >= SAVE_PERIODIC_S;
    if (eventDue || periodicDue) writeNow(g, now);
}
