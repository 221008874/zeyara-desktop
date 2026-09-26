// Stages the sidecar clinic-server JAR under a stable, un-versioned name so that
// src-tauri/tauri.conf.json never has to be edited when the server version bumps.
//
//   1. Find the sibling clinic-server repo's Maven output (newest version wins).
//   2. Copy it to src-tauri/resources/clinic-server.jar.
//
// The staged copy is gitignored (see .gitignore) and the Rust side prefers it
// over any versioned JAR, so a stale build sitting next to the app cannot shadow
// the one that was deliberately staged.
//
// Override the source with CLINIC_SERVER_REPO=/path/to/clinic-server
// or CLINIC_SERVER_JAR=/path/to/some.jar
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';

const STAGED_NAME = 'clinic-server.jar';
const DEST_DIR = resolve('src-tauri/resources');
const DEST = join(DEST_DIR, STAGED_NAME);

/** Reads `<version>` out of `clinic-server-<version>.jar`, ignoring qualifiers. */
function versionOf(file) {
  const m = /^clinic-server-(.+)\.jar$/i.exec(file);
  if (!m) return null;
  const numeric = /^\d+(\.\d+)*/.exec(m[1]);
  return numeric ? numeric[0] : null;
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Resolves the JAR to stage, or null with the reason already logged. */
function resolveSource() {
  if (process.env.CLINIC_SERVER_JAR) {
    const p = resolve(process.env.CLINIC_SERVER_JAR);
    if (!existsSync(p)) throw new Error(`CLINIC_SERVER_JAR does not exist: ${p}`);
    return p;
  }

  const repo =
    process.env.CLINIC_SERVER_REPO ? resolve(process.env.CLINIC_SERVER_REPO) : null;
  const candidates = repo
    ? [join(repo, 'target')]
    : [
        // Default layout: <workspace>/zeyara-desktop  +  <workspace>/Server/clinic-server
        resolve('..', 'Server', 'clinic-server', 'target'),
        resolve('..', 'clinic-server', 'target'),
      ];

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const jars = readdirSync(dir)
      .filter((f) => versionOf(f) !== null)
      .map((f) => ({ file: f, version: versionOf(f) }))
      .sort((a, b) => compareVersions(b.version, a.version)); // newest first
    if (jars.length) return join(dir, jars[0].file);
  }
  return null;
}

/**
 * SHA-256 of a file, streamed (the JAR is ~135 MB).
 *
 * Staleness is detected by CONTENT, not size. Maven repackages are frequently the
 * same byte length as the previous build, so comparing sizes would silently keep an
 * old JAR — and because the staged copy is gitignored, nothing else would reveal it.
 */
function sha256(path) {
  return new Promise((resolvePromise, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('data', (c) => h.update(c));
    s.on('error', reject);
    s.on('end', () => resolvePromise(h.digest('hex')));
  });
}

const source = resolveSource();
if (!source) {
  console.error(
    '[sync-server-jar] No clinic-server JAR found. Build it first:\n' +
      '    cd ..\\Server\\clinic-server && mvn -o package -DskipTests\n' +
      'Or set CLINIC_SERVER_JAR / CLINIC_SERVER_REPO.',
  );
  process.exit(1);
}

mkdirSync(DEST_DIR, { recursive: true });

const srcHash = await sha256(source);
const srcBytes = statSync(source).size;
const srcMtime = statSync(source).mtime.toISOString().replace('T', ' ').slice(0, 16);

if (existsSync(DEST)) {
  const destHash = await sha256(DEST);
  if (destHash === srcHash) {
    console.log(
      `[sync-server-jar] already staged, content matches\n` +
        `  source ${basename(source)}  ${(srcBytes / 1048576).toFixed(1)} MB  built ${srcMtime}\n` +
        `  sha256 ${srcHash.slice(0, 16)}`,
    );
    process.exit(0);
  }
  console.log(
    `[sync-server-jar] content differs (staged ${await shortHash(DEST)} != source ${srcHash.slice(0, 16)}), restaging`,
  );
  rmSync(DEST, { force: true });
}

copyFileSync(source, DEST);

// Verify the copy actually landed; a partial copy would ship a broken sidecar.
const destHash = await sha256(DEST);
if (destHash !== srcHash) {
  console.error(`[sync-server-jar] FAILED: staged copy does not match source (${destHash.slice(0, 16)} != ${srcHash.slice(0, 16)})`);
  process.exit(1);
}

console.log(
  `[sync-server-jar] staged ${basename(source)} -> src-tauri/resources/${STAGED_NAME}\n` +
    `  ${(srcBytes / 1048576).toFixed(1)} MB  built ${srcMtime}\n` +
    `  sha256 ${srcHash.slice(0, 16)}`,
);

async function shortHash(path) {
  return (await sha256(path)).slice(0, 16);
}
