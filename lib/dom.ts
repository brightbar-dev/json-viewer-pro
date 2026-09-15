/** Small DOM utilities shared by the viewer and the content script. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Add a stylesheet and return a function that removes it. A constructable
 * sheet is not subject to the page's CSP `style-src` (API responses often send
 * `default-src 'none'`); a `<style>` element is the fallback.
 */
export function addStyleSheet(cssText: string): () => void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    if (document.adoptedStyleSheets.includes(sheet)) {
      return () => {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      };
    }
  } catch {
    // fall through
  }
  const style = document.createElement('style');
  style.textContent = cssText;
  (document.head ?? document.documentElement).appendChild(style);
  return () => style.remove();
}

/**
 * Write text to the clipboard. The async Clipboard API needs a secure context
 * (plain-http API hosts are not one), so fall back to a hidden textarea.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.();
  return ok;
}

/** Briefly swap a button's label to confirm (or deny) a copy. */
export function flashLabel(button: HTMLElement, done: Promise<boolean>, okLabel: string): void {
  // Only the label changes, so an icon beside it stays put.
  const target = button.querySelector('.jvp-btn-label') ?? button;
  const original = target.textContent;
  void done.then((ok) => {
    target.textContent = ok ? okLabel : 'Copy failed';
    setTimeout(() => (target.textContent = original), 1200);
  });
}
