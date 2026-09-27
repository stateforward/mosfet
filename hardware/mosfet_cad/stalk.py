"""Eye stalk: a closed-end helical compression spring (bought steel or printed) driven by three tendons.

Stalk frame: the base plate's underside is the origin, the stalk axis is +z. From the bottom up: the base plate
(bolts to the drum pedestal) with a seat cup that takes the spring's bottom end; the spring; the guide discs,
screwed onto the active coil a whole number of pitches apart, carrying the tendons 120 degrees apart and standing them
off the spring; the tip plate, whose seat cup takes the spring's top end and which the eye mount bolts to.

The spring's ends are closed (the last turn sits on the next one), so nothing can screw onto them. Each seat cup's
floor is a helical ramp cut by the dead turn itself (plus a clearance), stepped where the wire ends: the end drops in
from above, sits square on the ramp, and can't turn one way; the cup's wall centres it. The tendon preload holds both
ends in their cups. The discs screw onto the open-pitch active coil through a helical groove cut by the spring (plus
a clearance) and stay put without glue. The display lead runs up the middle of the spring.

Each tendon has its own worm-gear winch (`winch.py`): a spring shortens when a tendon pulls it, so an antagonistic
pair on one double pulley would go slack. Three at 120 degrees cover every bending direction, as in `sim/bot.py`. The
winches can't be back-driven, so the pretensioned tendons hold the stalk with no current; the spring is modelled
squeezed by that pretension (`StalkSpec.installed_z`).
"""

from __future__ import annotations

import math
from functools import cache

from build123d import Circle, Location, Plane, Polyline, Pos, Transition, Vector, sweep

from . import part as P
from .geom import cut, cyl, fuse, polar
from .params import SpringSpec, StalkSpec
from .part import Part

COIL_SEGMENTS = 24  # per turn: the coil is a polyline sweep (a true helical sweep won't boolean in OCCT)


def tendon_xy(s: StalkSpec):
    """One tendon straight back, two forward at +-60 degrees: mirror-symmetric, so both stalks use the same parts."""
    return [polar(s.tendon_r, 180 + i * 360 / s.tendons) for i in range(s.tendons)]


def bolt_xy(r: float, n: int = 3):
    return [polar(r, i * 360 / n) for i in range(n)]


def coil(sp: SpringSpec, z0: float, z1: float, r: float, zmap=None):
    """The coil's wire between spring-frame heights z0 and z1, swept at radius r (the wire, or a groove cutter).

    Spring frame: the spring's bottom end is z = 0; the wire centre rises from z = wire/2 at angle 0, one dead turn,
    the active coils, one dead turn (SpringSpec.wire_z). `zmap` moves each point of the free coil to where it sits
    installed (StalkSpec.installed_z); none leaves the coil free.
    """
    t0, t1 = sp.turn_at(z0), sp.turn_at(z1)
    rm = sp.mean_d / 2
    n = max(2, math.ceil((t1 - t0) * COIL_SEGMENTS))
    pts = []
    for i in range(n + 1):
        t = t0 + (t1 - t0) * i / n
        a = 2 * math.pi * t
        z = sp.wire_z(t)
        pts.append(Vector(rm * math.cos(a), rm * math.sin(a), zmap(z) if zmap else z))
    profile = Plane(origin=pts[0], z_dir=pts[1] - pts[0]) * Circle(r)
    return sweep(profile, path=Polyline(*pts), transition=Transition.ROUND).solids()[0]


def _gripped(s: StalkSpec, body, z0: float, z1: float, bore_z: tuple[float, float]):
    """Cut the coil groove through a disc spanning spring-frame z0..z1, then its bore.

    The groove goes first: OCCT fails on a bore face that sits exactly on the coil's centreline.
    """
    sp = s.spring
    body = cut(body, coil(sp, z0 - sp.pitch, z1 + sp.pitch, sp.wire / 2 + s.clearance))
    return cut(body, cyl((0, 0, bore_z[0]), (0, 0, bore_z[1]), sp.mean_d / 2 - 0.5))


