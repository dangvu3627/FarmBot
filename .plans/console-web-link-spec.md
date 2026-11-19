# Console ↔ Web Link — Spec & Build Plan

Status: **built** 2026-11-19 (see §10 for how the build differs from the draft)
Scope: connect the ESP32 console and the 3D web version so they show and play **one farm**.

## 1. Decisions (from the interview)

| Topic | Decision |
|---|---|
| Source of truth | **The ESP32 console.** `game.cpp` decides every action. The web is a live 3D client. There's no separate server. |
| Network | **ESP32 hotspot only** (SoftAP), WPA2, password in `config.h`. Fixed address `192.168.4.1`. No home-Wi-Fi mode and no setup portal. |
| Simulation | A `FARM_NET_SIM` build flag makes the firmware join `Wokwi-GUEST` as a normal client (STA) instead of starting the hotspot. Wokwi port forwarding exposes it. |
| Web hosting | The web stays served from the laptop (`python3 -m http.server`). The page connects to the console by address. |
| Transport | **One WebSocket at `/ws`, JSON messages.** No REST endpoints. |
| Firmware libs | **ESPAsyncWebServer + AsyncTCP (ESP32Async forks) + ArduinoJson 7.** Chosen because they're well documented and simple to configure. |
| Clients | **One browser at a time. The first one keeps it.** A newcomer gets `busy` and is closed. |
| Stale client | The console drops a client that has sent nothing for **10 s**. The web closes its socket after its tab has been hidden for **60 s** and reconnects when the tab is visible again. |
| Shared state | Coins, tiles, game time, **selected seed**, **grow mode and crop table**, **action feed**. The cursor is **not** shared, with no ghost cursor. |
| Click feel | **Wait for the console.** The web changes nothing until the console's `state` arrives. |
| Game clock | Unchanged: the console's game seconds run only while it's powered. The web shows console time and interpolates locally between snapshots. |
| Console off / unreachable | The web shows the **last known farm, read-only, with growth frozen** at the last snapshot. Planting, selling and seed changes are disabled. |
| Offline cache | The last `hello` and `state` are kept in **localStorage**, so a reload while offline still shows the farm with "last seen HH:MM". |
| Cold start (no cache, no console) | **Demo mode:** a local `game.js` farm plants and harvests by itself in the background, behind instructions for joining the FarmBot Wi-Fi. Clicks do nothing. |
| New farm | **Removed from the web.** (The console has no reset UI. A reset means erasing NVS or reflashing.) |
| Save timing | `SAVE_MIN_INTERVAL_S` changes **60 → 30**. A power cut loses at most 30 s of actions. (This answers the open question from 2026-11-17.) |
| Radio power | Wi-Fi is always on while the console is powered. The hardware switch remains the only off. |
| OLED | A small Wi-Fi glyph in the status bar: **outline** when the hotspot is up and nobody is connected, **filled** when a browser is connected. |
| Dev loop | A **Python mock console** in `tools/` that speaks the same protocol, for web work without hardware. |

## 2. Architecture

```
 ┌──────── laptop ────────┐          FarmBot Wi-Fi (WPA2)          ┌──────── ESP32 ────────┐
 │ python http.server :8000│                                       │ loop() @30 Hz          │
 │   serves web/           │                                       │  clock → input →       │
 │ browser tab             │   ws://192.168.4.1/ws  (JSON)         │  net.drain() → game →  │
 │   net.js ───────────────┼──────────────────────────────────────▶│  save → net.publish()  │
 │   (remote state model)  │◀──── hello / state / event / result ──│  → render              │
 └─────────────────────────┘                                       │ AsyncWebSocket (task)  │
                                                                   │  only enqueues         │
                                                                   └────────────────────────┘
 dev:   ?console=localhost:8180  → Wokwi port forward  → simulated ESP32 (FARM_NET_SIM)
        ?console=localhost:8765  → tools/mock_console.py
```

