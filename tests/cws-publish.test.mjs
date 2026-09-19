// scripts/cws-publish.sh is the only thing that talks to the Chrome Web Store when a release is cut,
// and nothing else runs it before then. The April 2026 release of a sibling extension failed and
// nobody noticed for four months. These tests run the real script against a stub `curl`, so every
// branch (success, draft-only, async upload, each failure) is exercised in CI without touching the store.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../scripts/cws-publish.sh');
const RELEASE_YML = resolve(__dirname, '../.github/workflows/release.yml');
const PUB = '11844dd1-bc05-433e-99d0-613f8fd461a2';
const ITEM = 'abcdefghijklmnopabcdefghijklmnop';
const SECRET = 'CLIENT-SECRET-VALUE-XYZ';
const REFRESH = 'REFRESH-TOKEN-VALUE-XYZ';
const ITEM_URL = `publishers/${PUB}/items/${ITEM}`;

// A stand-in for curl. It logs each request and answers from a route table: the first route whose
// `match` is a substring of the URL, taking its responses in order and repeating the last one.
const STUB = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const url = args.find((a) => /^https?:/.test(a));
const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : args.includes('-T') ? 'PUT' : 'GET';
const routes = JSON.parse(fs.readFileSync(process.env.STUB_ROUTES, 'utf8'));
const state = fs.existsSync(process.env.STUB_STATE) ? JSON.parse(fs.readFileSync(process.env.STUB_STATE, 'utf8')) : {};
const i = routes.findIndex((r) => url.includes(r.match));
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({
  url, method,
  upload: args.includes('-T'),
  bearer: args.some((a) => a === 'Authorization: Bearer tok'),
  body: args.includes('-d') ? args[args.indexOf('-d') + 1] : undefined,
}) + '\\n');
if (i < 0) { process.stdout.write('{"error":{"message":"no stub route"}}\\n599'); process.exit(0); }
const n = state[i] ?? 0;
const r = routes[i].responses[Math.min(n, routes[i].responses.length - 1)];
state[i] = n + 1;
fs.writeFileSync(process.env.STUB_STATE, JSON.stringify(state));
process.stdout.write(JSON.stringify(r.body) + '\\n' + r.code);
`;

const ok = (body, code = 200) => ({ code, body });
const routes = {
  token: { match: 'oauth2.googleapis.com/token', responses: [ok({ access_token: 'tok' })] },
  upload: { match: ':upload', responses: [ok({ uploadState: 'SUCCEEDED', crxVersion: '1.2.3' })] },
  publish: { match: ':publish', responses: [ok({ state: 'PENDING_REVIEW' })] },
  status: { match: ':fetchStatus', responses: [ok({ submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } })] },
};

let dir;
function run(overrides = {}, { env = {}, withZip = true } = {}) {
  const table = { ...routes, ...overrides };
  writeFileSync(join(dir, 'routes.json'), JSON.stringify(Object.values(table)));
  rmSync(join(dir, 'state.json'), { force: true });
  rmSync(join(dir, 'calls.log'), { force: true });
  if (withZip) {
    mkdirSync(join(dir, 'work/.output'), { recursive: true });
    writeFileSync(join(dir, 'work/.output/ext-1.2.3-chrome.zip'), 'zip bytes');
  }
  const r = spawnSync('bash', [SCRIPT], {
    cwd: join(dir, 'work'),
    encoding: 'utf8',
    env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      HOME: dir,
      CWS_CLIENT_ID: 'client-id',
      CWS_CLIENT_SECRET: SECRET,
      CWS_REFRESH_TOKEN: REFRESH,
      CWS_PUBLISHER_ID: PUB,
      CWS_ITEM_ID: ITEM,
      CWS_POLL_SECONDS: '0',
      STUB_ROUTES: join(dir, 'routes.json'),
      STUB_STATE: join(dir, 'state.json'),
      STUB_LOG: join(dir, 'calls.log'),
      ...env,
    },
  });
  const log = existsSync(join(dir, 'calls.log'))
    ? readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { ...r, log, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cws-publish-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'work'));
  writeFileSync(join(dir, 'bin/curl'), STUB);
  chmodSync(join(dir, 'bin/curl'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('cws-publish.sh', () => {
  it('uploads to the draft and submits for review, on the v2 endpoints', () => {
    const r = run();
    expect(r.status, r.out).toBe(0);
    expect(r.log.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://oauth2.googleapis.com/token',
      `POST https://chromewebstore.googleapis.com/upload/v2/${ITEM_URL}:upload`,
      `POST https://chromewebstore.googleapis.com/v2/${ITEM_URL}:publish`,
      `GET https://chromewebstore.googleapis.com/v2/${ITEM_URL}:fetchStatus`,
    ]);
    expect(r.log.some((c) => c.url.includes('v1.1'))).toBe(false);
    const [, upload, publish] = r.log;
    expect(upload.upload).toBe(true);
    expect(upload.bearer).toBe(true);
    expect(publish.bearer).toBe(true);
    expect(JSON.parse(publish.body)).toEqual({ publishType: 'DEFAULT_PUBLISH' });
    expect(r.stdout).toContain('Upload: SUCCEEDED (crxVersion 1.2.3)');
    expect(r.stdout).toContain('Publish: PENDING_REVIEW (crxVersion 1.2.3)');
  });

  it('with CWS_AUTO_PUBLISH=false uploads to the draft and never submits', () => {
    const r = run({}, { env: { CWS_AUTO_PUBLISH: 'false' } });
    expect(r.status, r.out).toBe(0);
    expect(r.log.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      `https://chromewebstore.googleapis.com/upload/v2/${ITEM_URL}:upload`,
    ]);
    expect(r.stdout).toContain('NOT submitted for review');
  });

  it('treats any other CWS_AUTO_PUBLISH value as "submit"', () => {
    const r = run({}, { env: { CWS_AUTO_PUBLISH: '' } });
    expect(r.status, r.out).toBe(0);
    expect(r.log.some((c) => c.url.endsWith(':publish'))).toBe(true);
  });

  it('waits for an upload that is still in progress, then submits', () => {
    const r = run({
      upload: { match: ':upload', responses: [ok({ uploadState: 'IN_PROGRESS', crxVersion: '1.2.3' })] },
      status: {
        match: ':fetchStatus',
        responses: [ok({ lastAsyncUploadState: 'IN_PROGRESS' }), ok({ lastAsyncUploadState: 'SUCCEEDED' })],
      },
    });
    expect(r.status, r.out).toBe(0);
    const urls = r.log.map((c) => c.url.split('/').pop());
    expect(urls.slice(2, 5)).toEqual([`${ITEM}:fetchStatus`, `${ITEM}:fetchStatus`, `${ITEM}:publish`]);
  });

  it('gives up, without submitting, when the upload never finishes', () => {
    const r = run(
      {
        upload: { match: ':upload', responses: [ok({ uploadState: 'IN_PROGRESS' })] },
        status: { match: ':fetchStatus', responses: [ok({ lastAsyncUploadState: 'IN_PROGRESS' })] },
      },
      { env: { CWS_POLL_MAX: '2' } },
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('still in progress');
    expect(r.log.some((c) => c.url.endsWith(':publish'))).toBe(false);
  });

  it('fails, without submitting, when the upload FAILED', () => {
    const r = run({ upload: { match: ':upload', responses: [ok({ uploadState: 'FAILED', crxVersion: '1.2.3' })] } });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('upload did not succeed: FAILED');
    expect(r.log.some((c) => c.url.endsWith(':publish'))).toBe(false);
  });

  it('fails with the API message when the upload is refused', () => {
    const r = run({
      upload: { match: ':upload', responses: [ok({ error: { code: 403, message: 'Permission denied on resource' } }, 403)] },
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('upload rejected (HTTP 403): Permission denied on resource');
    expect(r.log.some((c) => c.url.endsWith(':publish'))).toBe(false);
  });

  it.each(['REJECTED', 'CANCELLED', 'ITEM_STATE_UNSPECIFIED'])('fails when the submission comes back %s', (state) => {
    const r = run({ publish: { match: ':publish', responses: [ok({ state })] } });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`publish not accepted: state ${state}`);
  });

  it('fails when publish is refused', () => {
    const r = run({
      publish: { match: ':publish', responses: [ok({ error: { message: 'The item is already pending review' } }, 400)] },
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('publish rejected (HTTP 400): The item is already pending review');
  });

  it('fails on a bad token exchange, calls nothing else, and never prints a credential', () => {
    const r = run({
      token: { match: 'oauth2.googleapis.com/token', responses: [ok({ error: 'invalid_grant', error_description: 'Bad Request' }, 400)] },
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('no access token (HTTP 400)');
    expect(r.out).toContain('invalid_grant');
    expect(r.out).not.toContain(SECRET);
    expect(r.out).not.toContain(REFRESH);
    expect(r.log).toHaveLength(1);
  });

  it('never prints a credential on success either', () => {
    const r = run();
    expect(r.out).not.toContain(SECRET);
    expect(r.out).not.toContain(REFRESH);
    expect(r.out).not.toContain('Bearer');
  });

  it('fails before uploading when there is no package', () => {
    const r = run({}, { withZip: false });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('expected exactly one .output/*-chrome.zip');
    expect(r.log.map((c) => c.url)).toEqual(['https://oauth2.googleapis.com/token']);
  });

  it('requires the item to be named', () => {
    const r = run({}, { env: { CWS_ITEM_ID: '' } });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('CWS_ITEM_ID is required');
  });
});

describe('release workflow', () => {
  const yml = readFileSync(RELEASE_YML, 'utf8');

  it('publishes through the script, not the v1.1 API that stops on 2026-10-15', () => {
    expect(yml).toContain('scripts/cws-publish.sh');
    expect(yml).not.toMatch(/v1\.1/);
    expect(yml).not.toContain('www.googleapis.com/upload/chromewebstore');
  });

  it('names the publisher and one store item, and passes the auto-publish switch through', () => {
    expect(yml).toContain(`CWS_PUBLISHER_ID: ${PUB}`);
    expect(yml).toMatch(/CWS_ITEM_ID: [a-p]{32}\b/);
    expect(yml).toContain('CWS_AUTO_PUBLISH: ${{ vars.CWS_AUTO_PUBLISH }}');
  });
});
