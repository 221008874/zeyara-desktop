/**
 * Release check: does the built executable's import table resolve?
 *
 * A signed installer can still be unusable. The 1.0.0 and 1.0.1 bundles verified their
 * signatures perfectly and then died on startup with STATUS_DLL_NOT_FOUND (0xC0000135),
 * because webview2-com links WebView2Loader.dll dynamically and the NSIS bundle shipped
 * only the main binary. Signing and launching test different things, and only one of them
 * was being done.
 *
 * This parses the PE import directory - the authoritative list of what the loader must
 * resolve before the entry point runs - and flags any DLL that is not present next to the
 * executable or in a system directory.
 *
 * API set forwarders are skipped. Names like `api-ms-win-core-synch-l1-2-0.dll` and
 * `ext-ms-win-*` are resolved by the OS through the API set schema and have no file on
 * disk, so testing them with Test-Path style existence checks yields a dozen false
 * failures. Everything else must genuinely resolve.
 *
 * Usage: node scripts/verify-bundle-imports.mjs <path-to-exe> [more-exe ...]
 * Exits 0 when everything resolves, 1 when something will not, 2 on bad usage.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { platform } from 'node:os';

if (platform() !== 'win32') {
  console.error('This check inspects a Windows PE binary; run it on Windows.');
  process.exit(2);
}

const exes = process.argv.slice(2);
if (exes.length === 0) {
  console.error('usage: verify-bundle-imports.mjs <path-to-exe> [more-exe ...]');
  process.exit(2);
}

/** OS-resolved forwarders with no file on disk. */
function isApiSet(name) {
  return /^(api-ms-win|api-ms-|ext-ms-win|ext-ms-)/i.test(name);
}

/** Reads the PE import directory and returns the imported DLL names. */
function readImportedDlls(buf) {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) {
    throw new Error('not a PE file (missing MZ signature)');
  }
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOff) !== 0x00004550) {
    throw new Error('not a PE file (missing PE signature)');
  }

  const nSections = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const optOff = peOff + 24;
  const pe32plus = buf.readUInt16LE(optOff) === 0x20b;

  // Data directories start after the fixed part of the optional header. Entry 1 is imports.
  const dirsOff = optOff + (pe32plus ? 112 : 96);
  const importRva = buf.readUInt32LE(dirsOff + 8);

  const sections = [];
  const secOff = optOff + optSize;
  for (let i = 0; i < nSections; i++) {
    const o = secOff + i * 40;
    sections.push({
      virtualSize: buf.readUInt32LE(o + 8),
      virtualAddress: buf.readUInt32LE(o + 12),
      rawSize: buf.readUInt32LE(o + 16),
      rawPtr: buf.readUInt32LE(o + 20),
    });
  }

  const rvaToOffset = (rva) => {
    for (const s of sections) {
      const span = Math.max(s.virtualSize, s.rawSize);
      if (rva >= s.virtualAddress && rva < s.virtualAddress + span) {
        return rva - s.virtualAddress + s.rawPtr;
      }
    }
    return -1;
  };

  if (importRva === 0) return [];
  const off = rvaToOffset(importRva);
  if (off < 0) throw new Error('import directory RVA is not inside any section');

  const names = new Set();
  for (let p = off; ; p += 20) {
    const nameRva = buf.readUInt32LE(p + 12);
    if (nameRva === 0) break;
    const nameOff = rvaToOffset(nameRva);
    if (nameOff < 0) continue;
    let end = nameOff;
    while (buf[end] !== 0) end++;
    names.add(buf.toString('ascii', nameOff, end));
  }
  return [...names].sort();
}

const systemDirs = [join(process.env.WINDIR || 'C:\\Windows', 'System32')];
if (process.env.WINDIR) systemDirs.push(join(process.env.WINDIR, 'SysWOW64'));

let failed = 0;

for (const exe of exes) {
  if (!existsSync(exe)) {
    console.error(`FAIL  ${exe}\n      file not found - build the release bundle first`);
    failed++;
    continue;
  }
  console.log(`\n${basename(exe)}`);
  const appDir = dirname(exe);

  let dlls;
  try {
    dlls = readImportedDlls(readFileSync(exe));
  } catch (err) {
    console.error(`FAIL  could not read the import table: ${err.message}`);
    failed++;
    continue;
  }

  const missing = [];
  for (const dll of dlls) {
    if (isApiSet(dll)) continue;
    const inApp = existsSync(join(appDir, dll));
    const inSystem = systemDirs.some((d) => existsSync(join(d, dll)));
    if (!inApp && !inSystem) missing.push(dll);
  }

  const real = dlls.filter((d) => !isApiSet(d)).length;
  const apisets = dlls.length - real;
  console.log(`      ${real} real imports, ${apisets} API set forwarders`);

  if (missing.length === 0) {
    console.log('      PASS  every imported DLL resolves');
  } else {
    for (const dll of missing) console.log(`      FAIL  ${dll} is imported but not shipped`);
    console.log(
      '            Declare it under bundle.resources in tauri.conf.json, or link it statically.'
    );
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} executable(s) would fail to start.`);
  process.exit(1);
}
console.log('\nall imports resolve');
