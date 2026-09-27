"""Charging dock: the bot reverses in and sits its round drum down into a U-shaped cradle; the skid lands on three
spring pins at the bottom of the U, hidden under the drum.

World frame: floor at z = 0; when docked the drum axis is straight above x = 0. The bot faces +x, out into the room.
It approaches from +x driving backwards, balancing, with its eyes curled back over the drum on the AprilTag, until
the drum hangs over the cradle (the drum's underside clears the cradle by about 50 mm while balancing). Then it sits:
the arms swing forward, the wheels roll forward on the floor either side of the cradle, and the drum comes down into
the U. The U is a little bigger than the drum, so the drum slides down its walls to the bottom (fore-aft), and its
end cheeks funnel the drum's ends in (sideways).

Everything electrical is behind or under the drum: the pins sit in the cradle floor under the skid, their wires run
in a channel on the cradle's underside to the backstop tower, and the tower (behind the drum, below its silhouette)
holds the switch board, the 24 V jack on its rear face, and the tag and IR beacon on its front face.

Two printed parts, cradle and tower, joined by two printed dog-bone keys.
"""

from __future__ import annotations

import math

from build123d import Face, Pos, Solid, Vector, Wire

from . import part as P
from .geom import box, cut, cyl, fuse, rot_xz
from .params import DOCK_H, DRUM_L, DRUM_R, PADS, POGO_D, POGO_PROUD, SKID_T
from .part import Part

# Cradle: a U across the drum axis, its circle concentric with the drum's when the drum sits at the bottom of it.
U_R = DRUM_R + SKID_T + 6  # 6 mm bigger than the skid circle: the drum touches only at the bottom, on the skid
U_Z = DOCK_H + U_R  # U centre height; the drum axis sits 6 mm below it, at DOCK_H + skid circle radius
SLOT_Y = DRUM_L / 2 + 3  # the U runs 3 mm past each drum end
CORE_Y = 72.0  # full-height walls stay inside the drum's length, clear of the arms (|y| >= 76)
CHEEK_Y = 92.0  # end cheeks reach out to here, still well inside the wheels (|y| >= 113)
CHEEK_H = 40.0  # cheeks stay under the arms: a balancing bot's arm bottoms are 46 mm up
REAR_H = 60.0  # rear wall of the U
LIP_H = 30.0  # front lip of the U
LIP_X = (80.0, 112.0)  # lip top ends, lead-in chamfer foot
KEY_R, KEY_NECK, KEY_T = 7.0, 8.0, 2.8
KEY_CLR = 0.2

# Backstop tower, behind the drum. Its front face leans back so the tag faces the eyes as they look back and down.
TOWER_LEAN = 20.0  # degrees back from vertical
TOWER_X = -105.0  # front face at the floor: 20 mm clear of the skid circle when docked; also the cradle seam
TOWER_H = 180.0  # below the drum's silhouette from the front (drum crown at z = 259)
TOWER_Y = 70.0  # half width: inside the drum's 150 mm length
TOWER_BACK = (-205.0, -186.5)  # back face x at the floor and at the top
WALL = 4.0
TAG = 94.0  # AprilTag 36h11 print, outer size
TAG_S = 118.0  # tag centre, measured up the front face from the floor: clear above the cradle's rear wall
BEACON_S = 178.0  # IR LED, up the front face
JACK_Z, JACK_D = 40.0, 11.0  # 5.5 x 2.1 panel DC jack, rear face (hole size UNVERIFIED)
KEYS_Y = (-55.0, 55.0)  # cradle/tower keys, either side of the wire channel


def _front_x(z: float) -> float:
    """The tower's front face (and the cradle's rear face) at height z."""
    return TOWER_X - z * math.tan(math.radians(TOWER_LEAN))


def _key(x: float, y: float, grow: float = 0.0, z0: float = -1.0, z1: float = 3.0):
    """Dog-bone key across the seam x = const through (x, y)."""
    return fuse(
        cyl((x - 9, y, z0), (x - 9, y, z1), KEY_R + grow),
        cyl((x + 9, y, z0), (x + 9, y, z1), KEY_R + grow),
        box((x - 9, y - KEY_NECK / 2 - grow, z0), (x + 9, y + KEY_NECK / 2 + grow, z1)),
    )


def _prism(pts_xz, y0: float, y1: float):
    """Extrude a closed x-z polygon along y."""
    face = Face(Wire.make_polygon([Vector(x, y0, z) for x, z in pts_xz], close=True))
    return Solid.extrude(face, Vector(0, y1 - y0, 0))


def _on_face(s: float):
    """Location on the tower's front face, s mm up the face from the floor; local +x is the face normal."""
    a = math.radians(TOWER_LEAN)
    return Pos(TOWER_X - s * math.sin(a), 0, s * math.cos(a)) * rot_xz(TOWER_LEAN)


