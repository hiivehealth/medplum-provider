import type { MedplumClient } from '@medplum/core';
import { CUI_ENABLED_URL, resolveCuiPolicy, setCuiEnabled } from './policy';

const medplum = { getAccessToken: () => 'user-token', refreshIfExpired: async () => {} } as unknown as MedplumClient;
const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
function response(value: unknown) {
  mockFetch.mockResolvedValue({ ok: true, json: async () => value });
}

test('uses the same-origin service with the caller token and no cookies or cache', async () => {
  const value = { projectId: 'p1', configurationId: 'c1', enabled: true, canManage: false };
  response(value);
  await expect(resolveCuiPolicy(medplum, 'p1')).resolves.toEqual(value);
  expect(mockFetch).toHaveBeenCalledWith('/api/cui-banner', {
    headers: { Authorization: 'Bearer user-token' },
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
});

test.each([
  undefined,
  {},
  { projectId: 'other', configurationId: 'c1', enabled: true, canManage: true },
  { projectId: 'p1', configurationId: 'c1', enabled: 'false', canManage: false },
  { projectId: 'p1', configurationId: '../other', enabled: false, canManage: false },
])('rejects invalid or cross-project responses', async (value) => {
  response(value);
  await expect(resolveCuiPolicy(medplum, 'p1')).rejects.toThrow('Invalid CUI project policy response');
});

test('service errors are not interpreted as disabled', async () => {
  mockFetch.mockResolvedValue({ ok: false });
  await expect(resolveCuiPolicy(medplum, 'p1')).rejects.toThrow('Unable to resolve');
});

test('missing authentication does not call the service', async () => {
  await expect(resolveCuiPolicy({ getAccessToken: () => undefined } as unknown as MedplumClient, 'p1')).rejects.toThrow(
    'Authentication required'
  );
  expect(mockFetch).not.toHaveBeenCalled();
});

test('refreshes an expired session before sending the service request', async () => {
  let token = 'expired';
  const client = {
    getAccessToken: () => token,
    refreshIfExpired: async () => {
      token = 'refreshed';
    },
  } as unknown as MedplumClient;
  response({ projectId: 'p1', configurationId: 'c1', enabled: false, canManage: false });
  await resolveCuiPolicy(client, 'p1');
  expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer refreshed');
});

test('toggle retains unrelated configuration extensions', () => {
  const other = { url: 'https://example.com/unrelated', valueString: 'keep' };
  const resource = {
    resourceType: 'Basic' as const,
    code: { text: 'CUI' },
    extension: [other, { url: CUI_ENABLED_URL, valueBoolean: true }],
  };
  expect(setCuiEnabled(resource, false).extension).toEqual([other, { url: CUI_ENABLED_URL, valueBoolean: false }]);
  expect(resource.extension[1]).toEqual({ url: CUI_ENABLED_URL, valueBoolean: true });
});
