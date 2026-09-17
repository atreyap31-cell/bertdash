// Level editor ("Bert Labs").
//
// Beyond stamping blocks this supports selection and multi-select, editing the
// properties of whatever is selected, undo/redo, copy/paste, rectangle fill,
// zoom, a minimap, and placing vehicles and powerups — none of which the
// original editor could do.

import { el, toast, confirmDialog } from './dom.js';
import { COLORS, POWERUP_TYPES, POWERUP_BY_ID, VIEW_W, VIEW_H } from '../data/config.js';
import { profile } from '../services/profile.js';
import { audio } from '../services/audio.js';

const GRID = 40;
const HISTORY_LIMIT = 80;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2;

/** Everything you can place, grouped for the sidebar. */
const TOOLS = [
  { id: 'select',    label: 'Select',    group: 'Tools',   color: '#e2e8f0' },
  { id: 'eraser',    label: 'Eraser',    group: 'Tools',   color: '#ef4444' },

  { id: 'static',    label: 'Platform',  group: 'Terrain', color: COLORS.platform,  w: GRID, h: GRID },
  { id: 'moving',    label: 'Moving',    group: 'Terrain', color: COLORS.moving,    w: 120,  h: 20 },
  { id: 'vanishing', label: 'Vanishing', group: 'Terrain', color: COLORS.vanishing, w: 120,  h: 20 },
  { id: 'conveyor',  label: 'Conveyor',  group: 'Terrain', color: COLORS.conveyor,  w: 200,  h: 20 },

  { id: 'spike',     label: 'Spikes',    group: 'Hazards', color: COLORS.spike,     w: GRID, h: 20 },
  { id: 'laser',     label: 'Laser',     group: 'Hazards', color: COLORS.laserOn,   w: 10,   h: 160 },
  { id: 'door',      label: 'Door',      group: 'Hazards', color: COLORS.door,      w: GRID, h: 120 },

  { id: 'bike',      label: 'Bike',      group: 'Pickups', color: COLORS.bike,      w: 56,   h: 34 },
  { id: 'car',       label: 'Car',       group: 'Pickups', color: COLORS.car,       w: 80,   h: 40 },
  ...POWERUP_TYPES.map(pu => ({
    id: `pu-${pu.id}`, label: pu.label, group: 'Pickups',
    color: pu.color, w: 30, h: 30, powerup: pu.id,
  })),

  { id: 'start',     label: 'Start',     group: 'Markers', color: COLORS.player,    w: 32,   h: 48 },
  { id: 'food',      label: 'Bag',       group: 'Markers', color: COLORS.food,      w: 26,   h: 26 },
  { id: 'goal',      label: 'Bert',      group: 'Markers', color: '#fbbf24',        w: 40,   h: 60 },
];

const TOOL_BY_ID = Object.fromEntries(TOOLS.map(t => [t.id, t]));
const GROUPS = ['Tools', 'Terrain', 'Hazards', 'Pickups', 'Markers'];
const RECT_TOOLS = new Set(['static', 'spike', 'conveyor', 'vanishing']);

const snap = v => Math.floor(v / GRID) * GRID;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const uid = prefix => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

const boxOf = item => ({ x: item.x, y: item.y, width: item.width, height: item.height });

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
}

function normaliseRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export class Editor {
  /**
   * @param {object|null} existing level to edit, or null for a new one
   * @param {object} handlers { onClose, onTest }
   */
  constructor(existing, handlers) {
    this.handlers = handlers;
    this.tool = 'static';
    this.cam = { x: 0, y: 0 };
    this.zoom = 1;
    this.mouse = { x: 0, y: 0 };
    this.selection = new Set();
    this.clipboard = [];
    this.history = [];
    this.historyIndex = -1;
    this.drag = null;
    this.rafId = null;

    const source = existing ?? {};
    this.id = source.id ?? `custom-${Date.now()}`;
    this.title = source.title ?? 'Untitled Level';
    this.width = source.width ?? 3000;
    this.height = source.height ?? 1200;
    this.background = source.background ?? '#0f172a';
    this.platforms = structuredClone(source.platforms ?? defaultFloor(this.width));
    // Vehicles and powerups are authored as {pos:{x,y}}; the editor works in
    // flat x/y like everything else and converts back on save.
    this.vehicles = (source.vehicles ?? []).map(v => ({
      kind: 'vehicle', id: v.id ?? uid('v'), type: v.type === 'car' ? 'car' : 'bike',
      x: v.pos?.x ?? v.x ?? 0, y: v.pos?.y ?? v.y ?? 0,
      width: v.width ?? 56, height: v.height ?? 34,
    }));
    this.powerups = (source.powerups ?? []).map(p => ({
      kind: 'powerup', id: p.id ?? uid('pu'),
      type: POWERUP_BY_ID[p.type] ? p.type : 'speed',
      x: p.pos?.x ?? p.x ?? 0, y: p.pos?.y ?? p.y ?? 0,
      width: p.width ?? 30, height: p.height ?? 30,
    }));
    this.start = { ...(source.startPos ?? { x: 120, y: 400 }) };
    this.goal = { ...(source.goalPos ?? { x: 2600, y: 440 }) };
    this.food = { ...(source.foodPos ?? { x: 180, y: 400 }) };
    this.physics = {
      gravityScale: 1, moveSpeedScale: 1, jumpForceScale: 1,
      windX: 0, wallSlideEnabled: true,
      ...(source.physics ?? {}),
    };

    this.root = this.#build();
    this.#pushHistory();
    this.#loop();
  }

  // --- history -------------------------------------------------------------

  #snapshot() {
    return JSON.stringify({
      platforms: this.platforms, vehicles: this.vehicles, powerups: this.powerups,
      start: this.start, goal: this.goal, food: this.food,
      width: this.width, height: this.height,
      background: this.background, physics: this.physics,
    });
  }

  #pushHistory() {
    const shot = this.#snapshot();
    if (this.history[this.historyIndex] === shot) return; // nothing actually changed
    this.history.length = this.historyIndex + 1;          // drop the redo branch
    this.history.push(shot);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.#updateHistoryButtons();
  }

  #restore(json) {
    const d = JSON.parse(json);
    this.platforms = d.platforms;
    this.vehicles = d.vehicles;
    this.powerups = d.powerups;
    this.start = d.start;
    this.goal = d.goal;
    this.food = d.food;
    this.width = d.width;
    this.height = d.height;
    this.background = d.background;
    this.physics = d.physics;
    this.selection.clear();
    this.#syncControls();
  }

  #undo() {
    if (this.historyIndex <= 0) return;
    this.#restore(this.history[--this.historyIndex]);
    this.#updateHistoryButtons();
  }

  #redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.#restore(this.history[++this.historyIndex]);
    this.#updateHistoryButtons();
  }

  #updateHistoryButtons() {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = this.historyIndex <= 0;
    this.redoBtn.disabled = this.historyIndex >= this.history.length - 1;
  }

  // --- layout --------------------------------------------------------------

  #build() {
    this.canvas = el('canvas.editor__canvas', { width: VIEW_W, height: VIEW_H });
    this.ctx = this.canvas.getContext('2d');

    this.canvas.addEventListener('pointerdown', this.#onPointerDown);
    this.canvas.addEventListener('pointermove', this.#onPointerMove);
    this.canvas.addEventListener('pointerup', this.#onPointerUp);
    this.canvas.addEventListener('pointerleave', this.#onPointerUp);
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    // Scoped to the canvas: the old build listened on window, so the wheel
    // scrolled the level even with the cursor over the sidebar.
    this.canvas.addEventListener('wheel', this.#onWheel, { passive: false });
    addEventListener('keydown', this.#onKeyDown);

    this.titleInput = el('input.input.editor__title', {
      value: this.title, maxLength: 40,
      oninput: e => { this.title = e.target.value; },
    });
    this.hint = el('div.editor__hint');
    this.propsPanel = el('div.editor__props');
    this.undoBtn = el('button.btn.btn--sm.btn--ghost',
      { onclick: () => this.#undo(), title: 'Undo (Ctrl+Z)' }, 'Undo');
    this.redoBtn = el('button.btn.btn--sm.btn--ghost',
      { onclick: () => this.#redo(), title: 'Redo (Ctrl+Shift+Z)' }, 'Redo');

    return el('div.editor', [
      el('header.editor__bar', [
        el('div.editor__brand', [el('span.editor__logo', 'BERT LABS'), this.titleInput]),
        el('div.editor__bar-actions', [
          this.undoBtn, this.redoBtn,
          el('button.btn.btn--sm.btn--ghost', { onclick: () => this.#test() }, 'Test'),
          el('button.btn.btn--sm.btn--primary', { onclick: () => this.#save() }, 'Save'),
          el('button.btn.btn--sm.btn--ghost', { onclick: () => this.handlers.onClose() }, 'Close'),
        ]),
      ]),
      el('div.editor__body', [
        el('aside.editor__side', [
          ...GROUPS.map(group => el('div.editor__group', [
            el('h4.editor__group-title', group),
            el('div.tool-grid', TOOLS.filter(t => t.group === group).map(tool =>
              el(`button.tool${this.tool === tool.id ? '.is-active' : ''}`, {
                onclick: () => this.#selectTool(tool.id),
                dataset: { tool: tool.id },
                title: tool.label,
              }, [
                el('span.tool__swatch', { style: { background: tool.color } }),
                el('span.tool__label', tool.label),
              ]))),
          ])),
          el('div.editor__group', [
            el('h4.editor__group-title', 'World'),
            this.#slider('Width', 'width', 800, 8000, 200),
            this.#slider('Height', 'height', 600, 6000, 200),
            el('label.field', [
              el('span.field__label', 'Background'),
              el('input.color-input', {
                type: 'color', value: this.background,
                oninput: e => { this.background = e.target.value; },
                onchange: () => this.#pushHistory(),
              }),
            ]),
          ]),
          el('div.editor__group', [
            el('h4.editor__group-title', 'Physics'),
            this.#physicsSlider('Gravity', 'gravityScale', 0.3, 2, 0.1),
            this.#physicsSlider('Run speed', 'moveSpeedScale', 0.5, 2, 0.1),
            this.#physicsSlider('Jump', 'jumpForceScale', 0.6, 1.8, 0.1),
            this.#physicsSlider('Wind', 'windX', -1.5, 1.5, 0.1),
            el('label.setting', [
              el('input', {
                type: 'checkbox', checked: this.physics.wallSlideEnabled,
                onchange: e => { this.physics.wallSlideEnabled = e.target.checked; this.#pushHistory(); },
              }),
              el('div', [el('span.setting__label', 'Wall sliding')]),
            ]),
          ]),
          el('div.editor__group', [
            el('button.btn.btn--sm.btn--danger.is-block', {
              onclick: async () => {
                if (await confirmDialog('Clear every piece in this level?', { confirmLabel: 'Clear' })) {
                  this.platforms = [];
                  this.vehicles = [];
                  this.powerups = [];
                  this.selection.clear();
                  this.#pushHistory();
                  this.#renderProps();
                }
              },
            }, 'Clear all'),
          ]),
        ]),
        el('div.editor__stage', [this.canvas, this.propsPanel, this.hint]),
      ]),
    ]);
  }

  #slider(label, key, min, max, step) {
    const out = el('span.slider__value', String(this[key]));
    const input = el('input', {
      type: 'range', min, max, step, value: this[key],
      oninput: e => {
        this[key] = Number(e.target.value);
        out.textContent = String(this[key]);
        this.#clampCamera();
      },
      onchange: () => this.#pushHistory(),
    });
    this[`ctl_${key}`] = { input, out };
    return el('label.slider', [el('span.slider__label', [label, out]), input]);
  }

  #physicsSlider(label, key, min, max, step) {
    const out = el('span.slider__value', String(this.physics[key]));
    const input = el('input', {
      type: 'range', min, max, step, value: this.physics[key],
      oninput: e => {
        this.physics[key] = Number(e.target.value);
        out.textContent = String(this.physics[key]);
      },
      onchange: () => this.#pushHistory(),
    });
    this[`ctl_phys_${key}`] = { input, out };
    return el('label.slider', [el('span.slider__label', [label, out]), input]);
  }

  /** Re-syncs sidebar widgets after undo/redo changes the values underneath. */
  #syncControls() {
    for (const key of ['width', 'height']) {
      const ctl = this[`ctl_${key}`];
      if (!ctl) continue;
      ctl.input.value = this[key];
      ctl.out.textContent = String(this[key]);
    }
    for (const key of ['gravityScale', 'moveSpeedScale', 'jumpForceScale', 'windX']) {
      const ctl = this[`ctl_phys_${key}`];
      if (!ctl) continue;
      ctl.input.value = this.physics[key];
      ctl.out.textContent = String(this.physics[key]);
    }
    this.#clampCamera();
    this.#renderProps();
  }

  #selectTool(id) {
    this.tool = id;
    if (id !== 'select') this.selection.clear();
    this.root.querySelectorAll('.tool').forEach(node =>
      node.classList.toggle('is-active', node.dataset.tool === id));
    this.#renderProps();
  }

  // --- property panel ------------------------------------------------------

  #renderProps() {
    const items = [...this.selection];
    if (!items.length) {
      this.propsPanel.replaceChildren();
      this.propsPanel.classList.remove('is-open');
      return;
    }
    this.propsPanel.classList.add('is-open');

    const first = items[0];
    const kind = first.kind ?? first.type;

    const num = (label, key, { min, step = 1 } = {}) => el('label.prop', [
      el('span.prop__label', label),
      el('input.input.input--sm', {
        type: 'number', value: first[key] ?? 0, min, step,
        oninput: e => {
          const value = Number(e.target.value);
          if (!Number.isFinite(value)) return;
          // Editing with several selected applies the value to all of them.
          for (const item of items) item[key] = value;
        },
        onchange: () => this.#pushHistory(),
      }),
    ]);

    const rows = [
      el('div.editor__props-head', [
        el('strong', items.length > 1 ? `${items.length} pieces selected` : labelFor(first)),
        el('button.icon-btn.icon-btn--sm', {
          onclick: () => { this.selection.clear(); this.#renderProps(); },
          'aria-label': 'Deselect',
        }, '×'),
      ]),
      el('div.prop-grid', [
        num('X', 'x', { step: 10 }),
        num('Y', 'y', { step: 10 }),
        num('Width', 'width', { min: 4, step: 10 }),
        num('Height', 'height', { min: 4, step: 10 }),
      ]),
    ];

    if (kind === 'moving') {
      rows.push(el('div.prop-grid', [
        num('Speed X', 'velX', { step: 0.5 }),
        num('Speed Y', 'velY', { step: 0.5 }),
        num('Range', 'range', { min: 0, step: 20 }),
      ]));
      rows.push(el('p.prop__hint', 'Range is how far it travels from where you placed it.'));
    }
    if (kind === 'laser' || kind === 'door') {
      rows.push(el('div.prop-grid', [
        num('Cycle (ms)', 'interval', { min: 200, step: 100 }),
        num('Offset (ms)', 'offset', { min: 0, step: 100 }),
      ]));
      rows.push(el('p.prop__hint', 'Offset staggers this against others on the same cycle.'));
    }
    if (first.conveyorVel !== undefined) {
      rows.push(el('div.prop-grid', [num('Belt speed', 'conveyorVel', { step: 1 })]));
    }
    if (first.kind === 'powerup') {
      rows.push(el('label.prop', [
        el('span.prop__label', 'Kind'),
        el('select.input.input--sm', {
          onchange: e => {
            for (const item of items) if (item.kind === 'powerup') item.type = e.target.value;
            this.#pushHistory();
          },
        }, POWERUP_TYPES.map(pu =>
          el('option', { value: pu.id, selected: pu.id === first.type }, pu.label))),
      ]));
    }

    rows.push(el('div.prop__actions', [
      el('button.btn.btn--sm.btn--ghost', { onclick: () => this.#duplicateSelection() }, 'Duplicate'),
      el('button.btn.btn--sm.btn--danger', { onclick: () => this.#deleteSelection() }, 'Delete'),
    ]));

    this.propsPanel.replaceChildren(...rows);
  }

  // --- selection operations ------------------------------------------------

  #allItems() {
    return [...this.platforms, ...this.vehicles, ...this.powerups];
  }

  #addItem(item) {
    if (item.kind === 'vehicle') this.vehicles.push(item);
    else if (item.kind === 'powerup') this.powerups.push(item);
    else this.platforms.push(item);
  }

  #deleteSelection() {
    if (!this.selection.size) return;
    const keep = item => !this.selection.has(item);
    this.platforms = this.platforms.filter(keep);
    this.vehicles = this.vehicles.filter(keep);
    this.powerups = this.powerups.filter(keep);
    this.selection.clear();
    this.#pushHistory();
    this.#renderProps();
  }

  #duplicateSelection() {
    if (!this.selection.size) return;
    const copies = [...this.selection].map(item => {
      const copy = structuredClone(item);
      copy.x += GRID;
      copy.y += GRID;
      if (copy.id) copy.id = uid(copy.kind ?? 'p');
      if (copy.startPos) copy.startPos = { x: copy.x, y: copy.y };
      this.#addItem(copy);
      return copy;
    });
    this.selection = new Set(copies);
    this.#pushHistory();
    this.#renderProps();
  }

  #copy() {
    if (!this.selection.size) return;
    this.clipboard = [...this.selection].map(item => structuredClone(item));
    toast(`Copied ${this.clipboard.length} piece${this.clipboard.length === 1 ? '' : 's'}`, { duration: 1200 });
  }

  #paste() {
    if (!this.clipboard.length) return;
    // Paste at the cursor, preserving the group's relative layout.
    const minX = Math.min(...this.clipboard.map(i => i.x));
    const minY = Math.min(...this.clipboard.map(i => i.y));
    const dx = snap(this.mouse.x) - minX;
    const dy = snap(this.mouse.y) - minY;

    const pasted = this.clipboard.map(item => {
      const copy = structuredClone(item);
      copy.x += dx;
      copy.y += dy;
      if (copy.id) copy.id = uid(copy.kind ?? 'p');
      if (copy.startPos) copy.startPos = { x: copy.x, y: copy.y };
      this.#addItem(copy);
      return copy;
    });
    this.#selectTool('select');
    this.selection = new Set(pasted);
    this.#pushHistory();
    this.#renderProps();
  }

  // --- input ---------------------------------------------------------------

  #onKeyDown = event => {
    if (document.activeElement?.matches('input, textarea, select')) return;
    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.code === 'KeyZ') {
      event.preventDefault();
      if (event.shiftKey) this.#redo(); else this.#undo();
      return;
    }
    if (ctrl && event.code === 'KeyY') { event.preventDefault(); this.#redo(); return; }
    if (ctrl && event.code === 'KeyC') { event.preventDefault(); this.#copy(); return; }
    if (ctrl && event.code === 'KeyV') { event.preventDefault(); this.#paste(); return; }
    if (ctrl && event.code === 'KeyD') { event.preventDefault(); this.#duplicateSelection(); return; }
    if (ctrl && event.code === 'KeyA') {
      event.preventDefault();
      this.#selectTool('select');
      this.selection = new Set(this.#allItems());
      this.#renderProps();
      return;
    }

    if (event.code === 'Delete' || event.code === 'Backspace') {
      event.preventDefault();
      this.#deleteSelection();
      return;
    }
    if (event.code === 'Escape') {
      this.selection.clear();
      this.#renderProps();
      return;
    }

    const nudge = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }[event.code];
    if (nudge && this.selection.size) {
      event.preventDefault();
      const step = event.shiftKey ? 1 : GRID; // Shift for fine positioning
      for (const item of this.selection) {
        item.x += nudge[0] * step;
        item.y += nudge[1] * step;
      }
      this.#pushHistory();
      this.#renderProps();
    }
  };

  #toWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: this.cam.x, y: this.cam.y };
    return {
      x: (event.clientX - rect.left) * (VIEW_W / rect.width) / this.zoom + this.cam.x,
      y: (event.clientY - rect.top) * (VIEW_H / rect.height) / this.zoom + this.cam.y,
    };
  }

  #hitTest(world) {
    // Topmost first, so the most recently placed piece wins.
    const all = this.#allItems();
    for (let i = all.length - 1; i >= 0; i--) {
      const item = all[i];
      if (world.x >= item.x && world.x <= item.x + item.width
          && world.y >= item.y && world.y <= item.y + item.height) return item;
    }
    return null;
  }

  #onPointerDown = event => {
    event.preventDefault();
    // Capture keeps a drag alive if the cursor leaves the canvas. It throws for
    // a pointer id the browser isn't tracking, which must not abort the action.
    try { this.canvas.setPointerCapture(event.pointerId); } catch { /* not capturable */ }

    const world = this.#toWorld(event);
    this.mouse = world;

    // Middle or right button always pans, whichever tool is active.
    if (event.button === 1 || event.button === 2) {
      this.drag = { mode: 'pan', sx: event.clientX, sy: event.clientY, cx: this.cam.x, cy: this.cam.y };
      return;
    }

    if (this.tool === 'select') {
      const hit = this.#hitTest(world);
      if (hit) {
        if (event.shiftKey) {
          if (this.selection.has(hit)) this.selection.delete(hit);
          else this.selection.add(hit);
        } else if (!this.selection.has(hit)) {
          this.selection = new Set([hit]);
        }
        this.drag = {
          mode: 'move',
          startWorld: world,
          origin: [...this.selection].map(item => ({ item, x: item.x, y: item.y })),
          moved: false,
        };
      } else {
        if (!event.shiftKey) this.selection.clear();
        this.drag = { mode: 'marquee', startWorld: world, additive: event.shiftKey };
      }
      this.#renderProps();
      return;
    }

    if (this.tool === 'eraser') {
      this.drag = { mode: 'erase' };
      this.#eraseAt(world);
      return;
    }

    // Terrain can be dragged out as a rectangle; everything else stamps.
    if (RECT_TOOLS.has(this.tool)) {
      this.drag = { mode: 'rect', startWorld: world };
      return;
    }
    this.drag = { mode: 'stamp' };
    this.#place(world);
  };

  #onPointerMove = event => {
    const world = this.#toWorld(event);
    this.mouse = world;
    const d = this.drag;
    if (!d) return;

    if (d.mode === 'pan') {
      const rect = this.canvas.getBoundingClientRect();
      const scale = (VIEW_W / rect.width) / this.zoom;
      this.cam.x = d.cx - (event.clientX - d.sx) * scale;
      this.cam.y = d.cy - (event.clientY - d.sy) * scale;
      this.#clampCamera();
    } else if (d.mode === 'move') {
      const dx = snap(world.x - d.startWorld.x + GRID / 2);
      const dy = snap(world.y - d.startWorld.y + GRID / 2);
      if (dx || dy) d.moved = true;
      for (const entry of d.origin) {
        entry.item.x = entry.x + dx;
        entry.item.y = entry.y + dy;
        if (entry.item.startPos) entry.item.startPos = { x: entry.item.x, y: entry.item.y };
      }
    } else if (d.mode === 'erase') {
      this.#eraseAt(world);
    } else if (d.mode === 'stamp') {
      this.#place(world);
    }
    // 'rect' and 'marquee' only need the live cursor, drawn as a preview.
  };

  #onPointerUp = event => {
    const d = this.drag;
    this.drag = null;
    try {
      if (event?.pointerId != null && this.canvas.hasPointerCapture?.(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch { /* capture already gone */ }
    if (!d) return;

    if (d.mode === 'rect') {
      this.#fillRect(d.startWorld, this.mouse);
      this.#pushHistory();
    } else if (d.mode === 'marquee') {
      const box = normaliseRect(d.startWorld, this.mouse);
      if (box.width > 4 && box.height > 4) {
        if (!d.additive) this.selection.clear();
        for (const item of this.#allItems()) {
          if (rectsOverlap(box, boxOf(item))) this.selection.add(item);
        }
        this.#renderProps();
      }
    } else if (d.mode === 'move') {
      if (d.moved) this.#pushHistory();
    } else if (d.mode === 'stamp' || d.mode === 'erase') {
      this.#pushHistory();
    }
  };

  #onWheel = event => {
    event.preventDefault();
    if (event.ctrlKey) {
      // Ctrl+wheel zooms about the cursor.
      const before = this.#toWorld(event);
      this.zoom = clamp(this.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_ZOOM, MAX_ZOOM);
      const after = this.#toWorld(event);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
    } else if (event.shiftKey) {
      this.cam.x += event.deltaY / this.zoom;
    } else {
      this.cam.y += event.deltaY / this.zoom;
    }
    this.#clampCamera();
  };

  #clampCamera() {
    this.cam.x = clamp(this.cam.x, 0, Math.max(0, this.width - VIEW_W / this.zoom));
    this.cam.y = clamp(this.cam.y, 0, Math.max(0, this.height - VIEW_H / this.zoom));
  }

  // --- placing -------------------------------------------------------------

  #place({ x, y }) {
    const gx = snap(x);
    const gy = snap(y);
    const tool = TOOL_BY_ID[this.tool];
    if (!tool) return;

    if (this.tool === 'start') { this.start = { x: gx, y: gy }; return; }
    if (this.tool === 'goal') { this.goal = { x: gx + 20, y: gy + 30 }; return; }
    if (this.tool === 'food') { this.food = { x: gx, y: gy }; return; }

    if (tool.powerup) {
      if (this.powerups.some(p => p.x === gx && p.y === gy)) return;
      this.powerups.push({
        kind: 'powerup', id: uid('pu'), type: tool.powerup,
        x: gx, y: gy, width: tool.w, height: tool.h,
      });
      return;
    }
    if (this.tool === 'bike' || this.tool === 'car') {
      if (this.vehicles.some(v => v.x === gx && v.y === gy)) return;
      this.vehicles.push({
        kind: 'vehicle', id: uid('v'), type: this.tool,
        x: gx, y: gy, width: tool.w, height: tool.h,
      });
      return;
    }

    const type = effectiveType(this.tool);
    if (this.platforms.some(p => p.x === gx && p.y === gy && p.type === type)) return;
    this.platforms.push(this.#makePiece(gx, gy, tool.w, tool.h));
  }

  #makePiece(x, y, width, height) {
    const piece = { x, y, width, height, type: effectiveType(this.tool) };
    if (this.tool === 'moving') {
      piece.velX = 3; piece.velY = 0; piece.range = 240; piece.startPos = { x, y };
    }
    if (this.tool === 'vanishing') piece.opacity = 1;
    if (this.tool === 'laser') { piece.interval = 2000; piece.offset = 0; }
    if (this.tool === 'door') { piece.interval = 3000; piece.offset = 0; }
    if (this.tool === 'conveyor') piece.conveyorVel = 3;
    return piece;
  }

  /** Drag-out rectangle fill, so a floor isn't a hundred separate clicks. */
  #fillRect(a, b) {
    const box = normaliseRect(a, b);
    const x = snap(box.x);
    const y = snap(box.y);
    const width = Math.max(GRID, Math.ceil((box.x + box.width - x) / GRID) * GRID);
    const height = Math.max(GRID, Math.ceil((box.y + box.height - y) / GRID) * GRID);
    const piece = this.#makePiece(x, y, width, height);
    if (piece.startPos) piece.startPos = { x, y };
    this.platforms.push(piece);
  }

  #eraseAt({ x, y }) {
    const keep = item => !(x >= item.x && x <= item.x + item.width
                        && y >= item.y && y <= item.y + item.height);
    this.platforms = this.platforms.filter(keep);
    this.vehicles = this.vehicles.filter(keep);
    this.powerups = this.powerups.filter(keep);
  }

  // --- drawing -------------------------------------------------------------

  #loop = () => {
    this.rafId = requestAnimationFrame(this.#loop);
    this.#draw();
  };

  #draw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));

    const viewW = VIEW_W / this.zoom;
    const viewH = VIEW_H / this.zoom;

    // The level's own background colour, so the picker means something.
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1;

    if (this.zoom > 0.5) {
      ctx.strokeStyle = 'rgba(148,163,184,0.09)';
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      for (let x = snap(this.cam.x); x <= this.cam.x + viewW + GRID; x += GRID) {
        ctx.moveTo(x, this.cam.y);
        ctx.lineTo(x, this.cam.y + viewH);
      }
      for (let y = snap(this.cam.y); y <= this.cam.y + viewH + GRID; y += GRID) {
        ctx.moveTo(this.cam.x, y);
        ctx.lineTo(this.cam.x + viewW, y);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2 / this.zoom;
    ctx.strokeRect(0, 0, this.width, this.height);

    for (const p of this.platforms) this.#drawPiece(ctx, p);
    for (const v of this.vehicles) this.#drawVehicle(ctx, v);
    for (const pu of this.powerups) this.#drawPowerup(ctx, pu);

    this.#drawMarker(ctx, this.start.x, this.start.y, 32, 48, COLORS.player, 'START');
    this.#drawMarker(ctx, this.food.x, this.food.y, 26, 26, COLORS.food, 'BAG');
    this.#drawMarker(ctx, this.goal.x - 20, this.goal.y - 30, 40, 60, '#fbbf24', 'BERT');

    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2 / this.zoom;
    ctx.setLineDash([5 / this.zoom, 4 / this.zoom]);
    for (const item of this.selection) {
      ctx.strokeRect(item.x - 2, item.y - 2, item.width + 4, item.height + 4);
    }
    ctx.setLineDash([]);

    this.#drawPreview(ctx);

    ctx.restore();
    this.#drawMinimap(ctx);

    const count = this.platforms.length + this.vehicles.length + this.powerups.length;
    this.hint.textContent =
      `${count} piece${count === 1 ? '' : 's'} · `
      + `${Math.round(this.mouse.x)}, ${Math.round(this.mouse.y)} · `
      + `${Math.round(this.zoom * 100)}%`
      + (this.selection.size ? ` · ${this.selection.size} selected` : '')
      + ' · wheel scrolls, ctrl+wheel zooms, right-drag pans';
  }

  #drawPreview(ctx) {
    const d = this.drag;
    if (d?.mode === 'rect') {
      const box = normaliseRect(d.startWorld, this.mouse);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = TOOL_BY_ID[this.tool]?.color ?? '#fff';
      ctx.fillRect(
        snap(box.x), snap(box.y),
        Math.max(GRID, Math.ceil(box.width / GRID) * GRID),
        Math.max(GRID, Math.ceil(box.height / GRID) * GRID));
      ctx.globalAlpha = 1;
      return;
    }
    if (d?.mode === 'marquee') {
      const box = normaliseRect(d.startWorld, this.mouse);
      ctx.fillStyle = 'rgba(34,211,238,0.12)';
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1 / this.zoom;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      return;
    }
    if (!d && this.tool !== 'select' && this.tool !== 'eraser') {
      const tool = TOOL_BY_ID[this.tool];
      if (!tool?.w) return;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = tool.color;
      ctx.fillRect(snap(this.mouse.x), snap(this.mouse.y), tool.w, tool.h);
      ctx.globalAlpha = 1;
    }
  }

  #drawPiece(ctx, p) {
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
      return;
    }

    ctx.globalAlpha = p.type === 'vanishing' ? 0.55 : 1;
    ctx.fillRect(p.x, p.y, p.width, p.height);
    ctx.globalAlpha = 1;

    if (p.type === 'moving') {
      // Travel envelope, so range is visible while editing.
      const from = p.startPos ?? { x: p.x, y: p.y };
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
      ctx.strokeStyle = COLORS.moving;
      ctx.lineWidth = 1 / this.zoom;
      ctx.strokeRect(
        from.x, from.y,
        (p.velX ? (p.range ?? 0) : 0) + p.width,
        (p.velY ? (p.range ?? 0) : 0) + p.height);
      ctx.restore();
    }
    if (p.conveyorVel) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${12 / this.zoom}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.conveyorVel > 0 ? '→' : '←', p.x + p.width / 2, p.y + p.height - 5);
      ctx.textAlign = 'left';
    }
  }

  #drawVehicle(ctx, v) {
    ctx.fillStyle = v.type === 'car' ? COLORS.car : COLORS.bike;
    ctx.fillRect(v.x, v.y, v.width, v.height);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(v.x + 4, v.y + 4, v.width - 8, v.height * 0.4);
  }

  #drawPowerup(ctx, pu) {
    const meta = POWERUP_BY_ID[pu.type] ?? POWERUP_TYPES[0];
    ctx.fillStyle = meta.color;
    ctx.fillRect(pu.x, pu.y, pu.width, pu.height);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${14 / this.zoom}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.glyph, pu.x + pu.width / 2, pu.y + pu.height / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  #drawMarker(ctx, x, y, w, h, color, label) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${9 / this.zoom}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y - 6);
    ctx.textAlign = 'left';
  }

  /** Whole-level overview with the current viewport marked. */
  #drawMinimap(ctx) {
    const W = 168;
    const H = 96;
    const pad = 12;
    const x0 = VIEW_W - W - pad;
    const y0 = pad;
    const scale = Math.min(W / this.width, H / this.height);

    ctx.save();
    ctx.fillStyle = 'rgba(5,6,10,0.82)';
    ctx.fillRect(x0, y0, W, H);
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, W, H);

    ctx.beginPath();
    ctx.rect(x0, y0, W, H);
    ctx.clip();
    ctx.translate(x0, y0);
    ctx.scale(scale, scale);

    const dot = 6 / scale; // keep tiny pieces visible at minimap scale
    ctx.fillStyle = 'rgba(148,163,184,0.6)';
    for (const p of this.platforms) {
      ctx.fillRect(p.x, p.y, Math.max(p.width, dot), Math.max(p.height, dot));
    }
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(this.start.x, this.start.y, dot * 4, dot * 4);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(this.goal.x, this.goal.y, dot * 4, dot * 4);

    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(this.cam.x, this.cam.y, VIEW_W / this.zoom, VIEW_H / this.zoom);
    ctx.restore();
  }

  // --- save / test ---------------------------------------------------------

  #toLevel(idOverride) {
    return {
      id: idOverride ?? this.id,
      title: this.title.trim() || 'Untitled Level',
      description: 'Custom level',
      width: this.width,
      height: this.height,
      platforms: this.platforms.map(p => ({ ...p })),
      // Drop the editor-only `kind` tag and shape these the way the engine and
      // the shipped level data expect.
      vehicles: this.vehicles.map(v => ({
        id: v.id, type: v.type, pos: { x: v.x, y: v.y }, width: v.width, height: v.height,
      })),
      powerups: this.powerups.map(p => ({
        id: p.id, type: p.type, pos: { x: p.x, y: p.y }, width: p.width, height: p.height,
      })),
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
    const inside = pt => pt.x >= 0 && pt.x <= this.width && pt.y >= 0 && pt.y <= this.height;

    if (!this.platforms.length) problems.push('there are no platforms');
    if (!inside(this.start)) problems.push('the start marker is outside the level');
    if (!inside(this.goal)) problems.push('Bert is outside the level');
    if (!inside(this.food)) problems.push('the bag is outside the level');
    if (Math.hypot(this.start.x - this.goal.x, this.start.y - this.goal.y) < 120) {
      problems.push('the start and Bert are almost on top of each other');
    }

    // Spawning inside masonry is the classic way to make a level unplayable.
    const spawnBox = { x: this.start.x, y: this.start.y, width: 32, height: 48 };
    const buried = this.platforms.some(p =>
      p.type !== 'spike' && p.type !== 'laser' && p.height > 24 && rectsOverlap(spawnBox, boxOf(p)));
    if (buried) problems.push('the start marker is buried inside a platform');

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
    this.handlers.onTest(this.#toLevel('custom-test'));
  }

  destroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.canvas.removeEventListener('wheel', this.#onWheel);
    removeEventListener('keydown', this.#onKeyDown);
    this.root.remove();
  }
}

// --- helpers ---------------------------------------------------------------

function effectiveType(tool) {
  return tool === 'conveyor' ? 'static' : tool;
}

function labelFor(item) {
  if (item.kind === 'vehicle') return item.type === 'car' ? 'Car' : 'Bike';
  if (item.kind === 'powerup') return `${POWERUP_BY_ID[item.type]?.label ?? 'Pickup'} pickup`;
  if (item.conveyorVel) return 'Conveyor';
  return {
    static: 'Platform', moving: 'Moving platform', vanishing: 'Vanishing platform',
    spike: 'Spikes', laser: 'Laser', door: 'Door',
  }[item.type] ?? 'Piece';
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
