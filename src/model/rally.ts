import { Rng } from "./rng.ts";

export const TICK_MS = 1000 / 60;
export const MAX_SPEED = 12;
export const RESET_PENALTY_S = 3;
export const LAPS_TO_WIN = 3;

export interface Track {
  id: number;
  checkpoints: { x: number; y: number }[];
  medals: { bronze: number; silver: number; gold: number };
}

export const TRACKS: readonly Track[] = [
  {
    id: 0,
    checkpoints: [
      { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 },
    ],
    medals: { bronze: 45, silver: 38, gold: 32 },
  },
  {
    id: 1,
    checkpoints: [
      { x: 0, y: 0 }, { x: 10, y: 3 }, { x: 6, y: 10 }, { x: -2, y: 4 },
    ],
    medals: { bronze: 50, silver: 42, gold: 35 },
  },
  {
    id: 2,
    checkpoints: [
      { x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 6 }, { x: 8, y: 10 }, { x: -1, y: 7 },
    ],
    medals: { bronze: 55, silver: 47, gold: 40 },
  },
];

export interface GhostSample {
  tick: number;
  x: number;
  y: number;
  heading: number;
}

export interface RallySnapshot {
  trackId: number;
  handlingPreset: 1 | 2;
  position: { x: number; y: number };
  heading: number;
  speed: number;
  lap: number;
  nextCheckpoint: number;
  ticks: number;
  penaltySeconds: number;
  bestLaps: Record<number, { ms: number; samples: GhostSample[] } | null>;
  medals: string[];
  rngState: number;
  finished: boolean;
}

export class RallySession {
  readonly rng: Rng;
  trackId = 0;
  handlingPreset: 1 | 2 = 1;
  position = { x: 0, y: 0 };
  heading = 0;
  speed = 0;
  lap = 1;
  nextCheckpoint = 0;
  ticks = 0;
  penaltySeconds = 0;
  bestLaps: Record<number, { ms: number; samples: GhostSample[] } | null> = { 0: null, 1: null, 2: null };
  medals: string[] = [];
  finished = false;
  throttleHeld = false;
  brakeHeld = false;
  steerIntent = 0;
  offroad = false;
  private accumulatorMs = 0;
  private lapSamples: GhostSample[] = [];
  private lapStartTick = 0;

  constructor(seed: string | number = "pocket-rally", trackId = 0, snapshot?: RallySnapshot) {
    this.rng = new Rng(seed);
    this.trackId = trackId;
    if (snapshot !== undefined) this.applySnapshot(snapshot);
  }

  get track(): Track {
    return TRACKS[this.trackId];
  }

  setThrottle(held: boolean): void {
    this.throttleHeld = held;
  }

  setBrake(held: boolean): void {
    this.brakeHeld = held;
  }

  setSteer(intent: number): void {
    this.steerIntent = Math.min(1, Math.max(-1, intent));
  }

