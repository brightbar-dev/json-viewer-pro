/**
 * JSON Viewer Pro promises that it never sends anything anywhere and never
 * runs code it did not ship. This scans a built extension for every way its
 * code could break that promise, and checks the manifest asks for nothing more
 * than it needs. Pure: scripts/check-privacy.mjs runs it in CI over the build,
 * and tests/privacy.test.ts pins the rules.
 */

/** @typedef {{ id: string, pattern: RegExp, why: string }} Rule */
/** @typedef {{ file: RegExp, rule: string, match?: RegExp, reason: string }} Allow */
/** @typedef {{ file: string, rule: string, why: string, match: string, line: number }} Finding */

/** @type {Rule[]} */
export const RULES = [
  { id: 'fetch', pattern: /\bfetch\s*\(/g, why: 'makes a network request' },
  { id: 'xhr', pattern: /\bXMLHttpRequest\b/g, why: 'makes a network request' },
  { id: 'websocket', pattern: /\bWebSocket\b/g, why: 'opens a network connection' },
  { id: 'eventsource', pattern: /\bEventSource\b/g, why: 'opens a network connection' },
  { id: 'beacon', pattern: /\bsendBeacon\b/g, why: 'sends data to a server' },
  { id: 'navigator-connect', pattern: /\bnavigator\.connect\b/g, why: 'opens a network connection' },
  { id: 'webrtc', pattern: /\bRTCPeerConnection\b/g, why: 'opens a network connection' },
  { id: 'import-scripts', pattern: /\bimportScripts\s*\(/g, why: 'loads code at run time' },
  { id: 'eval', pattern: /\beval\s*\(/g, why: 'runs code from a string' },
  { id: 'new-function', pattern: /\bnew\s+Function\s*\(/g, why: 'runs code from a string' },
  { id: 'string-timer', pattern: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/g, why: 'runs code from a string' },
  { id: 'remote-url', pattern: /\b(?:https?|wss?|ftp):\/\/[^\s"'`)<>\\]+/g, why: 'names a remote address' },
];

/** File types that can carry code or references to remote resources. */
export const SCANNED = /\.(?:m?js|html|css|json)$/;

/**
 * Findings in one file, split into those an allowlist entry explains and the
 * rest. `file` is the path relative to the build, with forward slashes.
 * @param {string} file
 * @param {string} text
 * @param {Allow[]} [allow]
 * @returns {{ findings: Finding[], allowed: (Finding & { reason: string })[] }}
 */
export function scanText(file, text, allow = []) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {(Finding & { reason: string })[]} */
  const allowed = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.pattern)) {
      const index = m.index ?? 0;
      let line = 1;
      for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
      const finding = { file, rule: rule.id, why: rule.why, match: m[0].slice(0, 120), line };
      const entry = allow.find((a) => a.rule === rule.id && a.file.test(file) && (!a.match || a.match.test(m[0])));
      if (entry) allowed.push({ ...finding, reason: entry.reason });
      else findings.push(finding);
    }
  }
  return { findings, allowed };
}

/**
 * What the manifest may ask for: the storage permission and nothing else — no
 * host or optional permissions, nothing web-accessible, no external messaging,
 * no custom content security policy, no self-hosted updates.
 * @param {any} manifest
 * @returns {string[]} one message per problem
 */
export function checkManifest(manifest) {
  const problems = [];
  const permissions = manifest?.permissions ?? [];
  const extra = permissions.filter((/** @type {string} */ p) => p !== 'storage');
  if (extra.length) problems.push(`permissions beyond "storage": ${extra.join(', ')}`);
  if ((manifest?.host_permissions ?? []).length) problems.push(`host_permissions: ${manifest.host_permissions.join(', ')}`);
  if ((manifest?.optional_permissions ?? []).length || (manifest?.optional_host_permissions ?? []).length) {
    problems.push('optional permissions');
  }
  if ((manifest?.web_accessible_resources ?? []).length) problems.push('web_accessible_resources (pages could detect or load extension files)');
  if (manifest?.externally_connectable) problems.push('externally_connectable (web pages could message the extension)');
  if (manifest?.content_security_policy) problems.push('a custom content_security_policy');
  if (manifest?.update_url) problems.push('update_url (updates from somewhere other than the store)');
  return problems;
}
