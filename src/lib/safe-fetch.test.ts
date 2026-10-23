import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isBlockedIPv4, isBlockedIPv6, safeFetch, pinnedLookup, UnsafeUrlError } from '@/lib/safe-fetch';

describe('pinnedLookup', () => {
  it('answers the 3-arg (err, address, family) form when opts.all is not set', () => {
    const callback = vi.fn();
    pinnedLookup('93.184.216.34', 4)('example.com', undefined, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('answers the 2-arg (err, addresses[]) form when opts.all is true — Happy Eyeballs / dual-stack resolution', () => {
    const callback = vi.fn();
    pinnedLookup('2606:4700:4700::1111', 6)('example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '2606:4700:4700::1111', family: 6 }]);
  });

  it('never resolves anything other than the pinned address, regardless of hostname argument', () => {
    const callback = vi.fn();
    // Even if called with a different hostname than expected, it must still answer with the
    // pre-validated address — this is what actually pins the connection against DNS rebinding.
    pinnedLookup('8.8.8.8', 4)('attacker-controlled-hostname.example', undefined, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  });
});

describe('isBlockedIPv4', () => {
  it('blocks loopback, private, link-local (cloud metadata), and reserved ranges', () => {
    expect(isBlockedIPv4('127.0.0.1')).toBe(true);
    expect(isBlockedIPv4('10.0.0.5')).toBe(true);
    expect(isBlockedIPv4('172.16.0.1')).toBe(true);
    expect(isBlockedIPv4('192.168.1.1')).toBe(true);
    expect(isBlockedIPv4('169.254.169.254')).toBe(true); // AWS/GCP/Azure metadata
    expect(isBlockedIPv4('100.64.0.1')).toBe(true); // carrier-grade NAT
    expect(isBlockedIPv4('0.0.0.0')).toBe(true);
    expect(isBlockedIPv4('255.255.255.255')).toBe(true);
    expect(isBlockedIPv4('224.0.0.1')).toBe(true); // multicast
  });

  it('allows real public addresses', () => {
    expect(isBlockedIPv4('8.8.8.8')).toBe(false);
    expect(isBlockedIPv4('1.1.1.1')).toBe(false);
    expect(isBlockedIPv4('93.184.216.34')).toBe(false);
  });
});

describe('isBlockedIPv6', () => {
  it('blocks loopback, unique-local, link-local, and IPv4-mapped private addresses', () => {
    expect(isBlockedIPv6('::1')).toBe(true);
    expect(isBlockedIPv6('::')).toBe(true);
    expect(isBlockedIPv6('fe80::1')).toBe(true);
    expect(isBlockedIPv6('fc00::1')).toBe(true);
    expect(isBlockedIPv6('fd12:3456:789a::1')).toBe(true);
    expect(isBlockedIPv6('::ffff:127.0.0.1')).toBe(true); // IPv4-mapped loopback
    expect(isBlockedIPv6('::ffff:169.254.169.254')).toBe(true); // IPv4-mapped metadata
  });

  it('allows real public IPv6 addresses', () => {
    expect(isBlockedIPv6('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
  });
});

describe('safeFetch — scheme and credential rejection (no network involved)', () => {
  it('rejects non-http(s) schemes before any network call', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetch('ftp://example.com/x')).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetch('gopher://example.com/x')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects URLs carrying embedded credentials', async () => {
    await expect(safeFetch('http://user:pass@example.com/')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects a malformed URL', async () => {
    await expect(safeFetch('not a url')).rejects.toThrow(UnsafeUrlError);
  });
});

describe('safeFetch — DNS resolution guard (mocked dns.lookup, no real network)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects a hostname that resolves to a private address', async () => {
    vi.doMock('node:dns', () => ({
      promises: { lookup: vi.fn().mockResolvedValue([{ address: '10.0.0.5', family: 4 }]) },
    }));
    const { safeFetch: mockedSafeFetch, UnsafeUrlError: MockedError } = await import('@/lib/safe-fetch');
    await expect(mockedSafeFetch('http://internal.example.com/')).rejects.toThrow(MockedError);
  });

  it('rejects a hostname with mixed public/private A records rather than gambling on which resolves', async () => {
    vi.doMock('node:dns', () => ({
      promises: {
        lookup: vi.fn().mockResolvedValue([
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ]),
      },
    }));
    const { safeFetch: mockedSafeFetch } = await import('@/lib/safe-fetch');
    await expect(mockedSafeFetch('http://mixed.example.com/')).rejects.toThrow();
  });

  it('rejects a raw private IPv4 literal directly, with no DNS lookup involved', async () => {
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetch('http://127.0.0.1:8080/admin')).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetch('http://[::1]/')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects the hostname "localhost" itself (not just the 127.0.0.1/::1 literals)', async () => {
    vi.doMock('node:dns', () => ({
      promises: { lookup: vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]) },
    }));
    const { safeFetch: mockedSafeFetch, UnsafeUrlError: MockedError } = await import('@/lib/safe-fetch');
    await expect(mockedSafeFetch('http://localhost:5432/')).rejects.toThrow(MockedError);
  });
});

describe('safeFetch — redirect hop re-validation (mocked dns.lookup and undici fetch, no real network)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects a redirect to a private address and never connects to that hop', async () => {
    vi.doMock('node:dns', () => ({
      promises: {
        lookup: vi.fn((hostname: string) => {
          if (hostname === 'public.example.com') return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
          if (hostname === 'internal.example.com') return Promise.resolve([{ address: '10.0.0.9', family: 4 }]);
          return Promise.reject(new Error(`unexpected hostname in test: ${hostname}`));
        }),
      },
    }));
    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: { get: (name: string) => (name.toLowerCase() === 'location' ? 'http://internal.example.com/secret' : null) },
      body: null,
    });
    vi.doMock('undici', () => ({
      Agent: class {
        close() {
          return Promise.resolve();
        }
      },
      fetch: mockFetch,
    }));
    const { safeFetch: mockedSafeFetch, UnsafeUrlError: MockedError } = await import('@/lib/safe-fetch');
    await expect(mockedSafeFetch('http://public.example.com/start')).rejects.toThrow(MockedError);
    // The redirect target must be validated and rejected BEFORE a second connection is ever
    // attempted -- proves re-validation happens per hop, not just once at the start.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to a public address and validates that hop too', async () => {
    vi.doMock('node:dns', () => ({
      promises: {
        lookup: vi.fn((hostname: string) => {
          if (hostname === 'public.example.com') return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
          if (hostname === 'also-public.example.com') return Promise.resolve([{ address: '1.1.1.1', family: 4 }]);
          return Promise.reject(new Error(`unexpected hostname in test: ${hostname}`));
        }),
      },
    }));
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 301,
        ok: false,
        headers: { get: (name: string) => (name.toLowerCase() === 'location' ? 'http://also-public.example.com/landed' : null) },
        body: null,
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: null,
      });
    vi.doMock('undici', () => ({
      Agent: class {
        close() {
          return Promise.resolve();
        }
      },
      fetch: mockFetch,
    }));
    const { safeFetch: mockedSafeFetch } = await import('@/lib/safe-fetch');
    const result = await mockedSafeFetch('http://public.example.com/start');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('aborts and throws once the response body exceeds maxResponseBytes, ignoring Content-Length', async () => {
    vi.doMock('node:dns', () => ({
      promises: { lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) },
    }));
    const cancel = vi.fn();
    const chunk = new Uint8Array(1024).fill(97);
    let reads = 0;
    const reader = {
      read: vi.fn(() => {
        reads += 1;
        return Promise.resolve(reads <= 10 ? { done: false, value: chunk } : { done: true, value: undefined });
      }),
      cancel,
    };
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => '1' }, // lies about Content-Length — must not be trusted
      body: { getReader: () => reader },
    });
    vi.doMock('undici', () => ({
      Agent: class {
        close() {
          return Promise.resolve();
        }
      },
      fetch: mockFetch,
    }));
    const { safeFetch: mockedSafeFetch, UnsafeUrlError: MockedError } = await import('@/lib/safe-fetch');
    const result = await mockedSafeFetch('http://public.example.com/big', { maxResponseBytes: 2048 });
    await expect(result.text()).rejects.toThrow(MockedError);
    expect(cancel).toHaveBeenCalled();
  });
});
