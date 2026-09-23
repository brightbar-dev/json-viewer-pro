#!/usr/bin/env node
// crx3.mjs - build and verify CRX3 packages, with no dependencies beyond Node itself.
//
// This item is opted in to Chrome Web Store "Verified CRX Uploads": the store refuses any package
// that is not a CRX signed with the publisher's own RSA key, so a leaked upload credential alone
// cannot ship an update (https://developer.chrome.com/docs/webstore/update). cws-publish.sh calls
// `pack` on the release zip and `verify` on the result before it uploads anything.
//
//   node scripts/crx3.mjs pack   <in.zip> <private-key.pem> <out.crx>
//   node scripts/crx3.mjs verify <in.crx> [<expected-public-key.pem>]
//
// `verify` checks every signature in the header and, given a public key, that this key signed it.
// It exits 0 and prints a JSON summary, or exits 1 and says why.
//
// The format is Chromium's components/crx_file/crx3.proto:
//   "Cr24" | uint32le 3 | uint32le header_size | CrxFileHeader | zip
//   CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2; bytes signed_header_data = 10000; }
//   AsymmetricKeyProof { bytes public_key = 1; bytes signature = 2; }   public_key is DER SPKI
//   SignedData { bytes crx_id = 1; }                                     first 16 bytes of sha256(SPKI)
// Each signature is RSASSA-PKCS1-v1_5/SHA-256 over
//   "CRX3 SignedData\x00" | uint32le len(signed_header_data) | signed_header_data | zip
// The store keeps the item's own ID and re-signs the package it serves, so crx_id here is derived
// from the signing key, exactly as `chrome --pack-extension --pack-extension-key` does.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const MAGIC = Buffer.from('Cr24');
const SIGN_CONTEXT = Buffer.from('CRX3 SignedData\x00', 'latin1');

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

// A length-delimited protobuf field (wire type 2).
const field = (num, bytes) => Buffer.concat([varint((num << 3) | 2), varint(bytes.length), bytes]);

// Every field in buf as { num, bytes }. Only varint and length-delimited wire types are expected.
function fields(buf) {
  const out = [];
  let i = 0;
  const readVarint = () => {
    let n = 0;
    let shift = 0;
    for (;;) {
      if (i >= buf.length) throw new Error('truncated varint');
      const b = buf[i++];
      n += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return n;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const tag = readVarint();
    const num = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) {
      out.push({ num, value: readVarint() });
    } else if (wire === 2) {
      const len = readVarint();
      if (i + len > buf.length) throw new Error(`field ${num} runs past the end`);
      out.push({ num, bytes: buf.subarray(i, i + len) });
      i += len;
    } else {
      throw new Error(`unexpected wire type ${wire}`);
    }
  }
  return out;
}

const signedPayload = (signedData, zip) => Buffer.concat([SIGN_CONTEXT, u32(signedData.length), signedData, zip]);
const spkiOf = (key) => createPublicKey(key).export({ type: 'spki', format: 'der' });
export const crxId = (spki) =>
  [...createHash('sha256').update(spki).digest().subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
    .join('');

export function pack(zip, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'rsa') throw new Error(`the key is ${key.asymmetricKeyType}, not RSA`);
  const spki = spkiOf(key);
  const signedData = field(1, createHash('sha256').update(spki).digest().subarray(0, 16));
  const signature = sign('sha256', signedPayload(signedData, zip), key);
  const header = Buffer.concat([field(2, Buffer.concat([field(1, spki), field(2, signature)])), field(10000, signedData)]);
  return Buffer.concat([MAGIC, u32(3), u32(header.length), header, zip]);
}

// Throws unless crx is a well-formed CRX3 whose every RSA proof verifies and one proof's key
// matches the declared crx_id. With expectedPublicKeyPem, that key must be among the signers.
export function verifyCrx(crx, expectedPublicKeyPem) {
  if (crx.length < 12 || !crx.subarray(0, 4).equals(MAGIC)) throw new Error('not a CRX file (no Cr24 magic)');
  const version = crx.readUInt32LE(4);
  if (version !== 3) throw new Error(`CRX version ${version}, expected 3`);
  const headerSize = crx.readUInt32LE(8);
  if (12 + headerSize > crx.length) throw new Error('header runs past the end of the file');
  const header = crx.subarray(12, 12 + headerSize);
  const zip = crx.subarray(12 + headerSize);
  if (zip.length < 4 || zip.readUInt32LE(0) !== 0x04034b50) throw new Error('the archive after the header is not a zip');

  const hf = fields(header);
  const signedData = hf.find((f) => f.num === 10000)?.bytes;
  if (!signedData) throw new Error('no signed_header_data');
  const declaredId = fields(signedData).find((f) => f.num === 1)?.bytes;
  if (!declaredId || declaredId.length !== 16) throw new Error('no 16-byte crx_id in signed_header_data');
  const proofs = hf.filter((f) => f.num === 2).map((f) => {
    const pf = fields(f.bytes);
    return { spki: pf.find((x) => x.num === 1)?.bytes, signature: pf.find((x) => x.num === 2)?.bytes };
  });
  if (!proofs.length) throw new Error('no sha256_with_rsa proofs');

  const payload = signedPayload(signedData, zip);
  const signers = proofs.map(({ spki, signature }, n) => {
    if (!spki || !signature) throw new Error(`proof ${n} is missing its key or signature`);
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    if (!verify('sha256', payload, key, signature)) throw new Error(`proof ${n}: signature does not verify`);
    return Buffer.from(spki);
  });
  const idKey = signers.find((spki) => createHash('sha256').update(spki).digest().subarray(0, 16).equals(declaredId));
  if (!idKey) throw new Error('no proof is signed by the key crx_id names');

  let expected = null;
  if (expectedPublicKeyPem) {
    const want = spkiOf(expectedPublicKeyPem);
    if (!signers.some((s) => s.equals(want))) throw new Error('not signed by the expected public key');
    expected = createHash('sha256').update(want).digest('hex');
  }
  return {
    crxId: crxId(idKey),
    proofs: signers.length,
    signerSpkiSha256: signers.map((s) => createHash('sha256').update(s).digest('hex')),
    expectedKeyMatched: expected,
    zipBytes: zip.length,
  };
}

const [cmd, ...args] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (cmd === 'pack' && args.length === 3) {
      const crx = pack(readFileSync(args[0]), readFileSync(args[1]));
      writeFileSync(args[2], crx);
      console.log(JSON.stringify({ wrote: args[2], bytes: crx.length, ...verifyCrx(crx) }));
    } else if (cmd === 'verify' && (args.length === 1 || args.length === 2)) {
      console.log(JSON.stringify(verifyCrx(readFileSync(args[0]), args[1] ? readFileSync(args[1]) : undefined)));
    } else {
      console.error('usage: crx3.mjs pack <in.zip> <key.pem> <out.crx> | verify <in.crx> [<public-key.pem>]');
      process.exit(2);
    }
  } catch (e) {
    console.error(`crx3: ${e.message}`);
    process.exit(1);
  }
}
