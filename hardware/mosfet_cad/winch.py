"""Tendon winches: six worm gearmotors (three per stalk) that wind the tendons, and the PTFE tubes to the stalks.

A worm gear can't be back-driven, so a winch holds its tendon with no current: the stalks keep their pose, and the
tendons their pretension, while every motor is off. Each winch is a 12 V JGY-370-class worm motor with a Hall
encoder, a 10 mm single-groove pulley on its D shaft, and a PTFE tube from the pulley to the stalk's pedestal.

Six of them don't fit as two three-motor pods (see hardware/README.md, Winches), so they sit where they fit:

- **Winch deck** (front of the drum, 4 winches): a plate standing across the drum at x = DECK_X, bolted to both end
  caps. The motors lie along y. Two columns, and in each column one left-stalk motor behind the plate (its gearbox at
  +y, shaft forward) and one right-stalk motor in front of it (gearbox at -y, shaft back). A motor's can and encoder
  run past the drum's middle, where the other stalk's motor has only its can too, so the two layers nest, and each
  pulley sits in the other layer's space at its own end. They drive the front tendons (+-60 degrees).
- **Back winches** (2, one per stalk): lying fore-aft over the arm servos, gearbox at the back, shaft outward, pulley
  at |y| 46 under the pedestal's line. They drive the back tendon (180 degrees).

Drum frame (body.py): x forward, y left, z up, origin on the drum axis at mid-length.
"""

from __future__ import annotations

from functools import cache

from build123d import Circle, FilletPolyline, Location, Plane, Pos, Rot, Transition, Vector, sweep

from . import part as P
from .geom import box, cut, cyl, fuse
from .params import CAP_T, DRUM_L, DRUM_R, PULLEY_R, SHELL, STALK, WINCH_MOTOR, StalkSpec, WormMotorSpec
from .part import Part
from .stalk import tendon_xy

M = WINCH_MOTOR
CAP_IN = DRUM_L / 2 - CAP_T  # end cap inner face, |y|
RI = DRUM_R - SHELL
PLATE_T = 4.0  # motor plates: the gearbox's output face bolts to one side (4 x M3), the pulley turns on the other
HEAD_GAP = 3.0  # plate to pulley: room for the M3 button heads under the flange
DISC_T = 6.0  # pulley: flange 1.5, groove 3, flange 1.5
HUB_L = 5.0
FLANGE_R = PULLEY_R + 2.5
TUBE_R = 2.0  # PTFE 2 x 4
SOCKET_R = 2.1

# --- winch deck ----------------------------------------------------------------------------------------------------
DECK_X = 62.0  # plate centre: the rear layer's backs clear the arm gears by 4.5, the front layer clears the shell
DECK_COLS = (-0.5, 33.5)  # column centres, z: the lower one 3.5 over the charge module, the upper under the top rail
DECK_Y = CAP_IN - 0.2
DECK_SHAFT_Y = CAP_IN - 1 - M.shaft_from_end  # |y| of the deck shafts: gearbox far ends 1 mm off the end caps
RAIL_T = 3.0
RAIL_X = (36.5, 91.0)
TOP_RAIL = DECK_COLS[1] + M.box_w / 2 + 0.5  # bottom of the top rail
BOTTOM_RAIL = DECK_COLS[0] - M.box_w / 2 - 0.5  # top of the bottom rail
FRONT_X = (88.0, 91.0)  # driver plate: the three TB67H420FTG carriers on its front
DECK_TABS = ((50.0, TOP_RAIL + RAIL_T + 5.5), (50.0, BOTTOM_RAIL - RAIL_T - 5.0))  # (x, z) of the end-cap bolts
DRIVER_BOARD = (30.5, 25.4, 5.0)  # Pololu TB67H420FTG carrier, 1.2 x 1.0 in, parts side
DRIVER_Y = (-34.0, 0.0, 34.0)
DRIVER_Z = 8.0  # board bottom edge

