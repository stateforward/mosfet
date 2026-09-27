"""Eye stalk: a helical compression spring (bought steel or printed) driven by three tendons.

Stalk frame: the base plate's underside is the origin, the stalk axis is +z. From the bottom up: the base plate
(bolts to the drum pedestal) with a collar that screws onto the spring's bottom turns; the spring; the guide discs,
screwed onto the coil a whole number of pitches apart, carrying the tendons 120 degrees apart and standing them off
the spring; the tip plate, whose collar screws onto the spring's top turns and which the eye mount bolts to.

The collars and discs grip the coil through a helical groove cut by the spring itself (plus a clearance), so they
screw on and stay put without glue. The display lead runs up the middle of the spring.

Each tendon has its own servo and single-groove pulley: a spring shortens when a tendon pulls it (about 9 mm at a
90 degree bend), so an antagonistic pair on one double pulley would go slack. Three at 120 degrees cover every
bending direction, as in `sim/bot.py`.
"""

from __future__ import annotations

import math
from functools import cache

from build123d import Circle, Location, Plane, Polyline, Pos, Transition, Vector, sweep

from . import part as P
from .geom import box, cut, cyl, fuse, polar
from .params import HORN_PCD, SERVO_H, SERVO_L, SERVO_SHAFT_OFF, SERVO_W, SpringSpec, StalkSpec
from .part import Part

PULLEY_R = 10.0  # groove radius: 31 mm of tendon per 180 deg of servo
COIL_SEGMENTS = 24  # per turn: the coil is a polyline sweep (a true helical sweep won't boolean in OCCT)


def tendon_xy(s: StalkSpec):
    """One tendon straight back, two forward at +-60 degrees: mirror-symmetric, so both stalks use the same parts."""
    return [polar(s.tendon_r, 180 + i * 360 / s.tendons) for i in range(s.tendons)]


def bolt_xy(r: float, n: int = 3):
    return [polar(r, i * 360 / n) for i in range(n)]


def coil(sp: SpringSpec, z0: float, z1: float, r: float):
    """The coil's wire between spring-frame heights z0 and z1, swept at radius r (the wire, or a groove cutter).

    Spring frame: the spring's bottom end is z = 0; the wire centre rises from z = wire/2 at angle 0.
    """
    lo, hi = sp.wire / 2, sp.free_length - sp.wire / 2
    z0, z1 = max(z0, lo), min(z1, hi)
    rm, p = sp.mean_d / 2, sp.pitch
    t0, t1 = (z0 - lo) / p, (z1 - lo) / p
    n = max(2, math.ceil((t1 - t0) * COIL_SEGMENTS))
    pts = []
    for i in range(n + 1):
        t = t0 + (t1 - t0) * i / n
        a = 2 * math.pi * t
        pts.append(Vector(rm * math.cos(a), rm * math.sin(a), lo + t * p))
    profile = Plane(origin=pts[0], z_dir=pts[1] - pts[0]) * Circle(r)
    return sweep(profile, path=Polyline(*pts), transition=Transition.ROUND).solids()[0]


def _gripped(s: StalkSpec, body, z0: float, z1: float, bore_z: tuple[float, float]):
    """Cut the coil groove through a collar or disc spanning spring-frame z0..z1, then its bore.

    The groove goes first: OCCT fails on a bore face that sits exactly on the coil's centreline.
    """
    sp = s.spring
    body = cut(body, coil(sp, z0 - sp.pitch, z1 + sp.pitch, sp.wire / 2 + s.clearance))
    return cut(body, cyl((0, 0, bore_z[0]), (0, 0, bore_z[1]), sp.mean_d / 2 - 0.5))


@cache
def spring(s: StalkSpec):
    """The spring in its own frame (bottom end at z = 0)."""
    return coil(s.spring, 0, s.spring.free_length, s.spring.wire / 2)


@cache
def base(s: StalkSpec):
    """Base plate plus bottom collar. Bolts to the pedestal with 3 x M3; PTFE tube sockets under the tendon holes.

    Base frame is the stalk frame: plate z 0..plate_t, the spring stands on it.
    """
    t, ch = s.plate_t, s.collar_h
    body = fuse(cyl((0, 0, 0), (0, 0, t), s.base_r), cyl((0, 0, t - 0.01), (0, 0, t + ch), s.collar_r))
    body = _gripped(s, body.moved(Pos(0, 0, -t)), 0, ch, (0.01, ch + 1)).moved(Pos(0, 0, t))
    tools = [cyl((0, 0, -1), (0, 0, t + 1), s.bore / 2)]
    for x, y in tendon_xy(s):
        tools += [cyl((x, y, -1), (x, y, t + 1), s.tendon_hole / 2), cyl((x, y, -1), (x, y, 3), 2.1)]
    tools += [cyl((x, y, -1), (x, y, t + 1), 1.7) for x, y in bolt_xy(s.bolt_r)]
    return cut(body, *tools)


@cache
def guide(s: StalkSpec):
    """Guide disc: screws onto the coil, carries the three tendons off the spring. Own frame: centred on z = 0."""
    zc, h = s.guide_z[0], s.guide_t / 2
    body = cyl((0, 0, zc - h), (0, 0, zc + h), s.guide_r)
    body = _gripped(s, body, zc - h, zc + h, (zc - h - 1, zc + h + 1))
    tools = [cyl((x, y, zc - h - 1), (x, y, zc + h + 1), s.tendon_hole / 2) for x, y in tendon_xy(s)]
    return cut(body, *tools).moved(Pos(0, 0, -zc))


