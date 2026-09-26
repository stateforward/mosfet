"""Open the MuJoCo viewer with the bot running a demo loop.

macOS needs MuJoCo's launcher for the interactive viewer:

    .venv/bin/mjpython run.py

Elsewhere, `.venv/bin/python run.py` works. The loop: the eye stalks look
around by pulling their cables in turn while the bot sits on its skid, stands
up onto its wheels (arms swing to vertical), balances and drives forward, back,
and turns, then sits back down. Close the window to quit.

    .venv/bin/python run.py --snapshot out.png

renders one still from the follow camera instead of opening a window, and

    .venv/bin/python run.py --faces faces.png

renders every expression close up.

Keys, in the viewer or the terminal: W/S drive forward and back, A/D turn,
Q sits down, M toggles the automatic demo loop; 1-8 pick an eye expression,
0 looks around, B blinks; V / P / R / C wave, point, reach, or curl the stalks.
"""

from __future__ import annotations

import argparse
import math
import time

import mujoco

import bot
from controller import BotController, Command
from eyes import GESTURES, ORDER, Eyes


class Demo:
    """The bot you drive: WASD moves it (it stands up on the first press), Q sits it down.

    Keys (in the viewer window or the terminal that launched it):
      W / S  forward / backward        A / D  turn left / right        Q  stop and sit down
      1-8    eye expressions           0      look around              B  blink
      V / P / R / C  wave, point, reach (pokes the ball), curl the stalks
      M      toggle the automatic demo loop (stand, drive, turn, sit, repeat)

    Keyboards only report presses, so a drive key keeps driving while it is held (auto-repeat) and the bot coasts to a
    stop HOLD_S after the last press.
    """

    CYCLE_S = 20.0
    HOLD_S = 0.6  # longer than a keyboard's initial repeat delay, so holding a key drives smoothly
    SPEED = 0.3
    REVERSE = 0.2
    TURN = 1.4

    def __init__(self, model) -> None:  # type: ignore[no-untyped-def]
        self.model = model
        self.drive = BotController(model)
        self.eyes = Eyes(model)
        self.auto = False
        self.standing = False
        self._forward = (0.0, -1.0)  # (direction, time of last press)
        self._turn = (0.0, -1.0)
        self._pending: list[int] = []

    @property
    def driving(self) -> bool:
        """Kept for callers that pause the demo: False means stay seated."""
        return self.auto or self.standing

    @driving.setter
    def driving(self, value: bool) -> None:
        self.auto = value
        self.standing = False

    def command(self, t: float) -> Command:
        if self.auto:
            c = t % self.CYCLE_S
            if c < 2 or c > 16:
                return Command(move=False)
            if 5 < c < 8:
                return Command(move=True, speed=self.SPEED)
            if 9 < c < 11:
                return Command(move=True, speed=-self.REVERSE)
            if 12 < c < 14:
                return Command(move=True, turn_rate=self.TURN)
            return Command(move=True)
        forward, forward_at = self._forward
        turn, turn_at = self._turn
        speed = (self.SPEED if forward > 0 else self.REVERSE) * forward if t - forward_at < self.HOLD_S else 0.0
        turn_rate = self.TURN * turn if t - turn_at < self.HOLD_S else 0.0
        return Command(move=self.standing, speed=speed, turn_rate=turn_rate)

    def key(self, keycode: int) -> None:
        """Key callback (viewer thread or terminal reader); applied on the next update."""
        self._pending.append(keycode)

    def _apply_keys(self, data) -> None:  # type: ignore[no-untyped-def]
        while self._pending:
            self._apply_key(self._pending.pop(0), data.time)

    def _apply_key(self, keycode: int, now: float) -> None:
        char = chr(keycode).upper() if 32 <= keycode < 127 else ""
        drive = {"W": ("forward", 1.0), "S": ("forward", -1.0), "A": ("turn", 1.0), "D": ("turn", -1.0)}
        if char in drive:
            axis, sign = drive[char]
            if axis == "forward":
                self._forward = (sign, now)
            else:
                self._turn = (sign, now)
            if self.auto:
                self.auto = False
                print("autopilot off: you're driving")
            self.standing = True
        elif char == "Q":
            self.standing = False
            self.auto = False
            print("sitting down")
        elif char == "M":
            self.auto = not self.auto
            self.standing = False
            print(f"autopilot {'on' if self.auto else 'off'}")
        elif char.isdigit():
            n = int(char)
            if n == 0:
                self.eyes.look_around()
                print("eyes: looking around")
            elif n <= len(ORDER):
                self.eyes.set_expression(ORDER[n - 1])
                print(f"eyes: {ORDER[n - 1]}")
        elif char in {"V", "P", "R", "C"}:
            name = {"V": "wave", "P": "point", "R": "reach", "C": "curl"}[char]
            self.eyes.gesture(name, now)
            print(f"stalks: {name}")
        elif char == "B":
            self.eyes.blink(now)

    # Standing up and sitting down are the shakiest moments; keep the stalks calm through them.
    CALM_MODES = {"standing_up", "sitting_down"}

    def update(self, data) -> None:  # type: ignore[no-untyped-def]
        self._apply_keys(data)
        self.eyes.update(data, vigor=0.3 if self.drive.mode.value in self.CALM_MODES else 1.0)
        self.drive.update(data, self.command(data.time))


