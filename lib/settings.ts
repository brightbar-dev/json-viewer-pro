export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  enabled: boolean;
  /** `auto` follows the operating system, live. */
  theme: Theme;
  /** CSS font-family for the viewer; '' means the default monospace stack. */
  fontFamily: string;
  /** Font size in px. */
  fontSize: number;
  /** Indent per nesting level, in px. */
  indent: number;
  /** Rows opened, breadth first, when a document is first shown. */
  expandBudget: number;
  /** Show a thumbnail when an image URL is hovered (loads the image from that URL). */
  imagePreview: boolean;
}

export const DEFAULT_MONOSPACE = "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  theme: 'auto',
  fontFamily: '',
  fontSize: 13,
  indent: 18,
  expandBudget: 1500,
  imagePreview: true,
};

export const LIMITS = {
  fontSize: [10, 24],
  indent: [8, 48],
  expandBudget: [1, 100000],
} as const;

function clampInt(v: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/** Only characters that belong in a font-family list. */
const FONT_FAMILY = /^[\w\s,'"-.]{0,200}$/;

/** Whatever is in storage (missing, partial, or from an older version) → a complete Settings. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const family = typeof r.fontFamily === 'string' ? r.fontFamily.trim() : '';
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : DEFAULT_SETTINGS.theme,
    fontFamily: FONT_FAMILY.test(family) ? family : '',
    fontSize: clampInt(r.fontSize, LIMITS.fontSize, DEFAULT_SETTINGS.fontSize),
    indent: clampInt(r.indent, LIMITS.indent, DEFAULT_SETTINGS.indent),
    expandBudget: clampInt(r.expandBudget, LIMITS.expandBudget, DEFAULT_SETTINGS.expandBudget),
    imagePreview: typeof r.imagePreview === 'boolean' ? r.imagePreview : DEFAULT_SETTINGS.imagePreview,
  };
}

/** The font-family to apply: the chosen family, falling back to the default stack. */
export function fontStack(family: string): string {
  return family ? `${family}, ${DEFAULT_MONOSPACE}` : DEFAULT_MONOSPACE;
}

/** Row height for a font size: 13px text on 20px rows, scaled. */
export function rowHeightFor(fontSize: number): number {
  return Math.round(fontSize * 1.54);
}
