import { describe, expect, it } from 'vitest';
import { websiteScopedHref } from './nav-href';

describe('websiteScopedHref', () => {
  it('leaves links alone when no website is remembered', () => {
    expect(websiteScopedHref({ href: '/settings' }, null).href).toBe('/settings');
  });

  it('points the dashboard link at the remembered website', () => {
    expect(websiteScopedHref({ href: '/dashboard' }, 'site1').href).toBe('/dashboard/site1');
  });

  it('carries the remembered website into Studio, Review and Settings', () => {
    expect(websiteScopedHref({ href: '/studio' }, 'site1').href).toBe('/studio?websiteId=site1');
    expect(websiteScopedHref({ href: '/review' }, 'site1').href).toBe('/review?websiteId=site1');
    expect(websiteScopedHref({ href: '/settings' }, 'site1').href).toBe('/settings?websiteId=site1');
  });

  it('keeps other item fields', () => {
    const item = { href: '/settings', label: 'Settings' };
    expect(websiteScopedHref(item, 'a b')).toEqual({ href: '/settings?websiteId=a%20b', label: 'Settings' });
  });
});
