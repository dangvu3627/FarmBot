// net.cpp - see net.h. Message format lives in protocol.cpp.
#include "net.h"
#include <Arduino.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "clock.h"
#include "config.h"
#include "protocol.h"

namespace {

AsyncWebServer server(WEB_PORT);
AsyncWebSocket ws("/ws");
QueueHandle_t  commands = nullptr;   // Command, written by the async task
constexpr UBaseType_t QUEUE_DEPTH = 8;

// Shared with the async task. Single 32-bit words, so plain volatile is enough.
volatile uint32_t clientId = 0;       // the one accepted browser, 0 = none
volatile uint32_t rxCount = 0;        // bumps on every frame from the client
volatile bool     helloPending = false;

// Loop-only state.
uint32_t lastRxSeen = 0;
uint32_t lastHeardMs = 0;
uint32_t lastStateMs = 0;
uint32_t lastFingerprint = 0;
uint32_t sentTo = 0;                  // client the last state went to

struct PendingEvent { Outcome o; bool fromWeb; };
constexpr uint8_t EVENT_SLOTS = 4;
PendingEvent events[EVENT_SLOTS];
uint8_t      eventCount = 0;

char out[PROTO_STATE_MAX];

void pushEvent(const Outcome& o, bool fromWeb) {
    if (eventCount < EVENT_SLOTS) events[eventCount++] = PendingEvent{o, fromWeb};
    // A full queue drops the toast only; the state message still shows the change.
}

// Everything a `state` message carries except time.
uint32_t fingerprint(const Game& g) {
    uint32_t k = 2166136261u;   // FNV-1a
    auto mix = [&k](uint32_t v) {
        for (int i = 0; i < 4; ++i) k = (k ^ ((v >> (8 * i)) & 0xFFu)) * 16777619u;
    };
    mix(g.coins);
    mix(g.selected);
    for (const Tile& t : g.tiles) {
        mix(static_cast<uint8_t>(t.crop));
        mix(t.plantedAt);
    }
    return k;
}

void sendText(uint32_t id, size_t len) {
    if (len > 0) ws.text(id, out, len);
}

// ---- async task ------------------------------------------------------------

void onData(AsyncWebSocketClient* client, void* arg, uint8_t* data, size_t len) {
    if (client->id() != clientId) return;
    const AwsFrameInfo* info = static_cast<AwsFrameInfo*>(arg);
    // Commands are tiny: accept only whole, single-frame text messages.
    if (!info->final || info->index != 0 || info->len != len || info->opcode != WS_TEXT) return;
    rxCount = rxCount + 1;

    Command c;
    if (!decodeCommand(reinterpret_cast<const char*>(data), len, c)) return;
    if (c.type == CmdType::Ping) return;
    if (xQueueSend(commands, &c, 0) != pdTRUE) {
        char reply[64];
        const size_t n = encodeResult(c.id, Reason::Busy, reply, sizeof(reply));
        if (n > 0) client->text(reply, n);
    }
}

void onEvent(AsyncWebSocket*, AsyncWebSocketClient* client, AwsEventType type, void* arg,
             uint8_t* data, size_t len) {
    switch (type) {
        case WS_EVT_CONNECT:
            if (clientId == 0) {
                clientId = client->id();
                helloPending = true;
            } else {   // first one keeps it
                char reply[16];
                const size_t n = encodeBusy(reply, sizeof(reply));
                client->text(reply, n);
                client->close();
            }
            break;
        case WS_EVT_DISCONNECT:
            if (client->id() == clientId) clientId = 0;
            break;
        case WS_EVT_DATA:
            onData(client, arg, data, len);
            break;
        default:
            break;
    }
}

}  // namespace

// ---- loop task ---------------------------------------------------------------

void netBegin() {
    commands = xQueueCreate(QUEUE_DEPTH, sizeof(Command));
#if FARM_NET_SIM
    WiFi.mode(WIFI_STA);
    WiFi.begin("Wokwi-GUEST", "", 6);
#else
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD, AP_CHANNEL, /*hidden=*/0, AP_MAX_STATIONS);
    Serial.printf("FarmBot hotspot \"%s\" at %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
#endif
    ws.onEvent(onEvent);
    server.addHandler(&ws);
    server.begin();
}

bool netDrain(Game& g, uint32_t now) {
    bool selectedChanged = false;
    Command c;
    while (xQueueReceive(commands, &c, 0) == pdTRUE) {
        const uint8_t before = g.selected;
        const Outcome o = applyCommand(g, c, now);
        if (o.press != PressResult::None) pushEvent(o, /*fromWeb=*/true);
        if (g.selected != before) selectedChanged = true;
        const uint32_t id = clientId;
        if (id != 0) sendText(id, encodeResult(c.id, o.reason, out, sizeof(out)));
    }
    return selectedChanged;
}

void netNotifyLocal(PressResult r, uint8_t tile, int8_t crop, uint16_t amount) {
    if (r != PressResult::None) pushEvent(Outcome{Reason::Ok, r, tile, crop, amount}, false);
}

void netPublish(const Game& g, uint32_t now) {
    ws.cleanupClients();
    const uint32_t id = clientId;
    const uint32_t ms = uptimeMs();
    if (id == 0) {
        eventCount = 0;   // nobody to tell
        sentTo = 0;
        return;
    }

    const uint32_t rx = rxCount;
    if (rx != lastRxSeen) {
        lastRxSeen = rx;
        lastHeardMs = ms;
    }

    const bool fresh = helloPending || id != sentTo;
    if (fresh) {
        helloPending = false;
        sentTo = id;
        lastHeardMs = ms;
        eventCount = 0;   // events from before this client connected are stale
        sendText(id, encodeHello(out, sizeof(out)));
    } else if (ms - lastHeardMs >= NET_CLIENT_TIMEOUT_MS) {
        ws.close(id);     // silent too long: free the slot for another browser
        clientId = 0;
        return;
    }

    for (uint8_t i = 0; i < eventCount; ++i) sendText(id, encodeEvent(events[i].o, events[i].fromWeb, out, sizeof(out)));
    eventCount = 0;

    const uint32_t fp = fingerprint(g);
    const bool changed = fp != lastFingerprint;
    const bool heartbeat = ms - lastStateMs >= NET_STATE_HEARTBEAT_MS;
    // A heartbeat may be skipped while the socket is backed up; a change never is.
    if (fresh || changed || (heartbeat && ws.availableForWrite(id))) {
        lastFingerprint = fp;
        lastStateMs = ms;
        sendText(id, encodeState(g, now, out, sizeof(out)));
    }
}

NetStatus netStatus() {
#if FARM_NET_SIM
    const bool up = WiFi.status() == WL_CONNECTED;
#else
    const bool up = true;   // the hotspot is up from netBegin() on
#endif
    if (!up) return NetStatus::Down;
    return clientId != 0 ? NetStatus::Client : NetStatus::Up;
}
