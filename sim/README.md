# sim

The mosfet bot in MuJoCo.

A drum on its side, on two wheels that ride long arms pivoting high on the drum.
Parked, the arms splay forward and it tips back onto a skid on the drum: three
points, no balancing. To move, it stands up: the arms swing to vertical, the
wheels come under the drum and lift it off the floor, and it balances and drives
on two wheels like a Segway. To stop, it sits back down on the skid. A battery
low and forward in the drum keeps weight on the wheels.

Each eye is a round memory LCD with a camera module in a bump on its rim, on a
stalk that is a spring column in a tube: a chain of short segments with springy
joints and three cables, 120 degrees apart, running through guide discs to the
tip. Pull one or two cables and the stalk bends toward them; let go and it
springs back. A full 25 N pull bends a stalk about 160 degrees; the guide discs
are what buy that (against the bare tube the same pull manages 80). Each eye has
a real MuJoCo camera.

Proportions come from the tuned 2D character (`web/src/face/critter.ts`,
`DEFAULT_GEOMETRY`), scaled so the drum radius is 6 cm.

## Run it

```sh
# mjpython needs a framework Python on macOS; uv's standalone builds fail to load libpython.
uv venv --python /opt/homebrew/opt/python@3.12/bin/python3.12
uv pip install mujoco numpy pillow
.venv/bin/mjpython run.py          # viewer (macOS needs mjpython)
.venv/bin/python run.py --snapshot bot.png
.venv/bin/python check.py          # headless physics checks
```

## Controls

| Actuator | Range | Does |
|---|---|---|
| `arm_left`, `arm_right` | -1.4..1.4 rad | arm swing; negative swings the wheel forward |
| `wheel_left`, `wheel_right` | -0.6..0.6 N·m | wheel torque; positive drives forward |
| `stalk_{left,right}_cable{0,1,2}` | -25..0 N | cable pull; cable 1 is at the back |

Cameras: `follow`, `face`, `stalk_left_camera`, `stalk_right_camera`.

Stalk gestures: W wave, P point, R reach (pokes the ball), C curl. The stalks
collide with the world, so they work as limbs. They are also heavy enough to
unbalance the bot, so `run.py` calms them while it stands up or sits down.

## Expressions

`eyes.py` draws each round display and poses the stalks for it. In the viewer:
1-8 pick an expression, 0 goes back to looking around, B blinks, D pauses or
resumes driving. `run.py --faces faces.png` renders them all close up.

## Driving

`controller.py` runs it: `BotController(model).update(data, Command(move, speed, turn_rate))`
every physics step. Modes go sitting → standing_up → balancing → sitting_down.
Balancing is LQR (`lqr.py`), with gains computed from MuJoCo's own
linearization around the pose where the center of mass is over the axle.
Standing up pinches first (one arm forward, one back) so the wheels straddle the
drum and it cannot roll away from the arm motors, then lifts;
sitting down nudges the base forward, brakes, and swings the arms out so it
tips back onto the skid.
