// Menu, level select, results, store, trophies, settings and the peer hub.

import { el, modal, toast, confirmDialog, formatTime, formatMoney } from './dom.js';
import { SKINS, ACHIEVEMENTS, QUOTES, FAIL_QUOTES, FAIL_LABELS } from '../data/config.js';
import { LEVELS, CAMPAIGN_LENGTH } from '../data/levels.js';
import { profile } from '../services/profile.js';
import { audio } from '../services/audio.js';
import { peer } from '../services/net.js';

const pick = list => list[Math.floor(Math.random() * list.length)];

function skinSwatch(skin) {
  return el('div.skin__art', [
    el('div.skin__body', { style: { background: skin.color } }, [
      el('span.skin__mark', { style: { color: skin.textColor } }, 'BERT'),
    ]),
  ]);
}

function stars(count) {
  return el('div.stars', Array.from({ length: 5 }, (_, i) =>
    el(`span.star${i < count ? '.is-lit' : ''}`, '★')));
}

// --- main menu -------------------------------------------------------------

export function renderMenu(app) {
  const p = profile.get();
  const cleared = Object.keys(p.bestLevelTimes).filter(k => k !== '0').length;

  const tile = (label, sub, onclick, variant = '') =>
    el(`button.tile${variant}`, { onclick: () => { audio.click(); onclick(); } }, [
      el('span.tile__label', label),
      sub ? el('span.tile__sub', sub) : null,
    ]);

  return el('div.screen.screen--menu', [
    el('div.menu', [
      el('header.menu__head', [
        el('h1.logo', [el('span', 'BERT'), el('span.logo__accent', 'DASH')]),
        el('p.menu__tag', 'Deliver the bag. Do not drop the bag.'),
      ]),
      el('div.menu__stats', [
        el('div.chip', [el('b', `$${formatMoney(p.tips)}`), ' tips']),
        el('div.chip', [el('b', `${cleared}/${CAMPAIGN_LENGTH}`), ' delivered']),
        el('div.chip', [el('b', `${p.unlockedAchievements.length}/${ACHIEVEMENTS.length}`), ' trophies']),
      ]),
      el('div.menu__grid', [
        tile('Start Shift', 'Continue the campaign', () => app.startCampaign(), '.tile--primary'),
        tile('Campaign', `${CAMPAIGN_LENGTH} levels`, () => app.show('levels')),
        tile('Workshop', `${p.customLevels.length} custom`, () => app.show('workshop')),
        tile('Store', 'Spend your tips', () => openStore()),
        tile('Trophies', `${p.unlockedAchievements.length} earned`, () => openTrophies()),
        tile('BertNet', 'Play alongside a friend', () => openHub()),
        tile('Tutorial', 'Learn the moves', () => app.play(0)),
        tile('Settings', 'Sound, data, name', () => openSettings(app)),
      ]),
      el('footer.menu__foot', [
        el('span', 'WASD / Arrows move · Space jump, again in mid-air for a second jump · '
          + 'Space on a wall to kick off · S slide, then Space for a long jump · '
          + 'E dive toward the cursor · Hold click to charge a throw'),
        el('span.menu__foot-key', 'Throw the bag upward, jump after it and catch it in mid-air '
          + 'for a launch far higher than any jump — several levels need it.'),
        el('span', 'Shift boosts a vehicle, Q leaves it · R restarts · Esc pauses'),
      ]),
    ]),
  ]);
}

// --- level select ----------------------------------------------------------

export function renderLevelSelect(app) {
  const p = profile.get();

  const cards = LEVELS.slice(1).map((level, index) => {
    const id = index + 1;
    const best = p.bestLevelTimes[String(id)];
    const done = best != null;
    return el(`button.level-card${done ? '.is-done' : ''}`, {
      onclick: () => { audio.click(); app.play(id); },
    }, [
      el('span.level-card__num', String(id)),
      el('span.level-card__title', level.title),
      el('span.level-card__meta', done ? formatTime(best) : `${level.theme === 'vertical' ? 'Climb' : 'Run'}`),
    ]);
  });

  return el('div.screen', [
    el('div.panel.panel--wide', [
      el('header.panel__head', [
        el('h2.panel__title', 'Select Zone'),
        el('button.btn.btn--ghost', { onclick: () => app.show('menu') }, 'Back'),
      ]),
      el('div.level-grid', cards),
    ]),
  ]);
}

// --- workshop --------------------------------------------------------------

