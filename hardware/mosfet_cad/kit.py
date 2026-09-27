"""Spring-stalk test kit: one full stalk with its eye, and the servo pod with its three pulleys, on the bench."""

from __future__ import annotations

from build123d import Location, Pos

from .eye import eye_parts
from .params import EYE, STALK, EyeSpec, StalkSpec
from .stalk import pod_parts, stalk_parts


def kit(s: StalkSpec = STALK, e: EyeSpec = EYE, refs: bool = True):
    parts, tip_top = stalk_parts(s, Location())
    parts += eye_parts(e, s, tip_top, 1, refs=refs)
    parts += pod_parts(Pos(-120, 0, 0), s.tendons, refs=refs)
    return parts
