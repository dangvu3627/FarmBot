#!/usr/bin/env python3
"""mock_console.py - a stand-in for the ESP32 console's web link.

Speaks protocol v1 (see .plans/console-web-link-spec.md, section 3) on
ws://localhost:8765/ws with the same rules and policies as the firmware:
one browser at a time (the first keeps it), a 2 s state heartbeat, and a
10 s idle timeout. Standard library only: no pip install.

    python3 tools/mock_console.py                    # dev grow times
    python3 tools/mock_console.py --real             # real grow times
    python3 tools/mock_console.py --console-actions  # a fake player turns the knob
    python3 tools/mock_console.py --self-test        # check messages against the fixtures

Then open http://localhost:8000/?console=localhost:8765
Stop it (Ctrl+C) to see the web go offline; start it again to reconnect.
The farm lives in memory only, like a console that was never saved.
"""
import argparse
import asyncio
import base64
import hashlib
import json
import os
import random
import struct
import sys
import time

PROTO = 1
COLS, ROWS = 8, 4
TILES = COLS * ROWS
NO_CROP = -1
START_COINS = 12
HEARTBEAT_S = 2.0
CLIENT_TIMEOUT_S = 10.0
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "protocol_fixtures.json")

# Same table as include/crops.h: (name, seed, sell, dev seconds, real seconds).
CROP_ROWS = [("WHEAT", 1, 2, 10, 60), ("CARROT", 2, 4, 20, 180), ("PUMPKIN", 4, 8, 30, 600)]


def compact(obj):
    return json.dumps(obj, separators=(",", ":"))


# ---- rules (a port of src/game.cpp) -------------------------------------------

class Farm:
    def __init__(self, real=False):
        self.real = real
        self.crops = [
            {"name": n, "seedCost": s, "sellPrice": p, "growSeconds": r if real else d}
            for n, s, p, d, r in CROP_ROWS
        ]
        self.coins = START_COINS
        self.selected = 0
        self.tiles = [[NO_CROP, 0] for _ in range(TILES)]

    def ripe(self, i, now):
        crop, planted = self.tiles[i]
        return crop != NO_CROP and ((now - planted) & 0xFFFFFFFF) >= self.crops[crop]["growSeconds"]

    def press(self, i, now):
        """Returns (reason, event-or-None), like protocol.cpp's applyCommand."""
        if not isinstance(i, int) or not 0 <= i < TILES:
            return "bad_tile", None
        crop = self.tiles[i][0]
        if crop == NO_CROP:
            cost = self.crops[self.selected]["seedCost"]
            if self.coins < cost:
                return "no_coins", None
            self.coins -= cost
            self.tiles[i] = [self.selected, now]
            return None, {"kind": "planted", "tile": i, "crop": self.selected, "amount": cost}
        if self.ripe(i, now):
            price = self.crops[crop]["sellPrice"]
            self.coins += price
            self.tiles[i] = [NO_CROP, 0]
            return None, {"kind": "harvested", "tile": i, "crop": crop, "amount": price}
        return "not_ripe", None

    def select(self, crop):
        if not isinstance(crop, int) or not 0 <= crop < len(self.crops):
            return "bad_crop"
        self.selected = crop
        return None

    # ---- messages (key order matches protocol.cpp) ----
    def hello(self):
        return {"t": "hello", "proto": PROTO, "growMode": "real" if self.real else "dev",
                "cols": COLS, "rows": ROWS, "crops": self.crops}

    def state(self, now):
        return {"t": "state", "now": now, "coins": self.coins, "selected": self.selected,
                "tiles": [list(t) for t in self.tiles]}


def event_msg(ev, source):
    return {"t": "event", **ev, "from": source}


def result_msg(cid, reason):
    msg = {"t": "result", "id": cid, "ok": reason is None}
    if reason:
        msg["reason"] = reason
    return msg


