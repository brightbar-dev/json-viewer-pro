export type ShortcutAction =
  | 'focus-search'
  | 'clear-search'
  | 'next-match'
  | 'prev-match'
  | 'expand-all'
  | 'collapse-all'
  | null;

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Map a keydown to a viewer action. Ctrl/Cmd+F is claimed deliberately: the
 * browser's own find cannot reach text inside collapsed or unrendered nodes,
 * our search can. Ctrl/Cmd+G steps through matches, as it does in browsers.
 * Bare letter keys are ignored while the user is typing in a field.
 */
export function resolveShortcut(e: ShortcutEvent, inInput: boolean): ShortcutAction {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && !e.altKey && (e.key === 'f' || e.key === 'F')) return 'focus-search';
  if (mod && !e.altKey && (e.key === 'g' || e.key === 'G')) return e.shiftKey ? 'prev-match' : 'next-match';
  if (e.key === 'Escape') return 'clear-search';

  if (inInput || mod || e.altKey) return null;

  if (e.key === '/') return 'focus-search';
  if (e.key === 'e' || e.key === 'E') return 'expand-all';
  if (e.key === 'c' || e.key === 'C') return 'collapse-all';

  return null;
}
