export type ShortcutAction =
  | 'focus-search'
  | 'clear-search'
  | 'next-match'
  | 'prev-match'
  | 'expand-all'
  | 'collapse-all'
  | 'level-1'
  | 'level-2'
  | 'level-3'
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
  if (e.key === '1' || e.key === '2' || e.key === '3') return `level-${e.key}`;

  return null;
}

export type TreeKeyAction =
  | 'down'
  | 'up'
  | 'right'
  | 'left'
  | 'home'
  | 'end'
  | 'page-down'
  | 'page-up'
  | 'toggle'
  | 'expand-subtree'
  | 'copy-value'
  | 'copy-path'
  | 'menu'
  | null;

/**
 * Keys handled while the tree has focus (WAI-ARIA tree pattern): arrows move
 * and open/close, Home/End jump, Enter/Space toggle, `*` opens the whole
 * subtree, Ctrl/Cmd+C copies the selected value as JSON (Shift: its path), and
 * the context-menu key or Shift+F10 opens the row's menu.
 */
export function resolveTreeKey(e: ShortcutEvent): TreeKeyAction {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && (e.key === 'c' || e.key === 'C')) return e.shiftKey ? 'copy-path' : 'copy-value';
  if (e.key === 'F10' && e.shiftKey && !mod) return 'menu';
  if (mod || e.altKey) return null;
  switch (e.key) {
    case 'ArrowDown':
      return 'down';
    case 'ArrowUp':
      return 'up';
    case 'ArrowRight':
      return 'right';
    case 'ArrowLeft':
      return 'left';
    case 'Home':
      return 'home';
    case 'End':
      return 'end';
    case 'PageDown':
      return 'page-down';
    case 'PageUp':
      return 'page-up';
    case 'Enter':
    case ' ':
      return 'toggle';
    case '*':
      return 'expand-subtree';
    case 'ContextMenu':
      return 'menu';
    default:
      return null;
  }
}
