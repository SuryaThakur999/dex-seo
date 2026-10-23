// Shared SSRF-safe fetch for every outbound request the crawler makes (homepage, robots.txt,
// sitemap.xml, internal links, redirect targets). Directive requirement: "public HTTP/HTTPS
// destinations only... validate resolved IPv4/IPv6 destinations and every redirect... the
// connection cannot bypass validation through DNS changes."
//
// Defense in depth, in order:
// 1. Reject non-http(s) schemes and URLs carrying embedded credentials (user:pass@host).
// 2. Resolve the hostname ourselves via dns.lookup and reject if ANY resolved address is
//    private/loopback/link-local/reserved/a cloud metadata address.
// 3. Pin the actual TCP connection to that pre-validated IP (via undici's dispatcher `lookup`
//    override) instead of letting the HTTP client re-resolve DNS at connect time — this is what
//    stops DNS rebinding: an attacker's nameserver can't swap the answer between our check and
//    the real connection, because we never ask it again.
// 4. Never auto-follow redirects. Each redirect target is re-validated from step 1, up to a
//    bounded hop count — a public URL redirecting to a private one is caught, not silently followed.
// 5. Cap response bytes read, independent of any (spoofable) Content-Length header.

import { promises as dns } from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB — a page's HTML has no business exceeding this
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function ipv4ToLong(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inRange(ip: string, base: string, maskBits: number): boolean {
  const ipLong = ipv4ToLong(ip);
  const baseLong = ipv4ToLong(base);
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipLong & mask) === (baseLong & mask);
}

// Every range that must never receive an outbound crawl request, including cloud metadata
// endpoints (169.254.169.254 lives inside the link-local block below).
const BLOCKED_IPV4_RANGES: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918 private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — includes AWS/GCP/Azure metadata (169.254.169.254)
  ['172.16.0.0', 12], // RFC1918 private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // RFC1918 private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
  ['255.255.255.255', 32], // broadcast
];

// Exported for direct fixture-based testing of the range logic itself (see safe-fetch.test.ts) —
// no real network access needed to verify which addresses this blocks.
export function isBlockedIPv4(ip: string): boolean {
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => inRange(ip, base, bits));
}

export function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true; // loopback / unspecified
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 unique local
  if (normalized.startsWith('ff')) return true; // ff00::/8 multicast
  if (normalized.startsWith('2001:db8:')) return true; // documentation

  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) — unwrap and check the
  // embedded IPv4 address too, so a mapped private address can't slip through as "IPv6".
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? normalized.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);

  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
}

function assertSafeUrlShape(url: URL): void {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError(`Blocked scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  }
}

// Resolves the hostname and rejects if ANY returned address is private/reserved — a hostname
// with mixed public/private A records is treated as unsafe rather than gambling on which one
// the connection actually uses. Returns the address this request will be pinned to.
async function resolveAndValidate(hostname: string): Promise<{ address: string; family: number }> {
  // IPv4/IPv6 literals (no DNS to rebind) still go through the same range check.
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (isBlockedAddress(hostname, literalFamily)) {
      throw new UnsafeUrlError(`Blocked destination address: ${hostname}`);
    }
    return { address: hostname, family: literalFamily };
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve hostname: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`No addresses resolved for hostname: ${hostname}`);
  }
  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family)) {
      throw new UnsafeUrlError(`Hostname ${hostname} resolves to a blocked address (${address})`);
    }
  }
  return addresses[0];
}

// Reads the response body up to maxBytes, aborting the stream rather than trusting
// Content-Length (which a malicious/compromised server can simply lie about).
async function readTextWithLimit(res: Awaited<ReturnType<typeof undiciFetch>>, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UnsafeUrlError(`Response exceeded ${maxBytes}-byte limit`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
}

// Node's underlying net/tls connect logic calls a `connect.lookup` override with two different
// expected callback shapes depending on `opts.all`: the classic 3-arg `(err, address, family)`
// form, or — when Happy Eyeballs/dual-stack resolution requests every candidate address — a
// 2-arg `(err, addresses[])` form where each entry is `{address, family}`. Answering with only
// the 3-arg form regardless of what was asked produced `ERR_INVALID_IP_ADDRESS: Invalid IP
// address: undefined` against real HTTPS targets (found via live testing, not caught by any
// mocked unit test) — this respects `opts.all` explicitly. Exported and separately unit-tested
// (safe-fetch.test.ts) so this exact shape mismatch can't silently regress again.
export function pinnedLookup(
  address: string,
  family: 4 | 6,
): (hostname: string, opts: { all?: boolean } | undefined, callback: (...args: unknown[]) => void) => void {
  return (_hostname, opts, callback) => {
    if (opts?.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

// Drop-in-shaped replacement for the subset of `fetch` the crawler needs (`res.ok`,
// `res.status`, `await res.text()`), with every hop SSRF-validated and DNS-pinned.
export async function safeFetch(inputUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  let currentUrl: URL;
  try {
    currentUrl = new URL(inputUrl);
  } catch {
    throw new UnsafeUrlError(`Malformed URL: ${inputUrl}`);
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    assertSafeUrlShape(currentUrl);
    const { address, family } = await resolveAndValidate(currentUrl.hostname);

    // Pin the TCP connection to the address we just validated — undici's `connect.lookup`
    // is consulted at actual socket-connect time, so this is the step that closes the
    // DNS-rebinding window between validation and connection.
    const dispatcher: Dispatcher = new Agent({
      connect: {
        // Cast: undici's LookupFunction type is stricter about the callback's error-type
        // parameter than this module needs — pinnedLookup's own signature stays simple and
        // independently testable (see safe-fetch.test.ts) rather than importing undici's
        // internal connector types just to satisfy this one call site.
        lookup: pinnedLookup(address, family as 4 | 6) as never,
      },
    });

    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(currentUrl.toString(), {
        headers: options.headers,
        redirect: 'manual',
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } finally {
      await dispatcher.close();
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new UnsafeUrlError('Redirect response had no Location header');
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    return {
      ok: res.ok,
      status: res.status,
      text: () => readTextWithLimit(res, maxResponseBytes),
    };
  }

  throw new UnsafeUrlError(`Exceeded ${maxRedirects} redirects`);
}