export function renderWorkshop(app) {
  const p = profile.get();

  const cards = p.customLevels.map(level => {
    const pieces = level.platforms.length
      + (level.vehicles?.length ?? 0) + (level.powerups?.length ?? 0);
    return el('div.custom-card', [
      // The title doubles as a rename field; there is nowhere else to do it.
      el('input.custom-card__title', {
        value: level.title, maxLength: 40, 'aria-label': 'Level name',
        onchange: event => {
          const title = event.target.value.trim() || 'Untitled Level';
          profile.saveCustomLevel({ ...level, title });
          toast('Renamed');
        },
      }),
      el('div.custom-card__meta',
        `${pieces} piece${pieces === 1 ? '' : 's'} · ${level.width}×${level.height}`),
      el('div.custom-card__actions', [
        el('button.btn.btn--sm.btn--primary', { onclick: () => app.playCustom(level) }, 'Play'),
        el('button.btn.btn--sm.btn--ghost', { onclick: () => app.openEditor(level) }, 'Edit'),
        el('button.btn.btn--sm.btn--ghost', {
          title: 'Duplicate',
          onclick: () => {
            profile.saveCustomLevel({
              ...structuredClone(level),
              id: `custom-${Date.now()}`,
              title: `${level.title} copy`,
            });
            toast('Duplicated');
            app.show('workshop');
          },
        }, 'Copy'),
        el('button.btn.btn--sm.btn--danger', {
          onclick: async () => {
            if (await confirmDialog(`Delete "${level.title}"? This cannot be undone.`, { confirmLabel: 'Delete' })) {
              profile.deleteCustomLevel(level.id);
              toast('Level deleted');
              app.show('workshop');
            }
          },
        }, 'Delete'),
      ]),
    ]);
  });

  return el('div.screen', [
    el('div.panel.panel--wide', [
      el('header.panel__head', [
        el('h2.panel__title', 'Workshop'),
        el('div.panel__actions', [
          el('button.btn.btn--primary', { onclick: () => app.openEditor(null) }, 'New level'),
          el('button.btn.btn--ghost', { onclick: () => app.show('menu') }, 'Back'),
        ]),
      ]),
      cards.length
        ? el('div.custom-grid', cards)
        : el('p.empty', 'No custom levels yet. Build one in the editor — it saves straight to this browser. '
            + 'You can place terrain, hazards, vehicles and powerups, and tune the level’s physics.'),
    ]),
  ]);
}

// --- results ---------------------------------------------------------------

export function renderResult(app, result) {
  const isWin = result.outcome === 'win';
  const quote = isWin
    ? pick(QUOTES[result.stars])
    : pick(FAIL_QUOTES[result.reason] ?? FAIL_QUOTES.FELL);

  const actions = [];
  if (isWin && result.hasNext) {
    actions.push(el('button.btn.btn--primary.btn--lg', { onclick: () => app.playNext() }, 'Next level'));
  }
  actions.push(el('button.btn.btn--lg' + (isWin && result.hasNext ? '.btn--ghost' : '.btn--primary'),
    { onclick: () => app.retry() }, isWin ? 'Replay' : 'Try again'));
  actions.push(el('button.btn.btn--lg.btn--ghost', { onclick: () => app.show('menu') }, 'Menu'));

  return el('div.screen.screen--result', [
    el(`div.result${isWin ? '.result--win' : '.result--lose'}`, [
      el('h2.result__head', isWin ? 'Delivered' : (FAIL_LABELS[result.reason] ?? 'Failed')),
      isWin ? stars(result.stars) : null,
      el('div.result__rows', [
        el('div.result__row', [el('span', 'Time'), el('b', formatTime(result.timeMs))]),
        el('div.result__row', [el('span', 'Par'), el('b', `${result.parTime.toFixed(1)}s`)]),
        isWin ? el('div.result__row', [el('span', 'Tips earned'), el('b.is-good', `+$${result.reward}`)]) : null,
        result.isNewBest ? el('div.result__row', [el('span', 'Personal best'), el('b.is-good', 'New record')]) : null,
      ]),
      el('blockquote.result__quote', `“${quote}”`),
      el('div.result__actions', actions),
    ]),
  ]);
}

// --- store -----------------------------------------------------------------

export function openStore() {
  let body;
  const build = () => {
    const p = profile.get();
    return el('div.store', [
      el('div.store__wallet', [
        el('span.store__wallet-label', 'Tips'),
        el('span.store__wallet-value', `$${formatMoney(p.tips)}`),
      ]),
      el('div.store__grid', SKINS.map(skin => {
        const owned = p.unlockedSkins.includes(skin.id);
        const equipped = p.equippedSkin === skin.id;
        const affordable = p.tips >= skin.cost;
        return el(`div.skin${equipped ? '.is-equipped' : ''}`, [
          equipped ? el('span.skin__flag', 'Equipped') : null,
          skinSwatch(skin),
          el('h3.skin__name', skin.name),
          owned ? null : el('p.skin__price', `$${skin.cost.toLocaleString()}`),
          owned
            ? el('button.btn.btn--sm' + (equipped ? '.btn--ghost' : '.btn--primary'), {
                disabled: equipped,
                onclick: () => { profile.equipSkin(skin.id); audio.click(); refresh(); },
              }, equipped ? 'Active' : 'Equip')
            : el('button.btn.btn--sm' + (affordable ? '.btn--primary' : '.btn--ghost'), {
                disabled: !affordable,
                title: affordable ? '' : `You need $${(skin.cost - p.tips).toLocaleString()} more`,
                onclick: () => {
                  if (profile.purchaseSkin(skin.id, skin.cost)) {
                    audio.pickup();
                    toast(`Unlocked ${skin.name}`, { icon: '◈', tone: 'good' });
                    refresh();
                  }
                },
              }, affordable ? 'Buy' : 'Locked'),
        ]);
      })),
    ]);
  };

  const refresh = () => body.replaceChildren(build());
  body = el('div');
  refresh();

  modal({ title: 'Delivery <em>Store</em>', subtitle: 'Spend those tips', body, wide: true });
}

