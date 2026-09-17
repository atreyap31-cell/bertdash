// Level editor.
//
// Fixes versus the original: the camera pans on both axes (it could previously
// only reach the top 600px of a 6000px-tall level), the scroll handler is
// scoped to the canvas instead of the whole window, drawing runs on rAF rather
// than a 30ms interval, and the Test button is wired to a handler that exists.

import { el, toast, confirmDialog } from './dom.js';
import { COLORS, VIEW_W, VIEW_H } from '../data/config.js';
import { profile } from '../services/profile.js';
import { audio } from '../services/audio.js';

const GRID = 40;

const TOOLS = [
  { id: 'static',    label: 'Platform',  color: COLORS.platform,   w: GRID, h: GRID },
  { id: 'moving',    label: 'Moving',    color: COLORS.moving,     w: 120,  h: 20 },
  { id: 'vanishing', label: 'Vanishing', color: COLORS.vanishing,  w: 120,  h: 20 },
  { id: 'spike',     label: 'Spikes',    color: COLORS.spike,      w: GRID, h: 20 },
  { id: 'laser',     label: 'Laser',     color: COLORS.laserOn,    w: 10,   h: 160 },
  { id: 'door',      label: 'Door',      color: COLORS.door,       w: GRID, h: 120 },
  { id: 'conveyor',  label: 'Conveyor',  color: COLORS.conveyor,   w: 200,  h: 20 },
  { id: 'start',     label: 'Start',     color: COLORS.player,     w: 32,   h: 48 },
  { id: 'food',      label: 'Bag',       color: COLORS.food,       w: 26,   h: 26 },
  { id: 'goal',      label: 'Bert',      color: '#fbbf24',         w: 40,   h: 60 },
  { id: 'eraser',    label: 'Eraser',    color: '#ef4444',         w: GRID, h: GRID },
];

const snap = value => Math.floor(value / GRID) * GRID;

export class Editor {
  /**
   * @param {object|null} existing level to edit, or null for a new one
   * @param {object} handlers { onClose, onTest }
   */
  constructor(existing, handlers) {
    this.handlers = handlers;
    this.tool = 'static';
    this.cam = { x: 0, y: 0 };
    this.mouse = { x: 0, y: 0 };
    this.painting = false;
    this.panning = false;
    this.panOrigin = null;
    this.rafId = null;

    const source = existing ?? {};
    this.id = source.id ?? `custom-${Date.now()}`;
    this.title = source.title ?? 'Untitled Level';
    this.width = source.width ?? 3000;
    this.height = source.height ?? 1200;
    this.background = source.background ?? '#0f172a';
    this.platforms = structuredClone(source.platforms ?? defaultFloor(this.width));
    this.start = { ...(source.startPos ?? { x: 120, y: 400 }) };
    this.goal = { ...(source.goalPos ?? { x: 2600, y: 440 }) };
    this.food = { ...(source.foodPos ?? { x: 180, y: 400 }) };
    this.physics = {
      gravityScale: 1,
      moveSpeedScale: 1,
      jumpForceScale: 1,
      windX: 0,
      wallSlideEnabled: true,
      ...(source.physics ?? {}),
    };

    this.root = this.#build();
    this.#loop();
  }

  // --- layout --------------------------------------------------------------

  #build() {
    this.canvas = el('canvas.editor__canvas', { width: VIEW_W, height: VIEW_H });
    this.ctx = this.canvas.getContext('2d');

