"""Charging dock: the bot reverses in, sits back, and its skid lands on three spring pins hidden under the drum.

World frame: floor at z = 0; when docked the drum axis is straight above x = 0 and the wheels sit in their troughs
at x = wheel_x. The bot faces +x, out into the room. It approaches from +x driving backwards, balancing, with its
eyes curled back over the drum on the AprilTag. The wheels climb the flared ramps, drop into the troughs and stop
against the curved backstops. Then it sits: the wheels stay in the troughs, the arms swing forward, and the drum
swings back and down until the skid lands on the pins at x = 0.

Everything electrical is behind or under the drum: the pins sit under the skid, their wires run in a channel on the
pad's underside to the backstop tower, and the tower (behind the drum, below its silhouette) holds the switch board,
the 24 V jack on its rear face, and the tag and IR beacon on its front face.

Six printed parts joined with printed dog-bone keys: pad, two wheel lanes, the backstop tower, and keys.
"""

from __future__ import annotations

import math

from build123d import Face, Pos, Rot, Solid, Vector, Wire

from . import part as P
from .body import WHEEL_Y1
from .geom import box, cut, cyl, fuse, rot_xz
from .params import DOCK_H, PADS, POGO_D, POGO_PROUD, WHEEL_R
from .part import Part

PAD_X = (-95.0, 150.0)  # pad under the drum; front edge sits between the wheel lanes
PAD_Y = 100.0
CRADLE_H = 22.0  # lane deck height
TROUGH_R = WHEEL_R + 3
STOP_H = 45.0  # the trough's rear wall rises this high: the wheels can't roll past it
RAMP_LEN = 80.0
FLARE = 25.0  # each lane wall splays this far out at the ramp mouth
KEY_R, KEY_NECK, KEY_T = 7.0, 8.0, 2.8
KEY_CLR = 0.2

# Backstop tower, behind the drum. Its front face leans back so the tag faces the eyes as they look back and down.
TOWER_LEAN = 20.0  # degrees back from vertical
TOWER_X = -105.0  # front face at the floor: 20 mm clear of the skid circle when docked
TOWER_H = 180.0  # below the drum's silhouette from the front (drum crown at z = 246)
TOWER_Y = 70.0  # half width: inside the drum's 150 mm length
TOWER_BACK = (-205.0, -186.5)  # back face x at the floor and at the top
WALL = 4.0
TAG = 94.0  # AprilTag 36h11 print, outer size
TAG_S = 100.0  # tag centre, measured up the front face from the floor
BEACON_S = 160.0  # IR LED, up the front face
JACK_Z, JACK_D = 40.0, 11.0  # 5.5 x 2.1 panel DC jack, rear face (hole size UNVERIFIED)


def _key(x: float, y: float, grow: float = 0.0, z0: float = -1.0, z1: float = 3.0, across: str = "y"):
    """Dog-bone key across a seam through (x, y): the seam is y = const (across='y') or x = const (across='x')."""
    if across == "y":
        s = 1 if y > 0 else -1
        a, b = (x, y - s * 9), (x, y + s * 9)
        neck = box((x - KEY_NECK / 2 - grow, y - 9, z0), (x + KEY_NECK / 2 + grow, y + 9, z1))
    else:
        a, b = (x - 9, y), (x + 9, y)
        neck = box((x - 9, y - KEY_NECK / 2 - grow, z0), (x + 9, y + KEY_NECK / 2 + grow, z1))
    return fuse(cyl((*a, z0), (*a, z1), KEY_R + grow), cyl((*b, z0), (*b, z1), KEY_R + grow), neck)


def _prism(pts_xz, y0: float, y1: float):
    """Extrude a closed x-z polygon along y."""
    face = Face(Wire.make_polygon([Vector(x, y0, z) for x, z in pts_xz], close=True))
    return Solid.extrude(face, Vector(0, y1 - y0, 0))


