// scripts/crx3.mjs signs every Chrome Web Store upload of this item. A CRX it gets wrong is refused
// by the store at release time, so the format is pinned here: a round trip, the layout Chrome's own
// packer writes, and each way a package can be forged or damaged.
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { pack, verifyCrx, crxId } from '../scripts/crx3.mjs';

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey.export({ type: 'spki', format: 'pem' }), spki: publicKey.export({ type: 'spki', format: 'der' }) };
};
const a = pair();
const b = pair();
const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('a zip, as far as the header is concerned')]);

describe('crx3', () => {
  it('packs a CRX3 that verifies against the signing key and carries the zip unchanged', () => {
    const crx = pack(zip, a.key);
    expect(crx.subarray(0, 4).toString()).toBe('Cr24');
    expect(crx.readUInt32LE(4)).toBe(3);
    expect(crx.subarray(crx.length - zip.length).equals(zip)).toBe(true);
    const v = verifyCrx(crx, a.pub);
    expect(v.proofs).toBe(1);
    expect(v.expectedKeyMatched).toBe(createHash('sha256').update(a.spki).digest('hex'));
    expect(v.crxId).toBe(crxId(a.spki));
    expect(v.crxId).toMatch(/^[a-p]{32}$/);
  });

  it('writes the header layout chrome --pack-extension writes (proof field 2, then signed data at 10000)', () => {
    const crx = pack(zip, a.key);
    const header = crx.subarray(12, 12 + crx.readUInt32LE(8));
    expect(header[0]).toBe(0x12); // field 2, length-delimited
    // field 10000, length-delimited, carrying SignedData{crx_id: 16 bytes}
    expect(header.subarray(header.length - 22, header.length - 16).toString('hex')).toBe('82f104120a10');
  });

  it('refuses a package signed by another key when a key is expected', () => {
    expect(() => verifyCrx(pack(zip, b.key), a.pub)).toThrow('not signed by the expected public key');
  });

  it('refuses a package whose zip was altered after signing', () => {
    const crx = pack(zip, a.key);
    crx[crx.length - 1] ^= 1;
    expect(() => verifyCrx(crx)).toThrow('signature does not verify');
  });

  it('refuses anything that is not a CRX3', () => {
    expect(() => verifyCrx(zip)).toThrow('no Cr24 magic');
    const v2 = pack(zip, a.key);
    v2.writeUInt32LE(2, 4);
    expect(() => verifyCrx(v2)).toThrow('CRX version 2');
  });

  it('refuses a non-RSA key', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(() => pack(zip, privateKey.export({ type: 'pkcs8', format: 'pem' }))).toThrow('not RSA');
  });
});
