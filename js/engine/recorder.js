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

/**
 * Frames of run-up and follow-through around a highlight.
 *
 * The follow-through has to outlast the slow-motion window or a clip snaps
 * back to full speed and then ends almost immediately, which reads as the cut
 * arriving early.
 */
export const LEAD_IN = 50;
export const LEAD_OUT = 46;

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
   * Picks the moments to cut to: the best few, spread out so the reel does not
   * replay the same two seconds from three angles, always ending on the
   * finish.
   */
  build({ maxClips = 4, minGap = 90 } = {}) {
    const total = this.frames.length;
    if (total < 30) return null;

    const finish = this.marks.filter(m => m.kind === 'finish').at(-1)
      ?? { frame: total - 1 + this.dropped, kind: 'finish', label: LABELS.finish, weight: 99 };

    const candidates = this.marks
      .filter(m => m.kind !== 'finish')
      .sort((a, b) => b.weight - a.weight || a.frame - b.frame);

    const chosen = [];
    for (const mark of candidates) {
      if (chosen.length >= maxClips - 1) break;
      // Do not cut to two moments that are practically the same instant.
      if (chosen.some(c => Math.abs(c.frame - mark.frame) < minGap)) continue;
      if (Math.abs(finish.frame - mark.frame) < minGap) continue;
      chosen.push(mark);
    }

    chosen.push(finish);
    chosen.sort((a, b) => a.frame - b.frame);

    const clips = chosen.map(mark => {
      const at = mark.frame - this.dropped;
      return {
        label: mark.label,
        kind: mark.kind,
        at,
        from: Math.max(0, at - LEAD_IN),
        to: Math.min(total - 1, at + LEAD_OUT),
      };
    }).filter(clip => clip.to > clip.from + 8);

    if (!clips.length) return null;
    return { frames: this.frames, clips };
  }
}
