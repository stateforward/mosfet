"""One named part: its shape in its own frame, where it sits, and how it prints."""

from __future__ import annotations

from dataclasses import dataclass, field

from build123d import Location, Shape

# Colours (RGB 0..1). The body reads as the character: pale shell and eyes, dark arms and tyres.
SHELL = (0.93, 0.92, 0.88)
ARM = (0.22, 0.24, 0.28)
TIRE = (0.08, 0.08, 0.08)
RIM = (0.85, 0.45, 0.15)
STALK = (0.80, 0.80, 0.78)
EYE = (0.96, 0.96, 0.95)
GLASS = (0.03, 0.03, 0.06)
INNER = (0.55, 0.60, 0.66)  # internal printed structure
DOCK = (0.30, 0.52, 0.78)
REF = (0.35, 0.62, 0.40)  # bought parts (reference only, not printed)
METAL = (0.78, 0.66, 0.30)


@dataclass
class Part:
    name: str
    shape: Shape  # in the part's own frame
    color: tuple[float, float, float]
    place: Location = field(default_factory=Location)  # own frame -> assembly frame
    printed: bool = True
    material: str = "PETG"
    print_pose: Location = field(default_factory=Location)  # own frame -> print orientation (bed = XY)
    note: str = ""

    def placed(self, outer: Location | None = None) -> Part:
        loc = self.place if outer is None else outer * self.place
        return Part(self.name, self.shape, self.color, loc, self.printed, self.material, self.print_pose, self.note)

    def world(self) -> Shape:
        return self.shape.moved(self.place)

    def printable(self) -> Shape:
        return self.shape.moved(self.print_pose)
