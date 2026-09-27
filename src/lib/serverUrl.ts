/**
 * Server URL policy.
 *
 * The Clinic Server is a separate application on another machine, reached over the
 * clinic LAN, so its address is not known when this app is built. That is why the CSP
 * has to allow the `https:` scheme rather than a fixed origin, and it is also why the
 * scheme cannot be checked at build time - it is checked here, on every value the app is
 * about to use.
 *
 * Two rules drive everything below:
 *
 *  1. A production build talks to `https:` only. `http:` survives solely for loopback
 *     during development, so `npm run dev` and `tauri dev` keep working.
 *  2. An `http://` URL is never silently upgraded to `https://`. Doing so hides a real
 *     misconfiguration behind a connection error that looks like a certificate problem.
 */

export interface UrlPolicy {
  /** Permit `http://` for loopback hosts only. True in development, false in production. */
  allowHttpLoopback: boolean;
}

/** Production: HTTPS only. */
export const PRODUCTION_POLICY: UrlPolicy = { allowHttpLoopback: false };

/** Development: the Vite dev server and a local Clinic Server may be plain HTTP. */
export const DEVELOPMENT_POLICY: UrlPolicy = { allowHttpLoopback: true };

export type ServerUrlErrorCode =
  | 'empty'
  | 'missing-scheme'
  | 'malformed'
  | 'scheme-not-allowed'
  | 'insecure-transport'
  | 'not-an-origin'
  | 'credentials-in-url';

export interface ServerUrlError {
  code: ServerUrlErrorCode;
  /** Operator-facing text. Arabic, because every string in this app is Arabic. */
  message: string;
}

export type ServerUrlValidation =
  | { ok: true; origin: string; scheme: 'http' | 'https' }
  | { ok: false; error: ServerUrlError };

/** Hostnames that may use plain HTTP, and only when the policy allows it. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Builds the candidate address to validate from a host and an optional port.
 *
 * A value that already carries a scheme is left alone. A bare host is given `http://`
 * **only** for loopback under a development policy, so `localhost` and `127.0.0.1` keep
 * working in dev. A bare non-loopback host gets no scheme and is therefore rejected by
 * validation - production never has a plain-HTTP path constructed for it.
 */
export function candidateFromHostPort(
  host: string,
  port: number | string | undefined,
  policy: UrlPolicy
): string {
  const raw = String(host ?? '').trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;

  const p = port === undefined || port === '' ? '' : `:${port}`;
  const hostOnly = raw.split(':')[0];

  if (policy.allowHttpLoopback && isLoopbackHost(hostOnly)) {
    return `http://${raw}${p}`;
  }
  return `${raw}${p}`;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Detects an address written without a scheme, e.g. `192.168.1.8:8081` or
 * `clinic.example.com`.
 *
 * A plain `^[a-z]+:` test is not enough: `localhost:8081` matches it, because
 * "localhost" is a valid scheme token. The giveaway is that the text before the colon
 * looks like a host - it contains a dot, or it is literally "localhost", or what follows
 * the colon is a port number. Reporting that as "protocol localhost: is not allowed"
 * would send the operator looking for the wrong problem.
 */
function looksSchemeless(value: string): boolean {
  const colon = value.indexOf(':');
  if (colon <= 0) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;

  const head = value.slice(0, colon);
  const tail = value.slice(colon + 1).split(/[/?#]/)[0];

  if (head.includes('.')) return true;
  if (head.toLowerCase() === 'localhost') return true;
  if (/^\d+$/.test(tail)) return true;
  return false;
}

/**
 * Validates a user- or discovery-supplied server address and returns a bare origin.
 *
 * Accepts `https://host[:port]`. Accepts `http://` only for loopback under a policy that
 * allows it. Rejects every other scheme, anything carrying a path, query, fragment or
 * credentials, and anything unparseable.
 */
export function validateServerOrigin(
  raw: string,
  policy: UrlPolicy = PRODUCTION_POLICY
): ServerUrlValidation {
  const value = String(raw ?? '').trim();

  if (!value) {
    return fail('empty', 'أدخل عنوان الخادم.');
  }

  // A bare "192.168.1.8:8081" is the most common input mistake. Say so specifically
  // rather than reporting it as an unparseable or disallowed protocol.
  if (!SCHEME_RE.test(value) || looksSchemeless(value)) {
    return fail(
      'missing-scheme',
      'يجب أن يبدأ العنوان بـ https:// — مثال: https://192.168.1.8:8443'
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('malformed', 'العنوان غير صالح. تأكد من كتابته بالكامل.');
  }

  const scheme = url.protocol.replace(':', '').toLowerCase();
  if (scheme !== 'https' && scheme !== 'http') {
    return fail(
      'scheme-not-allowed',
      `البروتوكول ${scheme}: غير مسموح. استخدم https:// فقط.`
    );
  }

  if (scheme === 'http') {
    if (!isLoopbackHost(url.hostname)) {
      // Not loopback: plain HTTP to a LAN server is refused outright in production.
      return fail(
        'insecure-transport',
        'الاتصال غير مشفّر. استخدم https:// — ضع الخادم خلف وكيل يدعم TLS.'
      );
    }
    if (!policy.allowHttpLoopback) {
      return fail(
        'insecure-transport',
        'الاتصال بـ http مسموح على هذا الجهاز أثناء التطوير فقط. استخدم https://'
      );
    }
  }

  if (url.username || url.password) {
    return fail('credentials-in-url', 'لا تضع اسم مستخدم أو كلمة مرور في العنوان.');
  }

  // An origin has no path, query or fragment. Rejecting them stops a pasted URL like
  // https://host/clinic from silently becoming https://host and calling the wrong API.
  const hasExtra =
    (url.pathname && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== '';
  if (hasExtra) {
    return fail(
      'not-an-origin',
      'أدخل عنوان الخادم فقط بدون مسار، مثل https://192.168.1.8:8443'
    );
  }

  return { ok: true, origin: url.origin, scheme: scheme as 'http' | 'https' };
}

function fail(code: ServerUrlErrorCode, message: string): ServerUrlValidation {
  return { ok: false, error: { code, message } };
}

/**
 * The policy for the current build.
 *
 * `import.meta.env.DEV` is false in a packaged Tauri build, which is what makes this
 * safe: the production bundle is compiled with the HTTPS-only policy baked in.
 */
export function activePolicy(): UrlPolicy {
  return import.meta.env.DEV ? DEVELOPMENT_POLICY : PRODUCTION_POLICY;
}

export function isProductionBuild(): boolean {
  return !import.meta.env.DEV;
}

/**
 * Whether a URL may be fetched by this build. Used for update artifacts, where the
 * concern is the same as for the server: a checksum fetched over cleartext alongside the
 * artifact is self-referential, because anything able to swap the file can swap the
 * expected hash.
 */
export function isFetchableUrl(raw: string, policy: UrlPolicy = activePolicy()): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const scheme = url.protocol.replace(':', '').toLowerCase();
  if (scheme === 'https') return true;
  if (scheme === 'http') return policy.allowHttpLoopback && isLoopbackHost(url.hostname);
  return false;
}
