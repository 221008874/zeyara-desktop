// Independent minisign verification for Tauri updater artifacts.
//
// Deliberately does NOT use the tauri CLI or the Rust updater: this re-implements the
// check from the minisign format so that a bug in the updater cannot hide a bad
// signature. It is what the tamper test asserts against.
//
//   node verify-updater-signature.mjs <pubkey file> <sig file> <artifact file>
//
// Exit 0 = signature valid. Exit 1 = invalid or unverifiable.
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

function parseMinisignText(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error('not a minisign document');
  return {
    untrustedComment: lines[0],
    sigBlob: Buffer.from(lines[1], 'base64'),
    trustedComment: lines[2] ?? '',
    globalSigBlob: lines[3] ? Buffer.from(lines[3], 'base64') : null,
  };
}

/**
 * Tauri writes both the public key and the signature as a single base64 blob that
 * decodes to the minisign document. Accept either that form or a plain .minisig text file.
 *
 * Throws with a clear reason on anything unusable, so a missing or empty signature is a
 * clean "INVALID" rather than an unhandled crash. Failing closed matters: a verifier that
 * throws has not decided anything.
 */
function readMaybeWrapped(path, what) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8').trim();
  } catch {
    throw new Error(`${what} file is missing or unreadable: ${path}`);
  }
  if (!raw) throw new Error(`${what} file is empty: ${path}`);
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  return decoded.includes('untrusted comment') ? decoded : raw;
}

const [, , pubPath, sigPath, artifactPath] = process.argv;
if (!pubPath || !sigPath || !artifactPath) {
  console.error('usage: verify-updater-signature.mjs <pubkey> <sig> <artifact>');
  process.exit(2);
}

const fail = (msg) => {
  console.error(`INVALID: ${msg}`);
  process.exit(1);
};

let pub;
let sig;
let artifact;
try {
  pub = parseMinisignText(readMaybeWrapped(pubPath, 'public key'));
  sig = parseMinisignText(readMaybeWrapped(sigPath, 'signature'));
  artifact = readFileSync(artifactPath);
} catch (e) {
  fail(e.message);
}

// --- structure -------------------------------------------------------------
if (pub.sigBlob.length !== 42) fail(`public key blob is ${pub.sigBlob.length} bytes, expected 42`);
if (sig.sigBlob.length !== 74) fail(`signature blob is ${sig.sigBlob.length} bytes, expected 74`);

const pubAlg = pub.sigBlob.subarray(0, 2).toString('ascii');
const sigAlg = sig.sigBlob.subarray(0, 2).toString('ascii');
const pubKeyId = pub.sigBlob.subarray(2, 10);
const sigKeyId = sig.sigBlob.subarray(2, 10);
const rawPublicKey = pub.sigBlob.subarray(10, 42);
const rawSignature = sig.sigBlob.subarray(10, 74);

if (pubAlg !== 'Ed') fail(`unexpected public key algorithm "${pubAlg}"`);
if (!pubKeyId.equals(sigKeyId)) {
  fail(`signature key id ${sigKeyId.toString('hex')} does not match key ${pubKeyId.toString('hex')}`);
}

// --- DER-wrap the raw 32-byte Ed25519 key so Node can use it ----------------
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const publicKey = createPublicKey({
  key: Buffer.concat([SPKI_ED25519_PREFIX, rawPublicKey]),
  format: 'der',
  type: 'spki',
});

// --- what was actually signed ----------------------------------------------
// Verified empirically against the bytes the Rust `minisign` crate (the one the Tauri
// updater uses) actually produces, because guessing here turns a valid signature into a
// false alarm:
//   * prehashed "ED"  -> BLAKE2b-512 of the artifact, NOT SHA-512
//   * "Ed"            -> the artifact bytes directly
let message;
if (sigAlg === 'Ed') {
  message = artifact;
} else if (sigAlg === 'ED') {
  message = createHash('blake2b512').update(artifact).digest();
} else {
  fail(`unsupported signature algorithm "${sigAlg}"`);
}

if (!cryptoVerify(null, message, publicKey, rawSignature)) {
  fail('Ed25519 signature does not match the artifact');
}

// --- the trusted comment is itself signed ---------------------------------
// This is what stops an attacker editing the filename or timestamp in the trusted
// comment while leaving the artifact signature intact.
//
// Note the global signature is a RAW 64-byte Ed25519 signature with no algorithm or key
// id header, and it covers signature||comment with no hashing.
if (sig.globalSigBlob) {
  if (sig.globalSigBlob.length !== 64) {
    fail(`global signature is ${sig.globalSigBlob.length} bytes, expected a raw 64`);
  }
  const comment = sig.trustedComment.replace(/^trusted comment:\s*/, '');
  const globalMessage = Buffer.concat([rawSignature, Buffer.from(comment, 'utf8')]);
  if (!cryptoVerify(null, globalMessage, publicKey, sig.globalSigBlob)) {
    fail('trusted comment signature does not verify');
  }
}

console.log(
  `VALID: ${sigAlg} signature by key ${pubKeyId.toString('hex')}` +
    (sig.trustedComment ? ` | ${sig.trustedComment.replace(/^trusted comment:\s*/, '')}` : '')
);
process.exit(0);
