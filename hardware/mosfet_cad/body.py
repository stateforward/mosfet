"""Drum, end caps, internal structure, arms, wheels, skid.

Drum frame: origin on the drum axis at mid-length, x forward, y left (the drum axis), z up. Side +1 is left.
"""

from __future__ import annotations

import math

from build123d import Face, Pos, Solid, Vector, Wire

from .geom import box, cut, cyl, fuse, polar, rot_xz
from .params import (
    ARM_L,
    ARM_PIVOT,
    ARM_T,
    ARM_W,
    ARM_Y0,
    BEARING_FIT,
    BEARING_OD,
    BEARING_W,
    BOSS_Z,
    CAP_T,
    DRUM_L,
    DRUM_R,
    JETSON_BOARD,
    JETSON_HOLE_INSET,
    JETSON_HOLES,
    MOTOR_D,
    MOTOR_L,
    PAD_W,
    PADS,
    POLOLU_HUB_PCD,
    SERVO_L,
    SERVO_SHAFT_OFF,
    SERVO_W,
    SHELL,
    SKID_T,
    STALK_SPREAD,
    WHEEL_R,
    WHEEL_W,
)

RI = DRUM_R - SHELL  # drum inner radius
CAP_IN = DRUM_L / 2 - CAP_T  # end cap inner face, |y|
GEAR_M = 2.0
GEAR_N, PINION_N = 32, 16  # 2:1 arm reduction
GEAR_Y = (44.5, 52.5)  # gear plane, |y|, just inside the bearing boss
PINION_DEG = 200.0  # pinion centre direction from the pivot, xz-angle
CENTRE_DIST = GEAR_M * (GEAR_N + PINION_N) / 2 + 0.5  # + printed-gear backlash
PIN_X = CENTRE_DIST * math.cos(math.radians(PINION_DEG))
PIN_Z = ARM_PIVOT + CENTRE_DIST * math.sin(math.radians(PINION_DEG))

JETSON_X0 = -60.0  # carrier board back edge, x
TRAY_Z = (-70.0, -66.0)
POD_CENTRE = (69.0, STALK_SPREAD, 0.0)  # stalk servo pod, left side (pod bottom z)
POD_FLANGE_HOLES = (-20.0, 20.0)  # x offsets from the pod centre, at pod mid-height
POD_TOP = 31.0

MOTOR_R = MOTOR_D / 2 + 0.2  # clamp bore
MOTOR_FACE = ARM_Y0 + ARM_T + 56  # gearbox face, |y|: the motor sits in a sleeve inside the wheel
WHEEL_Y0 = ARM_Y0 + ARM_T + 1  # wheel inner face, |y|
WHEEL_Y1 = WHEEL_Y0 + WHEEL_W
RIM_R = WHEEL_R - 8  # TPU tyre 8 mm thick

BATTERY_BOX = ((-15.0, -45.0, -93.0), (60.0, 45.0, -70.2))


def _radial(deg: float, y: float, r0: float, r1: float, rad: float):
    x0, z0 = polar(r0, deg)
    x1, z1 = polar(r1, deg)
    return cyl((x0, y, z0), (x1, y, z1), rad)


def _half_tube(upper: bool):
    tube = cyl((0, -DRUM_L / 2, 0), (0, DRUM_L / 2, 0), DRUM_R)
    z = (0, DRUM_R + 1) if upper else (-DRUM_R - 1, 0)
    return tube & box((-DRUM_R - 1, -DRUM_L / 2 - 1, z[0]), (DRUM_R + 1, DRUM_L / 2 + 1, z[1]))


def _cap_screw_holes(angles, rad):
    out = []
    for side in (1, -1):
        for a in angles:
            out.append(_radial(a, side * (DRUM_L / 2 - CAP_T / 2), RI - 9 if rad > 1.8 else RI - 1, DRUM_R + 1, rad))
    return out