### Threading rule (firmware)
AsyncTCP callbacks run on their own FreeRTOS task. **They never touch `Game`.** They only:
- push decoded commands (`press`, `select`) onto a FreeRTOS queue (depth 8, overflow → `result{ok:false, reason:"busy"}`),
- record client connect/disconnect and the "last heard" time under a small critical section.

`loop()` drains the queue once per frame, applies commands with the pure rules, then publishes. So `game.cpp` stays single-threaded and testable on the host.

## 3. Protocol v1

All messages are JSON text frames with a `t` (type) field. Unknown `t` values are ignored. Field names are short because the ESP32 builds them every frame.

### Console → web

| `t` | When | Body |
|---|---|---|
| `hello` | Right after a client is accepted | `{t:"hello", proto:1, growMode:"dev"\|"real", cols:8, rows:4, crops:[{name, seedCost, sellPrice, growSeconds}, …]}` |
| `state` | After any change (either device), and every **2 s** as a heartbeat | `{t:"state", now, coins, selected, tiles:[[crop, plantedAt], …32]}`. `crop` is `-1` for empty. |
| `event` | After a successful plant or harvest from **either** device | `{t:"event", kind:"planted"\|"harvested", tile, crop, amount, from:"console"\|"web"}` |
| `result` | Reply to every web `press`/`select` | `{t:"result", id, ok, reason?}`. `reason` is one of `"not_ripe"`, `"no_coins"`, `"bad_tile"`, `"bad_crop"`, `"busy"`. |
| `busy` | A second client tries to connect | `{t:"busy"}`, then the console closes the socket. |

The full `state` is about 400 bytes, so a full snapshot each time is simpler than sending diffs and costs little.

### Web → console

| `t` | Body | Console does |
|---|---|---|
| `press` | `{t:"press", id, tile}` | `pressTile(game, tile, now)` with the **shared** `game.selected`, the same rule as the encoder short press. On success: `saveRequest()`, `event`, `state`. |
| `select` | `{t:"select", id, crop}` | Sets `game.selected` and calls `saveRequest()`. If the OLED seed menu is open, its highlight jumps to the new seed. Then `state`. |
| `ping` | `{t:"ping"}` every **3 s** | Refreshes "last heard". No reply, because the 2 s `state` heartbeat already proves the console is alive. |

`id` is a client counter, so the web can match a `result` to the click that caused it.

### Liveness
- Console: no message from the client for **10 s** → close it, freeing the slot.
- Web: no message from the console for **6 s** → go offline (freeze, read-only), then reconnect with backoff 1 s → 2 s → 4 s → max 8 s.
- Web: tab hidden for **60 s** → close the socket on purpose. On `visibilitychange` back to visible → reconnect.
- `proto` mismatch → the web shows "Console firmware is newer/older than this page" and stays read-only.

## 4. Firmware changes

### New files
- `include/protocol.h`, `src/protocol.cpp` — **pure**, no Arduino and no networking. It does:
  - `encodeHello(JsonDocument&)`, `encodeState(const Game&, uint32_t now, JsonDocument&)`, `encodeEvent(…)`, `encodeResult(…)`
  - `decodeCommand(const char*, size_t, Command&) → bool` (validates `t`, `id`, ranges)
  - `applyCommand(Game&, const Command&, uint32_t now) → Result` (wraps `pressTile` and select, and maps failures to `reason`)
  - Built in `env:native` together with `game.cpp`. ArduinoJson is header-only, so it compiles on the host.
- `include/net.h`, `src/net.cpp` — Wi-Fi and the WebSocket server.
  - `netBegin()` — SoftAP (`AP_SSID`, `AP_PASSWORD`, channel 6, max 1 connection) or, with `FARM_NET_SIM`, `WiFi.begin("Wokwi-GUEST", "", 6)`. Starts `AsyncWebServer` on port 80 with `AsyncWebSocket("/ws")`.
  - Client policy: accept the first client, refuse any other with `busy` and close it, enforce the 10 s idle timeout, call `ws.cleanupClients()` every frame.
  - `netDrain(Game&, uint32_t now) → bool changed` — applies queued commands and sends a `result` for each.
  - `netPublish(const Game&, uint32_t now, bool changed)` — `state` when changed or 2 s have passed, and any pending `event`s.
  - `netNotifyLocal(PressResult, tile, crop)` — main calls this after an encoder action, so the web gets an `event` with `from:"console"`.
  - `netStatus() → {apUp, clientConnected}` for the OLED glyph.