// --- trophies --------------------------------------------------------------

export function openTrophies() {
  const p = profile.get();
  const earned = p.unlockedAchievements;

  const body = el('div.trophies', [
    el('div.trophies__progress', [
      el('div.bar', [el('div.bar__fill', {
        style: { width: `${(earned.length / ACHIEVEMENTS.length) * 100}%` },
      })]),
      el('span', `${earned.length} of ${ACHIEVEMENTS.length}`),
    ]),
    el('div.trophies__grid', ACHIEVEMENTS.map(ach => {
      const unlocked = earned.includes(ach.id);
      return el(`div.trophy${unlocked ? '.is-unlocked' : ''}`, [
        el('div.trophy__icon', ach.icon),
        el('div', [
          el('div.trophy__title', ach.title),
          el('div.trophy__desc', ach.description),
        ]),
      ]);
    })),
  ]);

  modal({ title: 'Trophy Case', subtitle: 'Every one of these is reachable', body, wide: true });
}

// --- settings --------------------------------------------------------------

export function openSettings(app) {
  const p = profile.get();

  const nameInput = el('input.input', {
    value: p.username,
    maxLength: 24,
    oninput: event => profile.setUsername(event.target.value),
  });

  const toggle = (label, key, hint) => {
    const input = el('input', {
      type: 'checkbox',
      checked: p.settings[key] !== false,
      onchange: event => profile.setSetting(key, event.target.checked),
    });
    return el('label.setting', [
      input,
      el('div', [el('span.setting__label', label), el('span.setting__hint', hint)]),
    ]);
  };

  const body = el('div.settings', [
    el('label.field', [el('span.field__label', 'Courier name'), nameInput]),
    toggle('Sound effects', 'sound', 'Synthesised in the browser — no audio files to download'),
    el('label.setting', [
      el('input', {
        type: 'checkbox',
        checked: p.settings.reducedFlash === true,
        onchange: event => profile.setSetting('reducedFlash', event.target.checked),
      }),
      el('div', [
        el('span.setting__label', 'Reduced flashing'),
        el('span.setting__hint', 'Damps screen shake, glow and particles'),
      ]),
    ]),
    el('div.settings__danger', [
      el('h3', 'Danger zone'),
      el('p', 'Progress lives in this browser only. Clearing site data also clears it.'),
      el('button.btn.btn--danger', {
        onclick: async () => {
          if (await confirmDialog('Reset all progress? Tips, skins, trophies, times and custom levels will be erased.', { confirmLabel: 'Reset everything' })) {
            profile.resetProgress();
            toast('Progress reset');
            app.show('menu');
            document.querySelector('dialog.modal')?.close();
          }
        },
      }, 'Reset progress'),
    ]),
  ]);

  modal({ title: 'Settings', body, onClose: () => app.refreshIfMenu() });
}

// --- peer hub --------------------------------------------------------------

