// Generate the Tauri updater manifest (latest.json) for a built, signed release.
//
// The manifest is the only thing the client trusts for *discovery*; the trust itself comes
// from the signature inside it, checked against the public key compiled into the app.
//
//   node scripts/make-updater-manifest.mjs --version 1.0.1 --sig <file.sig> --out <file>
//
// The artifact URL is derived from the tag so it is immutable: `releases/latest` is only
// used for the manifest, never for the installer itself.
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const version = arg('version');
const sigPath = arg('sig');
const outPath = arg('out');
const repo = arg('repo') ?? '221008874/zeyara-desktop';
const asset = arg('asset') ?? `Zeyara_${version}_x64-setup.exe`;

if (!version || !sigPath || !outPath) {
  console.error(
    'usage: make-updater-manifest.mjs --version <v> --sig <file.sig> --out <latest.json> ' +
      '[--repo owner/name] [--asset name]'
  );
  process.exit(2);
}

const signature = readFileSync(sigPath, 'utf8').trim();
if (!signature) {
  console.error('refusing to write a manifest with an empty signature');
  process.exit(1);
}

const manifest = {
  version,
  notes: `Zeyara Desktop ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    // The target string the Tauri updater looks up for a 64-bit Windows build.
    'windows-x86_64': {
      signature,
      url: `https://github.com/${repo}/releases/download/v${version}/${asset}`,
    },
  },
};

writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${outPath}`);
console.log(`  version    : ${manifest.version}`);
console.log(`  platform   : windows-x86_64`);
console.log(`  url        : ${manifest.platforms['windows-x86_64'].url}`);
console.log(`  signature  : ${signature.length} chars`);
