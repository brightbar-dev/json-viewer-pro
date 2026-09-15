export interface Rule {
  id: string;
  pattern: RegExp;
  why: string;
}

export interface Allow {
  file: RegExp;
  rule: string;
  match?: RegExp;
  reason: string;
}

export interface Finding {
  file: string;
  rule: string;
  why: string;
  match: string;
  line: number;
}

export const RULES: Rule[];
export const SCANNED: RegExp;
export function scanText(file: string, text: string, allow?: Allow[]): { findings: Finding[]; allowed: (Finding & { reason: string })[] };
export function checkManifest(manifest: unknown): string[];
