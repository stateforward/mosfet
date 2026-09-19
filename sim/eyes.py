"""Eye expressions and stalk gestures.

Each stalk is a limb: a spring spine with three cables and a camera on the end, so besides carrying an expression it can
reach out, point, wave, or curl right over. Gestures are timed bends; expressions are steady ones.

Each display is a square texture (bot.LCD_PIXELS) whose inscribed circle is the
screen. Images are drawn as the viewer sees them facing the bot: column 0 is on
the viewer's left, row 0 at the top. The bot's left eye is on the viewer's
right, so "toward the nose" is viewer-left for the left eye and viewer-right
for the right eye.

Poses bend each stalk by pulling its three cables. A bend is a direction in the
stalk's frame (x forward, y toward the bot's left) and an amount 0..1.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import mujoco
import numpy as np

import bot

SCREEN = np.array([200, 206, 190], dtype=np.float32)  # memory-LCD grey-green
INK = np.array([28, 32, 30], dtype=np.float32)
BEZEL = np.array([61, 214, 163], dtype=np.float32)  # eye housing color


@dataclass(frozen=True)
class EyeLook:
    """One eye's drawing: a solid dark eye shape whose outline carries the expression, with a light glint.

    `open` is how tall the eye is (1 full, 0 shut); `upper_tilt` slants its top edge (positive drops it toward the
    nose, like a frown; negative raises it, worried); `lower` flattens the bottom up toward center; `smile` draws a
    ^ arc instead; `ring` draws a wide-open outline with a small dot (startled).
    """

    open: float = 1.0
    upper_tilt: float = 0.0
    lower: float = 0.0
    width: float = 0.5
    smile: bool = False
    ring: bool = False


@dataclass(frozen=True)
class Bend:
    direction_deg: float  # in the stalk frame: 0 forward, 90 toward the bot's left
    amount: float  # 0..1 of max pull


@dataclass(frozen=True)
class Expression:
    left: EyeLook
    right: EyeLook
    left_bend: Bend | None = None
    right_bend: Bend | None = None


# Directions for the right eye mirror the left: "inward" is toward the other eye.
FORWARD, BACK = 0.0, 180.0
BALL_DIRECTION_DEG = math.degrees(math.atan2(bot.BALL_START[1], bot.BALL_START[0]))
"""Where the poking ball sits, as a bend direction for the left stalk."""


def inward(side: str) -> float:
    return -90.0 if side == "left" else 90.0


def outward(side: str) -> float:
    return 90.0 if side == "left" else -90.0


EXPRESSIONS: dict[str, Expression] = {
    "normal": Expression(EyeLook(), EyeLook()),
    "happy": Expression(
        EyeLook(smile=True), EyeLook(smile=True),
        Bend(outward("left") - 30, 0.17), Bend(outward("right") + 30, 0.17),
    ),
    "worried": Expression(
        EyeLook(open=0.9, upper_tilt=-0.55), EyeLook(open=0.9, upper_tilt=-0.55),
        Bend(BACK, 0.17), Bend(BACK, 0.17),
    ),
    "focused": Expression(
        EyeLook(open=0.5, width=0.6), EyeLook(open=0.5, width=0.6),
        Bend(FORWARD, 0.2), Bend(FORWARD, 0.2),
    ),
    "sleepy": Expression(
        EyeLook(open=0.3, upper_tilt=0.15), EyeLook(open=0.22, upper_tilt=0.15),
        Bend(FORWARD + 15, 0.25), Bend(FORWARD - 15, 0.21),
    ),
    "angry": Expression(
        EyeLook(open=0.85, upper_tilt=0.7), EyeLook(open=0.85, upper_tilt=0.7),
        Bend(inward("left") + 55, 0.15), Bend(inward("right") - 55, 0.15),
    ),
    "surprised": Expression(
        EyeLook(ring=True), EyeLook(ring=True),
        Bend(BACK, 0.1), Bend(BACK, 0.1),
    ),
    "skeptic": Expression(
        EyeLook(open=0.32, width=0.58), EyeLook(open=1.0, upper_tilt=-0.3),
        Bend(FORWARD, 0.28), Bend(BACK, 0.17),
    ),
}

ORDER = list(EXPRESSIONS)


@dataclass(frozen=True)
class Gesture:
    """A timed pose for both stalks: `bends(t)` returns each side's bend `t` seconds in, or None when it is over."""

    name: str
    seconds: float
    bends: object  # Callable[[float], tuple[Bend | None, Bend | None]]


