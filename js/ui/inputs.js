// On-screen input display.
//
// Shows which keys are down, the way a speedrun overlay does. It reads the
// engine's own key set, so what you see is exactly what the simulation is
// acting on — which makes it useful for telling "I did not press that" apart
// from "the game did not register it".
//
// Two pads, matching the control scheme: movement on the left hand, aiming and
// throwing on the arrow keys.

import { el } from './dom.js';

/** Layout of the overlay: rows of [label, key codes it represents]. */
const MOVE_ROWS = [
  [{ label: 'W', action: 'jump' }],
  [
    { label: 'A', action: 'left' },
    { label: 'S', action: 'slide' },
    { label: 'D', action: 'right' },
  ],
  [
    { label: 'E', action: 'dive', hint: 'dive' },
    { label: 'Q', action: 'exit', hint: 'exit' },
    { label: '⇧', action: 'boost', hint: 'boost' },
  ],
  [{ label: 'SPACE', action: 'jump', wide: true, hint: 'jump' }],
];

const AIM_ROWS = [
  [{ label: '↑', action: 'aimUp' }],
  [
    { label: '←', action: 'aimLeft' },
    { label: '↓', action: 'aimDown' },
    { label: '→', action: 'aimRight' },
  ],
];

export class InputDisplay {
  /** @param {object} bindings resolved action -> key codes */
  constructor(bindings) {
    this.keys = new Map();

    const buildRows = rows => rows.map(row => el('div.keys__row', row.map(spec => {
      const node = el(`div.key${spec.wide ? '.key--wide' : ''}`, [
        el('span.key__label', spec.label),
        spec.hint ? el('span.key__hint', spec.hint) : null,
      ]);
      this.keys.set(node, bindings[spec.action] ?? []);
      return node;
    })));

    this.root = el('div.keys', [
      el('div.keys__pad', [
        el('span.keys__cap', 'move'),
        ...buildRows(MOVE_ROWS),
      ]),
      el('div.keys__pad', [
        el('span.keys__cap', 'aim / throw'),
        ...buildRows(AIM_ROWS),
      ]),
    ]);
  }

  /**
   * @param {Set<string>} held key codes the engine currently has down
   */
  update(held) {
    for (const [node, codes] of this.keys) {
      node.classList.toggle('is-down', codes.some(code => held.has(code)));
    }
  }

  destroy() {
    this.root.remove();
  }
}