### Edited files
- `config.h`: `AP_SSID = "FarmBot"`, `AP_PASSWORD = "farmbot123"` (≥ 8 chars, required by WPA2), `NET_STATE_HEARTBEAT_MS = 2000`, `NET_CLIENT_TIMEOUT_MS = 10000`, `SAVE_MIN_INTERVAL_S = 30`.
- `main.cpp`: `setup()` calls `netBegin()` after `renderBegin()`. `frame()` runs `netDrain` before mode updates, reports encoder actions via `netNotifyLocal`, and calls `netPublish` after `saveService`. A web `select` while `Mode::SeedMenu` is open sets `menuRow = game.selected`. Web changes call `renderMarkDirty()`.
- `render.cpp`: status-bar Wi-Fi glyph, an 8×8 bitmap in outline or filled versions. Include `netStatus()` in the redraw fingerprint.
- `platformio.ini`:
  - `lib_deps` += `ESP32Async/ESPAsyncWebServer`, `ESP32Async/AsyncTCP`, `bblanchon/ArduinoJson@^7`.
  - New `env:esp32dev_sim` (extends esp32dev, `-D FARM_NET_SIM=1`).
  - `env:native`: `build_src_filter = -<*> +<game.cpp> +<protocol.cpp>`, `lib_deps = bblanchon/ArduinoJson@^7`.
  - Check that the image still fits the default 1.2 MB app partition (Wi-Fi + async server add roughly 600–800 KB). If it doesn't, switch to `board_build.partitions = huge_app.csv`. NVS is unaffected.
- `wokwi.toml`: point at `.pio/build/esp32dev_sim/…` and add:
  ```toml
  [[net.forward]]
  from = "localhost:8180"
  to = "target:80"
  ```
- `CPU_MHZ` stays at 80, which is the minimum Wi-Fi supports. Confirm Wi-Fi is stable at 80 MHz, otherwise raise it to 160.