def _wave(t: float) -> tuple[Bend, Bend]:
    # Left stalk leans out and sweeps; the right one stays put.
    sweep = math.sin(t * 6.0) * 55
    return Bend(outward("left") + sweep, 0.55), Bend(FORWARD, 0.05)


def _point(t: float) -> tuple[Bend, Bend]:
    # Both lean forward at what is in front, the left further, like an arm extended.
    lead = min(1.0, t * 2) * 0.75
    return Bend(FORWARD, lead), Bend(FORWARD, lead * 0.35)


def _reach(t: float) -> tuple[Bend, Bend]:
    # The left stalk reaches out to the bot's left-forward, where the ball sits, and holds.
    amount = min(1.0, t * 0.9)
    return Bend(BALL_DIRECTION_DEG, amount), Bend(FORWARD, 0.1)


def _curl(t: float) -> tuple[Bend, Bend]:
    # Curl both stalks right over, backward, like tucking in.
    amount = min(1.0, t * 0.8)
    return Bend(BACK, amount), Bend(BACK, amount)


GESTURES: dict[str, Gesture] = {
    "wave": Gesture("wave", 3.0, _wave),
    "point": Gesture("point", 2.5, _point),
    "reach": Gesture("reach", 3.5, _reach),
    "curl": Gesture("curl", 3.0, _curl),
}


def draw_eye(look: EyeLook, side: str, gaze: tuple[float, float], blink: float, size: int = bot.LCD_PIXELS) -> np.ndarray:
    """RGB image for one display. `gaze` is (-1..1 viewer-right, -1..1 up); `blink` 0 open .. 1 shut."""
    coords = (np.arange(size, dtype=np.float32) + 0.5) / size * 2 - 1
    x, y = np.meshgrid(coords, -coords)  # x to the viewer's right, y up
    screen = np.hypot(x, y) <= 1.0
    nose = -1.0 if side == "left" else 1.0  # the left eye's nose side is viewer-left
    gx, gy = gaze
    # The whole eye shifts a little with gaze, like it is looking.
    cx, cy = 0.14 * gx, 0.1 * gy
    ex, ey = x - cx, y - cy
    opening = max(0.0, look.open * (1 - blink))

    glint = np.zeros_like(screen)
    if look.smile and blink < 0.5:
        # A ^ arc: a thick upper half-ring.
        ink = (np.abs(np.hypot(ex, ey + 0.2) - 0.45) < 0.13) & (ey + 0.2 > -0.02)
    elif look.ring and blink < 0.5:
        ink = (np.abs(np.hypot(ex, ey) - 0.62) < 0.1) | (np.hypot(ex - 0.2 * gx, ey - 0.2 * gy) < 0.17)
    elif opening < 0.08:
        ink = (np.abs(ey) < 0.07) & (np.abs(ex) < look.width)  # shut: a lid line
    else:
        half_h = 0.72 * opening
        ink = (ex / look.width) ** 2 + (ey / half_h) ** 2 <= 1.0
        # Top edge: a straight lid line, slanted toward or away from the nose.
        lid = half_h * 0.55 - look.upper_tilt * 0.9 * (ex * nose)
        ink &= ey <= np.maximum(lid, -half_h * 0.6)
        if look.lower > 0:
            ink &= ey >= -half_h * (1 - look.lower)
        glint = np.hypot(ex + 0.18 - 0.1 * gx, ey - 0.22 * opening - 0.08 * gy) < 0.12
        glint &= ink

    image = np.empty((size, size, 3), dtype=np.float32)
    image[:] = BEZEL
    image[screen] = SCREEN
    image[screen & ink] = INK
    image[screen & glint] = SCREEN
    return image.astype(np.uint8)


