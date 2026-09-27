"""Eye stalk: printed Loc-Line style ball-and-socket segments driven by four tendons.

Segment frame: socket centre at the origin, its own ball centre at (0, 0, pitch), stalk axis +z. Each segment's
socket snaps over the ball below it and holds by friction (the interference), so the stalk keeps any pose
unpowered. Tendons run through holes in each segment's flange at 0/90/180/270 degrees: two antagonistic pairs,
each pair on one double pulley on one servo. A 10 mm bore carries the display/camera leads.

Print every piece in the frame it is modelled in (socket down, ball up): no supports.
"""

from __future__ import annotations

from functools import cache

from build123d import Location, Pos, Rot

from . import part as P
from .geom import box, cone, cut, cyl, fuse, polar, sph
from .params import HORN_PCD, SERVO_H, SERVO_L, SERVO_SHAFT_OFF, SERVO_W, StalkSpec
from .part import Part

PULLEY_R = 10.0  # groove radius: 31 mm of tendon per 180 deg of servo, ~216 deg for a full 180 deg stalk bend


def _tendon_xy(s: StalkSpec):
    return [polar(s.tendon_r, i * 360 / s.tendons) for i in range(s.tendons)]


def _socket_positive(s: StalkSpec):
    """Socket shell clipped at the mouth, plus the tendon flange above its equator."""
    shell = sph((0, 0, 0), s.ro) & box((-s.ro - 1, -s.ro - 1, -s.h), (s.ro + 1, s.ro + 1, s.ro + 1))
    flange_cone = cone((0, 0, 0.15 * s.rc), (0, 0, 0.3 * s.rc), s.ro - 0.3, s.flange_r)
    flange = cyl((0, 0, 0.3 * s.rc), (0, 0, 0.55 * s.rc), s.flange_r)
    return [shell, flange_cone, flange]


def _socket_cutters(s: StalkSpec):
    tools = [sph((0, 0, 0), s.rc)]
    tools += [cyl((x, y, -s.ro), (x, y, s.ro), s.tendon_hole / 2) for x, y in _tendon_xy(s)]
    for i in range(s.slits):
        slit = box((s.rc - 1.5, -s.slit_w / 2, -s.h - 1), (s.ro + 3, s.slit_w / 2, 0.12 * s.rc))
        tools.append(slit.moved(Rot(0, 0, 45 + i * 360 / s.slits)))
    return tools


def _ball_cutters(s: StalkSpec, zb: float):
    """Central bore, flared where it leaves the ball so the leads never see a sharp edge when the joint bends."""
    return [
        cyl((0, 0, -s.ro - 1), (0, 0, zb + s.rb + 1), s.bore / 2),
        cone((0, 0, zb), (0, 0, zb + s.rb + 0.01), s.bore / 2, s.bore / 2 + 0.5 * s.rb),
    ]


@cache
def segment(s: StalkSpec):
    body = fuse(*_socket_positive(s), cyl((0, 0, 0), (0, 0, s.pitch), s.rn), sph((0, 0, s.pitch), s.rb))
    return cut(body, *_socket_cutters(s), *_ball_cutters(s, s.pitch))


@cache
def base(s: StalkSpec):
    """Root: a plate that bolts to the drum pedestal (3 x M3 on Ø36), PTFE tube sockets under the tendon holes."""
    hb = s.base_h
    body = fuse(cyl((0, 0, 0), (0, 0, 5), 22), cone((0, 0, 5), (0, 0, hb), s.flange_r, s.rn), sph((0, 0, hb), s.rb))
    tools = _ball_cutters(s, hb)
    for x, y in _tendon_xy(s):
        tools += [cyl((x, y, -1), (x, y, hb), s.tendon_hole / 2), cyl((x, y, -1), (x, y, 4), 2.1)]
    for i in range(3):
        x, y = polar(18, 60 + i * 120)
        tools.append(cyl((x, y, -1), (x, y, 6), 1.7))
    return cut(body, *tools)


@cache
def tip(s: StalkSpec):
    """Last socket plus a cap: tendons knot in counterbores on top, 4 x M3 heat-set inserts take the eye."""
    ht = s.tip_h
    body = fuse(*_socket_positive(s), cyl((0, 0, 0.5 * s.rc), (0, 0, ht), s.flange_r))
    tools = _socket_cutters(s) + [cyl((0, 0, -s.ro - 1), (0, 0, ht + 1), s.bore / 2)]
    for i, (x, y) in enumerate(_tendon_xy(s)):
        tools += [cyl((x, y, 0), (x, y, ht + 1), s.tendon_hole / 2), cyl((x, y, ht - 3), (x, y, ht + 1), 1.5)]
        ix, iy = polar(9, 45 + i * 90)
        tools.append(cyl((ix, iy, ht - 6), (ix, iy, ht + 1), 2.0))  # M3 x 5.7 insert
    return cut(body, *tools)


