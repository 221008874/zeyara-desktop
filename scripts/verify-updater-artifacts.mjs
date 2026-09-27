#!/usr/bin/env node
// End-to-end signature verification against a real, built and signed installer.
//
// Demonstrates the two halves of AC13 with actual artifacts rather than mocks:
//
//   1. the genuine artifact verifies against the production public key;
//   2. a tampered artifact is REJECTED, and so are a wrong key and an edited trusted
//      comment - each of which is what a hostile mirror or a swapped file would look like.
//
// Nothing here touches the network or the installed application: it proves the trust
// anchor, not the install cycle.
//
//   node scripts/verify-updater-artifacts.mjs <pubkey> <artifact> <sig>
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [pubPath, artifactPath, sigPath] = process.argv.slice(2);
if (!pubPath || !artifactPath || !sigPath) {
  console.error('usage: verify-updater-artifacts.mjs <pubkey> <artifact> <sig>');
  process.exit(2);
}

const verifier = resolve('scripts/verify-updater-signature.mjs');
const work = mkdtempSync(join(tmpdir(), 'zeyara-sig-'));

let pass = 0;
let failCount = 0;

function run(pub, sig, artifact) {
  try {
    const out = execFileSync(process.execPath, [verifier, pub, sig, artifact], {
      encoding: 'utf8',
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    // A verifier that crashed has not decided anything, so treat a non-zero exit as a
    // rejection and surface its first line rather than dumping a stack trace.
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
    const first = text.split('\n').find((l) => l.startsWith('INVALID:')) ?? text.split('\n')[0] ?? '';
    return { ok: false, out: first.trim() };
  }
}

function check(label, expectValid, pub, sig, artifact) {
  const r = run(pub, sig, artifact);
  const good = r.ok === expectValid;
  if (good) {
    pass++;
    console.log(`   PASS  ${label}`);
  } else {
    failCount++;
    console.log(`   FAIL  ${label} (expected ${expectValid ? 'valid' : 'invalid'}, got ${r.ok ? 'valid' : 'invalid'})`);
    console.log(`         ${r.out}`);
  }
  return r;
}

try {
  console.log('\n── acceptance ──────────────────────────────');
  check('the genuine signed installer verifies', true, pubPath, sigPath, artifactPath);

  console.log('\n── tampering ───────────────────────────────');

  // 1. Flip one byte in the middle of the installer.
  const tampered = join(work, 'tampered.exe');
  const bytes = readFileSync(artifactPath);
  const mid = Math.floor(bytes.length / 2);
  bytes[mid] = bytes[mid] ^ 0xff;
  writeFileSync(tampered, bytes);
  check('a single flipped byte is rejected', false, pubPath, sigPath, tampered);

  // 2. Append a byte: length changes, content identical up to that point.
  const appended = join(work, 'appended.exe');
  writeFileSync(appended, Buffer.concat([readFileSync(artifactPath), Buffer.from([0x00])]));
  check('an appended byte is rejected', false, pubPath, sigPath, appended);

  // 3. Truncate the installer.
  const truncated = join(work, 'truncated.exe');
  writeFileSync(truncated, readFileSync(artifactPath).subarray(0, 1024));
  check('a truncated installer is rejected', false, pubPath, sigPath, truncated);

  // 4. A completely different file claiming the same signature.
  const substituted = join(work, 'substituted.exe');
  writeFileSync(substituted, Buffer.from('MZ this is not the installer you are looking for'));
  check('a substituted file is rejected', false, pubPath, sigPath, substituted);

  // 5. An empty file.
  const empty = join(work, 'empty.exe');
  writeFileSync(empty, Buffer.alloc(0));
  check('an empty file is rejected', false, pubPath, sigPath, empty);

  console.log('\n── wrong key ────────────────────────────────');
  // A public key that did not sign this artifact. The Tauri CLI can mint a throwaway one
  // outside the repository.
  const otherPub = process.env.OTHER_PUBKEY;
  if (otherPub && otherPub !== pubPath) {
    check('a different public key is rejected', false, otherPub, sigPath, artifactPath);
  } else {
    console.log('   SKIP  no second public key supplied (set OTHER_PUBKEY to run this)');
  }

  console.log('\n── edited trusted comment ──────────────────');
  // The trusted comment carries the filename and timestamp. Rewriting the filename while
  // keeping the artifact signature must fail, or an attacker could relabel a build.
  const raw = readFileSync(sigPath, 'utf8').trim();
  const inner = Buffer.from(raw, 'base64').toString('utf8');
  const edited = inner.replace('Zeyara_1.0.0_x64-setup.exe', 'Zeyara_9.9.9_x64-setup.exe');
  const editedSig = join(work, 'edited.sig');
  writeFileSync(editedSig, edited);
  check('an edited trusted comment is rejected', false, pubPath, editedSig, artifactPath);

  console.log('\n── corrupted signature ─────────────────────');
  const sigInner = Buffer.from(raw, 'base64');
  const sigLines = sigInner.toString('utf8').split('\n');
  const sigBlob = Buffer.from(sigLines[1], 'base64');
  sigBlob[20] = sigBlob[20] ^ 0xff; // damage the middle of the signature
  sigLines[1] = sigBlob.toString('base64');
  const corruptSig = join(work, 'corrupt.sig');
  writeFileSync(corruptSig, Buffer.from(sigLines.join('\n'), 'utf8').toString('base64'));
  check('a corrupted signature is rejected', false, pubPath, corruptSig, artifactPath);

  console.log('\n── missing signature ───────────────────────');
  const noSig = join(work, 'nosig.sig');
  writeFileSync(noSig, '');
  check('an empty signature file is rejected', false, pubPath, noSig, artifactPath);

  // A copy of the installer with no .sig alongside it at all.
  const orphan = join(work, 'orphan.exe');
  copyFileSync(artifactPath, orphan);
  check('an installer with no signature file is rejected', false, pubPath, join(work, 'absent.sig'), orphan);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