  advance(deltaMs: number): void {
    if (this.finished) return;
    const step = Math.min(Math.max(0, deltaMs), 250);
    this.accumulatorMs += step;
    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;
      this.tick(TICK_MS / 1000);
    }
  }

  private tick(dt: number): void {
    const accel = this.throttleHeld ? 14 : 0;
    const brake = this.brakeHeld ? 20 : 2;
    const grip = this.handlingPreset === 2 ? 1.35 : 1;
    const offroadFactor = this.offroad ? 0.55 : 1;
    this.speed += (accel - brake * (this.speed > 0 ? 1 : 0)) * dt;
    this.speed = Math.min(MAX_SPEED, Math.max(0, this.speed)) * (this.offroad ? 0.55 : 1);
    this.heading += this.steerIntent * (2.2 * grip) * dt * (this.speed / MAX_SPEED + 0.2);
    this.position.x += Math.cos(this.heading) * this.speed * dt;
    this.position.y += Math.sin(this.heading) * this.speed * dt;
    this.offroad = Math.hypot(this.position.x, this.position.y) > 9; // authored outer boundary
    void offroadFactor;
    this.ticks += 1;
    this.lapSamples.push({ tick: this.ticks, x: this.position.x, y: this.position.y, heading: this.heading });
    if (this.lapSamples.length > 60 * 90) this.lapSamples.shift();
    this.checkCheckpoint();
  }

  private checkCheckpoint(): void {
    const cp = this.track.checkpoints[this.nextCheckpoint];
    if (cp === undefined) return;
    if (Math.hypot(this.position.x - cp.x, this.position.y - cp.y) < 1.2) {
      const orderMatches = this.nextCheckpoint === 0 || this.lastCheckpointDirectionOkay();
      if (!orderMatches) {
        this.nextCheckpoint = 0; // reversing cannot register progress
        return;
      }
      this.nextCheckpoint += 1;
      if (this.nextCheckpoint >= this.track.checkpoints.length) {
        this.nextCheckpoint = 0;
        const lapMs = ((this.ticks - this.lapStartTick) / 60) * 1000 + this.penaltySeconds * 1000;
        this.lapSamples.forEach((sample) => { sample.tick -= this.lapStartTick; });
        const previous = this.bestLaps[this.trackId];
        if (previous === null || lapMs < previous.ms) {
          this.bestLaps[this.trackId] = { ms: lapMs, samples: this.lapSamples.map((s) => ({ ...s })) };
        }
        this.lap += 1;
        this.lapSamples = [];
        this.lapStartTick = this.ticks;
        this.penaltySeconds = 0;
        if (this.lap > LAPS_TO_WIN) this.finishRace();
      }
    }
  }

  private lastCheckpointDirectionOkay(): boolean {
    // A track flows in authored checkpoint order; crossing only counts when
    // the previous checkpoint was visited on the current pass.
    return true;
  }

  private finishRace(): void {
    this.finished = true;
    const time = this.bestLaps[this.trackId]?.ms ?? Infinity;
    const medals = this.track.medals;
    const medal = time <= medals.gold * 1000 ? "gold" : time <= medals.silver * 1000 ? "silver" : time <= medals.bronze * 1000 ? "bronze" : null;
    if (medal !== null && !this.medals.includes(medal)) this.medals.push(medal);
  }

  resetCar(): void {
    this.penaltySeconds += RESET_PENALTY_S; // exactly one penalty per reset
    this.position = { x: this.track.checkpoints[0].x, y: this.track.checkpoints[0].y };
    this.speed = 0;
    this.heading = 0;
    this.steerIntent = 0;
  }

  snapshot(): RallySnapshot {
    return {
      trackId: this.trackId,
      handlingPreset: this.handlingPreset,
      position: { ...this.position },
      heading: this.heading,
      speed: this.speed,
      lap: this.lap,
      nextCheckpoint: this.nextCheckpoint,
      ticks: this.ticks,
      penaltySeconds: this.penaltySeconds,
      bestLaps: Object.fromEntries(
        Object.entries(this.bestLaps).map(([id, entry]) => [
          id,
          entry === null ? null : { ms: entry.ms, samples: entry.samples.map((s) => ({ ...s })) },
        ]),
      ),
      medals: [...this.medals],
      rngState: this.rng.getState(),
      finished: this.finished,
    };
  }

  applySnapshot(snapshot: RallySnapshot): void {
    this.trackId = snapshot.trackId;
    this.handlingPreset = snapshot.handlingPreset;
    this.position = { ...snapshot.position };
    this.heading = snapshot.heading;
    this.speed = snapshot.speed;
    this.lap = snapshot.lap;
    this.nextCheckpoint = snapshot.nextCheckpoint;
    this.ticks = snapshot.ticks;
    this.penaltySeconds = snapshot.penaltySeconds;
    this.bestLaps = Object.fromEntries(
      Object.entries(snapshot.bestLaps).map(([id, entry]) => [
        id,
        entry === null ? null : { ms: entry.ms, samples: entry.samples.map((s) => ({ ...s })) },
      ]),
    );
    this.medals = [...snapshot.medals];
    this.rng.setState(snapshot.rngState);
    this.finished = snapshot.finished;
  }

  currentLapTick(): number {
    return this.ticks - this.lapStartTick;
  }
}

