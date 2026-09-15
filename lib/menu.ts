/** A small accessible popover menu (WAI-ARIA menu button pattern). */
import { el } from './dom';

export interface MenuItem {
  label: string;
  /** Secondary text: a shortcut, a preview of what will be copied… */
  hint?: string;
  disabled?: boolean;
  action: () => void;
}

/** `null` entries are skipped, so callers can write `cond ? item : null`. */
export type MenuEntry = MenuItem | 'separator' | null;

let current: { anchor: HTMLElement; close: (restoreFocus: boolean) => void } | null = null;

export function closeMenu(restoreFocus = false): void {
  current?.close(restoreFocus);
}

export interface MenuOptions {
  /** Where the menu element goes (so it inherits the viewer's styles). */
  host?: HTMLElement;
  /** What gets focus back when the menu closes; defaults to `anchor`. */
  returnFocus?: HTMLElement;
}

/** Open a menu under `anchor`. Opening it again from the same anchor closes it. */
export function openMenu(anchor: HTMLElement, entries: MenuEntry[], { host = document.body, returnFocus = anchor }: MenuOptions = {}): void {
  if (current?.anchor === anchor) {
    closeMenu(true);
    return;
  }
  closeMenu();

  const menu = el('div', 'jvp-menu');
  menu.setAttribute('role', 'menu');
  const items: HTMLButtonElement[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry === 'separator') {
      if (menu.lastElementChild && !menu.lastElementChild.classList.contains('jvp-menu-sep')) {
        menu.append(el('div', 'jvp-menu-sep'));
      }
      continue;
    }
    const item = el('button', 'jvp-menu-item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
    item.disabled = !!entry.disabled;
    item.append(el('span', 'jvp-menu-label', entry.label));
    if (entry.hint) item.append(el('span', 'jvp-menu-hint', entry.hint));
    item.addEventListener('click', () => {
      closeMenu(true);
      entry.action();
    });
    menu.append(item);
    if (!item.disabled) items.push(item);
  }
  if (menu.lastElementChild?.classList.contains('jvp-menu-sep')) menu.lastElementChild.remove();

  host.append(menu);
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
  let top = r.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  anchor.setAttribute('aria-expanded', 'true');

  const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
  const onKey = (e: KeyboardEvent) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') focusAt(at + 1);
    else if (e.key === 'ArrowUp') focusAt(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(-1);
    else if (e.key === 'Escape') closeMenu(true);
    else if (e.key === 'Tab') closeMenu(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const onPointer = (e: Event) => {
    const t = e.target as Node;
    if (!menu.contains(t) && !anchor.contains(t)) closeMenu(false);
  };
  const onViewportChange = () => closeMenu(false);

  menu.addEventListener('keydown', onKey);
  // Keys typed inside the menu must not reach the page's shortcuts.
  menu.addEventListener('keypress', (e) => e.stopPropagation());
  document.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, { passive: true });

  current = {
    anchor,
    close: (restoreFocus) => {
      menu.remove();
      anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange);
      current = null;
      if (restoreFocus) returnFocus.focus({ preventScroll: true });
    },
  };
  focusAt(0);
}