def _plan(pts_xy, z0: float, z1: float):
    """Extrude a closed x-y polygon along z."""
    face = Face(Wire.make_polygon([Vector(x, y, z0) for x, y in pts_xy], close=True))
    return Solid.extrude(face, Vector(0, 0, z1 - z0))


def _rail(p0, p1, t: float, h: float):
    """Wall of thickness t and height h along the floor from p0 to p1 (x, y)."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    n = (-dy / math.hypot(dx, dy) * t / 2, dx / math.hypot(dx, dy) * t / 2)
    pts = [(p0[0] + n[0], p0[1] + n[1]), (p1[0] + n[0], p1[1] + n[1]), (p1[0] - n[0], p1[1] - n[1]), (p0[0] - n[0], p0[1] - n[1])]
    return _plan(pts, 0, h)


def _on_face(s: float):
    """Location on the tower's front face, s mm up the face from the floor; local +x is the face normal."""
    a = math.radians(TOWER_LEAN)
    return Pos(TOWER_X - s * math.sin(a), 0, s * math.cos(a)) * rot_xz(TOWER_LEAN)


def _lane(side: int, wheel_x: float, pockets):
    """Wheel lane: flared ramp at the front, deck, trough with a curved backstop behind it, walls both sides."""
    y_in, y_out = side * PAD_Y, side * (WHEEL_Y1 + 14)
    x_rear, x_top = wheel_x - 80, wheel_x + 60  # backstop end, ramp top
    x_mouth = x_top + RAMP_LEN
    slope = math.degrees(math.atan2(CRADLE_H, RAMP_LEN))
    lo, hi = min(y_in, y_out) - FLARE - 10, max(y_in, y_out) + FLARE + 10

    def under_ramp(lift: float = 0.0):
        """Everything above the ramp line (rising from the mouth toward -x), raised by lift."""
        return box((-500, lo, 0), (0, hi, 300)).moved(Pos(x_mouth, 0, lift) * rot_xz(-slope))

    deck = fuse(
        box((x_rear, y_in, 0), (x_top, y_out, CRADLE_H)),
        box((x_rear, y_in, 0), (wheel_x - 20, y_out, STOP_H)),  # the trough's rear wall
        _plan([(x_top, y_in), (x_top, y_out), (x_mouth, y_out + side * FLARE), (x_mouth, y_in - side * FLARE)], 0, CRADLE_H),
    )
    deck = cut(deck, under_ramp())
    rails = fuse(
        box((x_rear, y_in, 0), (x_top, y_in + side * 6, 40)),  # inner wall
        box((x_rear, y_out - side * 6, 0), (x_top, y_out, 40)),  # outer wall
        _rail((x_top, y_in + side * 3), (x_mouth, y_in + side * (3 - FLARE)), 6, 40),
        _rail((x_top, y_out - side * 3), (x_mouth, y_out + side * (FLARE - 3)), 6, 40),
    )
    rails = cut(rails, under_ramp(14.0))  # walls and flared rails stand 14 mm proud of the ramp
    trough = cyl((wheel_x, side * (PAD_Y + 6), DOCK_H + TROUGH_R), (wheel_x, y_out - side * 6, DOCK_H + TROUGH_R), TROUGH_R)
    return cut(fuse(deck, rails), trough, *pockets)


