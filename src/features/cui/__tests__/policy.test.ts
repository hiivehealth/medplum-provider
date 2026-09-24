import type { MedplumClient } from '@medplum/core';
import { CUI_ENABLED_URL, resolveCuiPolicy, setCuiEnabled } from '../policy';

const searchOne = vi.fn();
const getProjectMembership = vi.fn();
const medplum = { searchOne, getProjectMembership } as unknown as MedplumClient;

beforeEach(() => {
  searchOne.mockReset();
  getProjectMembership.mockReset();
  getProjectMembership.mockReturnValue({ admin: false });
});

test('reads the profiled project configuration through Medplum', async () => {
  searchOne.mockResolvedValue({
    resourceType: 'Basic',
    id: 'c1',
    meta: { project: 'p1', profile: ['https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-configuration'] },
    extension: [{ url: CUI_ENABLED_URL, valueBoolean: true }],
  });

  await expect(resolveCuiPolicy(medplum, 'p1')).resolves.toEqual({
    projectId: 'p1',
    configurationId: 'c1',
    enabled: true,
    canManage: false,
  });
  expect(searchOne).toHaveBeenCalledWith(
    'Basic',
    { _profile: 'https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-configuration' },
    { cache: 'no-store' }
  );
});

test('defaults an absent configuration to disabled and exposes project administrator access', async () => {
  searchOne.mockResolvedValue(undefined);
  getProjectMembership.mockReturnValue({ admin: true });

  await expect(resolveCuiPolicy(medplum, 'p1')).resolves.toEqual({
    projectId: 'p1',
    enabled: false,
    canManage: true,
  });
});

test.each([
  { meta: { project: 'other', profile: ['https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-configuration'] } },
  { meta: { project: 'p1', profile: [] } },
  {
    meta: { project: 'p1', profile: ['https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-configuration'] },
    extension: [
      { url: CUI_ENABLED_URL, valueBoolean: true },
      { url: CUI_ENABLED_URL, valueBoolean: false },
    ],
  },
])('rejects invalid or cross-project configuration', async (configuration) => {
  searchOne.mockResolvedValue({ resourceType: 'Basic', id: 'c1', ...configuration });
  await expect(resolveCuiPolicy(medplum, 'p1')).rejects.toThrow('Invalid CUI project configuration');
});

test('does not interpret a direct read failure as a disabled policy', async () => {
  searchOne.mockRejectedValue(new Error('Offline'));
  await expect(resolveCuiPolicy(medplum, 'p1')).rejects.toThrow('Offline');
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