# --- back winches --------------------------------------------------------------------------------------------------
BACK_Z = 62.0  # motor centre height: gearbox 2.25 over the arm servo sleeve, can top clear of the pedestal
BACK_FAR_X = -80.5  # gearbox far end, x: its top corner is 2.8 inside the shell
BACK_FACE_Y = 36.0  # |y| of the output face: shaft outward, pulley groove at |y| 46
BACK_X = (-84.0, -36.0)  # plate
BACK_FLANGES = ((-88.0, -84.0), (-50.0, -44.0))  # x spans of the flanges that reach the end cap, behind and ahead of the pulley
BACK_TABS = ((-86.0, 62.0), (-47.0, 60.0))  # (x, z) of the end-cap bolts


def _frame(origin, shaft, x_dir) -> Location:
    """Motor frame in the drum: output face centre `origin`, shaft along `shaft`, gearbox width along `x_dir`."""
    return Location(Plane(origin=origin, x_dir=x_dir, z_dir=shaft))


def deck_motors() -> list[tuple[str, int, int, Location]]:
    """(label, side, column, frame) of the four deck winches: left ones behind the plate, right ones in front."""
    out = []
    for k, zc in enumerate(DECK_COLS):
        out.append(("L", 1, k, _frame((DECK_X - PLATE_T / 2, DECK_SHAFT_Y, zc), (1, 0, 0), (0, 0, 1))))
        out.append(("R", -1, k, _frame((DECK_X + PLATE_T / 2, -DECK_SHAFT_Y, zc), (-1, 0, 0), (0, 0, 1))))
    return out


def back_motor(side: int) -> Location:
    x = BACK_FAR_X + M.shaft_from_end
    return _frame((x, side * BACK_FACE_Y, BACK_Z), (0, side, 0), (0, 0, side))


# --- bought parts and pulleys (motor frame) ------------------------------------------------------------------------


@cache
def motor_ref(m: WormMotorSpec = M):
    """The gearmotor: gearbox, output boss and D shaft, can, encoder. UNVERIFIED shape, see params.WINCH_MOTOR."""
    y0 = -m.shaft_from_end
    y1 = y0 + m.box_l
    body = box((-m.box_w / 2, y0, -m.box_t), (m.box_w / 2, y1, 0))
    boss = cyl((0, 0, -0.1), (0, 0, 1.0), 6.0)
    shaft = cyl((0, 0, 0), (0, 0, m.shaft_l), m.shaft_d / 2) & box((-4, -4, -1), (m.shaft_d / 2 - 0.5, 4, m.shaft_l + 1))
    can = cyl((0, y1 - 0.1, m.can_z), (0, y1 + m.can_l, m.can_z), m.can_d / 2)
    enc = cyl((0, y1 + m.can_l - 0.1, m.can_z), (0, y1 + m.can_l + m.enc_l, m.can_z), m.enc_d / 2)
    return fuse(body, boss, shaft, can, enc)


@cache
def pulley():
    """Single-groove winch pulley: disc z 0..6 (groove radius PULLEY_R), hub z 6..11 with an M3 set screw on the
    shaft's flat, D bore, and a cross hole through the groove to knot the tendon."""
    t, fl = DISC_T, FLANGE_R
    body = fuse(
        cyl((0, 0, 0), (0, 0, 1.5), fl),
        cyl((0, 0, 1.5), (0, 0, t - 1.5), PULLEY_R),
        cyl((0, 0, t - 1.5), (0, 0, t), fl),
        cyl((0, 0, t - 0.01), (0, 0, t + HUB_L), 6.0),
    )
    r = M.shaft_d / 2 + 0.1
    bore = cyl((0, 0, -1), (0, 0, t + HUB_L + 1), r) & box((-r - 1, -r - 1, -2), (r - 0.5, r + 1, t + HUB_L + 2))
    tools = [
        bore,
        cyl((r - 1, 0, t + HUB_L / 2), (7, 0, t + HUB_L / 2), 1.25),  # M3 set screw, thread-forming, onto the flat
        cyl((0, -fl - 1, t / 2), (0, fl + 1, t / 2), 0.9),  # tendon anchor
    ]
    return cut(body, *tools)


def pulley_on(frame: Location, hub_in: bool) -> Location:
    """Where a pulley sits on a motor: disc first (hub out) or hub first (hub in), HEAD_GAP past the plate."""
    d0 = PLATE_T + HEAD_GAP
    return frame * (Pos(0, 0, d0 + DISC_T + HUB_L) * Rot(180, 0, 0) if hub_in else Pos(0, 0, d0))