### Unchanged
`game.cpp` rules, `clock.cpp`, the encoder controls (see the controls spec in memory), and the NVS save format (`SAVE_VERSION` stays 1, because the layout doesn't change).

## 5. Web changes

### New files
- `js/net.js` — the connection state machine: `demo` → `connecting` → `live` ↔ `offline` (+ `busy`, `mismatch`).
  - Address: `?console=host:port`, default `192.168.4.1`.
  - Exposes `send(cmd)`, `onHello`, `onState`, `onEvent`, `onResult` and `status()`.
  - Handles ping, the 6 s silence timeout, backoff and the 60 s hidden-tab release.
  - Writes `farmbot.hello`, `farmbot.state` and `farmbot.lastSeen` to localStorage on every `hello` and `state`.
- `js/demo.js` — cold-start attract mode: its own `createGame()` with dev crop times. Every ~1.5 s a bot harvests one ripe plot or plants a random empty one with a random affordable seed. It runs only while there's no cache and no connection.

### Edited files
- `crops.js`: becomes a mutable table filled from `hello` (or the cache). The built-in table is only for demo mode. **`?real` is removed.**
- `clock.js`: `now()` = `snapshot.now + floor((performance.now() − receivedAt)/1000)` while live, and **frozen** at `snapshot.now` while offline. Demo mode keeps the current local clock.
- `main.js`:
  - `press(i)` → `net.send({t:"press", tile:i})` when live, and nothing otherwise. Float text now comes from `event` messages (`from` decides the wording), not from the local rule result.
  - `selectSeed(i)` → `net.send({t:"select", crop:i})`. The highlight changes when `state.selected` arrives.
  - The game object is replaced by each `state`, and `gameIsValid()` checks it before use.
  - `newFarm` is deleted.
- `ui.js` / `index.html`:
  - Remove the **New farm** button and the `grow-mode` text that came from `?real` (show the grow mode from `hello` instead).
  - **Header pill:** `● Console live` (accent) / `Offline · last seen 14:02` (muted) / `Console busy — another browser is connected` / `Demo — join FarmBot Wi-Fi` / `Update needed` (proto mismatch).
  - While not live: the field is dimmed, the Shop button is disabled, plot clicks and the Enter/1–3 keys do nothing, and the info bar says why.
  - Demo overlay: short steps — "1. Turn on the console  2. Join Wi-Fi **FarmBot** (password in the README)  3. This page connects by itself".
  - Action feed: `event` with `from:"console"` → float text over the plot plus a small toast ("Console harvested Carrot +$4"). Events from `web` → float text only.
  - Failed `result` → a short shake or toast with the reason ("Not enough coins").
- `README.md` / `web/README.md`: connecting, the hotspot password, `?console=`, the Wokwi sim build, the mock console, and the removal of "no saved progress".

## 6. Mock console (`tools/mock_console.py`)

- Python 3, **standard library only** (a minimal WebSocket server on `asyncio`). Listens on `localhost:8765/ws`.
- A Python port of the rules: plant, harvest, stage and canAfford, with the crop table copied from `crops.h`. Flag `--real` for real times.
- Same protocol and policies as the firmware: one client, `busy` for the second, 10 s idle timeout, 2 s heartbeat.
- Dev extras: `--console-actions` makes a fake console player plant and harvest every few seconds, to exercise the action feed. You can kill and restart the script to test offline and reconnect.
- **Parity check:** `tools/protocol_fixtures.json` holds sample `hello`/`state`/`result` messages. The native firmware tests and a small mock self-test both check their encoders against it, so the three sides can't drift.

## 7. Build plan (in order; each step builds and runs on its own)

1. **Protocol core (firmware, host-testable).** `protocol.h/.cpp`, the ArduinoJson dependency, `env:native` filter, and Unity tests in `test/test_protocol/`: encode `state` round-trip, decode rejects bad `t`/tile/crop/missing id, `applyCommand` reasons, fixture match. Also add `test/test_game/` for `game.cpp` if it's still missing (no `test/` folder exists today).
2. **Config + save timing.** `SAVE_MIN_INTERVAL_S = 30` and the network constants in `config.h`.
3. **Networking (firmware).** `net.h/.cpp` with SoftAP, the WebSocket server, single-client policy, the command queue, heartbeat and events. Wire it into `main.cpp`. Check with `websocat ws://192.168.4.1/ws` on real hardware.
4. **Sim build.** `env:esp32dev_sim`, `wokwi.toml` forward, and a check with `websocat ws://localhost:8180/ws` against Wokwi.
5. **OLED glyph.** Status-bar icon and redraw fingerprint.
6. **Mock console.** `tools/mock_console.py` and the fixtures.
7. **Web connection layer.** `net.js`, clock interpolation, remote state replacing local rules, the remote crop table, removal of `?real`/New farm. Develop against the mock.
8. **Web offline and status UI.** Header pill, dimmed or read-only states, localStorage cache, frozen bars, busy and mismatch states.
9. **Web demo mode.** `demo.js` and the instruction overlay.
10. **Action feed.** Toasts for console events and reason messages for failed results.
11. **Docs.** Both READMEs, including the wiring and controls tables if they're affected (only the Wi-Fi note is new).
12. **End-to-end check** on Wokwi, then on hardware (see §8).

## 8. Acceptance checklist

- [ ] Planting on the console appears on the web in under 1 s with a "Console planted …" toast. Harvesting on the web updates the OLED coins in under 1 s.
- [ ] Choosing a seed in the web shop changes the console's selection (and the open seed menu's highlight), and the other way round.
- [ ] A web click on a growing plot changes nothing, and no toast appears for a plain no-op.
- [ ] A web click with too few coins shows "Not enough coins". The farm is unchanged.
- [ ] When you turn the console off, within about 6 s the web pill shows "Offline · last seen …", the bars freeze and clicks are ignored. After you turn it back on, it reconnects within about 10 s and the farm matches the OLED.
- [ ] Reloading the page while the console is off shows the cached farm, read-only.
- [ ] A fresh browser profile with no console shows demo mode with instructions. Demo actions never reach a console.
- [ ] A second tab gets "Console busy". After the first tab has been hidden for 60 s, the second tab can connect when you refresh it.
- [ ] Killing the browser abruptly frees the console within 10 s.
- [ ] An action from either device, then a power cut 30 s or more later → the action survives reboot.
- [ ] The OLED Wi-Fi glyph is an outline with no client and filled with a client.
- [ ] `pio test -e native` passes. `pio run -e esp32dev`, `esp32dev_real` and `esp32dev_sim` all build and fit flash.