def _cradle(pockets):
    """U channel across the drum axis: rear wall, low front lip with a lead-in, flared end cheeks, pins at the bottom."""
    profile = [
        (TOWER_X, 0),
        (_front_x(REAR_H), REAR_H),
        (-40, REAR_H),  # inside the U: the circle cuts it away
        (40, LIP_H),
        (LIP_X[0], LIP_H),
        (LIP_X[1], 0),
    ]
    body = _prism(profile, -CHEEK_Y, CHEEK_Y)
    tools = [cyl((0, -SLOT_Y, U_Z), (0, SLOT_Y, U_Z), U_R)]
    for s in (1, -1):
        tools.append(box((-200, s * CORE_Y, CHEEK_H), (200, s * (CHEEK_Y + 1), 100)))  # cheeks under the arms
        # flare: the cheek's inner top edge is cut back 2:1 so a drum end coming down off-centre slides in
        flare = [(SLOT_Y, 24), (SLOT_Y + 9, CHEEK_H + 2), (SLOT_Y - 1, CHEEK_H + 2), (SLOT_Y - 1, 24)]
        face = Face(Wire.make_polygon([Vector(-200, s * y, z) for y, z in flare], close=True))
        tools.append(Solid.extrude(face, Vector(400, 0, 0)))
    tools += [cyl((0, y, -1), (0, y, DOCK_H + 1), POGO_D / 2) for y in PADS.values()]
    tools.append(box((TOWER_X - 1, -40, -1), (4, 35, 2)))  # pin wires, back to the tower on the underside
    return cut(body, *tools, *pockets)


def _tower(pockets):
    fx = _front_x

    def bx(z: float) -> float:
        """Back face x at height z."""
        return TOWER_BACK[0] + (TOWER_BACK[1] - TOWER_BACK[0]) * z / TOWER_H

    body = _prism([(fx(0), 0), (fx(TOWER_H), TOWER_H), (bx(TOWER_H), TOWER_H), (bx(0), 0)], -TOWER_Y, TOWER_Y)
    fw = WALL / math.cos(math.radians(TOWER_LEAN))
    zt = TOWER_H - WALL
    bay = _prism(
        [(fx(DOCK_H) - fw, DOCK_H), (fx(zt) - fw, zt), (bx(zt) + WALL, zt), (bx(DOCK_H) + WALL, DOCK_H)],
        -TOWER_Y + WALL,
        TOWER_Y - WALL,
    )
    tools = [
        bay,
        box((-190, -45, -1), (-128, 45, DOCK_H + 1)),  # underside access to the bay for the switch board
        box((fx(0) + 1, -40, -1), (fx(0) - 12, 35, 2)),  # pin wires, continuing the cradle's channel
        box((fx(0) - 12, -40, -1), (fx(0) - 5, 35, DOCK_H + 1)),  # ...and up into the bay
        cyl((bx(JACK_Z) - 2, 0, JACK_Z), (bx(JACK_Z) + WALL + 4, 0, JACK_Z), JACK_D / 2),
        box((-1, -TAG / 2, -TAG / 2), (1, TAG / 2, TAG / 2)).moved(_on_face(TAG_S)),  # tag recess, 1 mm deep
        cyl((-10, 0, 0), (1, 0, 0), 2.6).moved(_on_face(BEACON_S)),  # 5 mm IR LED
    ]
    return cut(body, *tools, *pockets)


def dock_parts(wheel_x: float):
    """The dock. The wheels sit on the floor either side of the cradle, so wheel_x doesn't shape any part."""
    del wheel_x
    keys = [(TOWER_X, y) for y in KEYS_Y]
    pockets = [_key(x, y, KEY_CLR) for x, y in keys]
    parts = [
        Part("dock cradle", _cradle(pockets), P.DOCK),
        Part("dock tower", _tower(pockets), P.DOCK),
    ]
    key = _key(0, 0, 0, 0.1, KEY_T + 0.1)
    for i, (x, y) in enumerate(keys):
        parts.append(Part(f"dock key {i + 1}", key, P.DOCK, Pos(x, y, 0)))
    for name, y in PADS.items():
        parts.append(Part(f"REF pogo pin {name}", cyl((0, y, 0), (0, y, DOCK_H + POGO_PROUD), POGO_D / 2), P.METAL, printed=False))
    tag = box((-1, -TAG / 2, -TAG / 2), (-0.4, TAG / 2, TAG / 2)).moved(_on_face(TAG_S))
    parts.append(Part("REF AprilTag", tag, (0.05, 0.05, 0.05), printed=False))
    parts.append(Part("REF IR LED 940 nm", cyl((-8, 0, 0), (2, 0, 0), 2.5).moved(_on_face(BEACON_S)), (0.5, 0.1, 0.1), printed=False))
    return parts

