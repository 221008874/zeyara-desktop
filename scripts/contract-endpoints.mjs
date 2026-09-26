/**
 * Static server<->desktop endpoint contract check.
 *
 * Extracts every `/api/...` literal used by the desktop app and verifies that
 * each one resolves to a mapping declared by a Clinic Server controller.
 *
 * This exists because the full runtime contract smoke test
 * (scripts/contract-smoke.mjs) can only exercise the AUTHENTICATED endpoints
 * when a valid license is activated: the server answers 503 for every gated
 * API while the license gate is closed. This check needs no license and no
 * running server, so endpoint drift (a renamed/removed mapping) is caught in
 * CI instead of at runtime on a doctor's machine.
 *
 * Usage: node scripts/contract-endpoints.mjs [--server <path-to-clinic-server>]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = process.argv.slice(2);
const serverFlag = args.indexOf('--server');
const SERVER = resolve(
  serverFlag >= 0 && args[serverFlag + 1]
    ? args[serverFlag + 1]
    : join(here, '..', 'Server', 'clinic-server'),
);
// Scan the WHOLE main source tree, not just .../controller: several endpoints
// live outside that package (BackupRestoreController and PasswordResetController
// in the root package, SseEventStreamController under notification/dispatcher).
const SERVER_SRC = join(SERVER, 'src', 'main', 'java');
const SRC = join(here, 'src');

// ── collect server mappings ────────────────────────────────────────────────
function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}

const norm = (p) =>
  p
    .replace(/\{[^}]*\}/g, '{x}') // {id} / {version} -> {x}
    .replace(/\/+$/, '') || '/';

const serverPaths = new Set();
for (const file of walk(SERVER_SRC, ['.java'])) {
  const src = readFileSync(file, 'utf8');
  const baseMatch = src.match(/@RequestMapping\(\s*"([^"]*)"\s*\)/);
  const base = baseMatch ? baseMatch[1] : '';
  const re = /@(Get|Post|Put|Delete|Patch)Mapping(?:\(\s*(?:value\s*=\s*)?"([^"]*)"\s*(?:,\s*[a-zA-Z]+\s*=\s*[^)]*)?\))?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const sub = m[2] ?? '';
    // Only concrete method mappings count as servable paths. A class-level
    // @RequestMapping is just a prefix (HealthController declares "/api"), and
    // treating it as an endpoint would make every "/api/**" path look valid and
    // silently defeat the whole check.
    serverPaths.add(norm(`${base}${sub}`));
  }
}

// ── collect desktop API calls ──────────────────────────────────────────────
const calls = new Map(); // path -> [files]
for (const file of walk(SRC, ['.ts', '.tsx'])) {
  if (file.includes(sep + 'dist' + sep) || file.includes(sep + 'node_modules' + sep)) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/['"`](\/api\/[^'"`\s]*)['"`]/g)) {
    let raw = m[1];
    raw = raw.split('?')[0]; // drop query string
    raw = raw.replace(/\$\{[^}]*\}/g, '{x}'); // template placeholders
    raw = norm(raw);
    if (!calls.has(raw)) calls.set(raw, new Set());
    calls.get(raw).add(file.replace(`${here}${sep}`, ''));
  }
}

// ── verify ─────────────────────────────────────────────────────────────────
/** A desktop path is satisfied if it matches a mapping exactly, or a declared
 *  mapping is a proper path-prefix of it (covers `/api/x` serving `/api/x/{id}`). */
function isSatisfied(path) {
  if (serverPaths.has(path)) return true;
  for (const s of serverPaths) {
    if (s !== '/' && path.startsWith(`${s}/`)) return true;
  }
  return false;
}

const failures = [];
const skipped = [];
for (const [path, files] of [...calls].sort()) {
  // A path whose FIRST segment after /api is dynamic (e.g. UsersPage calling
  // `/api/${role}`) cannot be resolved statically. Report it, don't fail on it.
  if (/^\/api\/\{x\}/.test(path)) {
    skipped.push({ path, files: [...files] });
    continue;
  }
  if (!isSatisfied(path)) failures.push({ path, files: [...files] });
}

console.log(`server mappings discovered: ${serverPaths.size}`);
console.log(`desktop /api paths used:   ${calls.size}`);
console.log(`server root: ${SERVER}`);

if (skipped.length) {
  console.log(`\nSKIPPED ${skipped.length} dynamic path(s) - not statically verifiable:`);
  for (const s of skipped) {
    console.log(`  ${s.path}`);
    for (const file of s.files) console.log(`      used in ${file}`);
  }
}

if (failures.length) {
  console.error(`\nFAIL: ${failures.length} desktop API path(s) have no server mapping:\n`);
  for (const f of failures) {
    console.error(`  ${f.path}`);
    for (const file of f.files) console.error(`      used in ${file}`);
  }
  process.exit(1);
}
console.log('\nPASS: every desktop /api path resolves to a Clinic Server mapping.');
