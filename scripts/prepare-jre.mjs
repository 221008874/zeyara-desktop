import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';

function javaVersion(home) {
  const result = spawnSync(join(home, 'bin', platform() === 'win32' ? 'java.exe' : 'java'), ['-version'], {
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return output.match(/version "([^"]+)"/)?.[1] ?? '';
}

function javaHome() {
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);
  for (const base of ['C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Java']) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      if (entry.toLowerCase().startsWith('jdk-21') || entry.toLowerCase().startsWith('java-21')) {
        candidates.push(join(base, entry));
      }
    }
  }
  try {
    const output = execFileSync('java', ['-XshowSettings:properties', '-version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const match = output.match(/java\.home\s*=\s*(.+)/);
    if (match) candidates.push(match[1].trim());
  } catch {}
  const home = candidates.find((candidate) => existsSync(candidate) && javaVersion(candidate).startsWith('21'));
  if (!home) throw new Error('Java 21 is required to build the Tauri bundle');
  return home;
}

const source = resolve(javaHome());
const destination = resolve('src-tauri/resources/jre');
if (!existsSync(source)) throw new Error(`Java home does not exist: ${source}`);
if (!existsSync(destination)) mkdirSync(destination, { recursive: true });
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true, force: true });
const javaBinary = join(destination, 'bin', platform() === 'win32' ? 'java.exe' : 'java');
if (!existsSync(javaBinary)) throw new Error(`Bundled Java executable is missing: ${javaBinary}`);
console.log(`Bundled Java runtime: ${source}`);
