// What you are actually carrying.
//
// Every level was a generic orange box with a tan lid, which told you nothing
// and looked like nothing. Each level now has an order: a burger, a shake, a
// stack of pancakes. It is fixed per level, so level 3 is always the fries and
// you come to recognise a level by what it sends you out with.
//
// Each draw() gets a context already translated to the item's centre (and
// rotated, if it is in the air), and a box `s` pixels on a side to fill. The
// art is deliberately blocky to sit with the rest of the game, so these are
// nearly all fillRect — the few curves are the ones that would read wrong as
// squares, like a shake dome or a donut.

/** Fills a rect given in units of the box, measured from its centre. */
const box = (ctx, s, x, y, w, h, fill) => {
  ctx.fillStyle = fill;
  ctx.fillRect(x * s, y * s, w * s, h * s);
};

const disc = (ctx, s, x, y, r, fill) => {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2);
  ctx.fill();
};

export const ORDERS = [
  {
    id: 'burger', name: 'Burger',
    draw(ctx, s) {
      box(ctx, s, -0.42, -0.36, 0.84, 0.22, '#d9862b');   // top bun
      box(ctx, s, -0.30, -0.33, 0.08, 0.05, '#f3d9a8');   // sesame
      box(ctx, s, -0.10, -0.30, 0.08, 0.05, '#f3d9a8');
      box(ctx, s, 0.14, -0.33, 0.08, 0.05, '#f3d9a8');
      box(ctx, s, -0.46, -0.16, 0.92, 0.12, '#5faa3c');   // lettuce
      box(ctx, s, -0.42, -0.06, 0.84, 0.16, '#7a4321');   // patty
      box(ctx, s, -0.44, 0.10, 0.88, 0.10, '#f2c14b');    // cheese
      box(ctx, s, -0.42, 0.20, 0.84, 0.18, '#c2762a');    // bottom bun
    },
  },
  {
    id: 'fries', name: 'Fries',
    draw(ctx, s) {
      for (let i = 0; i < 5; i++) {
        box(ctx, s, -0.34 + i * 0.145, -0.46 + (i % 2) * 0.08, 0.10, 0.42, '#f6cf5a');
      }
      box(ctx, s, -0.36, -0.06, 0.72, 0.52, '#d8402f');   // carton
      box(ctx, s, -0.30, 0.04, 0.60, 0.10, '#f2f2f2');    // band
    },
  },
  {
    id: 'shake', name: 'Milkshake',
    draw(ctx, s) {
      box(ctx, s, 0.14, -0.52, 0.09, 0.34, '#e8607d');    // straw
      disc(ctx, s, -0.09, -0.26, 0.21, '#fff8ef');        // swirl of cream
      disc(ctx, s, 0.09, -0.22, 0.17, '#fff8ef');
      box(ctx, s, -0.30, -0.22, 0.60, 0.16, '#fff8ef');
      ctx.fillStyle = '#f7f2ea';                           // tapered cup
      ctx.beginPath();
      ctx.moveTo(-0.30 * s, -0.06 * s);
      ctx.lineTo(0.30 * s, -0.06 * s);
      ctx.lineTo(0.20 * s, 0.48 * s);
      ctx.lineTo(-0.20 * s, 0.48 * s);
      ctx.closePath();
      ctx.fill();
      box(ctx, s, -0.28, 0.08, 0.55, 0.13, '#e8607d');    // band
      disc(ctx, s, -0.09, -0.40, 0.08, '#d64062');        // cherry
    },
  },
  {
    id: 'pizza', name: 'Pizza Slice',
    draw(ctx, s) {
      ctx.fillStyle = '#f0b944';                           // cheese wedge
      ctx.beginPath();
      ctx.moveTo(0, 0.48 * s);
      ctx.lineTo(-0.44 * s, -0.36 * s);
      ctx.lineTo(0.44 * s, -0.36 * s);
      ctx.closePath();
      ctx.fill();
      box(ctx, s, -0.46, -0.46, 0.92, 0.14, '#d9862b');   // crust
      disc(ctx, s, -0.14, -0.14, 0.09, '#c0392b');
      disc(ctx, s, 0.16, -0.20, 0.08, '#c0392b');
      disc(ctx, s, 0.02, 0.14, 0.08, '#c0392b');
    },
  },
  {
    id: 'sushi', name: 'Sushi',
    draw(ctx, s) {
      box(ctx, s, -0.40, -0.08, 0.80, 0.42, '#f4f1ea');   // rice
      box(ctx, s, -0.44, -0.26, 0.88, 0.20, '#e8603c');   // salmon
      box(ctx, s, -0.44, -0.26, 0.88, 0.06, '#f28b6a');
      box(ctx, s, -0.12, -0.28, 0.24, 0.64, '#2f4f34');   // nori band
    },
  },
  {
    id: 'coffee', name: 'Coffee',
    draw(ctx, s) {
      box(ctx, s, -0.30, -0.42, 0.60, 0.12, '#f2f2f2');   // lid
      box(ctx, s, -0.08, -0.50, 0.16, 0.08, '#f2f2f2');   // spout
      box(ctx, s, -0.26, -0.30, 0.52, 0.72, '#e6e1d8');   // cup
      box(ctx, s, -0.26, -0.04, 0.52, 0.20, '#8a5a2b');   // sleeve
    },
  },
  {
    id: 'noodles', name: 'Noodles',
    draw(ctx, s) {
      for (let i = 0; i < 4; i++) box(ctx, s, -0.26 + i * 0.16, -0.48, 0.08, 0.24, '#f3d77a');
      box(ctx, s, -0.34, -0.28, 0.68, 0.14, '#d8402f');   // carton lip
      box(ctx, s, -0.30, -0.14, 0.60, 0.56, '#f4f0e6');   // carton
      box(ctx, s, -0.06, -0.14, 0.12, 0.56, '#d8402f');   // fold
    },
  },
  {
    id: 'donut', name: 'Donut',
    draw(ctx, s) {
      disc(ctx, s, 0, 0, 0.46, '#c98442');
      disc(ctx, s, 0, -0.04, 0.42, '#f06fa0');            // icing
      disc(ctx, s, 0, 0, 0.15, '#1b1b22');                // hole
      box(ctx, s, -0.26, -0.24, 0.10, 0.05, '#fff');
      box(ctx, s, 0.10, -0.12, 0.10, 0.05, '#7ad1e8');
      box(ctx, s, -0.06, 0.20, 0.10, 0.05, '#f6e05e');
    },
  },
  {
    id: 'taco', name: 'Taco',
    draw(ctx, s) {
      box(ctx, s, -0.40, -0.26, 0.80, 0.16, '#5faa3c');   // lettuce over the top
      box(ctx, s, -0.34, -0.34, 0.68, 0.12, '#c0392b');   // salsa
      ctx.fillStyle = '#e8b04b';                           // shell
      ctx.beginPath();
      ctx.moveTo(-0.46 * s, -0.20 * s);
      ctx.quadraticCurveTo(0, 0.62 * s, 0.46 * s, -0.20 * s);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: 'icecream', name: 'Ice Cream',
    draw(ctx, s) {
      disc(ctx, s, 0, -0.20, 0.30, '#f7e3c0');            // scoop
      disc(ctx, s, -0.14, -0.30, 0.16, '#fbeed4');
      ctx.fillStyle = '#c98442';                           // cone
      ctx.beginPath();
      ctx.moveTo(-0.28 * s, 0.02 * s);
      ctx.lineTo(0.28 * s, 0.02 * s);
      ctx.lineTo(0, 0.52 * s);
      ctx.closePath();
      ctx.fill();
      disc(ctx, s, 0.02, -0.42, 0.09, '#d64062');         // cherry, sat on the scoop
    },
  },
  {
    id: 'hotdog', name: 'Hot Dog',
    draw(ctx, s) {
      box(ctx, s, -0.46, -0.16, 0.92, 0.34, '#d9a05b');   // bun
      box(ctx, s, -0.48, -0.10, 0.96, 0.18, '#b8523a');   // sausage
      for (let i = 0; i < 4; i++) {
        box(ctx, s, -0.36 + i * 0.22, -0.14 + (i % 2) * 0.10, 0.14, 0.06, '#f6d33c');
      }
    },
  },
  {
    id: 'pancakes', name: 'Pancakes',
    draw(ctx, s) {
      box(ctx, s, -0.40, 0.18, 0.80, 0.18, '#d9a05b');
      box(ctx, s, -0.38, -0.02, 0.76, 0.18, '#e0ab63');
      box(ctx, s, -0.34, -0.22, 0.68, 0.18, '#e8b66e');
      box(ctx, s, -0.20, -0.34, 0.40, 0.14, '#f6d33c');   // butter
      box(ctx, s, -0.34, -0.06, 0.20, 0.08, '#8a5a2b');   // syrup running off
    },
  },
];

export const ORDER_BY_ID = Object.fromEntries(ORDERS.map(o => [o.id, o]));

/**
 * The order a level sends you out with. Keyed off the level's own id so it
 * never changes between runs, and so the level select and the game agree
 * without having to pass anything between them.
 */
export function orderFor(level) {
  const key = level?.id;
  if (typeof key === 'number') return ORDERS[key % ORDERS.length];
  // Training lessons and custom levels have string ids: hash them.
  const text = String(key ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 100003;
  return ORDERS[hash % ORDERS.length];
}