## 9. Risks / notes

- **Laptop loses internet while it's on the FarmBot Wi-Fi.** That's expected. Fonts fall back to system fonts and Three.js is bundled. macOS may auto-rejoin home Wi-Fi, so turn off auto-join on that network while you play.
- **Battery:** Wi-Fi in AP mode adds roughly 80–170 mA. Accepted (always on).
- **Mixed content:** the page must be served over `http`. An `https` page can't open `ws://` to a local IP.
- **Flash size:** see the partition note in §4.
- **AsyncTCP task vs loop:** all `Game` access stays in `loop()`. Sending from `loop()` uses `ws.textAll`/`client->text`, which ESPAsyncWebServer queues internally. Check `client->canSend()` and drop heartbeats (never `result`s) when its queue is full.
- **No console reset UI.** If this becomes a problem, a later change could add a "NEW FARM" row to the seed menu with a confirm step.

## 10. As built — differences from the draft

- **Reasons:** there is no `not_empty`. Pressing a planted plot that isn't ripe gives `not_ripe`, which the web ignores without a toast (the "plain no-op" click).
- **Order of messages after a web command:** `result`, then `event` (if any), then `state`. The firmware and the mock both do this.
- **Busy:** the page doesn't give up. It retries every 8 s and keeps showing "Console busy", so it gets the console as soon as the other browser lets go.
- **Offline cache** is keyed by console address (`farmbot.console.<address>`), so the mock's or Wokwi's farm never shows up as the real console's.
- **Mock console** uses only the standard library (no `pip install websockets`). Its `--self-test` checks the shared fixtures and the rules.
- **Fixtures:** `tools/protocol_fixtures.json` is read by `test/test_protocol` (path passed in as `FIXTURES_PATH`) and by the mock's self-test.
- **Flash:** 75.8 % of the default 1.2 MB app partition, so no partition change was needed.
- **Hotspot:** up to 4 Wi-Fi stations (`AP_MAX_STATIONS`), but still only one WebSocket client.
- **Demo:** if the page is pointed at a non-default address (`?console=`), the demo card says "Waiting for a console at <address>" instead of the Wi-Fi steps.

### Verified
- `pio test -e native`: 27/27 (14 game, 13 protocol). `esp32dev`, `esp32dev_real` and `esp32dev_sim` all build with no warnings in project code.
- `tools/mock_console.py --self-test` passes.
- Headless Chrome against the mock: demo → live (about 2 s after load), a web plant, a silent no-op on a growing plot, console toasts, seed select, second tab "busy", offline in 0.1 s after the mock is killed with frozen time, reload while offline shows the cached farm, reconnect about 1 s after the mock restarts, and a tab hidden for 60 s frees the console for another tab.

### Not verified here (needs hardware or Wokwi in VS Code)
- The firmware's link on a real ESP32: the hotspot, the 10 s idle drop, the OLED glyph, saves after web actions, and Wi-Fi stability at 80 MHz.
- The Wokwi port forward (`localhost:8180`).