@cache
def tip(s: StalkSpec):
    """Top collar plus tip plate. Tendons knot in counterbores on top; 2 x M3 from below take the eye's chin.

    Own frame: the spring's top end is z = 0, the plate is z 0..plate_t.
    """
    sp, t, ch = s.spring, s.plate_t, s.collar_h
    top = sp.free_length
    body = fuse(cyl((0, 0, top - ch), (0, 0, top + 0.01), s.collar_r), cyl((0, 0, top), (0, 0, top + t), s.tip_r))
    body = _gripped(s, body, top - ch, top, (top - ch - 1, top - 0.01)).moved(Pos(0, 0, -top))
    tools = [cyl((0, 0, -1), (0, 0, t + 1), s.bore / 2)]
    for x, y in tendon_xy(s):
        tools += [cyl((x, y, -1), (x, y, t + 1), s.tendon_hole / 2), cyl((x, y, t - 2.5), (x, y, t + 1), 1.5)]
    tools += [cyl((x, y, -1), (x, y, t + 1), 1.7) for x, y in s.tip_bolts]
    return cut(body, *tools)


@cache
def pulley():
    """Single-groove pulley, one tendon each. Bolts to the stock horn."""
    rg, fl = PULLEY_R, PULLEY_R + 2.5
    body = fuse(cyl((0, 0, 0), (0, 0, 2), fl), cyl((0, 0, 2), (0, 0, 6), rg), cyl((0, 0, 6), (0, 0, 8), fl))
    tools = [cyl((0, 0, -1), (0, 0, 9), 3.5)]
    for i in range(4):
        x, y = polar(HORN_PCD / 2, 45 + i * 90)
        tools.append(cyl((x, y, -1), (x, y, 9), 1.1))
    tools.append(cyl((-fl, 0, 4), (fl, 0, 4), 0.9))  # tendon anchor
    return cut(body, *tools)


POD_WALL = 2.5
POD_FLOOR = 3.0
POD_DEPTH = 28.0
POD_TOP = POD_FLOOR + POD_DEPTH
POD_FLANGE = 2.7
POD_FLANGE_HOLES = (-30.0, 30.0)  # x offsets from the pod centre, at pod mid-height


def pod_size(n: int = 3):
    """Pocket x, pocket y, half outer x, half outer y of a pod holding n servos side by side."""
    sx, sy = SERVO_W + 0.4, SERVO_L + 0.4
    return sx, sy, (n * sx + (n + 1) * POD_WALL) / 2, sy / 2 + POD_WALL


def servo_shafts(n: int = 3):
    """Shaft (x, y) of each servo in pod coordinates."""
    sx, sy, _, _ = pod_size(n)
    y = -sy / 2 + SERVO_SHAFT_OFF
    return [((i - (n - 1) / 2) * (sx + POD_WALL), y) for i in range(n)]


@cache
def servo_pod(n: int = 3):
    """Holds a stalk's servos side by side, shafts up. The +y flange bolts to the end cap (2 x M3)."""
    sx, sy, hx, hy = pod_size(n)
    body = fuse(box((-hx, -hy, 0), (hx, hy, POD_TOP)), box((-hx, hy, 0), (hx, hy + POD_FLANGE, POD_TOP)))
    tools = []
    for cx, _ in servo_shafts(n):
        tools.append(box((cx - sx / 2, -sy / 2, POD_FLOOR), (cx + sx / 2, sy / 2, POD_TOP + 1)))
        for y in (-(sy / 2 - 6), sy / 2 - 6):  # M2 into the case bottom: UNVERIFIED pattern, check the STEP
            tools.append(cyl((cx, y, -1), (cx, y, POD_FLOOR + 1), 1.1))
    for x in POD_FLANGE_HOLES:
        tools.append(cyl((x, hy - 1, POD_TOP / 2), (x, hy + POD_FLANGE + 1, POD_TOP / 2), 1.7))
    return cut(body, *tools)


def servo_ref():
    return box((-SERVO_W / 2, -SERVO_L / 2, 0), (SERVO_W / 2, SERVO_L / 2, SERVO_H))


def stalk_parts(s: StalkSpec, frame: Location, label: str = ""):
    """Base, spring, guide discs and tip, straight up the stalk frame. Returns (parts, tip-top frame)."""
    sp = s.spring
    at = frame * Pos(0, 0, s.plate_t)  # the spring's bottom end
    spring_part = Part(f"{label}stalk spring", spring(s), P.METAL, at, printed=sp.printed, material=sp.material)
    if not sp.printed:
        spring_part.name = f"REF {label}stalk spring ({sp.name})"
    parts = [Part(f"{label}stalk base", base(s), P.STALK, frame), spring_part]
    g = guide(s)
    parts += [Part(f"{label}stalk guide {k + 1}", g, P.STALK, at * Pos(0, 0, z)) for k, z in enumerate(s.guide_z)]
    top = at * Pos(0, 0, sp.free_length)
    parts.append(Part(f"{label}stalk tip", tip(s), P.STALK, top))
    return parts, top * Pos(0, 0, s.plate_t)


def pod_parts(frame: Location, n: int = 3, label: str = "", refs: bool = True):
    parts = [Part(f"{label}servo pod", servo_pod(n), P.INNER, frame)]
    pul = pulley()
    for i, (x, y) in enumerate(servo_shafts(n)):
        if refs:
            parts.append(
                Part(
                    f"REF {label}STS3215 {i + 1}",
                    servo_ref(),
                    P.REF,
                    frame * Pos(x, y + SERVO_L / 2 - SERVO_SHAFT_OFF, POD_FLOOR),
                    printed=False,
                )
            )
        parts.append(Part(f"{label}tendon pulley {i + 1}", pul, P.STALK, frame * Pos(x, y, POD_FLOOR + SERVO_H + 4)))
    return parts
