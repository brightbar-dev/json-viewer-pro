export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  enabled: boolean;
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = { enabled: true, theme: 'auto' };

/** Whatever is in storage (missing, partial, or from an older version) → a complete Settings. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : DEFAULT_SETTINGS.theme,
  };
}
