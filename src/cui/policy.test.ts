import type { MedplumClient } from '@medplum/core';
import { CUI_ENABLED_URL, resolveCuiPolicy, setCuiEnabled } from './policy';

function client(response: unknown): MedplumClient {
  return { get: vi.fn().mockResolvedValue(response) } as unknown as MedplumClient;
}

test('accepts the same authoritative endpoint contract for every shell', async () => {
  const value = { projectId: 'p1', enabled: true, canManage: false };
  const medplum = client(value);
  await expect(resolveCuiPolicy(medplum, 'p1')).resolves.toEqual(value);
  expect(medplum.get).toHaveBeenCalledWith('auth/cui-banner', { cache: 'no-store' });
});

test.each([
  undefined,
  {},
  { projectId: 'other', enabled: true, canManage: true },
  { projectId: 'p1', enabled: 'false', canManage: false },
])('rejects invalid or cross-project responses', async (response) => {
  await expect(resolveCuiPolicy(client(response), 'p1')).rejects.toThrow('Invalid CUI project policy response');
});

test('network and permission errors are not interpreted as a disabled policy', async () => {
  const medplum = client(undefined);
  vi.mocked(medplum.get).mockRejectedValue(new Error('Forbidden'));
  await expect(resolveCuiPolicy(medplum, 'p1')).rejects.toThrow('Forbidden');
});

test('toggle retains unrelated project extensions and replaces the single policy value', () => {
  const other = { url: 'https://example.com/unrelated', valueString: 'keep' };
  const project = {
    resourceType: 'Project' as const,
    name: 'Clinic',
    extension: [other, { url: CUI_ENABLED_URL, valueBoolean: true }],
  };
  expect(setCuiEnabled(project, false).extension).toEqual([other, { url: CUI_ENABLED_URL, valueBoolean: false }]);
  expect(project.extension[1]).toEqual({ url: CUI_ENABLED_URL, valueBoolean: true });
});
