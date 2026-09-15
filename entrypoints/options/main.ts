import { fontStack, normalizeSettings, type Settings } from '../../lib/settings';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = byId<HTMLInputElement>('enabled');
const theme = byId<HTMLSelectElement>('theme');
const fontPreset = byId<HTMLSelectElement>('fontPreset');
const fontCustomRow = byId<HTMLElement>('fontCustomRow');
const fontCustom = byId<HTMLInputElement>('fontCustom');
const fontSize = byId<HTMLSelectElement>('fontSize');
const indent = byId<HTMLSelectElement>('indent');
const expandBudget = byId<HTMLSelectElement>('expandBudget');
const imagePreview = byId<HTMLInputElement>('imagePreview');
const preview = byId<HTMLElement>('preview');
const status = byId<HTMLElement>('status');

/** Select `value`, adding an option for a value saved by another version or device. */
function choose(select: HTMLSelectElement, value: string, label = value): void {
  if (![...select.options].some((o) => o.value === value)) select.add(new Option(label, value));
  select.value = value;
}

function showPreview(s: Settings): void {
  preview.style.fontFamily = fontStack(s.fontFamily);
  preview.style.fontSize = `${s.fontSize}px`;
  preview.style.setProperty('--indent', `${s.indent}px`);
}

function render(s: Settings): void {
  enabled.checked = s.enabled;
  theme.value = s.theme;
  const preset = [...fontPreset.options].find((o) => o.value !== 'custom' && o.value === s.fontFamily);
  fontPreset.value = preset ? preset.value : 'custom';
  fontCustom.value = preset ? '' : s.fontFamily;
  fontCustomRow.hidden = !!preset;
  choose(fontSize, String(s.fontSize), `${s.fontSize} px`);
  choose(indent, String(s.indent), `${s.indent} px`);
  choose(expandBudget, String(s.expandBudget), `About ${s.expandBudget} rows`);
  imagePreview.checked = s.imagePreview;
  showPreview(s);
}

function read(): Settings {
  return normalizeSettings({
    enabled: enabled.checked,
    theme: theme.value,
    fontFamily: fontPreset.value === 'custom' ? fontCustom.value : fontPreset.value,
    fontSize: Number(fontSize.value),
    indent: Number(indent.value),
    expandBudget: Number(expandBudget.value),
    imagePreview: imagePreview.checked,
  });
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string): void {
  status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (status.textContent = ''), 2000);
}

async function save(): Promise<void> {
  fontCustomRow.hidden = fontPreset.value !== 'custom';
  const next = read();
  if (fontPreset.value === 'custom' && fontCustom.value.trim() && !next.fontFamily) {
    say('That font name has characters a font name cannot contain.');
    return;
  }
  showPreview(next);
  await browser.storage.sync.set({ settings: next });
  say('Saved');
}

browser.storage.sync.get('settings').then((data) => render(normalizeSettings(data.settings)));

for (const control of [enabled, theme, fontPreset, fontSize, indent, expandBudget, imagePreview]) {
  control.addEventListener('change', () => void save());
}
let typing: ReturnType<typeof setTimeout> | undefined;
fontCustom.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(() => void save(), 400);
});

// Changed from the popup (or another device): show it here too.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings && document.activeElement !== fontCustom) {
    render(normalizeSettings(changes.settings.newValue));
  }
});
