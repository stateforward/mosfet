# hardware

The real mosfet: parametric, printable CAD in Python ([build123d](https://github.com/gumyr/build123d)). Bought
parts are off the shelf; everything else prints on a Bambu Lab X1 (256 mm cube). The look is the character in
`web/src/face/critter.ts` and `sim/bot.py`, scaled up as far as the printer allows.

```sh
cd hardware
uv sync
uv run python -m ocp_viewer --port 3939 &   # live viewer: open http://localhost:3939
uv run python build.py                      # build, check fit, export, show in the viewer
uv run python build.py --only kit           # just the spring-stalk test kit
uv run python build.py --clash --no-show    # also list every pair of overlapping parts
uv run python shots.py out/shots            # render the proof views through the viewer
uv run python shots.py out/shots 3947 10    # ...through a second viewer on 3947, 10 s per view (headless GL)
```

`build.py` writes to `out/` (git-ignored):

- `out/mosfet.step`, `out/stalk_kit.step`: assemblies with named, coloured parts, for Shapr3D or any CAD.
- `out/print/<part>.3mf` and `.stl`: one file per distinct printed part, already in its print orientation,
  centred and sitting on the bed, for Bambu Studio. The fit report says how many of each to print.

It also prints the stalk spring's numbers (bending stiffness free and installed, axial rate, the preload, the
tendon pull and winch torque for 90° and 120°, the buckling margin, how far a winch can bend it) and the winches'
(encoder resolution, each PTFE tube's length and turning, and what the tube friction costs).

The build fails (exit 1) if any printed part's bounding box, in its print orientation, is bigger than 250 mm
on any axis (256 mm less 3 mm margin each side).

| File | What |
|---|---|
| `mosfet_cad/params.py` | every driving dimension: character ratios, bought-part sizes, `SpringSpec`, `StalkSpec`, `EyeSpec`, `WormMotorSpec`, `CellSpec`, `PackSpec`, docked pose |
| `mosfet_cad/stalk.py` | spring (installed, squeezed by the tendon preload), base plate, guide disc, tip plate |
| `mosfet_cad/winch.py` | worm-gear winches: winch deck, back winch brackets, pulley, bench stand, PTFE tube runs |
| `mosfet_cad/eye.py` | eye bezel with camera bump and chin, eye back cover |
| `mosfet_cad/kit.py` | the spring-stalk test kit |
| `mosfet_cad/body.py` | drum halves, end caps, tray, shelf, battery cradle, driver mount, skid, gears, arms, wheels |
| `mosfet_cad/dock.py` | charging dock: curved stop cradle with the pins in its seat, tower with the tag |
| `mosfet_cad/assembly.py` | the whole bot in its docked pose, on the dock |

Frames follow the sim: x forward, y left (the drum axis), z up; millimetres. Anything marked UNVERIFIED below
is a parameter in `params.py`. Measure the real part and change the number.

## Size

The drum radius sets the scale: `DRUM_R = 118` (Ø236, the biggest round drum that prints on the X1). Every other
proportion comes from `GEOMETRY` in `sim/bot.py`:

| | value |
|---|---|
| drum | Ø236 × 150 |
| wheels | Ø172 × 73 (TPU tyre 8 mm on a Ø156 rim) |
| arms | 184 pivot to axle, 80 wide, 36 thick; pivot 45 above the drum axis; parked 50° forward |
| stalks | 159 long (base plate to tip top, installed), roots on the crown straight above the drum axis, 96 apart, splayed 5° outward |
| eyes | Ø124 bezel (Ø115 round display), camera bump on the rim; screen centre on the stalk axis, 68 above the tip |
| overall, docked | 372 wide (tyre to tyre), 357 long, 529 tall; dock 285 × 184 |

**Everything is on the centreline.** In side view the stalk roots, the stalk axes and the screen centres all
lie in the x = 0 plane, straight above the drum and arm-pivot axis, mirror-symmetric about y = 0. The drawing's
root spread (0.26 × 150 = 39 mm each side) would put two Ø120 eyes on top of each other, so the roots sit at
y = ±48 (the Ø45 pedestals end at |y| 70.6, inside the drum's 75) and each stalk leans 5° outward, sideways only.
The screen centres end up at y = ±67.7, 135 apart, with a 15.9 mm gap between the bezels. Gravity pulls a splayed
stalk further out, so the gap only grows.

Docked, the bot sits on its wheels (on the floor) and its skid (on the dock's 6 mm seat). The skid
touches at 12.1° behind the drum's bottom, so the body pitches back 12.1° (`params.docked_pose`), and the
straight stalks and the screens pitch back with it: docked, the screens look 12.1° up. Nothing leans forward to
cancel it. A fore-aft offset would take the eyes off the centreline, and a bent spring would sit on the
tendons all the time. The screens are level whenever the body is. On a flat floor (`lift=0`) the pitch comes
from the common tangent of the wheel circle and the skid circle: 14.4°.

## Spring-stalk test kit (print this first)

`uv run python build.py --only kit`: one stalk (base plate, spring, 5 guide discs, tip plate), one eye, and a bench
stand with three winches and their pulleys.

**The spine is a compression spring.** It's McMaster **9662K33**: spring-steel cut-to-length stock, 36 in long,
1.00 in OD × 0.135 in wire (Ø25.4 × 3.43, ID 18.5), open ends, 5.6 lbf/in over the whole 36 in. Cut 6 in (152.4 mm)
per stalk. A cut piece is stiffer in proportion, 33.6 lbf/in (5.88 N/mm). From k = Gd⁴/(8D³n), with D = 21.97 mm
and G = 79.3 GPa, the stock has 131.7 coils, so the pitch is 6.94 mm and a 6 in piece has 22 coils (`STEEL_SPRING`;
E, G and the pitch are UNVERIFIED: measure the pitch and set it). With no tendon pulling, the spring holds the stalk
straight up. Pulling one or two tendons bends it toward them. That's the same model as `sim/bot.py`, where the stalk
is a springy segment chain with three cables through guide discs.

- **Only the free coils bend.** The collars grip 1.5 turns (10.4 mm) at each end and the five discs grip 4 mm each,
  so 40.8 mm of the spring is held rigid and 111.6 mm bends and compresses. The installed spring is stiffer
  than the cut piece: 8.04 N/mm axially. The bend numbers below use that free length. Counting the whole spring as
  bending would undercount the moment by about a quarter.
- **Stiffness.** EI = d⁴p / (32D(1/E + 1/2G)) = 0.123 N·m² free, 0.118 installed. EI goes with the pitch, and the
  preload squeezes it (`StalkSpec.ei`; `build.py` prints both).
- **Preload.** Each tendon is held at 10 N by its locked winch, so the spring carries 30 N at rest and is 3.7 mm
  shorter: 148.7 mm, and the stalk 158.7 mm base to tip. The CAD models the stalk at that length
  (`StalkSpec.installed_z`): the free coils squeeze and the gripped turns don't.
- **The eyes don't sag.** The eye with its tip plate is about 165 g (UNVERIFIED), with its centre 72.8 mm above the
  spring's top. A free spring would fold sideways under EI / (L_bend (L/2 + a)) = 7.46 N, 4.6× the eye's weight,
  and the 5° splay would sag to 6.4°. But the winches can't be back-driven. With all three tendons locked, the
  stalk can only bend by stretching a tendon. Spectra 65 lb is about 4.4 kN per unit strain (UNVERIFIED), which lets
  the eye sag 0.22°. It only moves when a winch turns.
- **Cost of a bend.** A 90° bend takes 1.73 N·m at the root: 97 N on the pulling tendon at r = 17.7 mm, plus 10 N
  because the other two stay at their pretension. That's 107 N, or 1.07 N·m at the 10 mm pulley, under the winch's
  rated 1.37 N·m. The pulling tendon takes in 27.8 mm for the bend and 12.1 mm more as the spring shortens, which is
  1.2 s at 12 V. A 120° bend takes 140 N (1.40 N·m) and 1.7 s. The wire sees about 580 MPa at 120°, a third of what
  spring steel takes.
- **Reach.** At the rated torque (137 N) a winch bends the stalk 117°. At the driver's 1.6 A current limit (176 N,
  61% of the Spectra's 289 N) it's 153°. Tube friction costs up to ×1.23 (see Winches), which makes that 93° and
  123°. The coils wouldn't bind until 275°, so the winches set the limit.
- **Collars and guide discs screw onto the coil.** Each has a helical groove cut by the spring itself plus
  0.25 mm (`clearance`), so it threads on along the coil and stays put without glue. The five Ø41 guide discs (4 mm
  thick, at 20.7, 48.4, 76.2, 104.0 and 131.7 mm up the free spring) sit 4 pitches (27.8 mm) apart, so they're one
  part, printed 5 times per stalk. Each carries the three tendon holes on r = 17.7, 5 mm off the spring. Standing
  the tendons off the spring is what gives them leverage.
- **Cables.** The display lead runs up the middle of the spring (ID 18.5) and through Ø15 bores in the plates and
  the pedestal. A stock USB-C plug threads through (≤ 13 mm wide, UNVERIFIED), so no slim overmold is needed.
- **Printed spring instead.** `PRINTED_SPRING` is a PETG coil, Ø30 × 6 mm wire at 12 mm pitch. Swap it in
  (`StalkSpec(spring=PRINTED_SPRING, pretension=...)`) and the collars, discs, plates and pedestal all resize from it.
  A printed spring is modelled free, not squeezed, since its part is also its print file. PETG is about 100× softer
  than steel, though. That coil's EI is 0.017 N·m² (UNVERIFIED: layer lines, creep), and it buckles under about
  0.75 N, less than half the eye. It's for bench-testing the tendons and discs with a dummy eye, not for carrying
  the display, and it needs a much lower pretension. Print it upright with tree supports under the coils.

**Tendons: 3 at 120°, one winch each.** That's 3 worm-gear winches per stalk and 6 in all. A spring shortens when a
tendon pulls it (12.1 mm at 90°, above), so an antagonistic pair on one double pulley would go slack on the far
side and give the stalk backlash every time it changed direction. Independent tendons stay taut, and three at 120°
reach every bending direction. Four per stalk would over-constrain it: with every winch locked, four tendon lengths
fix three unknowns (two bend angles and the spring's length), so any length error would fight the spring. Three
lengths set the pose exactly. It's also what the sim models. One tendon runs straight back and two run forward at
±60°. That's mirror-symmetric, so both stalks use the same parts.

Tendons: 0.41 mm PowerPro Spectra (65 lb). Each passes through its pulley's cross hole and is knotted. At the
tip they're knotted in Ø3 counterbores on the tip plate's top face. Between the winch and the stalk base they run
in 2 × 4 mm PTFE tube, from a socket on the winch to the base plate's counterbores through the pedestal.

**Base plate** (Ø45) bolts to its pedestal on the drum with 3 × M3 on Ø37 between the tendons (heat-set inserts in
the pedestal); the heads clear the collar by 0.75 mm. **Tip plate** (Ø49) takes the eye's chin with 2 × M3 from
below at (−12.4, ±14). Their heads sit beside the collar and screw into inserts in the chin.

**Try on the bench:** screw the discs on and thread the tendons. Hang the eye (or 165 g) on the tip with the tendons
slack and check the sag against the numbers above. That's the real test of `SpringSpec.ei`. Then tension each
tendon to 10 N and check the stalk shortens about 3.7 mm. Pull one with its winch and measure the pull, the
shortening, the time for 90°, and the current. Then cut the power mid-bend and check it holds.

## Winches

Each tendon is wound by a 12 V worm gearmotor with a Hall encoder: **NFP-JGY-370-EN, 12 V, 337:1**
([NFP listing](https://nfpshop.com/product/24mm-diameter-worm-gear-motor-model-nfp-jgy-370-en), also sold as
JGY-370 by ASLONG and others). At 12 V it runs 35 rpm and ≤ 0.25 A with no load, and 25 rpm at its rated 1.37 N·m and
≤ 1.3 A. It stalls at ≥ 3.4 N·m and ≤ 5.5 A. The worm is self-locking. The encoder is 11 PPR on the motor shaft,
14,828 counts per output turn in quadrature, or 4.2 µm of tendon per count. At the 10 mm pulley, 1.37 N·m is 137 N.
The 200:1 (42 rpm, 0.88 N·m) is too weak for a 90° bend through the tubes, and the 564:1 (15 rpm) takes over 2 s.
Everything about it is UNVERIFIED (`WINCH_MOTOR` in `params.py`), including every dimension: gearbox 46 × 32 × 21.5,
4 × M3 on 18 × 33 in the output face, D shaft Ø6 × 18.5 at 15 mm from the far end, Ø24.4 × 30.8 can, and an
encoder guessed at Ø21.5 × 14. That's 91 mm long and about 200 g.

- **Holding costs nothing.** The worm can't be back-driven, so a stopped winch holds its tendon with zero current.
  The rest pose, any held bend, and the 10 N pretension all cost no power. (The STS3215s drew current to hold.)
- **Pretension.** Drive each tendon in at a low current limit until its encoder stops, then stop. The limit is the
  driver's VREF, set from a Teensy PWM through an RC filter. How repeatable that is against the worm's 0.25 A no-load
  current is UNVERIFIED, so check it with a spring scale on the kit.
- **Pulley.** Single groove, radius 10, Ø25 flanges, 6 mm disc plus a 5 mm hub with an M3 thread-forming set screw
  onto the shaft's flat. The disc sits 3 mm off the motor plate, clear of the M3 button heads. One part, fitted
  hub-out or hub-in so that neighbouring pulleys are staggered.

**Why not a pod per stalk.** Six 370s don't fit as two three-motor pods. The motors are 91 mm long, which only fits
across the drum (134 mm between the end caps). Lying across it, a motor passes through one arm gear's plane
(|y| 44.5–52.5), so it has to stay out of that gear's Ø68 circle, which leaves the upper middle of the drum out. The
front is limited by the charge module and the BMS (tops at z −21 and −27) below and by the shell. The back is taken
by the arm servos, their mounts and the MDD10A. A 2D search of the drum's cross-section (motors plus pulleys, 2 mm
gaps) found room for one 104 × 40 row of three in front and none behind. Motors from both stalks can nest in
pairs, though. Each motor's gearbox is at its own end of the drum, so each can runs past the middle into the other
motor's half, where that motor has only its can too. Two such pairs fit in front, and the last two motors fit
fore-aft over the arm servos. So each stalk has two winches on a shared deck in front and one at the back
(`bot_winches.png`, `bot_section.png`).

- **Winch deck** (front, 4 winches, `deck()`). A 4 mm plate stands across the drum at x = 62 (x 60–64) and bolts to
  both end caps through tabs on its top and bottom rails (2 × M3 each end). It holds two columns of motors, centred
  at z = −0.5 and 33.5. In each column the left stalk's motor is behind the plate, with its gearbox at +y and its
  shaft forward, and the right stalk's motor is in front, with its gearbox at −y and its shaft back. Each pulley
  sits at its own motor's end (|y| 51), in the other layer's space where that layer has nothing. The deck is
  point-symmetric about its centre, so left and right are the same. These drive the front tendons: the lower motors
  pull the outer tendon (toward the end cap), the upper ones the inner tendon. The rear layer's backs are 4.5 mm
  from the arm gears, and the top rail 2.8. The bottom rail is 1.0 mm over the charge module and 7 mm over the BMS.
  The far ends of the gearboxes are 1 mm from the end caps, and the front layer's cans 1 mm from the driver plate.
- **Driver plate** (the deck's front wall, x 88–91). The three motor driver carriers mount on its front on M2.5
  standoffs, 10.5 mm inside the shell.
- **Back winches** (1 per stalk, `back_bracket()`). Each motor lies fore-aft at z = 62 over its arm servo, with the
  gearbox at the back (far end at x −80.5, 2.9 mm inside the shell) and the can and encoder reaching forward to
  x +10 under the pedestal. The output face is at |y| 36, and the shaft points outward to a pulley at |y| 46, right
  under the pedestal's back tendon. The bracket is a 4 mm plate on the output face with two flanges that bolt to the
  end cap (2 × M3), one behind the pulley and one ahead of it. The front flange carries the PTFE socket where the
  tendon leaves the pulley's top. The motor clears the arm servo by 5.2 mm, the arm gear by 7.0, and the other
  back winch by 26. The bracket clears the pinion by 3.7. The motors stay inside |y| 38 and the brackets only reach
  out to the end cap behind x −44, so the lead band (|y| 40–58, x −16 to 12) and the display leads coming down
  from the pedestals stay clear.
- **PTFE tubes** (`tube_runs()`, modelled and clash-checked). A front tube rises out of the deck's top rail to z 68,
  runs back and up to z 74 under its pedestal hole, and turns up into it. A back tube leaves its socket forward at
  z 72 and turns up into the pedestal. Every bend is 15 mm radius (UNVERIFIED: check the tube doesn't kink). The
  front tubes are 98–122 mm long and turn 165–171°. The back ones are 74 mm and turn 96°. The capstan loss is
  e^(μθ): with Spectra on PTFE at μ ≈ 0.07 (UNVERIFIED), that's ×1.22–1.23 in front and ×1.12 at the back.
  Through the worst tube a 90° bend takes 1.32 N·m at the pulley (still under the rated 1.37) and 1.3 s. The
  nearest things are the end cap (2.3 mm from a front tube), the arm gear (2.4 from a back tube), and the back
  winch's encoder (7.2).

**Motor drivers: 3 × Pololu TB67H420FTG dual carrier**
([Pololu 2999](https://www.pololu.com/product/2999), $12.95, 30 × 25 mm). Each gives two channels at 10–47 V,
1.7 A continuous and 4.5 A peak, with a hardware current limit per channel of I = 1.25 × VREF. Set VREF to 1.28 V for
a **1.6 A limit**. That covers the rated 1.3 A, and the chopper holds a stall there instead of at the motor's
≤ 5.5 A. The TB6612FNG (1.2 A continuous, 3.2 A peak) is too small for the stall. A DRV8871 has the current limit
but only one channel. The MC33926 dual has current feedback, but its fixed internal limit is above the stall, so a
firmware fault could stall at 5.5 A, which is ≥ 3.4 N·m, or 340 N on a tendon rated 289 N. Here the limit is
hardware. At 1.6 A a winch pulls at most 176 N, 61% of the Spectra. The trade is that the TB67H420 has no current
output, so the Teensy doesn't read tendon tension directly. It infers it from the spring model and the encoders.

- **Power.** The drivers run straight off the pack (12–16.8 V, after the BMS), with the PWM duty capped so the
  motors see 12 V at most. That keeps them off the 12 V servo regulator, which now feeds only the two arm servos.
- **Teensy pins.** Per channel it's PWM, IN1 and IN2 (18 pins), plus one VREF PWM per carrier (3). Each encoder is
  A and B (12 pins), powered at **3.3 V**, since the Teensy 4.1's pins aren't 5 V tolerant. That's 33 pins, and
  about 49 of the Teensy's 55 with the wheel encoders, MDD10A, servo bus, BMS UART, I²C and ADCs. The Teensy has four
  hardware quadrature decoders. Give them the two wheels and two winches, and count the other four winches on pin
  interrupts. At 35 rpm that's 8.6 k edges/s per winch.

## Eyes

**Display: [Waveshare ESP32-P4-WIFI6-Touch-LCD-3.4C](https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-3.4c.htm).**
It's a 3.4" round IPS, 800×800, 87.6 mm active area on a Ø115 outline, with its own ESP32-P4 and Wi-Fi 6, a USB-C
(OTG HS) port, and a MIPI-CSI camera connector (15-pin, 1.0 mm). $65–75. Its Ø115 outline puts the bezel at
Ø124, closest to the sim's Ø118 eye.

- *Why not the others.* The Jetson Orin Nano dev kit has no DSI and only one DisplayPort, so HDMI round panels
  (Waveshare [4" 720×720](https://www.waveshare.com/4inch-720x720-lcd.htm),
  [5" 1080×1080](https://www.waveshare.com/5inch-1080x1080-lcd.htm)) would need a DP MST hub and a thick HDMI
  cable up each stalk. The 5" also weighs about 0.5 kg with its board, per the listing. SPI GC9A01-class rounds are
  1.28" (≈Ø32), and the ESP32-S3 rounds top out at 2.1–2.8". The same board in 4" (ESP32-P4-WIFI6-Touch-LCD-4C,
  Ø126, 720×720) is the upgrade if the stalk carries it. It's heavier, and the bezel grows to Ø135.
- *Wiring.* **One USB-C lead per stalk.** The Jetson sends frames or expression commands, and the P4 draws
  them. The P4 can also carry its camera back as a USB video device, so nothing else goes up the stalk. That
  camera path over USB is UNVERIFIED: check that ESP-IDF's `esp_video`/`usb_device_uvc` supports the IMX219 on the
  P4 before relying on it (OV5647 is the safe sensor there). The fallback keeps the research plan: an Arducam IMX219
  spy camera with a 300 mm extension, straight to the Jetson's CSI ports, 9 mm flex up the Ø15 bore, with the
  display on Wi-Fi and only power up the stalk.
- *Mount: the screen stands on its stalk.* The stalk meets the eye at the bottom of its rim (6 o'clock). The
  screen stands straight up in line with the stalk axis, and its centre sits on that axis (x = 0, y = 0), 68 mm
  above the tip plate: the rim radius plus an 8 mm chin. The display glass is on the axis too, so the eye's
  body sits 2 mm in front of it and 20 mm behind. The chin is a 36 × 20 mm lug at the bottom of the bezel. It
  sits on the tip plate and takes 2 × M3 from below into inserts. The lead comes up the spring and the tip
  plate's bore and goes into the display pocket through a 10 × 13 slot in the chin, big enough for a USB-C plug.
  Nothing hangs behind the eye.
- *Housing.* The bezel holds the glass against a 2.5 mm lip and has 4 ears with M3 inserts. Print it front face
  down; the chin prints straight up off the ring. The camera bump sits on the rim, 30° from the top toward the
  outside, clear of the glass: a Ø18 boss with a 10 × 10 mm head pocket (UNVERIFIED: spy-cam head size), a Ø7
  lens hole, and a flex path back behind the display. The eye back is a 2.5 mm cover that screws to the ears.
  `EyeSpec` has the glass diameter, the stack depth (18 mm, UNVERIFIED), the camera angle, the camera head size,
  and the chin.
- *Mass at the tip:* bezel about 33 g and back about 36 g solid PETG (less with infill), tip plate 17 g, plus
  the display (weight UNVERIFIED, Waveshare doesn't list it; budget 80 g). About 165 g in all (`EYE_KG`).

## Body

- **Drum:** two half-tubes split at the axis (236 × 150 × 118 each). The top half carries the two stalk pedestals
  on the crown at x = 0, y = ±48. Each is a Ø45 boss tilted 5° outward, with its top at z = 122 so the splayed
  base plate clears the crown. Each pedestal has the Ø16 lead bore, three PTFE bores, and three M3 inserts. Both
  halves screw radially into the end-cap rims (8 × M3 into inserts).
- **End caps:** 8 mm discs inside the drum ends. Each has a 22 mm boss with two **6805-2RS** bearings (25 × 37 × 7)
  for the arm pivot, six vents, and inserts for the tray, the winch deck, the back winch bracket, and the
  arm-servo mount.
- **Arm drive:** Feetech **STS3250** → printed **2:1** spur pair (m2, 16:32 teeth, centre distance 48.5 including
  0.5 mm printed backlash) → hollow Ø25 arm hub turning in the bearings. The teeth are trapezoids approximating a
  20° involute. They're good enough to print and test. If it chatters, cut true involutes (e.g. `bd_warehouse`
  gears) at the same module and centre distance. The motor and encoder leads run through the hollow hub.
- **Arms:** two 18 mm clamshell halves per arm, hollow, joined by 4 × M3 into bosses. The outer half carries a
  clamp sleeve for the **Pololu 37D** gearmotor. The motor sits inside the wheel cup with its shaft outward, and
  a Pololu 1083 hub bolts to the rim's hub face (4 holes on Ø19, UNVERIFIED). An arm is 264 mm long, so it prints
  flat and **diagonally**: 210 × 210 mm on the bed.
- **Wheels:** PETG rim (Ø156 cup, lightening holes) plus a **TPU 95A tyre**, 8 mm thick with 36 tread grooves,
  0.5 mm stretch fit.
- **Inside** (see `bot_section.png`): the battery fills the bottom of the drum (see Battery, below), and the rest
  stacks on it. The tray is the pack's lid: z −43 to −39, 2 mm over the pack's wrap, bolted to both end caps by four
  tabs (x −40 and 25). On it: the Jetson Orin Nano Super on M2.5 standoffs (86 × 58 pattern, UNVERIFIED), board
  back edge at x −65, heatsink top at z +1. Across the front of the tray are the 4S BMS, both regulators and the
  charge module. A slot at x 88–100 lets the pack leads up from the lead bay in front of the pack. The electronics
  shelf is at z 9–12, 8 mm over the heatsink and 0.9 mm under the arm servo mounts, on four posts outside the
  Jetson board. It carries the Teensy 4.1 and the BNO085, 14 mm from the drum axis. The driver mount is an upright
  plate behind the Jetson, bolted to both end caps. The MDD10A hangs on its back and the bus-servo adapter on its
  front. The winch deck stands across the front of the drum over the BMS and the charge module (x 36–91, z −20 to
  53), with four winches and the three motor drivers on it. The back winches lie fore-aft over the arm servos
  (z 46–78). Their PTFE tubes run up and back to the crown pedestals (see Winches). The arm servos and gears sit next
  to the end caps. Each arm servo mount's lower post is behind the servo (x −58), clear of the heatsink and the
  shelf.
- **Lead path from the arms.** The motor and encoder leads come out of each hollow arm hub (Ø19 bore) at
  |y| = 44. They run down the band |y| 40–58, x −16 to 12, between the shelf posts and past the Jetson, to the
  tray. Nothing sits in that band. It's also the route for extra packs in the arms, later: their leads come
  through the same hub bore to the BMS (see Open questions).
- **Skid:** a 4 mm PETG ski on the drum's back-bottom (UHMW tape on the running surface) with recesses for the
  three brass charge pads. Its two M3 screws go through the shell into the battery cradle (thread-forming screws in
  Ø2.5 pilots), which holds the cradle in place. The pad wires come through the shell into a 4 × 2.5 mm groove in
  the cradle's underside, run along it to the ends of the drum, and go up beside the end caps.

## Battery

**4S6P Samsung 50S: 30 Ah, 432 Wh, about 1.8 kg**, custom-built (spot-welded nickel strip, fishpaper, PVC wrap),
lying low in the drum in a printed cradle (`PackSpec` in `params.py`, `cradle()` in `body.py`). The system stays 4S
(16.8 V full, 12.0 V empty) because the Jetson, the regulators, the charger and the dock all assume it.

- **Layout.** The 24 cells lie fore-aft (along x) in three layers of five across the drum (y). Each layer shifts
  half a pitch across and nests into the grooves of the one below, so the layers are 18.5 mm apart instead of 21.4.
  They step up the drum's curved bottom:
  - bottom layer: one cell long (x −32 to 40), 5 slots with the middle one empty (the BMS thermistor goes there);
  - middle layer: two cells end to end (x −72 to 72). It just fits: its end corners are 3 mm off the shell;
  - top layer: two cells long, shifted 12 mm forward (x −60 to 84).

  The pack is 157 × 118 × 58 mm over all, stepped, from z −104 to −45.5. Its cells' centre is at x 5.7, y −0.9,
  z −70. Each series group is five cells in one end of the middle or top layer plus one cell from the bottom
  layer. The pack builder should confirm the busbar plan.
- **Why 21700s in nested layers.** The space under the tray is a circle segment 134 mm long between the end caps,
  and a cell has to fit whole. Cells along y waste half that length: a 21700 is 71 long, and two 18650s end to end
  (131) don't fit with walls. Cells along x in nested rows fill it best. With the tray as high as it goes, that's 25
  slots of 21700 (4S6P, 432 Wh) against 30 of 18650 (4S7P, 353 Wh) or 12 of 26650 (4S3P, 216 Wh). LiFePO4
  (32700) is out: 4S LFP tops out at 14.6 V, not 16.8. 46xx cells aren't reliably sold to individuals. The tray
  sets the limit. Put it 12 mm lower and the top layer is gone (4S3P). It can't go higher without moving the Jetson
  off it, because the shelf above is already 0.9 mm under the arm servo mounts and the BNO085 has to stay near the
  axis.
- **Cells.** Samsung INR21700-50S: 5.0 Ah, 25 A continuous, 69 g, Ø21.25 × 70.8 max (dimensions and mass
  UNVERIFIED). Any 5 Ah 21700 up to Ø21.3 × 70.9 fits the 21.4 pitch: the Samsung 50E, or the Molicel P50B if its
  diameter measures under the pitch. Buy all 24 from one lot, from a reseller that tests (18650batterystore, IMR
  Batteries).
- **BMS: 4S Li-ion, ≥ 40 A continuous, with balancing.** For example a Daly 4S 40 A, or a JBD/Overkill 4S smart
  BMS so the Teensy can read state of charge over UART. It sits on the tray (60 × 40 × 12 envelope, UNVERIFIED).
  The worst case is about 33 A: both wheel motors stalled at 16.8 V (2 × 7.7 A), all six winches at their 1.6 A
  current limit straight off the pack (9.6 A), both arm servos stalled through the D24V150F12 (2 × 4.2 A at 12 V,
  UNVERIFIED, about 6.4 A from the pack), and the Jetson (25 W, 1.7 A). That's 5.5 A per cell, 1.1 C against a
  25 A rating. Before, with eight servos on the regulator, it was about 30 A. In use no more than four winches pull
  at once, two per stalk, and a held pose draws nothing: the worm winches hold with zero current. Normal driving
  draws 1.7 A.
- **Cradle.** A curved trough that sits on the shell, open upward, with a stepped pocket for each layer (0.8 mm over
  the wrap) and 2 mm side walls. Its floor is 1.7 mm at the thinnest, under the middle layer's ends. The tray above
  is the lid: stick 2 mm EVA foam on top of the pack. At the back, above z −51, the cradle stops at x −66.5 to
  clear the MDD10A. At the front, the space between the pack and the shell is the lead bay: the pack leads come over
  a notch in the front wall and up through the tray slot to the BMS. The cradle is 162 × 123 × 70 mm and prints
  curved side down, with tree supports under the curve.
- **Runtime** on 90% of 432 Wh, with the old 4S2P 12 Ah (173 Wh) for comparison:

  | | draw | 4S6P, 432 Wh | 4S2P, 173 Wh |
  |---|---|---|---|
  | idle (docked or sitting, Jetson idle) | ~3 W | 130 h (5.4 days) | 52 h |
  | awake (looking, talking, eyes on) | ~12 W | 32 h | 13 h |
  | driving (balancing and rolling) | ~25 W | 16 h | 6.2 h |

- **Shipping.** 432 Wh is over the 100 Wh and 160 Wh airline limits. The bot can't fly with the pack in it, and a
  built pack ships as Class 9 dangerous goods.

## Mass and balance

These are estimates from the CAD volumes (PETG at the print table's infill), the pack, and bought-part masses. The
bought parts are all UNVERIFIED: Jetson 200 g, 37D motor 195 g, STS3250 70 g, display 80 g, worm winch 200 g,
STS3215 55 g, and 300 g of wiring and fasteners. The last column is the second plus the difference, by CAD volume,
of the parts the winches changed.

| | 4S2P 12 Ah in the old sling | 4S6P, stalk servos | 4S6P, worm winches (now) |
|---|---|---|---|
| total | 4.97 kg | 6.26 kg | **7.29 kg** |
| body (drum, internals, stalks, eyes) | 3.40 kg | 4.70 kg | 5.73 kg |
| body CoM, drum frame (x, z) | 7.3, +12.9 | 4.6, −6.7 | 5.7, +6.2 |
| whole-bot CoM, docked pose, drum frame (x, y, z) | 42.9, 0.1, −8.8 | 33.5, −0.3, −19.0 | 30.3, −0.3, −7.2 |

The pack pulls the body's centre of mass down 20 mm, to below the drum axis, and 2.7 mm back. It can't go further
forward, because the middle layer spans the whole chord. The winches add 1.03 kg. The six motors weigh 1.2 kg
against 0.33 kg of STS3215s, and the bigger springs add 0.12 kg. That lifts the body's centre of mass 13 mm, back
above the axis. Four of the motors sit low in front, and the two back ones sit at z 62.

- **Standing up.** In the worst case the whole body hangs on the arm pivots, with the arms at 50° and the wheels
  rolling freely: 5.73 kg × g × 184 sin 50° = 7.9 N·m. That's 3.96 N·m per arm and 1.98 N·m at each STS3250
  through the 2:1 (1.62 with the stalk servos, 1.18 with the old pack), 40% of its ≈ 4.9 N·m stall (50 kg·cm at
  12 V, UNVERIFIED). Driving the wheels back under the body takes some of that.
- **Balancing.** With the arms straight down, the body's CoM is 145 mm over the axle (132 with the stalk servos,
  152 with the old pack). Holding a 5° lean takes 0.36 N·m per wheel motor. The 37D 50:1 stalls at 2.06 N·m at
  12 V, and Pololu suggests keeping continuous loads under about 1 N·m (UNVERIFIED). At 1 N·m each the motors hold a
  14° static lean (19° before), or accelerate the whole bot at 3.2 m/s² (3.7 before), enough to recover about 18°.
  √(h/g) is 122 ms (116 ms before), so retune the balance loop for the new mass and height.
- **Docked.** The centre of mass is 31 mm ahead of the skid contact and the wheels are 153 mm ahead, so the wheels
  carry 20% (15 N) and the skid 80% (24% and 76% with the stalk servos). The pads press on the pins harder. The dock
  geometry and `docked_pose` don't change.

## Charging dock

The dock is a concave wheel stop for the drum. The bot backs in at floor level. Its round drum meets a curve
rising behind it and slides down that curve into a seat, where the skid rests on the charge pins. Docked, the
bot faces the room, and none of the charging hardware shows from the front (`bot_front.png`,
`dock_section.png`).

- **The curve is the stop and the centering.** Behind the seat, the cradle rises as a curve of radius 128 about
  a line along the drum axis. That's 6 mm bigger than the skid circle, so a seated drum touches only at the
  bottom, on the skid, over the pins. The curve rises until it's vertical, at z = 134 (about drum-axis height),
  and its rim has a 10 mm 45° round-over. Both approaches end in the same seat:
  - *Backing in while sitting* (drum low, skid on the floor). There's no lip to climb. The front edge is a 12°
    chamfer from the floor up to the curve, which is 8 mm high where the chamfer meets it, and the seat floor is
    6 mm. The skid rides up the chamfer and over a 2 mm crest into the seat. There the drum meets the curve right
    behind it, and the curve stops it: a drum 6 mm smaller than the curve can't move back more than 6 mm.
  - *Backing in while balancing* (drum axis 225 mm up, underside 107 mm up). The drum passes over the chamfer and
    the seat, and its lower back bumps the rounded rim when the drum axis is 63 mm past the seat. That's the stop.
    Then it sits: the arms swing forward, and the drum comes down against the curve. The curve slopes 40–75°
    along that path, well past PETG-on-PETG friction (about 17°), so the drum slides forward and down into the
    seat. At the rim the tower's face is still 17 mm behind the drum.
  - *Sideways:* the curve runs 3 mm past each drum end, and end cheeks stand beyond that. Their inner top edges
    are cut back 2:1 up to 40 mm, so a drum end that comes down up to about 12 mm off-centre slides in, and the
    drum seats within ±3 mm. The pads tolerate ±6 mm sideways and ±15 mm fore-aft (12 × 36 mm strips).
  - *Arm and wheel clearance:* the tall curve stays inside |y| = 72 (the arms start at 76). Out past that the
    cradle is at most 40 mm tall, below a balancing bot's lowest arm point at 46 mm. The wheels roll on the floor
    outside it (cradle |y| ≤ 92, wheels |y| ≥ 113).
  - *Height:* the seat floor under the pins is 6 mm (`DOCK_H`). The wheels are on the floor and the skid is 6 mm
    up, so the docked pitch is 12.1° (`params.docked_pose(lift=DOCK_H)`).
- **Everything electrical is out of sight.** The three pins are pressed into the seat at x = 0, under the drum's
  lowest point. Their wires run in a 2 mm channel on the cradle's underside back to the tower. The tower stands
  behind the curve, 140 wide (inside the drum's 150 mm length) and 230 tall. In a front view from the bot's
  height the drum crown (246) still covers it. The VIN switch board goes in its bay, which opens underneath, and
  the 24 V jack is on its rear face. What shows below the drum from the front is the 8 mm front chamfer and the
  corners of the end cheeks (|y| 75–92).
- **Contacts.** On the bot are three brass strips in the skid: GND at y = −35, SENSE at −10, VIN at +30. On the
  dock are three spring pins (Mill-Max 0873 power pins, 9 A,
  [datasheet](https://www.mill-max.com/products/discrete-spring-loaded-pins/through-hole-mount-spring-loaded-pin/0873/0873-0-15-20-82-14-11-0))
  pressed into the seat. Barrel Ø3.0, UNVERIFIED; stroke UNVERIFIED.
- **Polarity safety.** The gaps are uneven (25 and 40 mm), so no sideways shift can land a wrong pin on a pad.
  The dock only turns VIN on when it sees its SENSE pin tied to its GND pin through the bot's 1 kΩ (SENSE pad to
  GND on the bot). That uses a small comparator plus a P-FET high-side switch, so the pins are dead until the
  bot is seated correctly. A mis-seat can't short, and nothing on the dock is live when no bot is on it. On the
  bot, VIN goes through an ideal diode, so the pads are never live from the battery.
- **Homing while reversing.** A 94 mm AprilTag 36h11 (printed and glued into a 1 mm recess) is on the tower's
  front face above the curve's rim, facing the bot. Its centre is 190 mm up the face and it spans z 134–223. An
  optional 5 mm 940 nm IR LED beacon sits beside it (y = 58). Why there:
  - The stalks bend back far enough that on the way in the eyes curl back over the drum and look down behind it.
    A 120° bend takes 1.40 N·m at the winch pulley, or 1.72 through the tube, just inside the winch's 1.6 A
    current limit (see Winches). The face leans back 20° so it points up toward the eyes instead of across the
    floor, which keeps the tag from being foreshortened.
  - A 2D line-of-sight check against the drum in the balancing pose keeps the whole tag in view until the drum
    axis is 10 mm *past* the seat, for an eye level over the drum crown. The rim stops the drum at 63 mm past.
    With the eye pushed 110 mm forward the tag is lost 45 mm before the seat, and with the eye curled back
    behind the crown, 30–45 mm past it. So the bot homes on the tag nearly the whole way, and the curve takes
    over from there. There's no final stretch on odometry: backing until the bot bumps is the procedure.
  - Once docked, the tag is behind the drum at |y| ≤ 47, below the crown, so it only shows from the side or
    from behind. From a standing adult's height you can see over the drum, and the top of the tower shows.
- **Docked detection.** The bot sees charger input voltage on a divider into the Teensy ADC.
- **Power path.** Unattended charging needs a pack with a BMS: the **4S6P pack** (see Battery). The dock takes
  24 V from a laptop-style adapter into a panel jack on the tower's back (Ø11 hole, UNVERIFIED). On the bot, a
  CC/CV buck module charges the pack at 16.8 V. At the old 1.5 A setting the 30 Ah pack would take about 20 hours,
  so the charger goes up to **5 A** (0.17 C, about 6.5 hours from empty). That needs an XL4016-class 8 A module:
  the 5 A XL4015 runs hot above 4 A. It draws about 4–4.3 A at 24 V with the bot idle or awake, so the adapter
  is 24 V ≥ 5 A (120 W), and each dock pin (Mill-Max 0873, 9 A) carries under half its rating. The Teensy measures
  charge current and cuts the charger off when it tapers below C/20 (1.5 A), so the pack doesn't sit at
  4.2 V/cell. The BMS is the backstop. The INA219 breakout's 0.1 Ω shunt reads only ±3.2 A, so use an INA226
  board with a 10 mΩ shunt.
- **Parts.** Cradle (234 × 184 × 134) and tower (100 × 140 × 230), joined by two printed dog-bone keys in
  pockets on the underside, across the seam at x = −125. Both fit the X1. The whole dock is 285 × 184.

## BOM

Prices are the listed ones where a page was read, otherwise UNVERIFIED. Nothing has been ordered. The dimensions behind most rows
come from the parts research draft, which isn't in the repo.

| Part | Qty | Source | Notes |
|---|---|---|---|
| Jetson Orin Nano Super Developer Kit 8 GB | 1 | [Amazon](https://www.amazon.com/NVIDIA-Jetson-Orin-Nano-Developer/dp/B0BZJTQ5YP), [SparkFun](https://www.sparkfun.com/nvidia-jetson-orin-nano-developer-kit.html) | 100 × 79 carrier; 9–20 V in, runs from the pack |
| Waveshare ESP32-P4-WIFI6-Touch-LCD-3.4C | 2 | [Waveshare](https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-3.4c.htm) | the eyes, $65–75 |
| IMX219 camera (spy-cam w/ extension) | 2 | [Arducam B0185 via UCTronics](https://www.uctronics.com/arducam-imx219-spy-camera-ir-300mm-extension-cable-for-nvidia-jetson-nano.html) | $24.99; see Eyes for wiring |
| Teensy 4.1 | 1 | [Adafruit 4622](https://www.adafruit.com/product/4622) | balance loop, servo bus; 8 encoders (2 wheels, 6 winches: 12 winch encoder pins at 3.3 V, 4 hardware quadrature decoders plus pin interrupts), 21 winch driver pins |
| Adafruit BNO085 | 1 | [Adafruit 4754](https://www.adafruit.com/product/4754) | IMU |
| Pololu 37D 50:1 12 V, 64 CPR encoder | 2 | [Pololu 4753](https://www.pololu.com/product/4753) | $60.95 |
| Pololu universal hub 6 mm | 1 pair | [Pololu 1083](https://www.pololu.com/product/1083) | $12.95 |
| Cytron MDD10A | 1 | [Cytron](https://www.cytron.io/p-10amp-5v-30v-dc-motor-driver-2-channels) | 84.5 × 62 |
| Feetech STS3250 12 V (arms) | 2 | [Feetech](https://www.feetechrc.com/en/562636.html) | through the printed 2:1 |
| NFP-JGY-370-EN worm gearmotor, 12 V, 337:1, Hall encoder | 6 | [NFP](https://nfpshop.com/product/24mm-diameter-worm-gear-motor-model-nfp-jgy-370-en) (price UNVERIFIED); JGY-370 12 V 30–35 rpm with encoder from ASLONG and others | the tendon winches, 3 per stalk; 1.37 N·m rated, self-locking; dimensions UNVERIFIED |
| Pololu TB67H420FTG dual motor driver carrier | 3 | [Pololu 2999](https://www.pololu.com/product/2999) | $12.95; 2 winches each, 1.7 A continuous per channel, current limit set to 1.6 A (VREF 1.28 V) |
| McMaster 9662K33 spring-steel cut-to-length compression spring, 1.00 in OD × 0.135 in wire, 36 in | 1 | [McMaster](https://www.mcmaster.com/9662K33/) (price UNVERIFIED) | cut two 6 in (152.4 mm) pieces, open ends; the stalk spines |
| Waveshare Bus Servo Adapter (A) | 1 | [Waveshare](https://www.waveshare.com/bus-servo-adapter-a.htm) | $4.99; the two arm servos |
| Pololu D24V150F12 (12 V servo bus) | 1 | [Pololu 2885](https://www.pololu.com/product/2885) | $79.95; the two arm servos (the winches run off the pack) |
| Pololu D36V50F5 (5 V logic) | 1 | [Pololu 4091](https://www.pololu.com/product/4091) | |
| Samsung INR21700-50S cells (5.0 Ah, 25 A) | 24 + 2 spare | 18650batterystore, IMR Batteries (price UNVERIFIED) | the 4S6P pack, one lot; or Samsung 50E, Molicel P50B if ≤ Ø21.3 |
| 4S Li-ion BMS, ≥ 40 A, balancing | 1 | Daly 4S 40 A, or JBD/Overkill 4S smart BMS (UART) | 60 × 40 × 12 envelope UNVERIFIED |
| Pure nickel strip 0.15 × 8 mm, fishpaper rings, PVC wrap, XT60 | 1 set | Amazon | for the pack; needs a spot welder, or have a pack shop build it |
| CC/CV buck charge module, 8 A (XL4016-class) | 1 | generic (Amazon) | set 16.8 V / 5 A; 39 × 23 × 18 modelled, dims UNVERIFIED |
| EVA foam 2 mm | 150 × 120 mm | craft store | between the pack and the tray |
| Ideal diode module (charge input), ≥ 6 A | 1 | generic | keeps the pads dead from the battery |
| INA226 current sensor, 10 mΩ shunt | 1 | generic (Amazon) | charge termination; the INA219's 0.1 Ω shunt tops out at 3.2 A |
| 24 V ≥ 5 A (120 W) DC adapter (dock) | 1 | any laptop-style brick | for charging at 5 A |
| 5.5 × 2.1 mm panel DC jack | 1 | generic | dock tower, rear face |
| 940 nm 5 mm IR LED | 1 | generic | optional homing beacon |
| Mill-Max 0873 spring power pins | 3 | [Mill-Max](https://www.mill-max.com/products/discrete-spring-loaded-pins/through-hole-mount-spring-loaded-pin/0873/0873-0-15-20-82-14-11-0) | dock contacts |
| Brass strip 0.8 × 12 mm | 150 mm | hobby/K&S | bot pads |
| 6805-2RS bearings (25 × 37 × 7) | 4 | Amazon | arm pivots |
| PowerPro Spectra 65 lb (0.41 mm) | 1 spool | [Tackle Warehouse](https://www.tacklewarehouse.com/Power_Pro_Spectra_Braided_Line_Moss_Green/descpage-PPSL.html) | tendons |
| PTFE tube 2 × 4 mm | 1.5 m | Amazon | tendon guides, winch to pedestal (6 runs, 0.6 m in all, plus the kit's) |
| M3 × 5.7 heat-set inserts (ruthex) | 100 | [ruthex](https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m3-100-stuck-rx-m3x5-7-messing-gewindebuchsen) | Ø4.0 holes throughout |
| M2.5 inserts, M3/M2.5/M2 screws, M3 button heads, M3 × 4 set screws | kit | Amazon | button heads (24) under the winch pulleys; set screws (9) in the pulley hubs |
| UHMW tape | 0.1 m | Amazon | skid running surface |

## Print settings (Bambu X1)

| Part | Qty | Material | Orientation (as exported) | Settings |
|---|---|---|---|---|
| stalk base, tip | 2 / 2 | PETG | as modelled (plate down / collar down) | 0.16 mm, 4 walls, 40% gyroid; the coil groove prints as a thread, no supports |
| stalk guide disc | 10 | PETG | flat | 0.16 mm, 100% |
| stalk spring (only with `PRINTED_SPRING`) | 2 | PETG | upright | 0.2 mm, 100%, tree supports under the coils |
| winch pulley | 6 (+ 3 for the kit) | PETG | flat, disc down | 0.16 mm, 100% |
| winch deck | 1 | PETG | on its end (as exported) | 0.2 mm, 4 walls, 25%; every wall stands up, no supports |
| back winch bracket L/R | 1 + 1 | PETG | plate down | 0.2 mm, 4 walls, 25%; supports under the tube socket |
| bench winch stand (kit only) | 1 | PETG | foot down | 0.2 mm, 3 walls, 20% |
| eye bezel L/R | 1 + 1 | PETG (white) | front face down, chin up | 0.16 mm, 3 walls; tree supports under the ears only |
| eye back | 2 | PETG (white) | flat | 0.2 mm, 3 walls, 20% |
| drum upper / lower | 1 + 1 | PETG | rim down (open side on the bed) | 0.24 mm, 3 walls, 15% gyroid; pedestals need supports |
| end cap L/R | 1 + 1 | PETG | flat, boss up | 0.24 mm, 4 walls around bearing bores, 20% |
| arm inner/outer L/R | 4 | PETG | flat, diagonal | 0.2 mm, 4 walls, 25% |
| arm gear / pinion | 2 + 2 | PETG or PA-CF | flat | 0.12 mm, 100% |
| wheel rim | 2 | PETG | hub face down | 0.2 mm, 3 walls, 20% |
| tyre | 2 | TPU 95A | on its side | 0.2 mm, 3 walls, 15% gyroid, slow (≤ 40 mm/s) |
| tray, shelf, driver mount, arm servo mounts, skid | 1 each / 2 | PETG | flat | 0.2 mm, 3 walls, 20% |
| battery cradle | 1 | PETG | curved side down, as modelled | 0.2 mm, 3 walls, 15% gyroid; tree supports under the curve |
| dock cradle, keys | 1 / 2 | PETG | flat, curve up | 0.24 mm, 3 walls, 15%; the curve is supported by the solid behind it, no supports |
| dock tower | 1 | PETG | upright, bay opening down | 0.24 mm, 3 walls, 15%; the 20° lean needs no supports |

Heat-set inserts go in at 230 °C after printing. The bearing bores are nominal +0.05 mm on radius. Print one end
cap first and adjust `BEARING_FIT` in `params.py` to your printer.

Fit report (`uv run python build.py`, current parameters): all 36 distinct printed parts fit. The largest are
the drum halves (236 × 150 × 118, 124 for the upper with its pedestals), the end caps (229.6 × 229.6 × 22), the arms (210 × 210 diagonal), the battery
cradle (162 × 123 × 70), the winch deck (134 × 94 × 55, on its end), and the dock cradle (234 × 184 × 134) and tower (100 × 140 × 230), all against a 250 mm
per-axis limit.

## Open questions

1. **Display stack depth and weight** (Waveshare doesn't list them): measure, then set `EyeSpec.depth` and
   `EYE_KG`. The locked tendons hold the eye whatever it weighs, but with the winches slack the spring's margin
   shrinks as the eye grows (it folds at 7.46 N, about 760 g, and the sag grows as 1 / (1 − W / 7.46 N)).
2. **Camera path:** P4 CSI → USB video (one lead per stalk) vs. the IMX219 spy-cam flex to the Jetson's CSI
   (a native driver, but a flat flex up a bending spring). Prototype one stalk both ways.
3. **Measure before freezing:** STS3250 mounting holes and shaft offset; the worm motor's gearbox, holes, shaft,
   can position (the CAD centres it on the gearbox, 1.45 mm proud of the output face) and encoder size; Jetson hole
   pattern; Pololu hub PCD; spy-cam head size; pogo barrel and stroke; charge module size; the stalk spring's OD,
   wire and pitch, and its bending stiffness (hang a weight on the tip, measure the sag).
4. **Arm clamshell screws** go through the arm's full thickness. If the arm flexes at 2.9 kg, add a rib or print
   the halves at 40% infill.
5. **Sim update:** heavier eyes (about 165 g), the 1 in spring (EI 0.118 installed instead of 0.011, 8 N/mm,
   30 N of preload), tendons that hold when the winches stop, the roots on the crown at y = ±48 with 5° of splay
   instead of 25° forward, the 4S6P pack and the winches should go into `sim/bot.py` before the controllers are
   retuned. The body is 5.73 kg with its centre of mass 6 mm over the drum axis. The pack is about 1.8 kg, 31% of
   the body, centred 0.05 R forward and 0.59 R down (the sim has 0.55 R and 0.4 R). The sim's three cables at 120°
   already match.
6. **Packs in the arms.** Each arm is hollow and its hub bore (Ø19) is already the lead path, so a 4S pack can ride
   in an arm with its leads through the hub. Packs are only safe to parallel at the same voltage, so give each arm
   pack its own BMS and fuse and join it through ideal-diode ORing (or a precharge switch), not straight onto the
   main pack. It adds mass low and forward when the arms are parked, and swinging mass when they move. Size it once
   the bot runs.
7. **Pack build:** confirm the series-group busbar plan with whoever welds it, glue the layers so the nesting holds,
   and put the BMS thermistor in the bottom layer's empty slot.
8. **Winches on the bench:** check the worm really holds under 176 N (the current limit) with the power off, that
   pretensioning against a low current limit repeats to within a few newtons, the tube friction (the numbers
   assume μ 0.07), and that the 15 mm tube bends don't kink. If the friction is worse, the 90° bend runs out of
   rated torque first: move the deck tubes' bends apart, or step up to the 564:1 (2.3 N·m, over 2 s for 90°).
9. **Tendon creep:** Spectra creeps under constant load. At 10 N (3.5% of its strength) it should be slow, but
   re-tension the tendons after the first week, and have the firmware re-zero them against the current limit at
   startup.
