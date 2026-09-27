"""Charging dock: the bot drives up to it, sits down, and its skid lands on three spring pins.

World frame: floor at z = 0; when docked the drum axis is straight above x = 0 and the wheels sit in their cradles
at x = wheel_x. The bot approaches from -x facing +x (its cameras see the AprilTag on the mast), stops over the
pad balancing, then sits: the arms swing forward, the wheels roll forward into the cradles (the circular troughs
centre them in x, the flared walls in y) and the drum tips back onto the pad.

Five printed parts joined with printed dog-bone keys: pad, two cradles, the tag mast, and keys.
"""

from __future__ import annotations

import math

from build123d import Pos

from . import part as P
from .body import WHEEL_Y0, WHEEL_Y1
from .geom import box, cut, cyl, fuse, rot_xz
from .params import DOCK_H, PADS, POGO_D, POGO_PROUD, WHEEL_R
from .part import Part

PAD_X = (-90.0, 90.0)
PAD_Y = 100.0
CRADLE_H = 22.0
TROUGH_R = WHEEL_R + 3
KEY_R, KEY_NECK, KEY_T = 7.0, 8.0, 2.8
KEY_CLR = 0.2


def _key(x: float, y: float, grow: float = 0.0, z0: float = -1.0, z1: float = 3.0):
    """Dog-bone key across the seam at y (the seam line is y = const)."""
    s = 1 if y > 0 else -1
    return fuse(
        cyl((x, y - s * 9, z0), (x, y - s * 9, z1), KEY_R + grow),
        cyl((x, y + s * 9, z0), (x, y + s * 9, z1), KEY_R + grow),
        box((x - KEY_NECK / 2 - grow, y - 9, z0), (x + KEY_NECK / 2 + grow, y + 9, z1)),
    )


def dock_parts(wheel_x: float):
    yw = (WHEEL_Y0 + WHEEL_Y1) / 2
    keys = [(x, s * PAD_Y) for s in (1, -1) for x in (30.0, 70.0)] + [(wheel_x + 50, s * PAD_Y) for s in (1, -1)]
    pockets = [_key(x, y, KEY_CLR) for x, y in keys]

    pad_tools = [cyl((0, y, -1), (0, y, DOCK_H + 1), POGO_D / 2) for y in PADS.values()]
    pad_tools.append(box((0, -40, -1), (PAD_X[1] + 1, 35, 2)))  # wire channel under the pins
    pad = cut(box((PAD_X[0], -PAD_Y, 0), (PAD_X[1], PAD_Y, DOCK_H)), *pad_tools, *pockets)
    parts = [Part("dock pad", pad, P.DOCK, material="PETG")]

    ramp_len = 80.0
    slope = math.degrees(math.atan2(CRADLE_H, ramp_len))
    for side, tag in ((1, "L"), (-1, "R")):
        y_in, y_out = side * PAD_Y, side * (yw + (WHEEL_Y1 - WHEEL_Y0) / 2 + 14)
        x0 = wheel_x - 75
        body = fuse(
            box((x0 - ramp_len, y_in, 0), (wheel_x + 60, y_out, CRADLE_H)),
            box((x0, y_in, 0), (wheel_x + 60, side * (PAD_Y + 6), 40)),  # inner wall
            box((x0, y_out - side * 6, 0), (wheel_x + 60, y_out, 40)),  # outer wall
        )
        lo, hi = min(y_in, y_out), max(y_in, y_out)
        slope_cut = box((0, lo - 1, 0), (400, hi + 1, 200)).moved(rot_xz(slope)).moved(P_(x0 - ramp_len))
        trough = cyl((wheel_x, side * (PAD_Y + 6), DOCK_H + TROUGH_R), (wheel_x, y_out - side * 6, DOCK_H + TROUGH_R), TROUGH_R)
        parts.append(Part(f"dock cradle {tag}", cut(body, slope_cut, trough, *pockets), P.DOCK))

    mast_x = wheel_x + 70
    mast = fuse(box((wheel_x + 40, -PAD_Y, 0), (mast_x + 10, PAD_Y, 5)), box((mast_x, -60, 0), (mast_x + 6, 60, 200)))
    mast = fuse(mast, *[box((mast_x + 6, y - 3, 5), (mast_x + 40, y + 3, 60)) & _gusset(mast_x + 6) for y in (-55, 55)])
    tag_recess = box((mast_x - 1, -47, 100), (mast_x + 1, 47, 194))  # 94 mm AprilTag 36h11 print, glued in
    parts.append(Part("dock tag mast", cut(mast, tag_recess, *pockets), P.DOCK))

    key = _key(0, PAD_Y, 0, 0.1, KEY_T + 0.1)  # symmetric about its seam, so one shape serves every joint
    for i, (x, y) in enumerate(keys):
        parts.append(Part(f"dock key {i + 1}", key, P.DOCK, Pos(x, y - PAD_Y, 0)))
    for name, y in PADS.items():
        parts.append(Part(f"REF pogo pin {name}", cyl((0, y, 0), (0, y, DOCK_H + POGO_PROUD), POGO_D / 2), P.METAL, printed=False))
    parts.append(Part("REF AprilTag", box((mast_x - 0.6, -47, 100), (mast_x, 47, 194)), (0.05, 0.05, 0.05), printed=False))
    return parts


def _gusset(x0: float):
    """Triangle-ish brace behind the mast: a box clipped by a 45 degree plane."""
    return box((x0, -200, 5), (x0 + 40, 200, 60)).cut(box((0, -300, 0), (200, 300, 200)).moved(rot_xz(-45)).moved(P_(x0, 60)))


def P_(x: float = 0.0, z: float = 0.0) -> Pos:
    return Pos(x, 0, z)
