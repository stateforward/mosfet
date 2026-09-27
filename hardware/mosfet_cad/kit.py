"""Spring-stalk test kit: one full stalk with its eye, and a bench stand with its three winches."""

from __future__ import annotations

from build123d import Location, Pos

from .eye import eye_parts
from .params import EYE, STALK, EyeSpec, StalkSpec
from .stalk import stalk_parts
from .winch import bench_parts


def kit(s: StalkSpec = STALK, e: EyeSpec = EYE, refs: bool = True):
    parts, tip_top = stalk_parts(s, Location())
    parts += eye_parts(e, s, tip_top, 1, refs=refs)
    parts += bench_parts(Pos(-130, 0, 0), refs=refs)
    return parts
