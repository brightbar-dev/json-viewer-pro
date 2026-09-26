import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings';

// The options page saves on every change; there is no Save button to fall back on. Its script runs
// on import against stubbed controls whose <option>s are read from the real markup.

const markup = readFileSync(new URL('../entrypoints/options/index.html', import.meta.url), 'utf8');

function optionsOf(id: string): { value: string; text: string }[] {
  const select = markup.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))?.[1] ?? '';
  return [...select.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(([, value, text]) => ({ value: value!, text: text! }));
}

type Listener = () => void;

class FakeControl {
  handlers: Record<string, Listener> = {};
  addEventListener(type: string, fn: Listener) {
    this.handlers[type] = fn;
  }
}

/** Like a real <select>: a value with no matching option selects nothing. */
class FakeSelect extends FakeControl {
  private selected = '';
  constructor(public options: { value: string; text: string }[]) {
    super();
    this.selected = options[0]?.value ?? '';
  }
  get value() {
    return this.selected;
  }
  set value(v: string) {
    this.selected = this.options.some((o) => o.value === v) ? v : '';
  }
  add(o: { value: string; text: string }) {
    this.options.push(o);
  }
}

class FakeInput extends FakeControl {
  value = '';
  checked = true;
}

class FakeOption {
  constructor(public text: string, public value: string) {}
}

let els: {
  enabled: FakeInput;
  theme: FakeSelect;
  fontPreset: FakeSelect;
  fontCustomRow: { hidden: boolean };
  fontCustom: FakeInput;
  fontSize: FakeSelect;
  indent: FakeSelect;
  expandBudget: FakeSelect;
  imagePreview: FakeInput;
  preview: { style: Record<string, string> & { setProperty: (k: string, v: string) => void } };
  status: { textContent: string };
};
let activeElement: unknown = null;

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

async function openOptions(): Promise<void> {
  vi.resetModules();
  await import('../entrypoints/options/main');
  await settle();
}

async function change(el: keyof typeof els, set: (e: never) => void): Promise<void> {
  set(els[el] as never);
  (els[el] as FakeControl).handlers.change!();
  await settle();
}

const stored = async () => (await fakeBrowser.storage.sync.get('settings')).settings as Settings | undefined;

