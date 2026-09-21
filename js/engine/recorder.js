// Records a run so it can be played back as a highlight reel.
//
// This stores state rather than inputs. Replaying inputs would mean
// re-simulating, which desyncs the moment any physics constant changes; a
// state track always plays back exactly what happened.
//
// Notable moments are marked as they occur. The flow system already scores how
// impressive each move is, so those weights double as "how worth watching is
// this" — a bag bounce outranks a plain jump without a second table.

/** Roughly four minutes at 60Hz. Long runs keep their most recent frames. */
const MAX_FRAMES = 14000;

/** Labels for the moments worth cutting to. */
const LABELS = {
  bagBounce: 'BAG BOUNCE',
  airDelivery: 'SPECIAL DELIVERY',
  diveBounce: 'DIVE REBOUND',
  wallKick: 'WALL KICK',
  longJump: 'LONG JUMP',
  catch: 'CAUGHT IT',
  dive: 'DIVE',
  airJump: 'AIR JUMP',
  nearMiss: 'CLOSE CALL',
  finish: 'DELIVERED',
};

export class Recorder {
  constructor() {
    this.frames = [];
    this.marks = [];
    this.dropped = 0;       // frames trimmed off the front of a long run
  }

  /** Snapshots the visible state of one simulation step. */
  record(game) {
    const p = game.player;
    const f = game.food;
    this.frames.push({
      x: p.x, y: p.y, w: p.width, h: p.height,
      face: p.facingRight,
      slide: p.sliding, dive: p.diving, wall: p.wallSliding, wallDir: p.wallDir,
      vx: p.vx, vy: p.vy,
      veh: p.vehicle?.type ?? null,
      shield: p.buffs.shield > 0, magnet: p.buffs.magnet > 0,
      speed: p.buffs.speed > 0, jump: p.buffs.jump > 0,
      hasFood: p.hasFood,
      fx: f.x, fy: f.y, fair: f.airborne,
      t: game.elapsed,
      flow: game.flow,
    });

    // Keep the most recent window: the end of a run is what a reel wants.
    if (this.frames.length > MAX_FRAMES) {
      this.frames.shift();
      this.dropped++;
    }
  }

  /**
   * Flags the current frame as notable. `weight` is the flow value of the
   * move, which is already a decent proxy for how good it looks.
   */
  mark(kind, weight) {
    const label = LABELS[kind];
    if (!label) return;
    this.marks.push({ frame: this.frames.length - 1 + this.dropped, kind, label, weight });
  }

  /**
   * The whole run, as one continuous take.
   *
   * This used to cut a montage: pick the best few marked moments, drop into
   * slow motion across each one and cut between them. It looked like a trailer
   * and read like one too — you could not follow what you had actually done.
   * Watching the run back from the player's own view is more useful and a lot
   * less fussy.
   *
   * The marks survive because they still earn their keep: the replay names
   * each move as it goes past.
   */
  build() {
    const total = this.frames.length;
    if (total < 30) return null;
    return {
      frames: this.frames,
      dropped: this.dropped,
      marks: this.marks,
      clips: [{ label: '', kind: 'run', at: 0, from: 0, to: total - 1 }],
    };
  }

}
