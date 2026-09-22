// Minimal DOM helpers. The old build pulled in React, ReactDOM and Babel from
// a CDN to render what amounts to a handful of static menus — this replaces all
// three with ~60 lines and removes the in-browser transpile step entirely.

/**
 * Build an element.
 *   el('button.primary', { onclick: fn }, 'Play')
 *   el('div', [child, child])
 * Tag supports `tag.class.class` and `tag#id` shorthand.
 */
export function el(tag, props, children) {
  if (Array.isArray(props) || typeof props === 'string' || props instanceof Node) {
    children = props;
    props = {};
  }
  props = props ?? {};

  const [head, ...classes] = tag.split('.');
  const [name, id] = head.split('#');
  const node = document.createElement(name || 'div');
  if (id) node.id = id;
  if (classes.length) node.classList.add(...classes);

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.classList.add(...String(value).split(/\s+/).filter(Boolean));
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value;         // only ever called with our own markup
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }

  append(node, children);
  return node;
}

/**
 * Renders the small amount of markup level text is allowed to carry.
 *
 * Hints are written with <b> around the key you are meant to press, and the
 * HUD was printing them through textContent, so ten of the twenty-nine hints
 * in the game read "Press <b>S</b> to slide" with the tags showing.
 *
 * innerHTML is not an option here: hints travel with custom levels, and a
 * custom level can arrive from another player over BertNet. This builds real
 * nodes for <b> and <em> and leaves everything else as text, so anything that
 * is not one of those two tags shows up literally rather than being parsed.
 *
 * @returns {Node[]}
 */
export function richText(text) {
  const out = [];
  const pattern = /<(b|em)>([\s\S]*?)<\/\1>/gi;
  let at = 0;
  for (const match of String(text ?? '').matchAll(pattern)) {
    if (match.index > at) out.push(document.createTextNode(text.slice(at, match.index)));
    const strong = document.createElement(match[1].toLowerCase() === 'b' ? 'strong' : 'em');
    strong.textContent = match[2];
    out.push(strong);
    at = match.index + match[0].length;
  }
  if (at < String(text ?? '').length) out.push(document.createTextNode(text.slice(at)));
  return out;
}

export function append(parent, children) {
  if (children == null || children === false) return parent;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
  } else {
    parent.append(children instanceof Node ? children : document.createTextNode(String(children)));
  }
  return parent;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/** Format milliseconds as m:ss.cc */
export function formatTime(ms) {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor(total / 1000) % 60;
  const centis = Math.floor((total % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export function formatMoney(value) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A modal dialog backed by <dialog>, so Escape-to-close, focus trapping and the
 * backdrop all come from the platform instead of being reimplemented.
 */
export function modal({ title, subtitle, body, wide = false, onClose }) {
  const dialog = el('dialog.modal' + (wide ? '.modal--wide' : ''), [
    el('header.modal__head', [
      el('div', [
        el('h2.modal__title', { html: title }),
        subtitle ? el('p.modal__sub', subtitle) : null,
      ]),
      el('button.icon-btn', { onclick: () => dialog.close(), 'aria-label': 'Close', title: 'Close (Esc)' }, '×'),
    ]),
    el('div.modal__body', body),
  ]);

  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  // Clicking the backdrop (i.e. the dialog element itself) closes it.
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** Non-blocking replacement for alert(). */
export function toast(message, { icon = '', tone = 'info', duration = 2600 } = {}) {
  let host = document.querySelector('.toasts');
  if (!host) host = document.body.appendChild(el('div.toasts', { 'aria-live': 'polite' }));

  const node = el(`div.toast.toast--${tone}`, [
    icon ? el('span.toast__icon', icon) : null,
    el('span', message),
  ]);
  host.append(node);

  setTimeout(() => {
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, duration);
}

/** Promise-based confirm dialog. */
export function confirmDialog(message, { confirmLabel = 'Confirm', tone = 'danger' } = {}) {
  return new Promise(resolve => {
    let answer = false;
    const dialog = el('dialog.modal.modal--slim', [
      el('div.modal__body', [
        el('p.confirm__text', message),
        el('div.confirm__actions', [
          el('button.btn.btn--ghost', { onclick: () => dialog.close() }, 'Cancel'),
          el(`button.btn.btn--${tone}`, { onclick: () => { answer = true; dialog.close(); } }, confirmLabel),
        ]),
      ]),
    ]);
    dialog.addEventListener('close', () => { dialog.remove(); resolve(answer); });
    document.body.append(dialog);
    dialog.showModal();
  });
}
