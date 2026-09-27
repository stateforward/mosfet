"""Stalk test kit: one full stalk with its eye, and the servo pod with both pulleys, laid out on the bench."""

from __future__ import annotations

from dataclasses import replace

from build123d import Location, Pos

from .eye import eye_parts
from .params import EYE, STALK, EyeSpec, StalkSpec
from .stalk import pod_parts, segment, stalk_parts

FIT_SWEEP = (0.20, 0.25, 0.30, 0.35)  # diametral ball/socket interference, mm


def fit_sweep(s: StalkSpec = STALK):
    """One segment per interference value: print three of each, snap them, keep the one that holds the eye."""
    for itf in FIT_SWEEP:
        yield f"fit_segment_i{round(itf * 100):03d}", segment(replace(s, interference=itf))


def kit(s: StalkSpec = STALK, e: EyeSpec = EYE, bend_deg: float = 0.0, refs: bool = True):
    parts, tip_top = stalk_parts(s, Location(), 0.0, bend_deg)
    parts += eye_parts(e, tip_top, 1, refs=refs)
    parts += pod_parts(Pos(-90, 0, 0), refs=refs)
    return parts