    this.canvas.addEventListener('pointerdown', this.#onPointerDown);
    this.canvas.addEventListener('pointermove', this.#onPointerMove);
    this.canvas.addEventListener('pointerup', this.#onPointerUp);
    this.canvas.addEventListener('pointerleave', this.#onPointerUp);
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    // Scoped to the canvas: the old build listened on window, so the wheel
    // scrolled the level even when you were over the sidebar.
    this.canvas.addEventListener('wheel', this.#onWheel, { passive: false });

    this.titleInput = el('input.input.editor__title', {
      value: this.title,
      maxLength: 40,
      oninput: event => { this.title = event.target.value; },
    });

    this.hint = el('div.editor__hint');

    return el('div.editor', [
      el('header.editor__bar', [
        el('div.editor__brand', [el('span.editor__logo', 'BERT LABS'), this.titleInput]),
        el('div.editor__bar-actions', [
          el('button.btn.btn--sm.btn--ghost', { onclick: () => this.#test() }, 'Test'),
          el('button.btn.btn--sm.btn--primary', { onclick: () => this.#save() }, 'Save'),
          el('button.btn.btn--sm.btn--ghost', { onclick: () => this.#close() }, 'Close'),
        ]),
      ]),
      el('div.editor__body', [
        el('aside.editor__side', [
          el('div.editor__group', [
            el('h4.editor__group-title', 'Pieces'),
            el('div.tool-grid', TOOLS.map(tool => el(
              `button.tool${this.tool === tool.id ? '.is-active' : ''}`,
              { onclick: event => this.#selectTool(tool.id, event.currentTarget), dataset: { tool: tool.id } },
              [el('span.tool__swatch', { style: { background: tool.color } }), el('span.tool__label', tool.label)],
            ))),
          ]),
          el('div.editor__group', [
            el('h4.editor__group-title', 'World'),
            this.#slider('Width', 'width', 800, 8000, 200),
            this.#slider('Height', 'height', 600, 6000, 200),
          ]),
          el('div.editor__group', [
            el('h4.editor__group-title', 'Physics'),
            this.#physicsSlider('Gravity', 'gravityScale', 0.3, 2, 0.1),
            this.#physicsSlider('Run speed', 'moveSpeedScale', 0.5, 2, 0.1),
            this.#physicsSlider('Jump', 'jumpForceScale', 0.6, 1.8, 0.1),
            this.#physicsSlider('Wind', 'windX', -1.5, 1.5, 0.1),
            el('label.setting', [
              el('input', {
                type: 'checkbox',
                checked: this.physics.wallSlideEnabled,
                onchange: event => { this.physics.wallSlideEnabled = event.target.checked; },
              }),
              el('div', [el('span.setting__label', 'Wall sliding')]),
            ]),
          ]),
          el('div.editor__group', [
            el('button.btn.btn--sm.btn--danger.is-block', {
              onclick: async () => {
                if (await confirmDialog('Clear every piece in this level?', { confirmLabel: 'Clear' })) {
                  this.platforms = [];
                }
              },
            }, 'Clear all'),
          ]),
        ]),
        el('div.editor__stage', [this.canvas, this.hint]),
      ]),
    ]);
  }

  #slider(label, key, min, max, step) {
    const out = el('span.slider__value', String(this[key]));
    return el('label.slider', [
      el('span.slider__label', [label, out]),
      el('input', {
        type: 'range', min, max, step, value: this[key],
        oninput: event => {
          this[key] = Number(event.target.value);
          out.textContent = String(this[key]);
          this.#clampCamera();
        },
      }),
    ]);
  }

  #physicsSlider(label, key, min, max, step) {
    const out = el('span.slider__value', String(this.physics[key]));
    return el('label.slider', [
      el('span.slider__label', [label, out]),
      el('input', {
        type: 'range', min, max, step, value: this.physics[key],
        oninput: event => {
          this.physics[key] = Number(event.target.value);
          out.textContent = String(this.physics[key]);
        },
      }),
    ]);
  }

  #selectTool(id, button) {
    this.tool = id;
    button.parentElement.querySelectorAll('.tool').forEach(node =>
      node.classList.toggle('is-active', node.dataset.tool === id));
  }

  // --- input ---------------------------------------------------------------

  #toWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (VIEW_W / rect.width) + this.cam.x,
      y: (event.clientY - rect.top) * (VIEW_H / rect.height) + this.cam.y,
    };
  }

  #onPointerDown = event => {
    event.preventDefault();
    // Capture keeps a drag alive if the cursor leaves the canvas. It throws for
    // a pointer id the browser isn't tracking, which must not abort placement.
    try { this.canvas.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    // Middle or right button pans; that is how you reach the rest of a tall level.
    if (event.button === 1 || event.button === 2) {
      this.panning = true;
      this.panOrigin = { x: event.clientX, y: event.clientY, cx: this.cam.x, cy: this.cam.y };
      return;
    }
    this.painting = true;
    this.#place(this.#toWorld(event));
  };

  #onPointerMove = event => {
    const world = this.#toWorld(event);
    this.mouse = world;

    if (this.panning && this.panOrigin) {
      const rect = this.canvas.getBoundingClientRect();
      this.cam.x = this.panOrigin.cx - (event.clientX - this.panOrigin.x) * (VIEW_W / rect.width);
      this.cam.y = this.panOrigin.cy - (event.clientY - this.panOrigin.y) * (VIEW_H / rect.height);
      this.#clampCamera();
      return;
    }
    if (this.painting) this.#place(world);
  };

  #onPointerUp = event => {
    this.painting = false;
    this.panning = false;
    this.panOrigin = null;
    try {
      if (event?.pointerId != null && this.canvas.hasPointerCapture?.(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch { /* capture already gone */ }
  };

  #onWheel = event => {
    event.preventDefault();
    // Shift-wheel scrolls horizontally, plain wheel vertically.
    if (event.shiftKey) this.cam.x += event.deltaY;
    else this.cam.y += event.deltaY;
    this.#clampCamera();
  };

  #clampCamera() {
    this.cam.x = Math.max(0, Math.min(this.cam.x, Math.max(0, this.width - VIEW_W)));
    this.cam.y = Math.max(0, Math.min(this.cam.y, Math.max(0, this.height - VIEW_H)));
  }

  #place({ x, y }) {
    const gx = snap(x);
    const gy = snap(y);
    const tool = TOOLS.find(t => t.id === this.tool);

    if (this.tool === 'start') { this.start = { x: gx, y: gy }; return; }
    if (this.tool === 'goal')  { this.goal = { x: gx + 20, y: gy + 30 }; return; }
    if (this.tool === 'food')  { this.food = { x: gx, y: gy }; return; }

    if (this.tool === 'eraser') {
      this.platforms = this.platforms.filter(p =>
        !(x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height));
      return;
    }

    // Don't stack identical pieces on the same cell while dragging.
    if (this.platforms.some(p => p.x === gx && p.y === gy && p.type === effectiveType(this.tool))) return;

    const piece = { x: gx, y: gy, width: tool.w, height: tool.h, type: effectiveType(this.tool) };
    if (this.tool === 'moving') { piece.velX = 3; piece.range = 240; piece.startPos = { x: gx, y: gy }; }
    if (this.tool === 'vanishing') piece.opacity = 1;
    if (this.tool === 'laser') { piece.interval = 2000; piece.offset = 0; }
    if (this.tool === 'door') { piece.interval = 3000; piece.offset = 0; }
    if (this.tool === 'conveyor') piece.conveyorVel = 3;
    this.platforms.push(piece);
  }

  // --- drawing -------------------------------------------------------------

  #loop = () => {
    this.rafId = requestAnimationFrame(this.#loop);
    this.#draw();
  };

  #draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));

    // Grid, drawn only across the visible window rather than the whole level.
    const left = snap(this.cam.x) - GRID;
    const top = snap(this.cam.y) - GRID;
    ctx.strokeStyle = 'rgba(148,163,184,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = left; x <= this.cam.x + VIEW_W + GRID; x += GRID) {
      ctx.moveTo(x + 0.5, this.cam.y);
      ctx.lineTo(x + 0.5, this.cam.y + VIEW_H);
    }
    for (let y = top; y <= this.cam.y + VIEW_H + GRID; y += GRID) {
      ctx.moveTo(this.cam.x, y + 0.5);
      ctx.lineTo(this.cam.x + VIEW_W, y + 0.5);
    }
    ctx.stroke();

    // Level bounds
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, this.width, this.height);

    for (const p of this.platforms) {
      ctx.fillStyle = pieceColor(p);
      if (p.type === 'spike') {
        ctx.beginPath();
        const teeth = Math.max(1, Math.floor(p.width / 20));
        const step = p.width / teeth;
        for (let i = 0; i < teeth; i++) {
          ctx.moveTo(p.x + i * step, p.y + p.height);
          ctx.lineTo(p.x + i * step + step / 2, p.y);
          ctx.lineTo(p.x + (i + 1) * step, p.y + p.height);
        }
        ctx.fill();
      } else {
        ctx.globalAlpha = p.type === 'vanishing' ? 0.55 : 1;
        ctx.fillRect(p.x, p.y, p.width, p.height);
        ctx.globalAlpha = 1;
      }
      if (p.type === 'moving') this.#drawRangeHint(ctx, p);
      if (p.conveyorVel) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillText(p.conveyorVel > 0 ? '→' : '←', p.x + p.width / 2, p.y + p.height - 5);
      }
    }

    this.#drawMarker(ctx, this.start.x, this.start.y, 32, 48, COLORS.player, 'START');
    this.#drawMarker(ctx, this.food.x, this.food.y, 26, 26, COLORS.food, 'BAG');
    this.#drawMarker(ctx, this.goal.x - 20, this.goal.y - 30, 40, 60, '#fbbf24', 'BERT');

    // Ghost of the piece about to be placed
    const tool = TOOLS.find(t => t.id === this.tool);
    if (tool && !['start', 'goal', 'food'].includes(tool.id)) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = tool.color;
      ctx.fillRect(snap(this.mouse.x), snap(this.mouse.y), tool.w, tool.h);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    this.hint.textContent =
      `${this.platforms.length} pieces · ${Math.round(this.mouse.x)}, ${Math.round(this.mouse.y)}`
      + ' · wheel scrolls, shift+wheel pans sideways, right-drag moves the camera';
  }