def shell_upper():
    """Top half of the drum, with the two stalk pedestals 25 degrees forward of the top."""
    bosses = [cyl((50, s * STALK_SPREAD, 95), (50, s * STALK_SPREAD, BOSS_Z), 22) for s in (1, -1)]
    body = fuse(_half_tube(True), *bosses)
    tools = [cyl((0, -DRUM_L, 0), (0, DRUM_L, 0), RI)]
    tools += _cap_screw_holes((30, 150), 1.7)
    for s in (1, -1):
        y = s * STALK_SPREAD
        tools.append(cyl((50, y, 80), (50, y, BOSS_Z + 1), 6))
        for i in range(4):
            dx, dy = polar(12, i * 90)
            tools.append(cyl((50 + dx, y + dy, 80), (50 + dx, y + dy, BOSS_Z + 1), 2.1))  # PTFE tube
        for i in range(3):
            dx, dy = polar(18, 60 + i * 120)
            tools.append(cyl((50 + dx, y + dy, BOSS_Z - 8), (50 + dx, y + dy, BOSS_Z + 1), 2.0))  # M3 insert
    return cut(body, *tools)


def shell_lower(beta: float):
    """Bottom half of the drum; the skid bolts on at xz-angle beta, contact wires pass through it."""
    tools = [cyl((0, -DRUM_L, 0), (0, DRUM_L, 0), RI)]
    tools += _cap_screw_holes((-30, -150), 1.7)
    for y in (-48.0, 48.0):
        tools.append(_radial(beta, y, RI - 1, DRUM_R + 1, 1.7))
    for y in PADS.values():
        tools.append(_radial(beta, y, RI - 1, DRUM_R + 1, 2.0))
    return cut(_half_tube(False), *tools)


def end_cap(side: int):
    """Disc inside the drum end: carries the arm pivot on two 6805 bearings, the servos and the tray."""
    y_in, y_out = side * CAP_IN, side * DRUM_L / 2
    body = fuse(
        cyl((0, y_in, 0), (0, y_out, 0), RI - 0.2),
        cyl((0, side * (DRUM_L / 2 - 22), ARM_PIVOT), (0, y_out, ARM_PIVOT), 24),
    )
    br = BEARING_OD / 2 + BEARING_FIT
    tools = [
        cyl((0, side * (DRUM_L / 2 - BEARING_W), ARM_PIVOT), (0, side * (DRUM_L / 2 + 1), ARM_PIVOT), br),
        cyl((0, side * (DRUM_L / 2 - 23), ARM_PIVOT), (0, side * (DRUM_L / 2 - 22 + BEARING_W), ARM_PIVOT), br),
        cyl((0, side * (DRUM_L / 2 - 23), ARM_PIVOT), (0, side * (DRUM_L / 2 + 1), ARM_PIVOT), 15),
    ]
    for a in (-160, -135, -110, -70, -45, -20):  # vents
        x, z = polar(88, a)
        tools.append(cyl((x, y_in - side, z), (x, y_out + side, z), 8))
    for a in (30, 150, -30, -150):  # radial M3 inserts: both shell halves screw into the cap rim
        tools.append(_radial(a, side * (DRUM_L / 2 - CAP_T / 2), RI - 9, RI + 1, 2.0))

    def insert(x, z):
        return cyl((x, y_in - side, z), (x, side * (CAP_IN + 6), z), 2.0)

    tools += [insert(x, -56) for x in (-40, 40)]  # tray tabs
    tools += [insert(POD_CENTRE[0] + dx, POD_TOP / 2) for dx in POD_FLANGE_HOLES]  # stalk servo pod
    tools += [insert(*p) for p in ARM_SERVO_POSTS]  # arm servo mount
    return cut(body, *tools)


# --- internal structure --------------------------------------------------------------------------------------------


def jetson_holes():
    by = JETSON_BOARD[1]
    hx, hy = JETSON_HOLES
    x0, y0 = JETSON_X0 + JETSON_HOLE_INSET, by / 2 - JETSON_HOLE_INSET
    return [(x0, y0), (x0 + hx, y0), (x0, y0 - hy), (x0 + hx, y0 - hy)]


SHELF_POSTS = [(-40.0, 45.0), (-40.0, -45.0), (15.0, 45.0), (15.0, -45.0)]
SLING_HOLES = [(-22.0, 40.0), (-22.0, -40.0), (66.0, 40.0), (66.0, -40.0)]


