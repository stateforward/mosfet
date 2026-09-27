"""Eye: a round colour display (Waveshare ESP32-P4 3.4" round, Ø115) in a printed bezel, camera bump on the rim.

Eye frame: the stalk's tip-plate top is the origin, the stalk axis is +z, the display faces +x. The screen stands on
the stalk: its centre sits on the axis (x = 0, y = 0), `centre_z` above the tip, and the stalk meets the eye at the
bottom of its rim (6 o'clock). Two printed parts: the bezel (front ring with a retaining lip, the camera bump, 4 ears
with M3 inserts, and a chin lug at 6 o'clock that sits on the tip plate and takes 2 x M3 from below) and the back
cover. The display drops in from behind; its lead comes up the stalk and in through the chin.
"""

from __future__ import annotations

from functools import cache

from build123d import Location, Rot

from . import part as P
from .geom import about, box, cut, cyl, fuse
from .params import EyeSpec, StalkSpec

EAR_DEG = (60.0, -60.0, 135.0, -135.0)


def _on_rim(e: EyeSpec, deg: float) -> Location:
    """Rotate something built at the top of the rim to angle deg (0 top, positive toward +y)."""
    return about((0, 0, e.centre_z), "x", -deg)


@cache
def bezel(e: EyeSpec, s: StalkSpec, side: int = 1):
    xb, zc, re_ = e.back_x, e.centre_z, e.rim_r
    xf = xb + e.depth + e.wall
    cam = _on_rim(e, side * e.cam_deg)
    bump = cyl((xb, 0, zc + e.bump_r), (xf + 3, 0, zc + e.bump_r), 9).moved(cam)
    ears = [cyl((xb, 0, zc + re_ + 1), (xb + 8, 0, zc + re_ + 1), 5).moved(_on_rim(e, d)) for d in EAR_DEG]
    chin = box((xb, -e.chin_w / 2, 0), (xf, e.chin_w / 2, e.rise + e.chin_up))
    body = fuse(cyl((xb, 0, zc), (xf, 0, zc), re_), bump, chin, *ears)
    cz = zc + e.bump_r
    tools = [
        cyl((xb - 1, 0, zc), (xb + e.depth, 0, zc), e.pocket_r),  # display pocket
        cyl((xb + e.depth - 1, 0, zc), (xf + 1, 0, zc), e.glass_d / 2 - e.lip),  # window
        cyl((xf - 4, 0, cz), (xf + 4, 0, cz), 3.5).moved(cam),  # lens
        box((xb + 2, -e.cam_w / 2, cz - e.cam_w / 2), (xf + 1, e.cam_w / 2, cz + e.cam_w / 2)).moved(cam),
        box((xb + 2, -5.5, cz - 20), (xb + 12, 5.5, cz)).moved(cam),  # flex path behind the glass
        # the lead: up out of the stalk's bore and through the chin into the pocket; a USB-C plug fits through
        box((-8, -s.bore / 2 - 0.5, -1), (xf - 1, s.bore / 2 + 0.5, zc - e.pocket_r + 1)),
    ]
    tools += [cyl((x, y, -1), (x, y, 5.7), 2.0) for x, y in s.tip_bolts]  # M3 x 5.7 inserts
    tools += [cyl((xb - 1, 0, zc + re_ + 1), (xb + 7, 0, zc + re_ + 1), 2.0).moved(_on_rim(e, d)) for d in EAR_DEG]
    return cut(body, *tools)


@cache
def back(e: EyeSpec):
    """Cover disc with its ears: screws into the bezel's inserts and holds the display in."""
    xb, zc, re_ = e.back_x, e.centre_z, e.rim_r
    x0 = xb - e.back_t
    ears = [cyl((x0, 0, zc + re_ + 1), (xb, 0, zc + re_ + 1), 5).moved(_on_rim(e, d)) for d in EAR_DEG]
    body = fuse(cyl((x0, 0, zc), (xb, 0, zc), re_), *ears)
    tools = [cyl((xb - 5, 0, zc + re_ + 1), (xb + 1, 0, zc + re_ + 1), 1.7).moved(_on_rim(e, d)) for d in EAR_DEG]
    return cut(body, *tools)


@cache
def glass(e: EyeSpec):
    x = e.back_x + e.depth
    return cyl((x - 2, 0, e.centre_z), (x, 0, e.centre_z), e.glass_d / 2)


def eye_parts(e: EyeSpec, s: StalkSpec, frame: Location, side: int = 1, label: str = "", refs: bool = True):
    parts = [
        P.Part(f"{label}eye bezel", bezel(e, s, side), P.EYE, frame, print_pose=Rot(0, 90, 0)),  # front face down
        P.Part(f"{label}eye back", back(e), P.EYE, frame, print_pose=Rot(0, 90, 0)),
    ]
    if refs:
        parts.append(P.Part(f"REF {label}round display", glass(e), P.GLASS, frame, printed=False))
    return parts
