import { describe, it, expect } from 'vitest';
import {
  validateServerOrigin,
  isFetchableUrl,
  PRODUCTION_POLICY,
  DEVELOPMENT_POLICY,
} from '../lib/serverUrl';
import tauriConf from '../../src-tauri/tauri.conf.json';

// Asserted against the real shipped configuration rather than a copy, so the test fails
// if the production CSP ever regains an http allowance.
const prodCsp: string = tauriConf.app.security.csp;
const devCsp: string = tauriConf.app.security.devCsp;

function errorOf(input: string, policy = PRODUCTION_POLICY): string {
  const r = validateServerOrigin(input, policy);
  if (r.ok) throw new Error(`expected ${input} to be rejected`);
  return r.error.code;
}

describe('AC12 — production requires HTTPS', () => {
  it('accepts an https origin', () => {
    const r = validateServerOrigin('https://clinic.example.com', PRODUCTION_POLICY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.origin).toBe('https://clinic.example.com');
      expect(r.scheme).toBe('https');
    }
  });

  it('accepts an https origin with a port', () => {
    const r = validateServerOrigin('https://192.168.1.8:8443', PRODUCTION_POLICY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.origin).toBe('https://192.168.1.8:8443');
  });

  it('accepts a bare https IP, which is the common LAN-with-TLS case', () => {
    expect(validateServerOrigin('https://192.168.1.8', PRODUCTION_POLICY).ok).toBe(true);
  });

  it('rejects a production http origin', () => {
    // The core of AC12. A LAN server over plain HTTP is refused outright.
    expect(errorOf('http://192.168.1.8:8081')).toBe('insecure-transport');
  });

  it('rejects http even for loopback in production', () => {
    // localhost is not special in a shipped build; the bundle is what runs.
    expect(errorOf('http://localhost:8081', PRODUCTION_POLICY)).toBe('insecure-transport');
    expect(errorOf('http://127.0.0.1:8081', PRODUCTION_POLICY)).toBe('insecure-transport');
  });

  it('never silently upgrades http to https', () => {
    // Upgrading would turn a configuration mistake into a certificate error that looks
    // like a server fault.
    const r = validateServerOrigin('http://192.168.1.8:8081', PRODUCTION_POLICY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toMatch(/https:\/\/192\.168\.1\.8/);
      expect(r.error.code).toBe('insecure-transport');
    }
  });

  it('rejects a bare host with no scheme', () => {
    expect(errorOf('192.168.1.8:8081')).toBe('missing-scheme');
    expect(errorOf('clinic.example.com')).toBe('missing-scheme');
  });

  it('rejects malformed input', () => {
    expect(errorOf('https://')).toBe('malformed');
    expect(errorOf('https://[bad')).toBe('malformed');
    expect(errorOf('   ')).toBe('empty');
    expect(errorOf('')).toBe('empty');
  });

  it('rejects non-HTTP(S) schemes', () => {
    for (const bad of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32',
      'data:text/html,<h1>x</h1>',
      'ftp://192.168.1.8',
      'ws://192.168.1.8:8081',
    ]) {
      expect(['scheme-not-allowed', 'malformed', 'not-an-origin']).toContain(errorOf(bad));
    }
  });

  it('rejects a URL carrying a path, query or fragment', () => {
    // An origin has none of those; accepting them would silently call the wrong API.
    expect(errorOf('https://host/clinic')).toBe('not-an-origin');
    expect(errorOf('https://host:8443/?x=1')).toBe('not-an-origin');
    expect(errorOf('https://host:8443/#frag')).toBe('not-an-origin');
  });

  it('accepts a bare root slash as an origin', () => {
    const r = validateServerOrigin('https://host:8443/', PRODUCTION_POLICY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.origin).toBe('https://host:8443');
  });

  it('rejects credentials embedded in the URL', () => {
    expect(errorOf('https://user:pass@host:8443')).toBe('credentials-in-url');
  });
});

describe('AC12 — development keeps loopback HTTP working', () => {
  it('allows http loopback in development', () => {
    const r = validateServerOrigin('http://localhost:8081', DEVELOPMENT_POLICY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scheme).toBe('http');
  });

  it('allows 127.0.0.1 in development', () => {
    expect(validateServerOrigin('http://127.0.0.1:8081', DEVELOPMENT_POLICY).ok).toBe(true);
  });

  it('still refuses a non-loopback http address in development', () => {
    // Development leniency is limited to loopback, not a blanket http allowance.
    expect(errorOf('http://192.168.1.8:8081', DEVELOPMENT_POLICY)).toBe('insecure-transport');
  });

  it('still requires an explicit scheme in development', () => {
    expect(errorOf('localhost:8081', DEVELOPMENT_POLICY)).toBe('missing-scheme');
  });
});

describe('AC12 — discovered endpoints face the same policy', () => {
  it('rejects a discovered http endpoint in production', () => {
    // Discovery may identify a server, but must not bypass the transport policy.
    expect(errorOf('http://192.168.1.8:8081', PRODUCTION_POLICY)).toBe('insecure-transport');
  });

  it('accepts a discovered https endpoint', () => {
    expect(validateServerOrigin('https://192.168.1.8:8443', PRODUCTION_POLICY).ok).toBe(true);
  });
});

describe('AC12 — update artifacts', () => {
  it('permits an https artifact', () => {
    expect(isFetchableUrl('https://github.com/x/y.msi', PRODUCTION_POLICY)).toBe(true);
  });

  it('refuses an http artifact in production', () => {
    // A checksum fetched over cleartext alongside the artifact proves nothing.
    expect(isFetchableUrl('http://github.com/x/y.msi', PRODUCTION_POLICY)).toBe(false);
  });

  it('refuses non-HTTP artifact schemes', () => {
    expect(isFetchableUrl('file:///C:/y.msi', PRODUCTION_POLICY)).toBe(false);
    expect(isFetchableUrl('ftp://h/y.msi', PRODUCTION_POLICY)).toBe(false);
  });
});

describe('AC12 — the shipped CSP contains no blanket http allowance', () => {
  it('production CSP does not allow http:', () => {
    // If this regresses, a release build would talk to any HTTP host.
    expect(prodCsp).not.toMatch(/connect-src[^;]*\bhttp:/);
    expect(prodCsp).not.toMatch(/\bhttp:/);
  });

  it('production CSP does not allow a wildcard or unsafe-eval', () => {
    expect(prodCsp).not.toContain('*');
    expect(prodCsp).not.toContain('unsafe-eval');
  });

  it('production CSP permits https and wss', () => {
    expect(prodCsp).toContain('https:');
    expect(prodCsp).toContain('wss:');
  });

  it('production CSP locks down object, base and framing', () => {
    expect(prodCsp).toContain("object-src 'none'");
    expect(prodCsp).toContain("base-uri 'self'");
    expect(prodCsp).toContain("frame-ancestors 'none'");
  });

  it('the http allowance exists only in the development CSP', () => {
    // devCsp is injected during development only and is absent from the built app.
    expect(devCsp).toMatch(/connect-src[^;]*http:\/\/localhost/);
    expect(prodCsp).not.toMatch(/http:\/\/localhost/);
  });

  it('documents why unsafe-inline remains for styles', () => {
    // MUI + emotion injects <style> elements at runtime; this is a proven requirement,
    // not a leftover, and it is scoped to style-src only.
    expect(prodCsp).toContain("style-src 'self' 'unsafe-inline'");
    expect(prodCsp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
