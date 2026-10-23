import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { listProfileSuggestions, decideProfileSuggestion, ProfileSuggestionError } from '@/lib/profile-suggestions';
import { GET } from './route';
import { PATCH } from './[suggestionId]/route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(), WebsiteNotFoundError: class extends Error {},
}));
vi.mock('@/lib/profile-suggestions', async () => ({
  ...await vi.importActual<typeof import('@/lib/profile-suggestions')>('@/lib/profile-suggestions'),
  listProfileSuggestions: vi.fn(), decideProfileSuggestion: vi.fn(),
}));

const scope = { customerId: 'customer1', clientProfileId: 'profile1', websiteId: 'site1' };
const params = { id: 'site1', suggestionId: 'suggestion1' };
function request(body?: unknown) {
  return new Request('http://localhost/api/websites/site1/profile-suggestions?clientProfileId=profile1',
    body === undefined ? {} : { method: 'PATCH', body: JSON.stringify(body) }) as NextRequest;
}

describe('profile suggestion routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(auth).mockReturnValue({ userId: 'user1' } as ReturnType<typeof auth>);
    vi.mocked(resolveWebsiteForRequest).mockResolvedValue({
      customer: { id: scope.customerId },
      website: { id: scope.websiteId, clientProfileId: scope.clientProfileId },
    } as Awaited<ReturnType<typeof resolveWebsiteForRequest>>);
    vi.mocked(listProfileSuggestions).mockResolvedValue([]);
    vi.mocked(decideProfileSuggestion).mockResolvedValue({ status: 'accepted' });
  });

  it('requires authentication for reads and decisions', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as ReturnType<typeof auth>);
    expect((await GET(request(), { params })).status).toBe(401);
    expect((await PATCH(request({ action: 'accept' }), { params })).status).toBe(401);
    expect(resolveWebsiteForRequest).not.toHaveBeenCalled();
  });

  it('resolves the selected profile and lists only the server-derived scope', async () => {
    const response = await GET(request(), { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suggestions: [] });
    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user1', 'site1', 'profile1');
    expect(listProfileSuggestions).toHaveBeenCalledWith(scope);
  });

  it('denies an inaccessible website before reading or deciding', async () => {
    vi.mocked(resolveWebsiteForRequest).mockRejectedValue(new WebsiteNotFoundError('not found'));
    expect((await GET(request(), { params })).status).toBe(404);
    expect((await PATCH(request({ action: 'reject' }), { params })).status).toBe(404);
    expect(listProfileSuggestions).not.toHaveBeenCalled();
    expect(decideProfileSuggestion).not.toHaveBeenCalled();
  });

  it('ignores ownership, field and status supplied in the body', async () => {
    const response = await PATCH(request({
      action: 'accept', value: 'Shop owners', customerId: 'other', clientProfileId: 'other',
      websiteId: 'other', field: 'claims', status: 'accepted',
    }), { params });
    expect(response.status).toBe(200);
    expect(decideProfileSuggestion).toHaveBeenCalledWith(scope, 'suggestion1', { action: 'accept', value: 'Shop owners' });
  });

  it.each([null, [], {}, { action: 'edit' }, { action: 'accept', value: null }])('rejects invalid decisions: %j', async (body) => {
    expect((await PATCH(request(body), { params })).status).toBe(400);
    expect(decideProfileSuggestion).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const req = new Request(request().url, { method: 'PATCH', body: '{' }) as NextRequest;
    expect((await PATCH(req, { params })).status).toBe(400);
    expect(decideProfileSuggestion).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404], ['conflict', 409], ['invalid', 400],
  ] as const)('maps %s service errors without exposing details', async (code, status) => {
    vi.mocked(decideProfileSuggestion).mockRejectedValue(new ProfileSuggestionError(code, 'private detail'));
    const response = await PATCH(request({ action: 'accept' }), { params });
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain('private detail');
  });
});
