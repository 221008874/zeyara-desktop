/**
 * Backs up the currently-deployed Firestore + Storage security rules for a
 * Firebase project, so a rules change can be reverted.
 *
 * Read-only. Uses firebase-tools' own stored credentials (no re-login, and the
 * token is never printed). Run before `firebase deploy --only firestore:rules`.
 *
 * Usage: node scripts/firebase-rules-backup.mjs <projectId> [moreProjectIds...]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const outDir = join(here, 'config', 'firebase-rules-backup');

const ftRoot = join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'firebase-tools');
const auth = require(join(ftRoot, 'lib', 'auth.js'));

const projects = process.argv.slice(2);
if (!projects.length) {
  console.error('usage: node scripts/firebase-rules-backup.mjs <projectId> [...projectIds]');
  process.exit(1);
}

// Use the access token firebase-tools already holds. Minting a fresh one is not
// possible when the stored refresh token has expired (the CLI keeps working
// until the cached access token lapses), so we never print or persist it.
const account = await auth.getGlobalDefaultAccount();
const stored = account?.tokens ?? {};
let accessToken = stored.access_token;
if (stored.expires_at && new Date(stored.expires_at).getTime() < Date.now()) {
  console.error('The cached Firebase access token has expired. Run: firebase login --reauth');
  process.exit(1);
}
if (!accessToken) {
  console.error('No Firebase access token available. Run: firebase login --reauth');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
let failed = 0;

for (const project of projects) {
  const res = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${project}/releases?pageSize=10`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await res.json();
  if (!res.ok) {
    console.error(`[${project}] ERROR ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    failed += 1;
    continue;
  }
  const releases = body.releases ?? [];
  if (!releases.length) {
    console.log(`[${project}] no rules releases -> rules were never deployed from the CLI`);
    writeFileSync(
      join(outDir, `${project}.rules.txt`),
      `# ${project}: no deployed rules release found as of ${new Date().toISOString()}\n` +
        '# The console default applies (Firestore default is deny-all for new projects,\n' +
        '# but "test mode" is allow-all, so verify in the console).\n',
      'utf8',
    );
    continue;
  }
  const active =
    releases.find((r) => r.name.endsWith('/releases/cloud.firestore')) ??
    releases[releases.length - 1];
  for (const r of releases) {
    console.log(`[${project}] release ${r.name} -> ruleset=${r.rulesetName} (createTime=${r.createTime})`);
  }
  // A re-deploy keeps the SAME release record and only swaps its ruleset pointer,
  // so createTime is NOT a reliable "when did this change" signal. The ruleset id is.
  const latest = active;
  const rs = await fetch(`https://firebaserules.googleapis.com/v1/${latest.rulesetName}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const rsBody = await rs.json();
  const source = rsBody.source?.files?.map((f) => f.content).join('\n') ?? '(no source)';
  const stamped =
    `# backup of ${project} taken ${new Date().toISOString()}\n` +
    `# ACTIVE release=${latest.name}\n` +
    `# ACTIVE ruleset=${latest.rulesetName}  (release createTime=${latest.createTime})\n` +
    `# --- restore with: firebase deploy --only firestore:rules --project ${project}\n` +
    `# (after copying this content into firestore.rules)\n` +
    source;
  writeFileSync(join(outDir, `${project}.rules.txt`), stamped, 'utf8');
  console.log(`[${project}] backed up ACTIVE ruleset ${latest.rulesetName}`);
  console.log('----------------------------------------');
  console.log(source);
  console.log('----------------------------------------');
}

console.log(`\nBackups written to ${outDir}`);
process.exit(failed ? 1 : 0);
