"""Drum, end caps, internal structure, arms, wheels, skid.

Drum frame: origin on the drum axis at mid-length, x forward, y left (the drum axis), z up. Side +1 is left.
"""

from __future__ import annotations

import math

from build123d import Face, Location, Pos, Rot, Solid, Vector, Wire

from .geom import box, cut, cyl, fuse, polar, rot_xz
from .params import (
    ARM_L,
    ARM_PIVOT,
    ARM_T,
    ARM_W,
    ARM_Y0,
    BATTERY,
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
    STALK,
    STALK_SPLAY,
    STALK_SPREAD,
    WHEEL_R,
    WHEEL_W,
)
from .stalk import POD_FLANGE, POD_FLANGE_HOLES, POD_TOP, bolt_xy, pod_size, tendon_xy

RI = DRUM_R - SHELL  # drum inner radius
CAP_IN = DRUM_L / 2 - CAP_T  # end cap inner face, |y|
GEAR_M = 2.0
GEAR_N, PINION_N = 32, 16  # 2:1 arm reduction
GEAR_Y = (44.5, 52.5)  # gear plane, |y|, just inside the bearing boss
PINION_DEG = 200.0  # pinion centre direction from the pivot, xz-angle
CENTRE_DIST = GEAR_M * (GEAR_N + PINION_N) / 2 + 0.5  # + printed-gear backlash
PIN_X = CENTRE_DIST * math.cos(math.radians(PINION_DEG))
PIN_Z = ARM_PIVOT + CENTRE_DIST * math.sin(math.radians(PINION_DEG))

JETSON_X0 = -65.0  # carrier board back edge, x
# The tray sits on the battery: its bottom 2 mm over the pack's wrap. Everything on it moved up 27 mm for the 4S6P pack,
# as far as the shelf can go: the Jetson's heatsink 8 mm under the shelf, the shelf 0.9 mm under the arm servo mounts.
TRAY_Z = (-43.0, -39.0)
TRAY_X = (-67.0, 103.0)
TRAY_TABS = (-40.0, 25.0)  # x of the tabs that bolt the tray to the end caps
TAB_Z = TRAY_Z[1] + 9  # tab bolt height
# Stalk servo pod, left side: (x, y, bottom z). Three servos side by side along x, low and forward: clear of the
# arm gear and bearing boss above it, the shelf behind it and the regulators and tray tabs below it. Its flange
# sits on the end cap's inner face.
POD_CENTRE = (67.0, CAP_IN - POD_FLANGE - pod_size(STALK.tendons)[3], -20.0)

MOTOR_R = MOTOR_D / 2 + 0.2  # clamp bore
MOTOR_FACE = ARM_Y0 + ARM_T + 56  # gearbox face, |y|: the motor sits in a sleeve inside the wheel
WHEEL_Y0 = ARM_Y0 + ARM_T + 1  # wheel inner face, |y|
WHEEL_Y1 = WHEEL_Y0 + WHEEL_W
RIM_R = WHEEL_R - 8  # TPU tyre 8 mm thick

# Driver mount: an upright plate behind the Jetson, bolted to both end caps. The MDD10A hangs on its back face, the
# bus-servo adapter on its front face.
DRIVER_X = (-70.0, -67.0)
DRIVER_Z = (-50.0, 12.0)
DRIVER_BOLTS = (-40.0, 0.0)  # z of the end-cap bolts


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


def stalk_root(side: int) -> Location:
    """A stalk's root frame: on the crown straight above the drum axis (x = 0), splayed outward about x only."""
    return Pos(0, side * STALK_SPREAD, BOSS_Z) * Rot(-side * STALK_SPLAY, 0, 0)


