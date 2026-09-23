// scripts/cws-publish.sh is the only thing that talks to the Chrome Web Store when a release is cut,
// and nothing else runs it before then. The April 2026 release of a sibling extension failed and
// nobody noticed for four months. These tests run the real script against a stub `curl`, so every
// branch (success, draft-only, async upload, each failure) is exercised in CI without touching the store.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { join, resolve } from 'node:path';
import { verifyCrx } from '../scripts/crx3.mjs';

const SCRIPT = resolve(__dirname, '../scripts/cws-publish.sh');
const RELEASE_YML = resolve(__dirname, '../.github/workflows/release.yml');
const CRX_PUBLIC_KEY = resolve(__dirname, '../store/cws-crx-public-key.pub');
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
  file: args.includes('-T') ? args[args.indexOf('-T') + 1] : undefined,
  headers: args.filter((a, n) => args[n - 1] === '-H' && !a.startsWith('Authorization')),
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
function run(overrides = {}, { env = {}, withZip = true, publicKey } = {}) {
  const table = { ...routes, ...overrides };
  writeFileSync(join(dir, 'routes.json'), JSON.stringify(Object.values(table)));
  rmSync(join(dir, 'state.json'), { force: true });
  rmSync(join(dir, 'calls.log'), { force: true });
  if (withZip) {
    mkdirSync(join(dir, 'work/.output'), { recursive: true });
    // Starts with a zip local-file-header signature, which is all the CRX verifier checks of it.
    writeFileSync(join(dir, 'work/.output/ext-1.2.3-chrome.zip'), Buffer.from('PK\x03\x04 zip bytes', 'latin1'));
  }
  rmSync(join(dir, 'work/store'), { recursive: true, force: true });
  if (publicKey) {
    mkdirSync(join(dir, 'work/store'), { recursive: true });
    writeFileSync(join(dir, 'work/store/cws-crx-public-key.pub'), publicKey);
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
    expect(r.out).toContain('no access token (HTTP 400, via refresh token)');
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

  it('fails before calling anything when there is no package', () => {
    const r = run({}, { withZip: false });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('expected exactly one .output/*-chrome.zip');
    expect(r.log).toHaveLength(0);
  });

  it('uploads the zip as it is when the item takes unsigned uploads (no public key, no CWS_CRX_KEY)', () => {
    const r = run();
    expect(r.status, r.out).toBe(0);
    const upload = r.log.find((c) => c.upload);
    expect(upload.file).toBe('.output/ext-1.2.3-chrome.zip');
    expect(upload.headers.some((h) => h.startsWith('X-Goog-Upload'))).toBe(false);
  });

  it('requires the item to be named', () => {
    const r = run({}, { env: { CWS_ITEM_ID: '' } });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('CWS_ITEM_ID is required');
  });
});