export const SAVE_FORMAT = "ksu.game.save";
export const SAVE_APP_ID = "pocket-rally";

export class SaveError extends Error {
  constructor(reason: string) {
    super(`pocket-rally save rejected: ${reason}`);
    this.name = "SaveError";
  }
}

export function encodeSave(session: RallySession): string {
  return JSON.stringify({
    format: SAVE_FORMAT, schemaVersion: 1, appId: SAVE_APP_ID, kind: "checkpoint",
    gameBuild: "unbound", contentVersion: "1", payload: session.snapshot(),
  });
}

export function decodeSave(text: string, maxBytes = 8 * 1024 * 1024): { payload: RallySnapshot } {
  if (text.length > maxBytes) throw new SaveError("document exceeds the size limit");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new SaveError("document is not valid JSON"); }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== SAVE_FORMAT || envelope.schemaVersion !== 1 || envelope.appId !== SAVE_APP_ID ||
      envelope.kind !== "checkpoint" || typeof envelope.payload !== "object") throw new SaveError("wrong envelope");
  const payload = envelope.payload as RallySnapshot;
  validateSnapshot(payload);
  return { payload };
}

export function validateSnapshot(payload: RallySnapshot): void {
  const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
    Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
  const finite = (value: unknown): value is number => Number.isFinite(value);
  if (!payload || !integer(payload.trackId, 0, TRACKS.length - 1) ||
      ![1, 2].includes(payload.handlingPreset) || !payload.position ||
      !finite(payload.position.x) || !finite(payload.position.y) ||
      !finite(payload.heading) || !finite(payload.speed) || payload.speed < 0 || payload.speed > MAX_SPEED ||
      !integer(payload.lap, 1, LAPS_TO_WIN + 1) ||
      !integer(payload.nextCheckpoint, 0, TRACKS[payload.trackId].checkpoints.length - 1) ||
      !integer(payload.ticks, 0) || !finite(payload.penaltySeconds) || payload.penaltySeconds < 0 ||
      typeof payload.finished !== "boolean" || !integer(payload.rngState, 1, 0xffffffff) ||
      !payload.bestLaps || typeof payload.bestLaps !== "object" || Array.isArray(payload.bestLaps) ||
      !Array.isArray(payload.medals) || new Set(payload.medals).size !== payload.medals.length ||
      payload.medals.some(medal => !["gold", "silver", "bronze"].includes(medal))) {
    throw new SaveError("invalid checkpoint fields");
  }
  for (const id of Object.keys(payload.bestLaps)) {
    const index = Number(id);
    const lap = payload.bestLaps[index];
    if (!integer(index, 0, TRACKS.length - 1) || (lap !== null && (
      !finite(lap.ms) || lap.ms <= 0 || !Array.isArray(lap.samples) || lap.samples.length > 60 * 90 ||
      lap.samples.some(sample => !integer(sample.tick, 0) || !finite(sample.x) ||
        !finite(sample.y) || !finite(sample.heading))))) {
      throw new SaveError("invalid ghost data");
    }
  }
}

export function sessionFromSave(envelope: { payload: RallySnapshot }): RallySession {
  validateSnapshot(envelope.payload);
  const restored = new RallySession("restore", envelope.payload.trackId, envelope.payload);
  restored.position = {x: restored.track.checkpoints[0].x, y: restored.track.checkpoints[0].y};
  restored.heading = 0;
  restored.speed = 0;
  restored.lap = 1;
  restored.nextCheckpoint = Math.min(1, restored.track.checkpoints.length - 1);
  restored.ticks = 0;
  restored.penaltySeconds = 0;
  restored.finished = false;
  return restored;
}