def decode(text):
    """Returns a command dict or None, with the same checks as decodeCommand."""
    try:
        msg = json.loads(text)
    except ValueError:
        return None
    if not isinstance(msg, dict):
        return None
    t = msg.get("t")
    if t == "ping":
        return msg
    key = {"press": "tile", "select": "crop"}.get(t)
    if key is None:
        return None
    cid, arg = msg.get("id"), msg.get(key)
    ok_int = lambda v: isinstance(v, int) and not isinstance(v, bool)
    if not ok_int(cid) or cid < 0 or not ok_int(arg):
        return None
    return msg


# ---- minimal WebSocket server (RFC 6455, text frames only) ------------------------

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


async def handshake(reader, writer):
    request = await reader.readuntil(b"\r\n\r\n")
    lines = request.decode("latin-1").split("\r\n")
    path = lines[0].split(" ")[1] if len(lines[0].split(" ")) > 1 else ""
    headers = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in lines[1:] if l)}
    key = headers.get("sec-websocket-key")
    if path.split("?")[0] != "/ws" or not key:
        writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
        await writer.drain()
        return False
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                  "Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").encode())
    await writer.drain()
    return True


async def read_frame(reader):
    """Returns (opcode, payload bytes)."""
    b0, b1 = await reader.readexactly(2)
    length = b1 & 0x7F
    if length == 126:
        (length,) = struct.unpack(">H", await reader.readexactly(2))
    elif length == 127:
        (length,) = struct.unpack(">Q", await reader.readexactly(8))
    mask = await reader.readexactly(4) if b1 & 0x80 else b"\0\0\0\0"
    data = bytearray(await reader.readexactly(length))
    for i in range(length):
        data[i] ^= mask[i % 4]
    return b0 & 0x0F, bytes(data)


def frame(opcode, payload):
    n = len(payload)
    if n < 126:
        head = struct.pack(">BB", 0x80 | opcode, n)
    elif n < 65536:
        head = struct.pack(">BBH", 0x80 | opcode, 126, n)
    else:
        head = struct.pack(">BBQ", 0x80 | opcode, 127, n)
    return head + payload


class Client:
    def __init__(self, writer):
        self.writer = writer
        self.closed = False

    def send(self, msg):
        if not self.closed:
            self.writer.write(frame(0x1, compact(msg).encode()))

    def close(self):
        if not self.closed:
            self.closed = True
            try:
                self.writer.write(frame(0x8, b""))
            except (ConnectionError, RuntimeError):
                pass
            self.writer.close()


# ---- the console ---------------------------------------------------------------

class Console:
    def __init__(self, farm, console_actions):
        self.farm = farm
        self.console_actions = console_actions
        self.started = time.monotonic()
        self.client = None
        self.last_heard = 0.0

    def now(self):
        return int(time.monotonic() - self.started) & 0xFFFFFFFF

    def broadcast_state(self):
        if self.client:
            self.client.send(self.farm.state(self.now()))

    async def handle(self, reader, writer):
        try:
            if not await handshake(reader, writer):
                writer.close()
                return
        except (asyncio.IncompleteReadError, ConnectionError, IndexError):
            writer.close()
            return
        me = Client(writer)
        if self.client is not None:          # first one keeps it
            me.send({"t": "busy"})
            await writer.drain()
            me.close()
            log("refused a second browser (busy)")
            return
        self.client, self.last_heard = me, time.monotonic()
        log("browser connected")
        me.send(self.farm.hello())
        me.send(self.farm.state(self.now()))
        try:
            while True:
                opcode, payload = await read_frame(reader)
                if opcode == 0x8:
                    break
                if opcode == 0x9:            # ping frame -> pong
                    writer.write(frame(0xA, payload))
                    continue
                if opcode != 0x1:
                    continue
                self.last_heard = time.monotonic()
                self.on_command(payload.decode("utf-8", "replace"))
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            if self.client is me:
                self.client = None
                log("browser disconnected")
            me.close()

    def on_command(self, text):
        cmd = decode(text)
        if cmd is None or cmd["t"] == "ping":
            return
        now = self.now()
        if cmd["t"] == "press":
            reason, ev = self.farm.press(cmd["tile"], now)
        else:
            reason, ev = self.farm.select(cmd["crop"]), None
        self.client.send(result_msg(cmd["id"], reason))
        if ev:
            self.client.send(event_msg(ev, "web"))
        if reason is None:
            self.client.send(self.farm.state(now))

    async def heartbeat(self):
        while True:
            await asyncio.sleep(HEARTBEAT_S)
            if self.client and time.monotonic() - self.last_heard > CLIENT_TIMEOUT_S:
                log("browser silent for 10 s, dropping it")
                self.client.close()
                self.client = None
            self.broadcast_state()

    async def fake_player(self):
        """--console-actions: harvest something ripe, else plant somewhere empty."""
        while True:
            await asyncio.sleep(random.uniform(3, 6))
            now = self.now()
            ripe = [i for i in range(TILES) if self.farm.ripe(i, now)]
            empty = [i for i in range(TILES) if self.farm.tiles[i][0] == NO_CROP]
            target = random.choice(ripe) if ripe else (random.choice(empty) if empty else None)
            if target is None:
                continue
            reason, ev = self.farm.press(target, now)
            if ev and self.client:
                self.client.send(event_msg(ev, "console"))
                self.broadcast_state()
            if ev:
                log(f"console {ev['kind']} tile {target}")


