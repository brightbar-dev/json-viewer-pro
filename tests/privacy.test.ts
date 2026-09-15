import { describe, it, expect } from 'vitest';
import { checkManifest, scanText } from '../scripts/privacy-scan.mjs';

const rules = (text: string, file = 'content-scripts/content.js') => scanText(file, text).findings.map((f) => f.rule);

describe('privacy scan: what it catches', () => {
  it('network APIs', () => {
    expect(rules('fetch("/a"); new XMLHttpRequest(); new WebSocket(u); new EventSource(u); navigator.sendBeacon(u, d);')).toEqual([
      'fetch', 'xhr', 'websocket', 'eventsource', 'beacon',
    ]);
  });
  it('less common channels', () => {
    expect(rules('navigator.connect(x); new RTCPeerConnection(); importScripts("x.js")')).toEqual(['navigator-connect', 'webrtc', 'import-scripts']);
  });
  it('code from strings', () => {
    expect(rules('eval(s); new Function("a", s); setTimeout("run()", 1); setInterval(`x`, 2)')).toEqual(['eval', 'new-function', 'string-timer', 'string-timer']);
  });
  it('remote addresses, in code, markup and styles', () => {
    expect(rules('const u = "https://tracker.example/p.gif"')).toEqual(['remote-url']);
    expect(rules('<script src="http://cdn.example/x.js"></script>', 'popup.html')).toEqual(['remote-url']);
    expect(rules('@import url(https://fonts.example/css);', 'assets/a.css')).toEqual(['remote-url']);
    expect(rules('new WebSocket("wss://live.example")')).toEqual(['websocket', 'remote-url']);
  });
  it('reports the line', () => {
    expect(scanText('a.js', 'ok();\nok();\nfetch(x)').findings[0]).toMatchObject({ rule: 'fetch', line: 3, match: 'fetch(' });
  });
});

describe('privacy scan: what it leaves alone', () => {
  it('ordinary code', () => {
    expect(rules('const fetched = 1; el.textContent = "x"; img.src = value; setTimeout(() => go(), 5); obj.evaluate(1); refetch(x)')).toEqual([]);
  });
  it('the http(s) check in a regular expression is not an address', () => expect(rules('const isUrl = /^https?:\\/\\//;')).toEqual([]));
});

describe('privacy scan: allowlist', () => {
  const allow = [{ file: /^popup\.html$/, rule: 'remote-url', match: /^https:\/\/chromewebstore\.google\.com\//, reason: 'a link the user clicks' }];
  it('an entry explains a specific match', () => {
    const r = scanText('popup.html', '<a href="https://chromewebstore.google.com/detail/x">x</a>', allow);
    expect(r.findings).toEqual([]);
    expect(r.allowed[0]).toMatchObject({ rule: 'remote-url', reason: 'a link the user clicks' });
  });
  it('the same address in another file is still flagged', () => {
    expect(scanText('content-scripts/content.js', '"https://chromewebstore.google.com/detail/x"', allow).findings).toHaveLength(1);
  });
  it('a different address in the allowed file is still flagged', () => {
    expect(scanText('popup.html', '<img src="https://tracker.example/p.gif">', allow).findings).toHaveLength(1);
  });
});

describe('manifest check', () => {
  const ok = { manifest_version: 3, permissions: ['storage'], content_scripts: [{ matches: ['<all_urls>'], js: ['c.js'] }] };
  it('storage only passes', () => expect(checkManifest(ok)).toEqual([]));
  it('no permissions at all passes', () => expect(checkManifest({ manifest_version: 3 })).toEqual([]));
  it('any other permission fails', () => expect(checkManifest({ ...ok, permissions: ['storage', 'tabs', 'downloads'] })).toEqual(['permissions beyond "storage": tabs, downloads']));
  it('host permissions fail', () => expect(checkManifest({ ...ok, host_permissions: ['<all_urls>'] })[0]).toMatch(/host_permissions/));
  it('optional permissions fail', () => expect(checkManifest({ ...ok, optional_permissions: ['tabs'] })).toEqual(['optional permissions']));
  it('web-accessible resources fail', () => expect(checkManifest({ ...ok, web_accessible_resources: [{ resources: ['x.css'] }] })[0]).toMatch(/web_accessible/));
  it('external messaging fails', () => expect(checkManifest({ ...ok, externally_connectable: { matches: ['*://*/*'] } })[0]).toMatch(/externally_connectable/));
  it('a custom CSP fails', () => expect(checkManifest({ ...ok, content_security_policy: { extension_pages: "script-src 'self'" } })[0]).toMatch(/content_security_policy/));
  it('self-hosted updates fail', () => expect(checkManifest({ ...ok, update_url: 'https://x' })[0]).toMatch(/update_url/));
});
