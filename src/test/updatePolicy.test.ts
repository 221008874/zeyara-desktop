import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  compareVersions,
  decideUpdate,
  shouldOfferUpdate,
} from '../lib/updatePolicy';

describe('version parsing', () => {
  it('parses a three-part version', () => {
    expect(parseVersion('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 });
  });

  it('accepts a leading v', () => {
    expect(parseVersion('v2.0.1')).toMatchObject({ major: 2, minor: 0, patch: 1 });
  });

  it('treats a missing minor or patch as zero', () => {
    // Otherwise "1.2" and "1.2.0" would look like different versions.
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('parses a pre-release', () => {
    expect(parseVersion('1.2.0-rc1')?.prerelease).toEqual(['rc1']);
  });

  it('rejects unparseable input rather than guessing', () => {
    for (const bad of ['', '   ', 'abc', '1.2.3.4', 'v', '1..2', null, undefined, 42, {}]) {
      expect(parseVersion(bad as unknown)).toBeNull();
    }
  });
});

describe('version comparison', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('2.1.0', '2.0.9')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
  });

  it('reports equality', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('sorts a pre-release before its final release', () => {
    expect(compareVersions('1.2.0-rc1', '1.2.0')).toBe(-1);
    expect(compareVersions('1.2.0', '1.2.0-rc1')).toBe(1);
  });

  it('orders pre-release identifiers correctly', () => {
    expect(compareVersions('1.2.0-rc1', '1.2.0-rc2')).toBe(-1);
    // Numeric identifiers compare as numbers, not as text: 2 < 10.
    expect(compareVersions('1.2.0-2', '1.2.0-10')).toBe(-1);
    expect(compareVersions('1.2.0-10', '1.2.0-2')).toBe(1);
    // Alphanumeric identifiers compare as text, so "rc10" sorts before "rc2".
    // That is the semver rule, and it is intentional rather than a bug.
    expect(compareVersions('1.2.0-rc2', '1.2.0-rc10')).toBe(1);
    // A numeric identifier sorts below an alphanumeric one.
    expect(compareVersions('1.2.0-1', '1.2.0-alpha')).toBe(-1);
    // Fewer identifiers sort first when the shared prefix is equal.
    expect(compareVersions('1.2.0-rc', '1.2.0-rc.1')).toBe(-1);
  });

  it('returns null when either side is unparseable', () => {
    expect(compareVersions('nope', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', 'nope')).toBeNull();
  });
});

describe('update decision — no downgrade, ever', () => {
  it('offers a strictly newer version', () => {
    const d = decideUpdate('1.0.0', '1.1.0');
    expect(d.offer).toBe(true);
    if (d.offer) expect(d.to).toBe('1.1.0');
  });

  it('refuses the same version', () => {
    expect(decideUpdate('1.2.3', '1.2.3')).toEqual({ offer: false, reason: 'same' });
  });

  it('refuses an older version', () => {
    // The core anti-downgrade rule.
    expect(decideUpdate('2.0.0', '1.9.9')).toEqual({ offer: false, reason: 'older' });
  });

  it('refuses a downgrade that only differs in minor', () => {
    expect(decideUpdate('1.10.0', '1.9.0')).toEqual({ offer: false, reason: 'older' });
  });

  it('compares numerically, not lexically', () => {
    // 1.10.0 is newer than 1.9.0; a string compare would get this backwards.
    expect(shouldOfferUpdate('1.9.0', '1.10.0')).toBe(true);
    expect(shouldOfferUpdate('1.10.0', '1.9.0')).toBe(false);
  });

  it('refuses when the installed version cannot be parsed', () => {
    // The installed version is authoritative; a bad value is never treated as "old".
    expect(decideUpdate('garbage', '9.9.9')).toEqual({
      offer: false,
      reason: 'unparseable-current',
    });
  });

  it('refuses when the announced version cannot be parsed', () => {
    expect(decideUpdate('1.0.0', 'garbage')).toEqual({
      offer: false,
      reason: 'unparseable-latest',
    });
  });

  it('will not offer a pre-release over a final release of the same number', () => {
    expect(shouldOfferUpdate('1.2.0', '1.2.0-rc1')).toBe(false);
  });

  it('will offer a final release over its own pre-release', () => {
    expect(shouldOfferUpdate('1.2.0-rc1', '1.2.0')).toBe(true);
  });
});