def tray():
    z0, z1 = TRAY_Z
    parts = [box((-86, -CAP_IN + 3, z0), (86, CAP_IN - 3, z1))]
    for s in (1, -1):
        for x in (-40, 40):
            parts.append(box((x - 10, s * (CAP_IN - 9), z1), (x + 10, s * (CAP_IN - 3), -46)))
    parts += [cyl((x, y, z1), (x, y, z1 + 5), 4) for x, y in jetson_holes()]
    tools = []
    for s in (1, -1):
        for x in (-40, 40):
            tools.append(cyl((x, s * (CAP_IN - 12), -56), (x, s * (CAP_IN + 1), -56), 1.7))
    tools += [cyl((x, y, z1 + 1), (x, y, z1 + 6), 1.8) for x, y in jetson_holes()]  # M2.5 inserts
    tools += [cyl((x, y, z0 - 1), (x, y, z1 + 1), 1.7) for x, y in SHELF_POSTS + SLING_HOLES]
    return cut(fuse(*parts), *tools)


def shelf():
    """Electronics shelf over the Jetson: Teensy 4.1, BNO085 near the drum axis, bus-servo adapter."""
    plate = box((-48, -49, -18), (22, 49, -15))
    posts = [cyl((x, y, TRAY_Z[1]), (x, y, -15), 5) for x, y in SHELF_POSTS]
    tools = [cyl((x, y, TRAY_Z[1] - 1), (x, y, TRAY_Z[1] + 8), 2.0) for x, y in SHELF_POSTS]
    return cut(fuse(plate, *posts), *tools)


def sling():
    """Open-ended cradle under the tray that holds the 4S1P pack low and forward."""
    (x0, y0, z0), (x1, y1, z1) = BATTERY_BOX
    body = fuse(box((x0 - 3, y0 - 2, z0 - 2), (x1 + 2, y1 + 2, TRAY_Z[0])), box((-26, -48, -73), (70, 48, TRAY_Z[0])))
    tools = [box((x0, y0 - 5, z0), (x1, y1 + 5, z1 + 0.2)), box((x0 + 10, -30, z0 - 5), (x1 - 10, 30, z0 + 1))]
    tools += [cyl((x, y, -80), (x, y, TRAY_Z[0] + 1), 1.7) for x, y in SLING_HOLES]
    return cut(body, *tools)


def driver_mount():
    """Upright plate at the back of the tray for the Cytron MDD10A (M3 standoffs, pattern to suit the board)."""
    body = fuse(box((-84, -44, TRAY_Z[1]), (-81, 44, 0)), box((-84, -44, TRAY_Z[1]), (-70, 44, TRAY_Z[1] + 3)))
    tools = [cyl((-85, y, z), (-80, y, z), 1.6) for y in (-38, 38) for z in (-58, -8)]
    return cut(body, *tools)


# --- skid ----------------------------------------------------------------------------------------------------------


def skid(beta: float):
    """Low-friction ski on the drum's back-bottom, with recesses for the three brass charge pads."""
    r = DRUM_R + SKID_T
    body = cyl((0, -55, 0), (0, 55, 0), r) & box((-26, -56, -r - 1), (26, 56, -DRUM_R + 30))
    tools = [cyl((0, -60, 0), (0, 60, 0), DRUM_R)]
    for y in PADS.values():
        tools.append(box((-20, y - PAD_W / 2, -r - 1), (20, y + PAD_W / 2, -r + 1)))
        tools.append(cyl((0, y, -r - 1), (0, y, -DRUM_R + 1), 1.5))
    tools += [cyl((0, y, -r - 1), (0, y, -DRUM_R + 1), 1.7) for y in (-48, 48)]
    return cut(body, *tools).moved(rot_xz(beta + 90))


def pads(beta: float):
    """Brass strip pads (reference)."""
    r = DRUM_R + SKID_T
    return [
        (
            name,
            (box((-18, y - PAD_W / 2 + 0.5, -r - 0.2), (18, y + PAD_W / 2 - 0.5, -r + 0.8)) & cyl((0, -60, 0), (0, 60, 0), r)).moved(
                rot_xz(beta + 90)
            ),
        )
        for name, y in PADS.items()
    ]


# --- gears ---------------------------------------------------------------------------------------------------------