describe('options page', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    fakeBrowser.reset();
    const style: Record<string, string> = {};
    els = {
      enabled: new FakeInput(),
      theme: new FakeSelect(optionsOf('theme')),
      fontPreset: new FakeSelect(optionsOf('fontPreset')),
      fontCustomRow: { hidden: true },
      fontCustom: new FakeInput(),
      fontSize: new FakeSelect(optionsOf('fontSize')),
      indent: new FakeSelect(optionsOf('indent')),
      expandBudget: new FakeSelect(optionsOf('expandBudget')),
      imagePreview: new FakeInput(),
      preview: { style: Object.assign(style, { setProperty: (k: string, v: string) => (style[k] = v) }) },
      status: { textContent: '' },
    };
    // Chrome fires storage.onChanged only for values that actually change; the fake fires on every set.
    const set = fakeBrowser.storage.sync.set.bind(fakeBrowser.storage.sync);
    vi.spyOn(fakeBrowser.storage.sync, 'set').mockImplementation(async (items: Record<string, unknown>) => {
      const current = await fakeBrowser.storage.sync.get(Object.keys(items));
      if (!isDeepStrictEqual(current, items)) await set(items);
    });
    activeElement = null;
    // What background.ts stores on install.
    await set({ settings: DEFAULT_SETTINGS });
    vi.stubGlobal('document', {
      getElementById: (id: keyof typeof els) => els[id],
      get activeElement() {
        return activeElement;
      },
    });
    vi.stubGlobal('Option', FakeOption);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('the markup offers the default of every choice', () => {
    expect(els.fontSize.options.map((o) => o.value)).toContain(String(DEFAULT_SETTINGS.fontSize));
    expect(els.indent.options.map((o) => o.value)).toContain(String(DEFAULT_SETTINGS.indent));
    expect(els.expandBudget.options.map((o) => o.value)).toContain(String(DEFAULT_SETTINGS.expandBudget));
  });

  it('shows the stored settings, adding a choice for a value saved by another version', async () => {
    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, theme: 'dark', fontFamily: 'Menlo', fontSize: 17, expandBudget: 800 } });
    await openOptions();
    expect(els.theme.value).toBe('dark');
    expect(els.fontPreset.value).toBe('Menlo');
    expect(els.fontCustomRow.hidden).toBe(true);
    expect(els.fontSize.value).toBe('17');
    expect(els.fontSize.options.at(-1)).toEqual({ text: '17 px', value: '17' });
    expect(els.expandBudget.value).toBe('800');
    expect(els.preview.style).toMatchObject({ fontSize: '17px', '--indent': '18px' });
  });

  it('shows a font that is not a preset in the custom field', async () => {
    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, fontFamily: 'Iosevka' } });
    await openOptions();
    expect(els.fontPreset.value).toBe('custom');
    expect(els.fontCustom.value).toBe('Iosevka');
    expect(els.fontCustomRow.hidden).toBe(false);
  });

  it('saves the whole settings object on every change, and says so', async () => {
    await openOptions();
    await change('fontSize', (e: FakeSelect) => (e.value = '16'));
    expect(await stored()).toEqual({ ...DEFAULT_SETTINGS, fontSize: 16 });
    expect(els.status.textContent).toBe('Saved');
    vi.advanceTimersByTime(2000);
    expect(els.status.textContent).toBe('');

    await change('imagePreview', (e: FakeInput) => (e.checked = false));
    await change('theme', (e: FakeSelect) => (e.value = 'light'));
    expect(await stored()).toEqual({ ...DEFAULT_SETTINGS, fontSize: 16, imagePreview: false, theme: 'light' });
  });

  it('saves a custom font 400 ms after typing stops', async () => {
    await openOptions();
    await change('fontPreset', (e: FakeSelect) => (e.value = 'custom'));
    expect(els.fontCustomRow.hidden).toBe(false);
    els.fontCustom.value = 'Ioseve';
    els.fontCustom.handlers.input!();
    vi.advanceTimersByTime(300);
    els.fontCustom.value = 'Iosevka';
    els.fontCustom.handlers.input!();
    vi.advanceTimersByTime(399);
    await settle();
    expect((await stored())?.fontFamily).toBe('');
    vi.advanceTimersByTime(1);
    await settle();
    expect((await stored())?.fontFamily).toBe('Iosevka');
  });

  it('refuses a font name that could break out of font-family, without saving', async () => {
    await openOptions();
    await change('fontPreset', (e: FakeSelect) => (e.value = 'custom'));
    els.fontCustom.value = 'x; } body { display: none';
    els.fontCustom.handlers.input!();
    vi.advanceTimersByTime(400);
    await settle();
    expect(els.status.textContent).toBe('That font name has characters a font name cannot contain.');
    expect((await stored())?.fontFamily).not.toContain('display');
  });

  // Choosing Other… must not save '' and re-render the select back to a preset.
  it('lets a user switch from a preset font to a custom one', async () => {
    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, fontFamily: 'Menlo' } });
    await openOptions();
    await change('fontPreset', (e: FakeSelect) => (e.value = 'custom'));
    expect(els.fontPreset.value).toBe('custom');
    expect(els.fontCustomRow.hidden).toBe(false);
  });

  it('keeps the saved font until a custom one is typed', async () => {
    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, fontFamily: 'Menlo' } });
    await openOptions();
    await change('fontPreset', (e: FakeSelect) => (e.value = 'custom'));
    expect((await stored())?.fontFamily).toBe('Menlo');
    els.fontCustom.value = 'Iosevka';
    els.fontCustom.handlers.input!();
    vi.advanceTimersByTime(400);
    await settle();
    expect((await stored())?.fontFamily).toBe('Iosevka');
    expect(els.fontPreset.value).toBe('custom');
  });

  it('follows changes made in the popup, but not while a custom font is being typed', async () => {
    await openOptions();
    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, enabled: false } });
    expect(els.enabled.checked).toBe(false);

    activeElement = els.fontCustom;
    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });
    expect(els.theme.value).toBe('auto');
  });
});