def groove_offset(hub_in: bool) -> float:
    """Groove centre past the motor's output face."""
    d0 = PLATE_T + HEAD_GAP
    return d0 + (HUB_L + DISC_T / 2 if hub_in else DISC_T / 2)


def _plate_tools(frame: Location, m: WormMotorSpec = M):
    """Holes a motor needs in the plate on its output face: shaft and boss, 4 x M3, and a window for the can, whose
    round side stands 1.45 proud of the output face (can centred on the gearbox: UNVERIFIED)."""
    y0 = -m.shaft_from_end
    t = [cyl((0, 0, -1), (0, 0, PLATE_T + 1), 6.5)]
    t += [cyl((x, y0 + y, -1), (x, y0 + y, PLATE_T + 1), 1.7) for x, y in m.holes]
    y1 = y0 + m.box_l
    t.append(box((-6.5, y1 - 1, -1), (6.5, y1 + m.can_l + m.enc_l + 1, 2.0)))
    return [s.moved(frame) for s in t]


# --- printed parts (drum frame) ------------------------------------------------------------------------------------


def _shell_clip(parts_shape, r: float = RI - 1.5):
    """Keep a part inside the drum's bore, 1.5 mm off the shell."""
    return parts_shape & cyl((0, -DRUM_L, 0), (0, DRUM_L, 0), r)


@cache
def deck():
    """The winch deck: a plate across the drum with four motors on it, top and bottom rails, the driver plate in front,
    and end tabs that bolt to both end caps. The top rail has the four PTFE sockets over the tendons' exits."""
    x0, x1 = DECK_X - PLATE_T / 2, DECK_X + PLATE_T / 2
    zb, zt = BOTTOM_RAIL, TOP_RAIL
    parts = [
        box((x0, -DECK_Y, zb - RAIL_T), (x1, DECK_Y, zt + RAIL_T)),
        box((RAIL_X[0], -DECK_Y, zt), (RAIL_X[1], DECK_Y, zt + RAIL_T)),
        box((RAIL_X[0], -DECK_Y, zb - RAIL_T), (RAIL_X[1], DECK_Y, zb)),
        box((FRONT_X[0], -DECK_Y, zb - RAIL_T), (FRONT_X[1], DECK_Y, zt + RAIL_T)),
    ]
    for s in (1, -1):
        for x, z in DECK_TABS:
            z0, z1 = (zt + RAIL_T - 0.01, z + 5) if z > 0 else (z - 5, zb - RAIL_T + 0.01)
            parts.append(box((x - 6, s * (DECK_Y - 3), z0), (x + 6, s * DECK_Y, z1)))
    tools = []
    for _, _, _, f in deck_motors():
        tools += _plate_tools(f)
    for x, y in deck_exits():
        tools.append(cyl((x, y, zt - 1), (x, y, zt + RAIL_T + 1), SOCKET_R))
    for s in (1, -1):
        for x, z in DECK_TABS:
            tools.append(cyl((x, s * (DECK_Y - 4), z), (x, s * (DECK_Y + 1), z), 1.7))
    for y in DRIVER_Y:  # M2.5 standoffs for the driver carriers
        for dy in (-12.0, 12.0):
            for dz in (3.0, DRIVER_BOARD[1] - 3):
                tools.append(cyl((FRONT_X[0] - 1, y + dy, DRIVER_Z + dz), (FRONT_X[1] + 1, y + dy, DRIVER_Z + dz), 1.4))
    return _shell_clip(cut(fuse(*parts), *tools))


