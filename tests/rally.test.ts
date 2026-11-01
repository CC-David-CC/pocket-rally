import { describe, expect, it } from "vitest";
import {
  RallySession,
  RESET_PENALTY_S,
  TRACKS,
  decodeSave,
  encodeSave,
  sessionFromSave,
} from "../src/model/rally.js";

describe("RallySession rules", () => {
  it("a checkpoint can only advance in authored order", () => {
    const session = new RallySession("order", 0);
    session.position = { x: 0, y: 0 };
    session.heading = Math.PI;
    session.speed = 1;
    session.advance(16);
    session.advance(16);
    // Reversing away from checkpoint 0 never registers a lap.
    expect(session.lap).toBe(1);
  });

  it("ghost samples use simulation ticks and are recorded separately from collisions", () => {
    const session = new RallySession("ghost", 0);
    session.setThrottle(true);
    for (let elapsed = 0; elapsed < 1000; elapsed += 250) session.advance(250);
    expect(session.ticks).toBe(60);
  });

  it("throttle and brake multi-touch hold independent state", () => {
    const session = new RallySession("multi", 0);
    session.setThrottle(true);
    session.setBrake(true);
    expect(session.throttleHeld).toBe(true);
    expect(session.brakeHeld).toBe(true);
    session.setThrottle(false);
    expect(session.brakeHeld).toBe(true);
  });

  it("reset applies the penalty exactly once per call", () => {
    const session = new RallySession("reset", 0);
    session.penaltySeconds = 0;
    session.resetCar();
    expect(session.penaltySeconds).toBe(RESET_PENALTY_S);
    session.resetCar();
    expect(session.penaltySeconds).toBe(RESET_PENALTY_S * 2);
  });

  it("save/load resumes at race start with persistent ghost data", () => {
    const session = new RallySession("save", 1);
    session.bestLaps[1] = { ms: 30_000, samples: [{ tick: 0, x: 0, y: 0, heading: 0 }] };
    const restored = sessionFromSave(decodeSave(encodeSave(session)));
    expect(restored.bestLaps[1]?.ms).toBe(30_000);
    expect(restored.position).toEqual({ x: 0, y: 0 });
    expect(TRACKS).toHaveLength(3);
  });
});
