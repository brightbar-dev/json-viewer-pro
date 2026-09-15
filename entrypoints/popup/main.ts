import { normalizeSettings } from '../../lib/settings';

const enabledCheckbox = document.getElementById('enabled') as HTMLInputElement;
const themeSelect = document.getElementById('theme') as HTMLSelectElement;

browser.storage.sync.get('settings').then((data) => {
  const settings = normalizeSettings(data.settings);
  enabledCheckbox.checked = settings.enabled;
  themeSelect.value = settings.theme;
});

// Merge into what is stored, so the popup never wipes settings it does not show.
async function saveSettings(): Promise<void> {
  const stored = normalizeSettings((await browser.storage.sync.get('settings')).settings);
  const settings = normalizeSettings({ ...stored, enabled: enabledCheckbox.checked, theme: themeSelect.value });
  await browser.storage.sync.set({ settings });
}

enabledCheckbox.addEventListener('change', () => void saveSettings());
themeSelect.addEventListener('change', () => void saveSettings());

document.getElementById('options-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});