@cache
def back_bracket(side: int):
    """A back winch's plate, with a flange behind and one ahead of the pulley that bolt to the end cap, and a PTFE
    socket on the front flange where the tendon leaves the pulley's top."""
    s = side
    f0, f1 = s * BACK_FACE_Y, s * (BACK_FACE_Y + PLATE_T)
    z0, z1 = BACK_Z - M.box_w / 2 - 1.5, BACK_Z + M.box_w / 2 + 1.5
    parts = [box((BACK_X[0], f0, z0), (BACK_X[1], f1, z1))]
    for fx0, fx1 in BACK_FLANGES:
        parts.append(box((fx0, f0, BACK_Z - 12), (fx1, s * DECK_Y, BACK_Z + 8)))
    _, gy, gz = back_exit(side)
    parts.append(box((BACK_FLANGES[1][0], gy - 4, BACK_Z + 7.99), (BACK_FLANGES[1][1], gy + 4, gz + 4.5)))
    tools = _plate_tools(back_motor(side))
    tools.append(cyl((BACK_FLANGES[1][0] - 1, gy, gz), (BACK_FLANGES[1][1] + 1, gy, gz), SOCKET_R))
    for x, z in BACK_TABS:
        tools.append(cyl((x, s * (DECK_Y - 4), z), (x, s * (DECK_Y + 1), z), 1.7))
    return _shell_clip(cut(fuse(*parts), *tools))


BENCH_COLS = (-36.0, 0.0, 36.0)
BENCH_FOOT = 4.0


def bench_motors() -> list[Location]:
    """Kit stand: three motors side by side behind an upright plate, cans up, shafts forward."""
    z = BENCH_FOOT + 2 + M.shaft_from_end
    return [_frame((0, y, z), (1, 0, 0), (0, 1, 0)) for y in BENCH_COLS]


@cache
def bench_stand():
    """Upright plate on a foot, for the spring-stalk test kit: three winches on the bench, pulleys in front."""
    parts = [
        box((0, -56, 0), (PLATE_T, 56, 52)),
        box((-30, -56, 0), (26, 56, BENCH_FOOT)),
    ]
    tools = []
    for f in bench_motors():
        tools += _plate_tools(f)
    tools += [cyl((x, y, -1), (x, y, BENCH_FOOT + 1), 2.2) for x in (-24.0, 20.0) for y in (-50.0, 50.0)]
    return cut(fuse(*parts), *tools)


# --- tendon exits and PTFE tubes -----------------------------------------------------------------------------------


def _deck_hub_in(col: int) -> bool:
    """Stagger the pulleys: the lower one's tendon rises past the upper pulley's hub, not its disc."""
    return col == 1


def _exit_side(col: int) -> int:
    """Lower pulleys pay out on their outer side (toward the end cap), upper ones on their inner side."""
    return 1 if col == 0 else -1


def deck_exits() -> list[tuple[float, float]]:
    """(x, y) where each deck tendon leaves its pulley going up, in deck_motors() order."""
    out = []
    for _, side, col, f in deck_motors():
        g = f * Pos(0, 0, groove_offset(_deck_hub_in(col)))
        out.append((g.position.X, side * (DECK_SHAFT_Y + _exit_side(col) * PULLEY_R)))
    return out


def back_exit(side: int) -> tuple[float, float, float]:
    """Where the back tendon leaves its pulley's top, heading forward (x, y, z)."""
    g = back_motor(side) * Pos(0, 0, groove_offset(False))
    return g.position.X, g.position.Y, BACK_Z + PULLEY_R


TUBE_BEND_R = 15.0  # PTFE 2 x 4 bends no tighter than this (UNVERIFIED: check it doesn't kink)
FRONT_TUBE_Z = (68.0, 74.0)  # front tubes: rise to the first height, run back and up to the second, under the hole


def _tube(points):
    """A tube along straight runs joined by TUBE_BEND_R bends: its turning is just the corners' angles."""
    path = FilletPolyline(*[Vector(*p) for p in points], radius=TUBE_BEND_R)
    profile = Plane(origin=path @ 0, z_dir=path % 0) * Circle(TUBE_R)
    return sweep(profile, path=path, transition=Transition.ROUND).solids()[0], path


def _hole_axis(root: Location, tx: float, ty: float, z: float):
    """The pedestal's tube bore (tendon hole at tx, ty) as a line: its top end, and the point on it at height z."""
    end = (root * Pos(tx, ty, -2)).position
    up = (root * Pos(tx, ty, -1)).position - end
    return end, end + up * ((z - end.Z) / up.Z)


