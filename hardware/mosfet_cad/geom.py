"""Small solid-modelling helpers on top of build123d.

Every length is millimetres. Frames follow the sim: x forward, y left, z up.
"""

from __future__ import annotations

import math
from functools import reduce

from build123d import Location, Plane, Pos, Rot, Shape, Solid, Vector


def cyl(p0, p1, r: float) -> Solid:
    """Cylinder of radius r from point p0 to point p1."""
    a, b = Vector(*p0), Vector(*p1)
    d = b - a
    return Solid.make_cylinder(r, d.length, Plane(origin=a, z_dir=d))


def cone(p0, p1, r0: float, r1: float) -> Solid:
    """Truncated cone from p0 (radius r0) to p1 (radius r1)."""
    a, b = Vector(*p0), Vector(*p1)
    d = b - a
    return Solid.make_cone(r0, r1, d.length, Plane(origin=a, z_dir=d))


def sph(c, r: float) -> Solid:
    return Pos(*c) * Solid.make_sphere(r)


def box(c1, c2) -> Solid:
    """Axis-aligned box between two opposite corners."""
    lo = [min(a, b) for a, b in zip(c1, c2)]
    hi = [max(a, b) for a, b in zip(c1, c2)]
    return Solid.make_box(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], Plane(origin=lo))


def fuse(*shapes: Shape) -> Shape:
    shapes = [s for s in shapes if s is not None]
    return reduce(lambda a, b: a.fuse(b), shapes[1:], shapes[0]).clean()


def cut(target: Shape, *tools: Shape) -> Shape:
    tools = [t for t in tools if t is not None]
    return target.cut(*tools).clean() if tools else target


def about(point, axis: str, deg: float) -> Location:
    """Rotation by deg about an axis ('x', 'y' or 'z') through point."""
    r = {"x": Rot(deg, 0, 0), "y": Rot(0, deg, 0), "z": Rot(0, 0, deg)}[axis]
    return Pos(*point) * r * Pos(*(-c for c in point))


def rot_xz(deg: float) -> Location:
    """Rotate in the x-z plane by deg, measured from +x toward +z (nose-up is positive)."""
    return Rot(0, -deg, 0)


def polar(r: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return r * math.cos(a), r * math.sin(a)


def ys(side: int, *values: float) -> tuple[float, ...]:
    """Mirror y values to one side (+1 left, -1 right)."""
    return tuple(side * v for v in values)