def gear(n: int, m: float, cx: float, cz: float, y0: float, y1: float, bore: float, phase: float = 0.0):
    """Spur gear about an axis parallel to y. Trapezoid teeth approximating a 20 degree involute.

    A tooth is centred at xz-angle phase (degrees).
    """
    rp = m * n / 2
    rr, rt = rp - 1.25 * m, rp + m
    wr, wt = math.pi * m / 2 + 2 * 1.25 * m * math.tan(math.radians(20)), math.pi * m / 2 - 2 * m * math.tan(math.radians(20))
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + math.radians(phase)
        for r, w in ((rr, -wr), (rt, -wt), (rt, wt), (rr, wr)):
            t = a + w / (2 * r)
            pts.append(Vector(cx + r * math.cos(t), y0, cz + r * math.sin(t)))
    face = Face(Wire.make_polygon(pts, close=True))
    body = Solid.extrude(face, Vector(0, y1 - y0, 0))
    return cut(body, cyl((cx, y0 - 1 if y1 > y0 else y0 + 1, cz), (cx, y1 + 1 if y1 > y0 else y1 - 1, cz), bore))


def arm_gear(side: int):
    g = gear(GEAR_N, GEAR_M, 0, ARM_PIVOT, side * GEAR_Y[0], side * GEAR_Y[1], 12.6, PINION_DEG)
    tools = [cyl((x, side * 40, z), (x, side * 60, z), 1.7) for x, z in (polar(20, a) for a in (0, 120, 240))]
    return cut(g, *[t.moved(Pos(0, 0, ARM_PIVOT)) for t in tools])


def pinion(side: int):
    g = gear(PINION_N, GEAR_M, PIN_X, PIN_Z, side * GEAR_Y[0], side * GEAR_Y[1], 3.0, PINION_DEG + 180 + 180 / PINION_N)
    tools = []
    for a in (45, 135, 225, 315):
        x, z = polar(7, a)
        tools.append(cyl((PIN_X + x, side * 40, PIN_Z + z), (PIN_X + x, side * 60, PIN_Z + z), 1.1))
    return cut(g, *tools)


ARM_SERVO_POSTS = [(PIN_X - 42, PIN_Z), (PIN_X + 8, PIN_Z - 24)]


def arm_servo_box(side: int):
    """STS3250 body: shaft along +side*y, output at the pinion."""
    return box(
        (PIN_X - (SERVO_L - SERVO_SHAFT_OFF), side * 10, PIN_Z - SERVO_W / 2),
        (PIN_X + SERVO_SHAFT_OFF, side * (GEAR_Y[0] - 0.5), PIN_Z + SERVO_W / 2),
    )


def arm_servo_mount(side: int):
    """Sleeve around the arm servo with two posts that bolt to the end cap, clear of both gears."""
    x0, x1 = PIN_X - (SERVO_L - SERVO_SHAFT_OFF), PIN_X + SERVO_SHAFT_OFF
    body = fuse(
        box((x0 - 3, side * 20, PIN_Z - SERVO_W / 2 - 3), (x1 + 3, side * 40, PIN_Z + SERVO_W / 2 + 3)),
        *[cyl((x, side * 30, z), (x, side * CAP_IN, z), 5) for x, z in ARM_SERVO_POSTS],
        box((PIN_X - 42, side * 20, PIN_Z - 3), (x0 - 2, side * 40, PIN_Z + 3)),
        box((PIN_X + 5, side * 20, PIN_Z - 24), (PIN_X + 11, side * 40, PIN_Z - SERVO_W / 2 - 2)),
    )
    tools = [box((x0 - 0.2, side * 15, PIN_Z - SERVO_W / 2 - 0.2), (x1 + 0.2, side * 45, PIN_Z + SERVO_W / 2 + 0.2))]
    tools += [cyl((x, side * 25, z), (x, side * (CAP_IN + 1), z), 1.7) for x, z in ARM_SERVO_POSTS]
    return cut(body, *tools)


# --- arm and wheel (arm frame: pivot at the origin, arm hanging along -z) ------------------------------------------


def _slot(y0: float, y1: float, r: float):
    return fuse(cyl((0, y0, 0), (0, y1, 0), r), cyl((0, y0, -ARM_L), (0, y1, -ARM_L), r), box((-r, y0, -ARM_L), (r, y1, 0)))


ARM_BOSSES = [(0.0, -62.0), (0.0, -122.0), (28.0, 0.0), (-28.0, 0.0)]


