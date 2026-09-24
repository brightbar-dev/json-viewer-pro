import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readState } from '@brightbar-dev/review-nudge';
import { nudgeFromSlot, offersReview, recordDocumentViewed } from '../lib/review-nudge';
import listing from '../store/cws.json';

// The slot's attributes, read from the popup markup the way the browser would hand them over.
const popup = readFileSync(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');
const slotTag = popup.match(/<div class="review-nudge" id="review-nudge"[^>]*>/)?.[0] ?? '';
const dataset = Object.fromEntries(
  [...slotTag.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name!.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()), value!]),
);

describe('review nudge', () => {
  beforeEach(() => fakeBrowser.reset());

  it('the popup asks for a review of this item and no other', () => {
    const options = nudgeFromSlot(dataset);
    expect(options?.reviewUrl).toBe(`https://chromewebstore.google.com/detail/${listing.extension_id}/reviews`);
    expect(options?.name).toBe('Brightbar JSON Viewer');
  });

  it('sends problems to the listing’s support page, not the store', () => {
    expect(nudgeFromSlot(dataset)?.feedbackUrl.startsWith(listing.support_url)).toBe(true);
  });

  it('takes every string from the markup and shows nothing if one is missing', () => {
    const options = nudgeFromSlot(dataset)!;
    expect(options.strings?.prompt?.(options.name)).toBe('Is Brightbar JSON Viewer useful to you?');
    expect(options.strings).toMatchObject({ review: 'Leave a review', feedback: 'Something wrong? Tell us', dismiss: 'Don’t ask again' });
    expect(nudgeFromSlot({ ...dataset, dismiss: '' })).toBeNull();
  });

  it('never asks in the Firefox build, which is not on the Chrome Web Store', () => {
    expect(offersReview(true)).toBe(false);
    expect(offersReview(false)).toBe(true);
  });

  it('counts each document shown as JSON in storage.local', async () => {
    await recordDocumentViewed();
    await recordDocumentViewed();
    const state = await readState({ storage: fakeBrowser.storage.local });
    expect(state).toMatchObject({ status: 'counting', activations: 2, activeDays: 1 });
  });

  it('keeps a storage failure away from the viewer', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('quota'));
    await expect(recordDocumentViewed()).resolves.toBeUndefined();
  });
});