export function openHub() {
  const history = [];
  let tab = 'rankings';

  const body = el('div.hub');
  const tabsRow = el('div.hub__tabs');
  const pane = el('div.hub__pane');
  body.append(tabsRow, pane);

  const setTab = next => {
    tab = next;
    tabsRow.replaceChildren(...[
      ['rankings', 'Your times'],
      ['connect', 'Connect'],
      ['chat', 'Chat'],
    ].map(([id, label]) => el(`button.hub__tab${tab === id ? '.is-active' : ''}`, {
      onclick: () => setTab(id),
    }, label)));
    pane.replaceChildren(render());
  };

  const render = () => {
    if (tab === 'rankings') return renderRankings();
    if (tab === 'connect') return renderConnect();
    return renderChat();
  };

  const renderRankings = () => {
    const p = profile.get();
    const rows = LEVELS
      .map((level, index) => ({ level, index, best: p.bestLevelTimes[String(index)] }))
      .filter(row => row.best != null)
      .sort((a, b) => a.index - b.index);

    if (!rows.length) return el('p.empty', 'No finished levels yet. Your best times will appear here.');

    return el('div.rankings', [
      el('p.hub__note', 'Times are stored in this browser. There is no server keeping a global board.'),
      el('table.table', [
        el('thead', el('tr', [el('th', '#'), el('th', 'Level'), el('th.is-right', 'Best')])),
        el('tbody', rows.map(row => el('tr', [
          el('td', row.index === 0 ? 'T' : String(row.index)),
          el('td', row.level.title),
          el('td.is-right.is-mono', formatTime(row.best)),
        ]))),
      ]),
    ]);
  };

  const renderConnect = () => {
    const statusEl = el('span.hub__status', peer.status);
    const myCode = el('textarea.code', { readOnly: true, rows: 4, placeholder: 'Your code appears here' });
    const theirCode = el('textarea.code', { rows: 4, placeholder: "Paste your friend's code" });

    peer.on('status', status => { statusEl.textContent = status; });

    const copy = async () => {
      if (!myCode.value) return;
      try {
        await navigator.clipboard.writeText(myCode.value);
        toast('Code copied');
      } catch {
        myCode.select();
        toast('Press Ctrl+C to copy');
      }
    };

    return el('div.connect', [
      el('p.hub__note', 'Direct browser-to-browser chat over WebRTC. Nothing is uploaded to a server — you pass the codes to each other yourself.'),
      el('div.connect__row', [el('span', 'Status'), statusEl]),

      el('section.connect__step', [
        el('h4', 'Host a session'),
        el('div.connect__buttons', [
          el('button.btn.btn--sm.btn--primary', {
            onclick: async event => {
              event.target.disabled = true;
              try { myCode.value = await peer.createOffer(); }
              catch (error) { toast('Could not create a code: ' + error.message, { tone: 'bad' }); }
              finally { event.target.disabled = false; }
            },
          }, 'Generate invite'),
          el('button.btn.btn--sm.btn--ghost', { onclick: copy }, 'Copy'),
        ]),
        myCode,
      ]),

      el('section.connect__step', [
        el('h4', "Paste your friend's code"),
        theirCode,
        el('div.connect__buttons', [
          el('button.btn.btn--sm.btn--primary', {
            onclick: async () => {
              if (!theirCode.value.trim()) return;
              try {
                // An invite you were sent produces an answer; an answer you
                // were sent completes a session you already hosted.
                if (myCode.value) await peer.acceptAnswer(theirCode.value);
                else myCode.value = await peer.acceptOffer(theirCode.value);
              } catch (error) {
                toast('That code did not work: ' + error.message, { tone: 'bad' });
              }
            },
          }, 'Connect'),
        ]),
      ]),
    ]);
  };

  const renderChat = () => {
    const log = el('div.chat__log');
    const input = el('input.input', { placeholder: 'Message…', maxLength: 300 });

    const paint = () => {
      log.replaceChildren(...history.map(msg => el(
        `div.chat__msg${msg.mine ? '.is-mine' : ''}${msg.system ? '.is-system' : ''}`,
        [el('span.chat__who', msg.sender), el('span.chat__text', msg.content)],
      )));
      log.scrollTop = log.scrollHeight;
    };

    const push = msg => { history.push(msg); if (tab === 'chat') paint(); };

    peer.on('message', msg => push({ ...msg, mine: false }));
    peer.on('status', status => push({ sender: 'System', content: `Connection: ${status}`, system: true }));

    const form = el('form.chat__form', {
      onsubmit: event => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        const me = profile.get().username;
        if (!peer.send({ sender: me, content: text })) {
          toast('Not connected to a peer yet', { tone: 'bad' });
          return;
        }
        push({ sender: me, content: text, mine: true });
        profile.bump('messagesSent');
        input.value = '';
      },
    }, [input, el('button.btn.btn--primary', { type: 'submit' }, 'Send')]);

    paint();
    return el('div.chat', [log, form]);
  };

  peer.on('status', status => {
    if (status === 'connected') profile.bump('peersConnected');
  });

  setTab('rankings');
  modal({ title: 'Bert<em>Net</em>', subtitle: 'Serverless, peer to peer', body, wide: true });
}

// --- pause -----------------------------------------------------------------

export function openPause({ onResume, onRestart, onMenu }) {
  const dialog = modal({
    title: 'Paused',
    body: el('div.pause', [
      el('button.btn.btn--primary.btn--lg', { onclick: () => dialog.close() }, 'Resume'),
      el('button.btn.btn--lg.btn--ghost', { onclick: () => { dialog.close(); onRestart(); } }, 'Restart level'),
      el('button.btn.btn--lg.btn--ghost', { onclick: () => { dialog.close(); onMenu(); } }, 'Quit to menu'),
      el('p.pause__hint', 'Esc or P also toggles pause.'),
    ]),
    onClose: onResume,
  });
  return dialog;
}
