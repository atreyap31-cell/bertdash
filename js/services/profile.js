// Player profile: tips, skins, achievements, stats and custom levels.
//
// Everything lives in localStorage under one key. Writes are debounced because
// the engine bumps stats (jumps, slides, wall slides) many times a second and
// a synchronous localStorage write per event is enough to cause frame drops.

import { ACHIEVEMENTS } from '../data/config.js';

const STORAGE_KEY = 'bertdash.profile.v1';
const LEGACY_KEY = 'bd_offline_v4'; // save file from the old single-page build
const SAVE_DEBOUNCE_MS = 120;

const DEFAULT_STATS = {
  totalJumps: 0,
  totalDeaths: 0,
  foodThrown: 0,
  foodCaught: 0,
  totalDives: 0,
  totalSlides: 0,
  wallSlides: 0,
  wallJumps: 0,
  airJumps: 0,
  longJumps: 0,
  diveBounces: 0,
  boosts: 0,
  shieldsUsed: 0,
  chargedThrows: 0,
  magnetCatches: 0,
  levelsCleared: 0,
  customCleared: 0,
  verticalCleared: 0,
  fiveStars: 0,
  comebacks: 0,
  clutchDeliveries: 0,
  lifetimeTips: 0,
  bikeRides: 0,
  carRides: 0,
  speedPickups: 0,
  jumpPickups: 0,
  shieldPickups: 0,
  magnetPickups: 0,
  messagesSent: 0,
  peersConnected: 0,
  deathsByDrop: 0,
  deathsBySpike: 0,
  deathsByLaser: 0,
  deathsByFall: 0,
  deathsByCrush: 0,
  playTimeMs: 0,
};

const DEFAULT_PROFILE = {
  username: 'Courier',
  tips: 500,
  unlockedSkins: ['base'],
  equippedSkin: 'base',
  customLevels: [],
  unlockedAchievements: [],
  bestLevelTimes: {},
  attemptsPerLevel: {},
  settings: { sound: true, reducedFlash: false },
  stats: { ...DEFAULT_STATS },
};

class ProfileService {
  #profile;
  #listeners = new Set();
  #achievementListeners = new Set();
  #saveTimer = null;

  constructor() {
    this.#profile = this.#load();
    // Flush pending writes if the tab is closed or backgrounded mid-run.
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    addEventListener('pagehide', () => this.flush());
  }

  #load() {
    const raw = this.#readKey(STORAGE_KEY) ?? this.#readKey(LEGACY_KEY);
    if (!raw) return structuredClone(DEFAULT_PROFILE);
    // Merge rather than spread-replace so profiles saved by older builds pick
    // up new fields (and new stat counters) instead of leaving them undefined.
    return {
      ...structuredClone(DEFAULT_PROFILE),
      ...raw,
      settings: { ...DEFAULT_PROFILE.settings, ...(raw.settings ?? {}) },
      stats: { ...DEFAULT_STATS, ...(raw.stats ?? {}) },
      bestLevelTimes: { ...(raw.bestLevelTimes ?? {}) },
      attemptsPerLevel: { ...(raw.attemptsPerLevel ?? {}) },
      unlockedSkins: [...new Set(raw.unlockedSkins ?? ['base'])],
      unlockedAchievements: [...new Set(raw.unlockedAchievements ?? [])],
      customLevels: Array.isArray(raw.customLevels) ? raw.customLevels : [],
    };
  }

  #readKey(key) {
    try {
      const text = localStorage.getItem(key);
      return text ? JSON.parse(text) : null;
    } catch {
      return null; // private mode, blocked storage, or corrupt JSON
    }
  }

  get() {
    return this.#profile;
  }

  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  onAchievement(fn) {
    this.#achievementListeners.add(fn);
    return () => this.#achievementListeners.delete(fn);
  }

  /**
   * Persist and notify, coalescing the bursts of stat writes the engine
   * produces. Deliberately a timer rather than requestAnimationFrame: rAF is
   * paused outright in a background tab, which would leave progress unsaved
   * for as long as the tab stayed hidden.
   */
  save() {
    this.#evaluateAchievements();
    if (this.#saveTimer !== null) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.flush();
      this.#listeners.forEach(fn => fn(this.#profile));
    }, SAVE_DEBOUNCE_MS);
  }

  flush() {
    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#profile));
    } catch {
      // Storage full or unavailable — the session still plays, it just won't persist.
    }
  }

  #evaluateAchievements() {
    for (const ach of ACHIEVEMENTS) {
      if (this.#profile.unlockedAchievements.includes(ach.id)) continue;
      let earned = false;
      try {
        earned = ach.check(this.#profile);
      } catch {
        earned = false;
      }
      if (!earned) continue;
      this.#profile.unlockedAchievements.push(ach.id);
      this.#achievementListeners.forEach(fn => fn(ach));
    }
  }

  // --- mutations -----------------------------------------------------------

  addTips(amount) {
    this.#profile.tips += amount;
    this.#profile.stats.lifetimeTips += Math.max(0, amount);
    this.save();
  }

  purchaseSkin(id, cost) {
    const p = this.#profile;
    if (p.unlockedSkins.includes(id) || p.tips < cost) return false;
    p.tips -= cost;
    p.unlockedSkins.push(id);
    this.save();
    return true;
  }

  equipSkin(id) {
    if (!this.#profile.unlockedSkins.includes(id)) return;
    this.#profile.equippedSkin = id;
    this.save();
  }

  /** Add to a counter. `amount` may be >1 to batch a frame's worth of events. */
  bump(key, amount = 1) {
    this.#profile.stats[key] = (this.#profile.stats[key] ?? 0) + amount;
    this.save();
  }

  recordAttempt(levelId) {
    const key = String(levelId);
    this.#profile.attemptsPerLevel[key] = (this.#profile.attemptsPerLevel[key] ?? 0) + 1;
    this.save();
  }

  getAttempts(levelId) {
    return this.#profile.attemptsPerLevel[String(levelId)] ?? 0;
  }

  recordClear(levelId, timeMs) {
    const key = String(levelId);
    const best = this.#profile.bestLevelTimes[key];
    const isNewBest = best == null || timeMs < best;
    if (isNewBest) this.#profile.bestLevelTimes[key] = timeMs;
    this.save();
    return isNewBest;
  }

  getBest(levelId) {
    return this.#profile.bestLevelTimes[String(levelId)] ?? null;
  }

  saveCustomLevel(level) {
    const levels = this.#profile.customLevels;
    const idx = levels.findIndex(l => l.id === level.id);
    if (idx >= 0) levels[idx] = level;
    else levels.push(level);
    this.save();
  }

  deleteCustomLevel(id) {
    this.#profile.customLevels = this.#profile.customLevels.filter(l => l.id !== id);
    this.save();
  }

  setUsername(name) {
    const trimmed = name.trim().slice(0, 24);
    if (trimmed) this.#profile.username = trimmed;
    this.save();
  }

  setSetting(key, value) {
    this.#profile.settings[key] = value;
    this.save();
  }

  resetProgress() {
    const { username, settings } = this.#profile;
    this.#profile = { ...structuredClone(DEFAULT_PROFILE), username, settings };
    this.save();
  }
}

export const profile = new ProfileService();
