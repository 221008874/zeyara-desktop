/**
 * Update version policy.
 *
 * Kept as pure functions, separate from the updater plugin, so the rules can be tested
 * directly and so they hold no matter which transport reports a version.
 *
 * The rules, in one place:
 *   - a version that is the same as, or older than, the installed one is never offered;
 *   - a malformed version on either side is refused rather than guessed at, because
 *     guessing is how a downgrade slips through;
 *   - the installed version is the single source of truth and is never written by an
 *     update path.
 *
 * A note on the old hard-coded literal: an earlier revision kept
 * `const CURRENT_VERSION = '1.0.0'` in this area. The app now reads its real version from
 * the Tauri runtime (`getAppVersion`), so building 1.1.0 reports 1.1.0. Nothing here may
 * reintroduce a literal.
 */

/** A parsed dotted version, e.g. `1.2.3` or `v1.2.3-rc1`. */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers, empty for a final release. */
  prerelease: string[];
  /** The input with a leading `v` removed. */
  normalised: string;
}

const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/**
 * Parses a dotted version, or returns null.
 *
 * A missing minor or patch is treated as 0, so `1.2` and `1.2.0` compare equal rather than
 * one of them looking newer than the other.
 */
export function parseVersion(input: unknown): ParsedVersion | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const m = VERSION_RE.exec(trimmed);
  if (!m) return null;

  const [, major, minor, patch, pre] = m;
  return {
    major: Number(major),
    minor: Number(minor ?? 0),
    patch: Number(patch ?? 0),
    prerelease: pre ? pre.split('.') : [],
    normalised: trimmed.replace(/^v/, ''),
  };
}

/** -1 when a < b, 1 when a > b, 0 when equal. Null if either side is unparseable. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  // A pre-release sorts before its own final release: 1.2.0-rc1 < 1.2.0.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const x = pa.prerelease[i];
    const y = pb.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xn !== yn) {
      // Numeric identifiers sort below alphanumeric ones.
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export type UpdateDecision =
  | { offer: true; from: string; to: string }
  | { offer: false; reason: 'same' | 'older' | 'unparseable-current' | 'unparseable-latest' };

/**
 * Decides whether an update should be offered.
 *
 * Never downgrades, and never offers on an unparseable version. The installed version is
 * treated as authoritative: a "newer" claim that cannot be parsed is refused rather than
 * believed.
 */
export function decideUpdate(current: string, latest: string): UpdateDecision {
  const pc = parseVersion(current);
  if (!pc) return { offer: false, reason: 'unparseable-current' };

  const cmp = compareVersions(latest, current);
  if (cmp === null) return { offer: false, reason: 'unparseable-latest' };

  if (cmp === 0) return { offer: false, reason: 'same' };
  if (cmp < 0) return { offer: false, reason: 'older' };
  return { offer: true, from: pc.normalised, to: parseVersion(latest)!.normalised };
}

/** Convenience predicate for the common "should I show a banner?" question. */
export function shouldOfferUpdate(current: string, latest: string): boolean {
  return decideUpdate(current, latest).offer;
}