def arm_inner(side: int):
    y0, ym = side * ARM_Y0, side * (ARM_Y0 + ARM_T / 2)
    body = fuse(_slot(y0, ym, ARM_W / 2), cyl((0, side * (GEAR_Y[0] - 0.5), 0), (0, side * (ARM_Y0 + 3), 0), BEARING_OD / 2 - 6))
    tools = [_slot(side * (ARM_Y0 + 3), side * (ARM_Y0 + ARM_T / 2 + 1), ARM_W / 2 - 4)]
    tools.append(cyl((0, side * 40, 0), (0, side * (ARM_Y0 + 4), 0), 9.5))  # hollow hub: motor + encoder leads
    body = cut(body, *tools)
    bosses = [cyl((x, side * (ARM_Y0 + 2), z), (x, ym, z), 4.5) for x, z in ARM_BOSSES]
    body = fuse(body, *bosses)
    holes = [cyl((x, side * (ARM_Y0 - 1), z), (x, side * (ARM_Y0 + ARM_T / 2 + 1), z), 1.7) for x, z in ARM_BOSSES]
    return cut(body, *holes)


def arm_outer(side: int):
    ym, y1 = side * (ARM_Y0 + ARM_T / 2), side * (ARM_Y0 + ARM_T)
    body = fuse(_slot(ym, y1, ARM_W / 2), cyl((0, y1, -ARM_L), (0, side * MOTOR_FACE, -ARM_L), MOTOR_R + 3))
    tools = [
        _slot(side * (ARM_Y0 + ARM_T / 2 - 1), side * (ARM_Y0 + ARM_T - 3), ARM_W / 2 - 4),
        cyl((0, ym, -ARM_L), (0, side * (MOTOR_FACE + 1), -ARM_L), MOTOR_R),
        box((-1, side * (ARM_Y0 + ARM_T + 5), -ARM_L + MOTOR_R - 1), (1, side * (MOTOR_FACE + 1), -ARM_L + MOTOR_R + 4)),  # clamp slit
    ]
    body = cut(body, *tools)
    body = fuse(body, *[cyl((x, ym, z), (x, side * (ARM_Y0 + ARM_T - 2), z), 4.5) for x, z in ARM_BOSSES])
    return cut(body, *[cyl((x, ym - side, z), (x, side * (ARM_Y0 + ARM_T / 2 + 8), z), 2.0) for x, z in ARM_BOSSES])


def wheel_rim(side: int):
    y0, y1 = side * WHEEL_Y0, side * WHEEL_Y1
    body = cyl((0, y0, -ARM_L), (0, y1, -ARM_L), RIM_R)
    tools = [cyl((0, side * (WHEEL_Y0 - 1), -ARM_L), (0, side * (WHEEL_Y1 - 4), -ARM_L), RIM_R - 4)]
    tools.append(cyl((0, side * (WHEEL_Y1 - 5), -ARM_L), (0, side * (WHEEL_Y1 + 1), -ARM_L), 3.5))
    for a in (45, 135, 225, 315):
        x, z = polar(POLOLU_HUB_PCD / 2, a)
        tools.append(cyl((x, side * (WHEEL_Y1 - 5), z - ARM_L), (x, side * (WHEEL_Y1 + 1), z - ARM_L), 1.7))
    for a in range(0, 360, 60):
        x, z = polar(46, a)
        tools.append(cyl((x, side * (WHEEL_Y1 - 5), z - ARM_L), (x, side * (WHEEL_Y1 + 1), z - ARM_L), 14))
    return cut(body, *tools)


def tire(side: int):
    y0, y1 = side * WHEEL_Y0, side * WHEEL_Y1
    body = cut(cyl((0, y0, -ARM_L), (0, y1, -ARM_L), WHEEL_R), cyl((0, y0 - side, -ARM_L), (0, y1 + side, -ARM_L), RIM_R - 0.5))
    grooves = []
    for i in range(36):
        g = box((-1.5, min(y0, y1) - 1, -WHEEL_R - 1), (1.5, max(y0, y1) + 1, -WHEEL_R + 2))
        grooves.append(g.moved(Pos(0, 0, -ARM_L) * rot_xz(i * 10)))
    return cut(body, *grooves)


def motor_ref(side: int):
    return fuse(
        cyl((0, side * (MOTOR_FACE - MOTOR_L), -ARM_L), (0, side * MOTOR_FACE, -ARM_L), MOTOR_D / 2),
        cyl((0, side * MOTOR_FACE, -ARM_L), (0, side * (MOTOR_FACE + 16), -ARM_L), 3),
    )