def snapshot(path: str, seconds: float = 6.5) -> None:
    model, data = bot.load()
    demo = Demo(model)
    while data.time < seconds:
        demo.update(data)
        mujoco.mj_step(model, data)
    renderer = mujoco.Renderer(model, height=720, width=1280)
    try:
        demo.eyes.upload(lambda tid: mujoco.mjr_uploadTexture(model, renderer._mjr_context, tid))
        renderer.update_scene(data, camera="follow")
        pixels = renderer.render()
    finally:
        renderer.close()
    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    Image.fromarray(np.asarray(pixels)).save(path)
    print(f"wrote {path}")


def faces(path: str) -> None:
    """Contact sheet: every expression, close up, with the bot sitting still."""
    import numpy as np  # noqa: PLC0415
    from PIL import Image, ImageDraw  # noqa: PLC0415

    tiles = []
    for name in ORDER:
        model, data = bot.load()
        demo = Demo(model)
        demo.driving = False
        demo.eyes.set_expression(name)
        demo.eyes._next_blink = 1e9  # no blink mid-photo
        while data.time < 2.5:
            demo.update(data)
            mujoco.mj_step(model, data)
        renderer = mujoco.Renderer(model, height=300, width=400)
        try:
            demo.eyes.dirty = True
            demo.eyes.upload(lambda tid: mujoco.mjr_uploadTexture(model, renderer._mjr_context, tid))
            renderer.update_scene(data, camera="face")
            tile = Image.fromarray(np.asarray(renderer.render()))
        finally:
            renderer.close()
        ImageDraw.Draw(tile).text((12, 10), f"{ORDER.index(name) + 1}  {name}", fill=(235, 240, 235))
        tiles.append(tile)
    sheet = Image.new("RGB", (400 * 4, 300 * 2))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, ((i % 4) * 400, (i // 4) * 300))
    sheet.save(path)
    print(f"wrote {path}")


def view() -> None:
    import mujoco.viewer  # noqa: PLC0415

    model, data = bot.load()
    demo = Demo(model)
    print("drive: W/S forward/back, A/D turn, Q sit down, M autopilot")
    print("eyes: 1-8 (" + ", ".join(f"{i + 1} {name}" for i, name in enumerate(ORDER)) + "), 0 look around, B blink")
    print("stalks: V wave, P point, R reach, C curl")
    print("type the keys in the viewer window or right here in this terminal (Ctrl-C to quit)")
    stop = _read_terminal_keys(demo.key)
    try:
        _run_viewer(model, data, demo)
    finally:
        stop()


def _read_terminal_keys(on_key) -> "object":  # type: ignore[no-untyped-def]
    """Forward single keypresses typed in this terminal to `on_key`, so the demo works without focusing the viewer.

    Puts the terminal in cbreak mode (keys arrive immediately, Ctrl-C still works) and restores it on exit.
    Returns a function that restores the terminal.
    """
    import sys  # noqa: PLC0415
    import threading  # noqa: PLC0415

    if not sys.stdin.isatty():
        return lambda: None
    import termios  # noqa: PLC0415
    import tty  # noqa: PLC0415

    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    tty.setcbreak(fd)

    def pump() -> None:
        while True:
            ch = sys.stdin.read(1)
            if not ch:
                return
            on_key(ord(ch.upper()))

    threading.Thread(target=pump, daemon=True).start()
    return lambda: termios.tcsetattr(fd, termios.TCSADRAIN, saved)


def _run_viewer(model, data, demo) -> None:  # type: ignore[no-untyped-def]
    import mujoco.viewer  # noqa: PLC0415

    with mujoco.viewer.launch_passive(model, data, key_callback=demo.key) as viewer:
        while viewer.is_running():
            started = time.monotonic()
            demo.update(data)
            mujoco.mj_step(model, data)
            demo.eyes.upload(viewer.update_texture)
            viewer.sync()
            spare = model.opt.timestep - (time.monotonic() - started)
            if spare > 0:
                time.sleep(spare)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", metavar="PNG", help="render one still to this file instead of opening the viewer")
    parser.add_argument("--faces", metavar="PNG", help="render every expression close up to this file")
    args = parser.parse_args()
    if args.faces:
        faces(args.faces)
    elif args.snapshot:
        snapshot(args.snapshot)
    else:
        view()