  #drawRangeHint(ctx, p) {
    const from = p.startPos ?? { x: p.x, y: p.y };
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS.moving;
    ctx.strokeRect(from.x, from.y, (p.range ?? 0) + p.width, p.height);
    ctx.restore();
  }

  #drawMarker(ctx, x, y, w, h, color, label) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y - 6);
    ctx.textAlign = 'left';
  }

  // --- save / test ---------------------------------------------------------

  #toLevel(idOverride) {
    return {
      id: idOverride ?? this.id,
      title: this.title.trim() || 'Untitled Level',
      description: 'Custom level',
      width: this.width,
      height: this.height,
      platforms: structuredClone(this.platforms),
      vehicles: [],
      powerups: [],
      startPos: { ...this.start },
      goalPos: { ...this.goal },
      foodPos: { ...this.food },
      background: this.background,
      theme: this.height > this.width ? 'vertical' : 'horizontal',
      isFinalLevel: false,
      physics: { ...this.physics },
    };
  }

  /** Catches the mistakes that would produce an unplayable level. */
  #validate() {
    const problems = [];
    const inside = point => point.x >= 0 && point.x <= this.width && point.y >= 0 && point.y <= this.height;
    if (!this.platforms.length) problems.push('there are no platforms');
    if (!inside(this.start)) problems.push('the start marker is outside the level');
    if (!inside(this.goal)) problems.push('Bert is outside the level');
    if (!inside(this.food)) problems.push('the bag is outside the level');
    if (Math.hypot(this.start.x - this.goal.x, this.start.y - this.goal.y) < 120) {
      problems.push('the start and Bert are almost on top of each other');
    }
    return problems;
  }

  #save() {
    const problems = this.#validate();
    if (problems.length) {
      toast(`Cannot save: ${problems[0]}.`, { tone: 'bad', duration: 4000 });
      return;
    }
    profile.saveCustomLevel(this.#toLevel());
    audio.pickup();
    toast(`Saved "${this.title}"`, { icon: '⚒', tone: 'good' });
  }

  #test() {
    const problems = this.#validate();
    if (problems.length) {
      toast(`Cannot test: ${problems[0]}.`, { tone: 'bad', duration: 4000 });
      return;
    }
    // This is the call that crashed in the old build — App passed
    // `onStartCustomGame` while the editor invoked `onPlay`.
    this.handlers.onTest(this.#toLevel('custom-test'));
  }

  #close() {
    this.handlers.onClose();
  }

  destroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.canvas.removeEventListener('wheel', this.#onWheel);
    this.root.remove();
  }
}

function effectiveType(tool) {
  return tool === 'conveyor' ? 'static' : tool;
}

function pieceColor(p) {
  if (p.type === 'spike') return COLORS.spike;
  if (p.type === 'laser') return COLORS.laserOn;
  if (p.type === 'door') return COLORS.door;
  if (p.type === 'moving') return COLORS.moving;
  if (p.type === 'vanishing') return COLORS.vanishing;
  if (p.conveyorVel) return COLORS.conveyor;
  return COLORS.platform;
}

function defaultFloor(width) {
  return [{ x: 0, y: 520, width, height: 80, type: 'static' }];
}
