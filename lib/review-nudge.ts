import { mountReviewNudge, recordActivation, reviewNudgeCss, type MountOptions } from '@brightbar-dev/review-nudge';

/**
 * The one-time review request. @brightbar-dev/review-nudge owns the rules (never on install, only
 * after 8 rendered documents over 3 days, shown once, "Don't ask again" is final). Its text and both
 * links live on the popup's `#review-nudge` element (strings stay in HTML), read by `nudgeFromSlot`.
 *
 * The Firefox build is not on the Chrome Web Store (or Firefox Add-ons), so it never asks.
 */

export function offersReview(isFirefox = import.meta.env.BROWSER === 'firefox'): boolean {
  return !isFirefox;
}

/** Count one document shown as JSON. Never lets a storage failure reach the viewer. */
export async function recordDocumentViewed(): Promise<void> {
  if (!offersReview()) return;
  await recordActivation({ storage: browser.storage.local }).catch(() => {});
}

type SlotData = Partial<Record<'name' | 'reviewUrl' | 'feedbackUrl' | 'prompt' | 'review' | 'feedback' | 'dismiss', string>>;

/** The mount options the popup's slot describes, or null if any part is missing. */
export function nudgeFromSlot(data: SlotData): Omit<MountOptions, 'storage'> | null {
  const { name, reviewUrl, feedbackUrl, prompt, review, feedback, dismiss } = data;
  if (!name || !reviewUrl || !feedbackUrl || !prompt || !review || !feedback || !dismiss) return null;
  return { name, reviewUrl, feedbackUrl, strings: { prompt: () => prompt, review, feedback, dismiss } };
}

/** Show the request inside `slot` if it has been earned. */
export async function showReviewNudge(slot: HTMLElement): Promise<void> {
  const options = nudgeFromSlot(slot.dataset);
  if (!offersReview() || !options) return;
  const doc = slot.ownerDocument;
  const shown = await mountReviewNudge(slot, { ...options, storage: browser.storage.local }).catch(() => null);
  if (shown && !doc.getElementById('bb-review-nudge-css')) {
    doc.head.append(Object.assign(doc.createElement('style'), { id: 'bb-review-nudge-css', textContent: reviewNudgeCss }));
  }
}