def shell_upper():
    """Top half of the drum, with the two stalk pedestals on the crown, straight above the drum axis."""
    bosses = [cyl((0, 0, -35), (0, 0, 0), STALK.base_r).moved(stalk_root(s)) for s in (1, -1)]
    body = fuse(_half_tube(True), *bosses)
    tools = [cyl((0, -DRUM_L, 0), (0, DRUM_L, 0), RI)]
    tools += _cap_screw_holes((30, 150), 1.7)
    for s in (1, -1):
        local = [cyl((0, 0, -45), (0, 0, 1), STALK.bore / 2 + 0.5)]  # display lead
        local += [cyl((x, y, -45), (x, y, 1), 2.1) for x, y in tendon_xy(STALK)]  # PTFE tube
        local += [cyl((x, y, -8), (x, y, 1), 2.0) for x, y in bolt_xy(STALK.bolt_r)]  # M3 insert
        tools += [t.moved(stalk_root(s)) for t in local]
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

    tools += [insert(x, TAB_Z) for x in TRAY_TABS]  # tray tabs
    tools += [insert(sum(DRIVER_X) / 2, z) for z in DRIVER_BOLTS]  # driver mount
    tools += [insert(POD_CENTRE[0] + dx, POD_CENTRE[2] + POD_TOP / 2) for dx in POD_FLANGE_HOLES]  # stalk pod
    tools += [insert(*p) for p in ARM_SERVO_POSTS]  # arm servo mount
    return cut(body, *tools)


# --- internal structure --------------------------------------------------------------------------------------------


def jetson_holes():
    by = JETSON_BOARD[1]
    hx, hy = JETSON_HOLES
    x0, y0 = JETSON_X0 + JETSON_HOLE_INSET, by / 2 - JETSON_HOLE_INSET
    return [(x0, y0), (x0 + hx, y0), (x0, y0 - hy), (x0 + hx, y0 - hy)]


SHELF_Z = (9.0, 12.0)
# Shelf posts stand outside the Jetson board (|y| 45), clear of the arm gears above them. Between the front and back
# posts, the band |y| 38-58 from the arm hubs down to the tray stays open for the motor leads (and arm packs, later).
SHELF_POSTS = [(-22.0, 45.0), (-22.0, -45.0), (18.0, 45.0), (18.0, -45.0)]
PACK_LEAD_SLOT = ((88.0, -40.0), (100.0, -16.0))  # tray slot over the lead bay in front of the pack


def tray():
    z0, z1 = TRAY_Z
    parts = [box((TRAY_X[0], -CAP_IN + 3, z0), (TRAY_X[1], CAP_IN - 3, z1))]
    for s in (1, -1):
        for x in TRAY_TABS:
            parts.append(box((x - 10, s * (CAP_IN - 9), z1), (x + 10, s * (CAP_IN - 3), z1 + 18)))
    parts += [cyl((x, y, z1), (x, y, z1 + 5), 4) for x, y in jetson_holes()]
    tools = []
    for s in (1, -1):
        for x in TRAY_TABS:
            tools.append(cyl((x, s * (CAP_IN - 12), TAB_Z), (x, s * (CAP_IN + 1), TAB_Z), 1.7))
    tools += [cyl((x, y, z1 + 1), (x, y, z1 + 6), 1.8) for x, y in jetson_holes()]  # M2.5 inserts
    tools += [cyl((x, y, z0 - 1), (x, y, z1 + 1), 1.7) for x, y in SHELF_POSTS]
    (sx0, sy0), (sx1, sy1) = PACK_LEAD_SLOT
    tools.append(box((sx0, sy0, z0 - 1), (sx1, sy1, z1 + 1)))
    return cut(fuse(*parts), *tools)


def shelf():
    """Electronics shelf over the Jetson: Teensy 4.1 and the BNO085 on the drum axis."""
    z0, z1 = SHELF_Z
    plate = box((-31, -38, z0), (22, 38, z1))  # the arm servo mounts' lower posts come down behind it
    ears = []
    for x, y in SHELF_POSTS:
        ears.append(cyl((x, y, TRAY_Z[1]), (x, y, z1), 5.5))
        ears.append(box((x - 5.5, min(y, math.copysign(36, y)), z0), (x + 5.5, max(y, math.copysign(36, y)), z1)))
    tools = [cyl((x, y, TRAY_Z[1] - 1), (x, y, TRAY_Z[1] + 8), 2.0) for x, y in SHELF_POSTS]
    return cut(fuse(plate, *ears), *tools)


