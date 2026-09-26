# JevBOT Rx: what Jev is asked

All of this is built by `prepareJevRequest()` in `src/jev-request.js`. The off-the-shelf LLM receives the exact same state and questions. Each call is **one request with 1–3 typed questions**, sent every 250 ms near people, turns or crossings, and every 650 ms on a clear corridor. A question with only one possible answer is resolved locally and never sent.

## Context sent with every question (state)
- **driving_style** (hospital): "Hospital delivery robot carrying STAT medication: every second matters, so keep making steady progress. People first: pass pedestrians with a wide berth instead of freezing, yield to carts at crossings. Stop when a person is in or stepping into your path; otherwise stop only for an imminent collision or arrival."
- **units**: meters, seconds, m/s, degrees; points are [right, ahead] of the robot.
- **speed / limit**, **nav**: next turn, distance to the turn, remaining meters, direction to the destination.
- **road**: whether the robot is on the corridor floor, lane offset, corridor boundary table, body-to-edge clearances.
- **traffic** table: nearby people and carts (id, type, position, speed, heading, relative speed).
- **following / blocker / current_path_hazard**: when present.
- **candidates** table: the 12 sampled 3-second paths `v0…v11`. Each has speed, end speed, progress, route/lane/heading error, end point, and on-floor/in-lane flags. It also carries predicted **conflicts** (object and time to contact). Paths predicted to collide are removed before the model sees the list.

## Questions (all `Choice` type)
| id | Asked when | Options | Instruction (verbatim) |
|---|---|---|---|
| `motion` | Both driving and stopping are possible (indoors: also whenever a person is within about 9 m of the path) | `drive`, `stop` | "Drive includes slowing or approaching a stop line; stop means zero target speed NOW. Prefer drive when useful progress is possible. Use current conflicts, legal requirements and stop memory; proximity alone is not a reason to stop." |
| `vector` | More than one safe path exists | `v0 … v11` (only the safe ones) | "Assuming drive, choose fastest useful progress with low route/lane error. Predictions include following and curve/section speed control. Keep the whole car on asphalt: negative clearance=off-road, null edges=unknown, preview end is not road end." Situational additions: *"Conflicts are future predicted contacts; compare timing and paths. A current-path hazard may not affect another candidate."* and *"Recover toward target… clear reverse is allowed."* |
| `route` | Only after staying well off the route | route ids | "Choose a route to destination. Keep the route when on or near it. Alternatives address a sustained departure: consider join distance, direction and blocked junctions; avoid repeated reversals." |

## What code decides, not Jev
Collision prediction, removing unsafe paths, the safety brake, freshness checks, rejecting an answer that names an imminent-collision path, and turning the chosen path into steering and speed.

## Gaps worth fixing next (from the stress test)
- The `vector` instruction still says "asphalt" and "car" (inherited from JevPilot). It should describe corridors and people.
- There's no dedicated question about people. For example, a `Noul`: "Is any person about to step into the robot's path within the next 3 s?" If yes, slow down pre-emptively.
- ✅ Fixed: a full `stop` is now offered as soon as a person is within about 9 m of the path, not only at 2.5 m.
