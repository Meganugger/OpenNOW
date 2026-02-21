/**
 * Character-level translation for non-QWERTY → US-QWERTY remote VM.
 *
 * When the local keyboard is AZERTY/QWERTZ (or any non-US layout) and the
 * remote cloud VM runs US-QWERTY, pressing a key locally produces a character
 * via event.key that may live on a completely different physical key on US
 * layout.  For example, AZERTY "!" is Shift+Digit8, but on US-QWERTY "!" is
 * Shift+Digit1.
 *
 * This module maps every printable ASCII character to the US-QWERTY physical
 * key (event.code) plus the modifiers needed to produce it.  The caller sends
 * the corresponding VK + scancode from the existing codeMap.
 *
 * Only used when effectiveLayout !== "qwerty".  For QWERTY users the existing
 * physical-scancode path is already correct.
 */

export interface UsKeystroke {
  /** KeyboardEvent.code on a US-QWERTY keyboard that produces this char */
  code: string;
  /** Whether Shift must be held */
  shift: boolean;
}

/**
 * Full US-QWERTY printable-ASCII lookup.
 * Key = the character (event.key), value = how to type it on US-QWERTY.
 */
const US_CHAR_MAP: Record<string, UsKeystroke> = {
  // ── Letters (lowercase) ─────────────────────────────────────────
  a: { code: "KeyA", shift: false },
  b: { code: "KeyB", shift: false },
  c: { code: "KeyC", shift: false },
  d: { code: "KeyD", shift: false },
  e: { code: "KeyE", shift: false },
  f: { code: "KeyF", shift: false },
  g: { code: "KeyG", shift: false },
  h: { code: "KeyH", shift: false },
  i: { code: "KeyI", shift: false },
  j: { code: "KeyJ", shift: false },
  k: { code: "KeyK", shift: false },
  l: { code: "KeyL", shift: false },
  m: { code: "KeyM", shift: false },
  n: { code: "KeyN", shift: false },
  o: { code: "KeyO", shift: false },
  p: { code: "KeyP", shift: false },
  q: { code: "KeyQ", shift: false },
  r: { code: "KeyR", shift: false },
  s: { code: "KeyS", shift: false },
  t: { code: "KeyT", shift: false },
  u: { code: "KeyU", shift: false },
  v: { code: "KeyV", shift: false },
  w: { code: "KeyW", shift: false },
  x: { code: "KeyX", shift: false },
  y: { code: "KeyY", shift: false },
  z: { code: "KeyZ", shift: false },

  // ── Letters (uppercase = Shift) ─────────────────────────────────
  A: { code: "KeyA", shift: true },
  B: { code: "KeyB", shift: true },
  C: { code: "KeyC", shift: true },
  D: { code: "KeyD", shift: true },
  E: { code: "KeyE", shift: true },
  F: { code: "KeyF", shift: true },
  G: { code: "KeyG", shift: true },
  H: { code: "KeyH", shift: true },
  I: { code: "KeyI", shift: true },
  J: { code: "KeyJ", shift: true },
  K: { code: "KeyK", shift: true },
  L: { code: "KeyL", shift: true },
  M: { code: "KeyM", shift: true },
  N: { code: "KeyN", shift: true },
  O: { code: "KeyO", shift: true },
  P: { code: "KeyP", shift: true },
  Q: { code: "KeyQ", shift: true },
  R: { code: "KeyR", shift: true },
  S: { code: "KeyS", shift: true },
  T: { code: "KeyT", shift: true },
  U: { code: "KeyU", shift: true },
  V: { code: "KeyV", shift: true },
  W: { code: "KeyW", shift: true },
  X: { code: "KeyX", shift: true },
  Y: { code: "KeyY", shift: true },
  Z: { code: "KeyZ", shift: true },

  // ── Digits (unshifted) ──────────────────────────────────────────
  "1": { code: "Digit1", shift: false },
  "2": { code: "Digit2", shift: false },
  "3": { code: "Digit3", shift: false },
  "4": { code: "Digit4", shift: false },
  "5": { code: "Digit5", shift: false },
  "6": { code: "Digit6", shift: false },
  "7": { code: "Digit7", shift: false },
  "8": { code: "Digit8", shift: false },
  "9": { code: "Digit9", shift: false },
  "0": { code: "Digit0", shift: false },

  // ── Shifted digit row ───────────────────────────────────────────
  "!": { code: "Digit1", shift: true },
  "@": { code: "Digit2", shift: true },
  "#": { code: "Digit3", shift: true },
  "$": { code: "Digit4", shift: true },
  "%": { code: "Digit5", shift: true },
  "^": { code: "Digit6", shift: true },
  "&": { code: "Digit7", shift: true },
  "*": { code: "Digit8", shift: true },
  "(": { code: "Digit9", shift: true },
  ")": { code: "Digit0", shift: true },

  // ── Punctuation (unshifted) ─────────────────────────────────────
  "-": { code: "Minus", shift: false },
  "=": { code: "Equal", shift: false },
  "[": { code: "BracketLeft", shift: false },
  "]": { code: "BracketRight", shift: false },
  "\\": { code: "Backslash", shift: false },
  ";": { code: "Semicolon", shift: false },
  "'": { code: "Quote", shift: false },
  "`": { code: "Backquote", shift: false },
  ",": { code: "Comma", shift: false },
  ".": { code: "Period", shift: false },
  "/": { code: "Slash", shift: false },

  // ── Punctuation (shifted) ───────────────────────────────────────
  "_": { code: "Minus", shift: true },
  "+": { code: "Equal", shift: true },
  "{": { code: "BracketLeft", shift: true },
  "}": { code: "BracketRight", shift: true },
  "|": { code: "Backslash", shift: true },
  ":": { code: "Semicolon", shift: true },
  "\"": { code: "Quote", shift: true },
  "~": { code: "Backquote", shift: true },
  "<": { code: "Comma", shift: true },
  ">": { code: "Period", shift: true },
  "?": { code: "Slash", shift: true },

  // ── Space ───────────────────────────────────────────────────────
  " ": { code: "Space", shift: false },
};

/**
 * Look up how to produce a given character on a US-QWERTY keyboard.
 *
 * @param char  The printable character (event.key when event.key.length === 1)
 * @returns     The US-QWERTY code + shift requirement, or null if unknown.
 */
export function charToUsKeystroke(char: string): UsKeystroke | null {
  return US_CHAR_MAP[char] ?? null;
}