@cache
def pulley():
    """Double-groove pulley: one tendon of a pair wraps each groove, in opposite senses. Bolts to the stock horn."""
    rg, fl = PULLEY_R, PULLEY_R + 2.5
    body = fuse(
        cyl((0, 0, 0), (0, 0, 2), fl),
        cyl((0, 0, 2), (0, 0, 6), rg),
        cyl((0, 0, 6), (0, 0, 7.5), fl),
        cyl((0, 0, 7.5), (0, 0, 11.5), rg),
        cyl((0, 0, 11.5), (0, 0, 13.5), fl),
    )
    tools = [cyl((0, 0, -1), (0, 0, 14.5), 3.5)]
    for i in range(4):
        x, y = polar(HORN_PCD / 2, 45 + i * 90)
        tools.append(cyl((x, y, -1), (x, y, 14.5), 1.1))
    tools.append(cyl((-fl, 0, 4), (fl, 0, 4), 0.9))  # tendon anchor, lower groove
    tools.append(cyl((0, -fl, 9.5), (0, fl, 9.5), 0.9))  # tendon anchor, upper groove
    return cut(body, *tools)


POD_WALL = 2.5
POD_FLOOR = 3.0
POD_DEPTH = 28.0


def pod_size():
    sx, sy = SERVO_W + 0.4, SERVO_L + 0.4
    return sx, sy, sx + 1.5 * POD_WALL, sy / 2 + POD_WALL  # pocket x, pocket y, half outer x, half outer y


def servo_shafts():
    """Shaft (x, y) of each servo in pod coordinates."""
    sx, sy, _, _ = pod_size()
    y = -sy / 2 + SERVO_SHAFT_OFF
    return [(-(sx + POD_WALL) / 2, y), ((sx + POD_WALL) / 2, y)]


@cache
def servo_pod(flange: float = 2.7):
    """Holds a stalk's two STS3215s side by side, shafts up. The +y flange bolts to the end cap (2 x M3)."""
    sx, sy, hx, hy = pod_size()
    top = POD_FLOOR + POD_DEPTH
    body = fuse(box((-hx, -hy, 0), (hx, hy, top)), box((-hx, hy, 0), (hx, hy + flange, top)))
    tools = []
    for cx in (-(sx + POD_WALL) / 2, (sx + POD_WALL) / 2):
        tools.append(box((cx - sx / 2, -sy / 2, POD_FLOOR), (cx + sx / 2, sy / 2, top + 1)))
        for y in (-(sy / 2 - 6), sy / 2 - 6):  # M2 into the case bottom: UNVERIFIED pattern, check the STEP
            tools.append(cyl((cx, y, -1), (cx, y, POD_FLOOR + 1), 1.1))
    for x in (-20, 20):
        tools.append(cyl((x, hy - 1, top / 2), (x, hy + flange + 1, top / 2), 1.7))
    return cut(body, *tools)


def servo_ref():
    return box((-SERVO_W / 2, -SERVO_L / 2, 0), (SERVO_W / 2, SERVO_L / 2, SERVO_H))


def stalk_parts(s: StalkSpec, frame: Location, roll_deg: float = 0.0, pitch_deg: float = 0.0, label: str = ""):
    """Base, segments and tip posed along a stalk. Returns (parts, tip-top frame).

    The bend (roll about x: sideways, pitch about y: forward) is shared equally by every joint, a constant-curvature
    arc, which is what pulling one tendon pair produces.
    """
    n = s.segments
    turn = Rot(roll_deg / (n + 1), pitch_deg / (n + 1), 0)
    seg = segment(s)
    parts = [Part(f"{label}stalk base", base(s), P.STALK, frame)]
    t = frame * Pos(0, 0, s.base_h)
    for k in range(n):
        t = t * turn
        parts.append(Part(f"{label}stalk segment {k + 1}", seg, P.STALK, t))
        t = t * Pos(0, 0, s.pitch)
    t = t * turn
    parts.append(Part(f"{label}stalk tip", tip(s), P.STALK, t))
    return parts, t * Pos(0, 0, s.tip_h)


def pod_parts(frame: Location, label: str = "", refs: bool = True):
    parts = [Part(f"{label}servo pod", servo_pod(), P.INNER, frame)]
    pul = pulley()
    for i, (x, y) in enumerate(servo_shafts()):
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