def log(text):
    print(time.strftime("%H:%M:%S"), text, flush=True)


# ---- self-test --------------------------------------------------------------------

def self_test():
    with open(FIXTURES) as f:
        fx = json.load(f)
    farm = Farm(real=False)
    farm.coins, farm.selected = 9, 1
    farm.tiles[0], farm.tiles[3] = [0, 5], [1, 7]
    checks = {
        "hello_dev": farm.hello(),
        "state": farm.state(20),
        "event_harvest_web": event_msg({"kind": "harvested", "tile": 3, "crop": 1, "amount": 4}, "web"),
        "event_plant_console": event_msg({"kind": "planted", "tile": 0, "crop": 0, "amount": 1}, "console"),
        "result_ok": result_msg(8, None),
        "result_no_coins": result_msg(7, "no_coins"),
        "busy": {"t": "busy"},
    }
    failed = 0
    for key, got in checks.items():
        if compact(got) != compact(fx[key]):
            failed += 1
            print(f"FAIL {key}\n  want {compact(fx[key])}\n  got  {compact(got)}")
    # Rules: plant, not ripe, harvest, no coins, bad input.
    f2 = Farm()
    assert f2.press(0, 0) == (None, {"kind": "planted", "tile": 0, "crop": 0, "amount": 1})
    assert f2.press(0, 5)[0] == "not_ripe"
    assert f2.press(0, 10)[1]["kind"] == "harvested"
    assert f2.press(32, 0)[0] == "bad_tile"
    f2.coins = 0
    assert f2.press(1, 0)[0] == "no_coins"
    assert f2.select(3) == "bad_crop"
    assert decode('{"t":"press","id":-1,"tile":1}') is None
    assert decode('{"t":"press","id":1,"tile":true}') is None
    assert decode('{"t":"select","id":1,"crop":2}') is not None
    print("self-test:", "FAILED" if failed else f"all {len(checks)} fixtures and rule checks passed")
    return 1 if failed else 0


async def main(args):
    console = Console(Farm(real=args.real), args.console_actions)
    server = await asyncio.start_server(console.handle, args.host, args.port)
    log(f"mock console on ws://{args.host}:{args.port}/ws ({'real' if args.real else 'dev'} grow times)")
    log(f"open http://localhost:8000/?console=localhost:{args.port}")
    tasks = [asyncio.create_task(console.heartbeat())]
    if args.console_actions:
        tasks.append(asyncio.create_task(console.fake_player()))
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--real", action="store_true", help="real grow times")
    p.add_argument("--console-actions", action="store_true", help="a fake console player plants and harvests")
    p.add_argument("--self-test", action="store_true", help="check messages against protocol_fixtures.json")
    a = p.parse_args()
    if a.self_test:
        sys.exit(self_test())
    try:
        asyncio.run(main(a))
    except KeyboardInterrupt:
        pass