class Eyes:
    """Drives both displays and the stalk cables. Call `update` every physics step, `upload` when textures changed."""

    BLINK_S = 0.18

    def __init__(self, model: mujoco.MjModel) -> None:
        self.model = model
        self.spec = bot.BotSpec()
        self.expression = "normal"
        self.looking_around = True
        self._blink_at = -1.0
        self._next_blink = 2.5
        self._tex = {side: mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_TEXTURE, f"lcd_{side}") for side in ("left", "right")}
        self._cables = {
            side: [bot.actuator_index(model, f"stalk_{side}_cable{k}") for k in range(3)] for side in ("left", "right")
        }
        self._last_frame = -1.0
        self._vigor = 1.0
        self._gesture: Gesture | None = None
        self._gesture_at = 0.0
        self.dirty = True

    def set_expression(self, name: str) -> None:
        if name in EXPRESSIONS:
            self.expression = name
            self.looking_around = False
            self.dirty = True

    def gesture(self, name: str, now: float) -> None:
        """Start a stalk gesture; it takes over the cables until it finishes."""
        if name in GESTURES:
            self._gesture = GESTURES[name]
            self._gesture_at = now

    @property
    def gesturing(self) -> str | None:
        return self._gesture.name if self._gesture is not None else None

    def look_around(self) -> None:
        self.expression = "normal"
        self.looking_around = True
        self.dirty = True

    def blink(self, now: float) -> None:
        self._blink_at = now

    def _blink_amount(self, now: float) -> float:
        t = now - self._blink_at
        if 0 <= t <= self.BLINK_S:
            return math.sin(math.pi * t / self.BLINK_S)
        return 0.0

    def update(self, data: mujoco.MjData, vigor: float = 1.0) -> None:
        """`vigor` scales every stalk pull: the stalks are heavy limbs, and swinging them hard shoves the bot around."""
        now = data.time
        self._vigor = max(0.0, min(1.0, vigor))
        if now >= self._next_blink:
            self.blink(now)
            self._next_blink = now + 2.5 + 3.0 * (0.5 + 0.5 * math.sin(now * 7.3))

        expr = EXPRESSIONS[self.expression]
        if self._gesture is not None:
            elapsed = now - self._gesture_at
            if elapsed > self._gesture.seconds:
                self._gesture = None
            else:
                left, right = self._gesture.bends(elapsed)  # type: ignore[operator]
                self._bend(data, "left", left)
                self._bend(data, "right", right)
                gaze = (0.0, 0.0)
                self._draw(expr, gaze, now)
                return

        if self.looking_around:
            phase = now * 0.9
            gaze = (math.cos(phase), 0.6 * math.sin(phase))
            # Circle each stalk by sweeping the pull around its cables; the right eye lags the left. Gently: a hard
            # sweep on these long stalks is enough to unbalance the bot.
            for side, lag in (("left", 0.0), ("right", 1.1)):
                self._bend(data, side, Bend(math.degrees(phase + lag), 0.12))
        else:
            gaze = (0.0, 0.0)
            self._bend(data, "left", expr.left_bend)
            self._bend(data, "right", expr.right_bend)

        self._draw(expr, gaze, now)

    def _draw(self, expr: Expression, gaze: tuple[float, float], now: float) -> None:
        """Redraw the displays at ~30 Hz (or right away after a change)."""
        if self.dirty or now - self._last_frame >= 1 / 30:
            blink = self._blink_amount(now)
            for side, look in (("left", expr.left), ("right", expr.right)):
                self._write(side, draw_eye(look, side, gaze, blink))
            self._last_frame = now
            self.dirty = True

    def _bend(self, data: mujoco.MjData, side: str, bend: Bend | None) -> None:
        pulls = [0.0, 0.0, 0.0]
        if bend is not None and bend.amount > 0:
            # Cables sit at CABLE_ANGLES_DEG around the stalk; pulling one bends toward it, so weight each by how well it
            # points along the wanted direction.
            want = math.radians(bend.direction_deg)
            for k, angle in enumerate(bot.CABLE_ANGLES_DEG):
                pulls[k] = max(0.0, math.cos(want - math.radians(angle))) * bend.amount * self._vigor
        for k, actuator in enumerate(self._cables[side]):
            data.ctrl[actuator] = -self.spec.stalk.max_pull * pulls[k]

    def _write(self, side: str, image: np.ndarray) -> None:
        tid = self._tex[side]
        adr = self.model.tex_adr[tid]
        self.model.tex_data[adr : adr + image.size] = image.ravel()

    def upload(self, upload_texture) -> None:  # type: ignore[no-untyped-def]
        """Push changed textures to the GPU with `upload_texture(texture_id)` (viewer or renderer)."""
        if self.dirty:
            for tid in self._tex.values():
                upload_texture(tid)
            self.dirty = False
