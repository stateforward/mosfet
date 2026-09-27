"""Eye: a round colour display (Waveshare ESP32-P4 3.4" round, Ø115) in a printed bezel, camera bump on the rim.

Eye frame: the mount face (the stalk tip's top) is the origin, the post rises along +z, the display faces +x.
Two printed parts: the bezel (front ring with a retaining lip, the camera bump and 4 ears with M3 inserts) and
the back (a cover disc and the post that bolts to the stalk tip with 4 x M3). The display drops in from behind.
"""

from __future__ import annotations

from functools import cache

from build123d import Location, Rot

from . import part as P
from .geom import about, box, cut, cyl, fuse
from .params import EyeSpec
from .part import Part

EAR_DEG = (60.0, -60.0, 135.0, -135.0)
XB = 14.0  # back face of the bezel, x (the post, radius 14, sits behind it)


def _on_rim(e: EyeSpec, deg: float) -> Location:
    """Rotate something built at the top of the rim to angle deg (0 top, positive toward +y)."""
    return about((0, 0, e.centre_z), "x", -deg)


@cache
def bezel(e: EyeSpec, side: int = 1):
    zc, re_, xf = e.centre_z, e.rim_r, XB + e.depth + e.wall
    cam = _on_rim(e, side * e.cam_deg)
    bump = cyl((XB, 0, zc + e.bump_r), (xf + 3, 0, zc + e.bump_r), 9).moved(cam)
    ears = [cyl((XB, 0, zc + re_ + 1), (XB + 8, 0, zc + re_ + 1), 5).moved(_on_rim(e, d)) for d in EAR_DEG]
    body = fuse(cyl((XB, 0, zc), (xf, 0, zc), re_), bump, *ears)
    cz = zc + e.bump_r
    tools = [
        cyl((XB - 1, 0, zc), (XB + e.depth, 0, zc), e.pocket_r),  # display pocket
        cyl((XB + e.depth - 1, 0, zc), (xf + 1, 0, zc), e.glass_d / 2 - e.lip),  # window
        cyl((xf - 4, 0, cz), (xf + 4, 0, cz), 3.5).moved(cam),  # lens
        box((XB + 2, -e.cam_w / 2, cz - e.cam_w / 2), (xf + 1, e.cam_w / 2, cz + e.cam_w / 2)).moved(cam),
        box((XB + 2, -5.5, cz - 20), (XB + 12, 5.5, cz)).moved(cam),  # flex path behind the glass
    ]
    tools += [cyl((XB - 1, 0, zc + re_ + 1), (XB + 7, 0, zc + re_ + 1), 2.0).moved(_on_rim(e, d)) for d in EAR_DEG]
    return cut(body, *tools)


@cache
def back(e: EyeSpec):
    zc, re_ = e.centre_z, e.rim_r
    top = zc - re_ / 2
    ears = [cyl((XB - e.back_t, 0, zc + re_ + 1), (XB, 0, zc + re_ + 1), 5).moved(_on_rim(e, d)) for d in EAR_DEG]
    body = fuse(cyl((XB - e.back_t, 0, zc), (XB, 0, zc), re_), cyl((0, 0, 0), (0, 0, top), e.post_r), *ears)
    tools = [
        cyl((0, 0, -1), (0, 0, top - 6), 5),  # lead up the post...
        cyl((-1, 0, top - 11), (XB + 1, 0, top - 11), 5),  # ...and into the eye
    ]
    for i in range(4):
        a = Rot(0, 0, 45 + i * 90)
        tools.append(cyl((9, 0, -1), (9, 0, top + 1), 1.7).moved(a))
        tools.append(cyl((9, 0, 6), (9, 0, top + 1), 3.2).moved(a))  # screw-head counterbore, open at the top
    tools += [cyl((XB - 5, 0, zc + re_ + 1), (XB + 1, 0, zc + re_ + 1), 1.7).moved(_on_rim(e, d)) for d in EAR_DEG]
    return cut(body, *tools)


@cache
def glass(e: EyeSpec):
    return cyl((XB + e.depth - 2, 0, e.centre_z), (XB + e.depth, 0, e.centre_z), e.glass_d / 2)


def eye_parts(e: EyeSpec, frame: Location, side: int = 1, label: str = "", refs: bool = True):
    parts = [
        Part(f"{label}eye bezel", bezel(e, side), P.EYE, frame, print_pose=Rot(0, 90, 0)),  # front face down
        Part(f"{label}eye back", back(e), P.EYE, frame),
    ]
    if refs:
        parts.append(Part(f"REF {label}round display", glass(e), P.GLASS, frame, printed=False))
    return parts