def _tower(pockets):
    t = math.tan(math.radians(TOWER_LEAN))

    def fx(z: float) -> float:
        """Front face x at height z."""
        return TOWER_X - z * t

    def bx(z: float) -> float:
        """Back face x at height z."""
        return TOWER_BACK[0] + (TOWER_BACK[1] - TOWER_BACK[0]) * z / TOWER_H

    shell = _prism([(fx(0), 0), (fx(TOWER_H), TOWER_H), (bx(TOWER_H), TOWER_H), (bx(0), 0)], -TOWER_Y, TOWER_Y)
    body = fuse(shell, box((fx(0) - 1, -TOWER_Y, 0), (PAD_X[0], TOWER_Y, DOCK_H)))  # foot out to the pad seam
    fw = WALL / math.cos(math.radians(TOWER_LEAN))
    zt = TOWER_H - WALL
    bay = _prism(
        [(fx(DOCK_H) - fw, DOCK_H), (fx(zt) - fw, zt), (bx(zt) + WALL, zt), (bx(DOCK_H) + WALL, DOCK_H)],
        -TOWER_Y + WALL,
        TOWER_Y - WALL,
    )
    tools = [
        bay,
        box((-190, -50, -1), (-128, 50, DOCK_H + 1)),  # underside access to the bay for the switch board
        box((PAD_X[0] - 1, -40, -1), (fx(0) - 6, 35, 2)),  # pin wires, continuing the pad's channel
        box((fx(0) - 12, -40, -1), (fx(0) - 5, 35, DOCK_H + 1)),  # ...and up into the bay
        cyl((bx(JACK_Z) - 2, 0, JACK_Z), (bx(JACK_Z) + WALL + 4, 0, JACK_Z), JACK_D / 2),
        box((-1, -TAG / 2, -TAG / 2), (1, TAG / 2, TAG / 2)).moved(_on_face(TAG_S)),  # tag recess, 1 mm deep
        cyl((-10, 0, 0), (1, 0, 0), 2.6).moved(_on_face(BEACON_S)),  # 5 mm IR LED
        *pockets,
    ]
    return cut(body, *tools)


def dock_parts(wheel_x: float):
    pad_keys = [(x, s * PAD_Y) for s in (1, -1) for x in (wheel_x - 60, wheel_x - 20)]
    tower_keys = [(PAD_X[0], y) for y in (-60.0, 60.0)]
    pockets = [_key(x, y, KEY_CLR) for x, y in pad_keys] + [_key(x, y, KEY_CLR, across="x") for x, y in tower_keys]

    pad_tools = [cyl((0, y, -1), (0, y, DOCK_H + 1), POGO_D / 2) for y in PADS.values()]
    pad_tools.append(box((PAD_X[0] - 1, -40, -1), (4, 35, 2)))  # wire channel under the pins, back to the tower
    pad = cut(box((PAD_X[0], -PAD_Y, 0), (PAD_X[1], PAD_Y, DOCK_H)), *pad_tools, *pockets)
    parts = [Part("dock pad", pad, P.DOCK, material="PETG")]
    for side, tag in ((1, "L"), (-1, "R")):
        parts.append(Part(f"dock lane {tag}", _lane(side, wheel_x, pockets), P.DOCK))
    parts.append(Part("dock tower", _tower(pockets), P.DOCK))

    key_y = _key(0, PAD_Y, 0, 0.1, KEY_T + 0.1)  # symmetric about its seam, so one shape serves every y seam
    for i, (x, y) in enumerate(pad_keys):
        parts.append(Part(f"dock key {i + 1}", key_y, P.DOCK, Pos(x, y - PAD_Y, 0)))
    for i, (x, y) in enumerate(tower_keys):  # same shape turned 90 degrees: prints from the same file
        parts.append(Part(f"dock key {len(pad_keys) + i + 1}", key_y, P.DOCK, Pos(x, y, 0) * Rot(0, 0, 90) * Pos(0, -PAD_Y, 0)))
    for name, y in PADS.items():
        parts.append(Part(f"REF pogo pin {name}", cyl((0, y, 0), (0, y, DOCK_H + POGO_PROUD), POGO_D / 2), P.METAL, printed=False))
    tag = box((-1, -TAG / 2, -TAG / 2), (-0.4, TAG / 2, TAG / 2)).moved(_on_face(TAG_S))
    parts.append(Part("REF AprilTag", tag, (0.05, 0.05, 0.05), printed=False))
    parts.append(Part("REF IR LED 940 nm", cyl((-8, 0, 0), (2, 0, 0), 2.5).moved(_on_face(BEACON_S)), (0.5, 0.1, 0.1), printed=False))
    return parts
