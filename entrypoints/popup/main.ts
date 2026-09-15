import { normalizeSettings } from '../../lib/settings';
import { describeTabStatus, type TabStatus } from '../../lib/status';

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

// Is the current tab being shown as JSON? Ask it: a tab that rendered answers,
// any other tab has no listener and the message fails. Needs no `tabs` permission.
const statusEl = document.getElementById('tab-status')!;
async function showTabStatus(): Promise<void> {
  const settings = normalizeSettings((await browser.storage.sync.get('settings')).settings);
  let status: TabStatus | null = null;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) status = ((await browser.tabs.sendMessage(tab.id, { type: 'jvp-status' })) as TabStatus | undefined) ?? null;
  } catch {
    status = null;
  }
  const { tone, text } = describeTabStatus(status, settings.enabled);
  statusEl.textContent = text;
  statusEl.className = `tab-status ${tone}`;
}
void showTabStatus();

document.getElementById('version')!.textContent = `v${browser.runtime.getManifest().version}`;