def _seat(s: StalkSpec, body, bottom: bool):
    """Cut a seat cup for one closed end into `body` (spring frame): the dead turn's groove is the cup's helical floor,
    and everything above it (below it, at the top end) is open out to the coil's outside, so the end drops in."""
    sp, top = s.spring, s.spring.free_length
    r = sp.od / 2 + 0.3
    t0 = 0.0 if bottom else sp.turns - 1.1
    if bottom:
        body = cut(body, cyl((0, 0, sp.wire), (0, 0, s.collar_h + 1), r))
    else:
        body = cut(body, cyl((0, 0, top - s.collar_h - 1), (0, 0, top - sp.wire), r))
    # The dead turn's pitch is under the cutter's diameter, so a whole-turn sweep would overlap itself: cut it in
    # quarter turns, each overlapping the next.
    for k in range(5):
        a, b = t0 + k * 0.22, min(t0 + k * 0.22 + 0.25, t0 + 1.1)
        body = cut(body, coil(sp, sp.wire_z(a), sp.wire_z(b), sp.wire / 2 + s.clearance))
    return body


@cache
def spring(s: StalkSpec):
    """The spring in its own frame (bottom end at z = 0): installed, squeezed by the tendon pretension. A printed
    spring stays free, since its part is also its print file."""
    zmap = None if s.spring.printed else s.installed_z
    return coil(s.spring, 0, s.spring.free_length, s.spring.wire / 2, zmap)


@cache
def base(s: StalkSpec):
    """Base plate plus the bottom seat cup. Bolts to the pedestal with 3 x M3; PTFE tube sockets under the tendon holes.

    Base frame is the stalk frame: plate z 0..plate_t, the spring stands in the cup on it.
    """
    t, ch = s.plate_t, s.collar_h
    body = fuse(cyl((0, 0, 0), (0, 0, t), s.base_r), cyl((0, 0, t - 0.01), (0, 0, t + ch), s.collar_r))
    body = _seat(s, body.moved(Pos(0, 0, -t)), True).moved(Pos(0, 0, t))
    tools = [cyl((0, 0, -1), (0, 0, t + ch + 1), s.bore / 2)]
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
    """Top seat cup plus tip plate. Tendons knot in counterbores on top; 2 x M3 from below take the eye's chin.

    Own frame: the spring's top end is z = 0, the plate is z 0..plate_t.
    """
    sp, t, ch = s.spring, s.plate_t, s.collar_h
    top = sp.free_length
    body = fuse(cyl((0, 0, top - ch), (0, 0, top + 0.01), s.collar_r), cyl((0, 0, top), (0, 0, top + t), s.tip_r))
    body = _seat(s, body, False).moved(Pos(0, 0, -top))
    tools = [cyl((0, 0, -ch - 1), (0, 0, t + 1), s.bore / 2)]
    for x, y in tendon_xy(s):
        tools += [cyl((x, y, -1), (x, y, t + 1), s.tendon_hole / 2), cyl((x, y, t - 2.5), (x, y, t + 1), 1.5)]
    tools += [cyl((x, y, -1), (x, y, t + 1), 1.7) for x, y in s.tip_bolts]
    return cut(body, *tools)


def stalk_parts(s: StalkSpec, frame: Location, label: str = ""):
    """Base, spring, guide discs and tip, straight up the stalk frame. Returns (parts, tip-top frame)."""
    sp = s.spring
    at = frame * Pos(0, 0, s.plate_t)  # the spring's bottom end
    spring_part = Part(f"{label}stalk spring", spring(s), P.METAL, at, printed=sp.printed, material=sp.material)
    if not sp.printed:
        spring_part.name = f"REF {label}stalk spring ({sp.name})"
    parts = [Part(f"{label}stalk base", base(s), P.STALK, frame), spring_part]
    zmap = (lambda z: z) if sp.printed else s.installed_z
    g = guide(s)
    parts += [Part(f"{label}stalk guide {k + 1}", g, P.STALK, at * Pos(0, 0, zmap(z))) for k, z in enumerate(s.guide_z)]
    top = at * Pos(0, 0, zmap(sp.free_length))
    parts.append(Part(f"{label}stalk tip", tip(s), P.STALK, top))
    return parts, top * Pos(0, 0, s.plate_t)