describe('cws-publish.sh with a service account (CWS_SA_KEY)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const SA_KEY = JSON.stringify({ type: 'service_account', client_email: 'sa@test.iam.gserviceaccount.com', private_key: PEM });
  const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  it('mints the token from a signed JWT, never touches the refresh token, and says which identity it used', () => {
    const r = run({}, { env: { CWS_SA_KEY: SA_KEY } });
    expect(r.status, r.out).toBe(0);
    const [token, upload] = r.log;
    expect(token.url).toBe('https://oauth2.googleapis.com/token');
    expect(token.body).toMatch(/^grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=/);
    expect(token.body).not.toContain('refresh_token');
    expect(upload.bearer).toBe(true);
    expect(r.stdout).toContain('Auth: service account sa@test.iam.gserviceaccount.com');

    const [head, claims, sig] = token.body.split('assertion=')[1].split('.');
    expect(JSON.parse(b64url(head))).toEqual({ alg: 'RS256', typ: 'JWT' });
    const c = JSON.parse(b64url(claims));
    expect(c).toMatchObject({
      iss: 'sa@test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(c.exp - c.iat).toBe(3600);
    const v = createVerify('RSA-SHA256');
    v.update(`${head}.${claims}`);
    expect(v.verify(publicKey, b64url(sig))).toBe(true);
  });

  it('works with no OAuth secrets at all', () => {
    const r = run({}, { env: { CWS_SA_KEY: SA_KEY, CWS_CLIENT_ID: '', CWS_CLIENT_SECRET: '', CWS_REFRESH_TOKEN: '' } });
    expect(r.status, r.out).toBe(0);
  });

  it('never prints the private key, even when the token exchange fails', () => {
    const r = run(
      { token: { match: 'oauth2.googleapis.com/token', responses: [ok({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400)] } },
      { env: { CWS_SA_KEY: SA_KEY } },
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('no access token (HTTP 400, via service account sa@test.iam.gserviceaccount.com)');
    expect(r.out).not.toContain('PRIVATE KEY');
    expect(r.out).not.toContain(PEM.split('\n')[1]);
    expect(r.log).toHaveLength(1);
  });

  it('refuses a CWS_SA_KEY that is not a service-account key, before calling anything', () => {
    const r = run({}, { env: { CWS_SA_KEY: 'not json' } });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('CWS_SA_KEY is not a service-account JSON key');
    expect(r.log).toHaveLength(0);
  });
});

describe('cws-publish.sh with Verified CRX Uploads (CWS_CRX_KEY)', () => {
  const pair = () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
      key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      pub: publicKey.export({ type: 'spki', format: 'pem' }),
    };
  };
  const signer = pair();
  const stranger = pair();

  it('signs the zip into a CRX3, checks it against the registered key, and uploads the CRX raw', () => {
    const r = run({}, { env: { CWS_CRX_KEY: signer.key }, publicKey: signer.pub });
    expect(r.status, r.out).toBe(0);
    const upload = r.log.find((c) => c.upload);
    expect(upload.file).toBe('.output/ext-1.2.3-chrome.crx');
    expect(upload.headers).toEqual(['X-Goog-Upload-Protocol: raw', 'X-Goog-Upload-File-Name: ext-1.2.3-chrome.crx']);
    const crx = readFileSync(join(dir, 'work/.output/ext-1.2.3-chrome.crx'));
    expect(verifyCrx(crx, signer.pub).proofs).toBe(1);
    expect(() => verifyCrx(crx, stranger.pub)).toThrow('not signed by the expected public key');
    expect(r.stdout).toMatch(/Signed: \.output\/ext-1\.2\.3-chrome\.crx/);
    expect(r.log.some((c) => c.url.endsWith(':publish'))).toBe(true);
  });

  it('refuses to upload an unsigned zip once the item has a registered public key', () => {
    const r = run({}, { publicKey: signer.pub });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('CWS_CRX_KEY is not set');
    expect(r.log).toHaveLength(0);
  });

  it('refuses a CRX signed by any other key, before calling anything, and never prints the key', () => {
    const r = run({}, { env: { CWS_CRX_KEY: stranger.key }, publicKey: signer.pub });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('not signed by the registered key');
    expect(r.out).not.toContain('PRIVATE KEY');
    expect(r.out).not.toContain(stranger.key.split('\n')[1]);
    expect(r.log).toHaveLength(0);
  });

  it('fails, calling nothing, when CWS_CRX_KEY is not a key', () => {
    const r = run({}, { env: { CWS_CRX_KEY: 'not a key' }, publicKey: signer.pub });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('could not sign the package');
    expect(r.log).toHaveLength(0);
  });

  it('with CWS_BUILD_ONLY=true builds and verifies the CRX and touches no network or credential', () => {
    const r = run({}, {
      env: { CWS_CRX_KEY: signer.key, CWS_BUILD_ONLY: 'true', CWS_CLIENT_ID: '', CWS_CLIENT_SECRET: '', CWS_REFRESH_TOKEN: '' },
      publicKey: signer.pub,
    });
    expect(r.status, r.out).toBe(0);
    expect(r.log).toHaveLength(0);
    expect(r.stdout).toContain('CWS_BUILD_ONLY=true');
    expect(verifyCrx(readFileSync(join(dir, 'work/.output/ext-1.2.3-chrome.crx')), signer.pub).proofs).toBe(1);
  });
});

describe('the registered CRX public key', () => {
  // The key registered in the dashboard's Verified CRX Uploads section for all four Brightbar
  // items (2026-09-23). The private half is vault:brightbar-cws-crx-signing-key#notes and the
  // org Actions secret CWS_CRX_KEY. A different file here means the next release is refused.
  it('is the brightbar publisher key', async () => {
    const { createPublicKey, createHash } = await import('node:crypto');
    const spki = createPublicKey(readFileSync(CRX_PUBLIC_KEY)).export({ type: 'spki', format: 'der' });
    expect(createHash('sha256').update(spki).digest('hex')).toBe(
      '7cc41f58481e44147a5b9d759eb1722cdcd1c2149fe7d40ef697faf931f96205',
    );
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

  it('passes the service-account key, so releases publish as Claw rather than as Ken', () => {
    expect(yml).toContain('CWS_SA_KEY: ${{ secrets.CWS_SA_KEY }}');
  });

  it('passes the CRX signing key, because the store refuses unsigned uploads for this item', () => {
    expect(yml).toContain('CWS_CRX_KEY: ${{ secrets.CWS_CRX_KEY }}');
  });
});