def tube_runs(stalk_root, s: StalkSpec = STALK):
    """Every PTFE tube, from its winch's socket to its pedestal bore: [(label, solid, path)].

    `stalk_root(side)` is the stalk's root frame on the crown (body.stalk_root). Tendon k of tendon_xy(): 0 is the back
    one, 1 and 2 the front ones at -60 and +60 degrees (root-frame y negative / positive). A front tube rises out of
    the deck's top rail, runs back and slightly up, and turns up into the pedestal; a back tube leaves its socket
    forward and turns up into the pedestal.
    """
    txy = tendon_xy(s)
    runs = []
    for (tag, side, col, _), (x, y) in zip(deck_motors(), deck_exits()):
        # lower deck winch -> the front tendon toward the end cap, upper -> the one toward the middle
        tx, ty = txy[2 if (side > 0) == (col == 0) else 1]
        end, under = _hole_axis(stalk_root(side), tx, ty, FRONT_TUBE_Z[1])
        pts = [(x, y, TOP_RAIL + 0.5), (x, y, FRONT_TUBE_Z[0]), tuple(under), tuple(end)]
        solid, path = _tube(pts)
        runs.append((f"{tag} front tendon {col + 1}", solid, path))
    for side in (1, -1):
        tag = "L" if side > 0 else "R"
        _, gy, gz = back_exit(side)
        tx, ty = txy[0]
        end, under = _hole_axis(stalk_root(side), tx, ty, gz)
        solid, path = _tube([(BACK_FLANGES[1][0] + 0.5, gy, gz), (BACK_FLANGES[1][1] + 1.5, gy, gz), tuple(under), tuple(end)])
        runs.append((f"{tag} back tendon", solid, path))
    return runs


def tube_turn_deg(path, n: int = 200) -> float:
    """Total turning of a tube along its length, degrees: the tendon's capstan angle in it."""
    import math

    total, prev = 0.0, path % 0
    for i in range(1, n + 1):
        d = path % (i / n)
        c = max(-1.0, min(1.0, prev.dot(d)))
        total += math.degrees(math.acos(c))
        prev = d
    return total


# --- assemblies ----------------------------------------------------------------------------------------------------


def winch_parts(stalk_root, refs: bool = True) -> list[Part]:
    """The deck, the back brackets, six pulleys, and (refs) the motors, driver carriers and PTFE tubes."""
    # on its end: the plate, the rails and the driver plate all stand up, so nothing overhangs
    parts = [Part("winch deck", deck(), P.INNER, print_pose=Rot(90, 0, 0))]
    pul = pulley()
    for tag, side, col, f in deck_motors():
        name = f"{tag} front winch {col + 1}"
        parts.append(Part(f"{tag} winch pulley {col + 1}", pul, P.STALK, pulley_on(f, _deck_hub_in(col))))
        if refs:
            parts.append(Part(f"REF {name} ({M.name})", motor_ref(), P.REF, f, printed=False))
    for side in (1, -1):
        tag = "L" if side > 0 else "R"
        f = back_motor(side)
        parts.append(Part(f"back winch bracket {tag}", back_bracket(side), P.INNER, print_pose=Rot(side * 90, 0, 0)))
        parts.append(Part(f"{tag} winch pulley 3", pul, P.STALK, pulley_on(f, False)))
        if refs:
            parts.append(Part(f"REF {tag} back winch ({M.name})", motor_ref(), P.REF, f, printed=False))
    if refs:
        bw, bh, bt = DRIVER_BOARD
        for i, y in enumerate(DRIVER_Y):
            board = box((FRONT_X[1] + 3, y - bw / 2, DRIVER_Z), (FRONT_X[1] + 3 + bt, y + bw / 2, DRIVER_Z + bh))
            parts.append(Part(f"REF TB67H420FTG dual driver {i + 1}", board, P.REF, printed=False))
        for label, solid, _ in tube_runs(stalk_root):
            parts.append(Part(f"REF PTFE tube {label}", solid, (0.92, 0.92, 0.95), printed=False))
    return parts


def bench_parts(frame: Location, refs: bool = True) -> list[Part]:
    parts = [Part("bench winch stand", bench_stand(), P.INNER, frame)]
    pul = pulley()
    for i, f in enumerate(bench_motors()):
        parts.append(Part(f"bench winch pulley {i + 1}", pul, P.STALK, frame * pulley_on(f, False)))
        if refs:
            parts.append(Part(f"REF bench winch {i + 1} ({M.name})", motor_ref(), P.REF, frame * f, printed=False))
    return parts