def cradle(beta: float):
    """Curved trough on the drum's bottom that holds the 4S pack: it follows the shell, and the cells' nested layers
    step up it. The tray above is the lid. The two skid screws come up through the shell into it (thread-forming M3),
    which locates it, and a groove in its underside carries the charge-pad wires along y to the ends of the drum.
    """
    P = BATTERY
    clr = P.wrap + 0.3
    yw = P.width / 2 + clr
    wall = 2.0
    top = P.top + P.wrap
    xs = [P.layer_box(k)[:2] for k in range(len(P.layers))]
    x_back, x_front = min(x[0] for x in xs) - clr - wall, max(x[1] for x in xs) + clr + wall
    shell = cyl((0, -yw - wall, 0), (0, yw + wall, 0), RI - 0.2)
    body = shell & box((x_back, -yw - wall, -DRUM_R), (x_front, yw + wall, top))
    tools = []
    for k in range(len(P.layers)):
        x0, x1, zb, _ = P.layer_box(k)
        tools.append(box((x0 - clr, -yw, zb - clr), (x1 + clr, yw, top + 1)))  # open upward: the pack drops in
    tools.append(box((x_back - 1, -yw - wall - 1, DRIVER_Z[0] - 1), (DRIVER_X[1] + 0.5, yw + wall + 1, top + 1)))  # MDD10A
    tools.append(box((x_front - 4, -40, top - 20), (x_front + 1, -16, top + 1)))  # pack leads out to the lead bay
    for y in (-48.0, 48.0):  # skid screws
        tools.append(_radial(beta, y, RI - 7, DRUM_R + 1, 1.25))
    r = RI - 0.2
    groove = box((-2.0, -yw - wall - 1, -r - 1), (2.0, yw + wall + 1, -r + 2.5))  # pad wires, along y
    tools.append(groove.moved(rot_xz(beta + 90)))
    return cut(body, *tools)


def driver_mount():
    """Upright plate behind the Jetson, bolted to both end caps. The Cytron MDD10A hangs on its back face (M3
    standoffs, pattern to suit the board), the bus-servo adapter on its front face."""
    (x0, x1), (z0, z1) = DRIVER_X, DRIVER_Z
    xm = (x0 + x1) / 2
    parts = [box((x0, -CAP_IN + 5, z0), (x1, CAP_IN - 5, z1))]
    for s in (1, -1):
        for z in DRIVER_BOLTS:
            parts.append(box((x0 - 4, s * (CAP_IN - 8), z - 6), (x1, s * CAP_IN, z + 6)))
    tools = [cyl((xm, s * (CAP_IN - 12), z), (xm, s * (CAP_IN + 1), z), 1.7) for s in (1, -1) for z in DRIVER_BOLTS]
    tools += [cyl((x0 - 1, y, z), (x1 + 1, y, z), 1.6) for y in (-38, 38) for z in (z0 + 4, z1 - 4)]  # MDD10A
    tools += [cyl((x0 - 1, y, z), (x1 + 1, y, z), 1.6) for y in (28, 55) for z in (-27, -3)]  # bus-servo adapter
    return cut(fuse(*parts), *tools)


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


# The lower post sits behind the servo, clear of the Jetson's heatsink and the shelf under it.
ARM_SERVO_POSTS = [(PIN_X - 42, PIN_Z), (PIN_X - 12, PIN_Z - 21)]


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
        box((PIN_X - 15, side * 20, PIN_Z - 21), (PIN_X - 9, side * 40, PIN_Z - SERVO_W / 2 - 2)),
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
