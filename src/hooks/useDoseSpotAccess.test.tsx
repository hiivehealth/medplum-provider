import { showNotification } from '@mantine/notifications';
import { MockClient } from '@medplum/mock';
import { useMedplum, useSearchResources } from '@medplum/react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DOSESPOT_PRACTITIONER_ROLE_TYPE_SYSTEM } from '../components/utils';
import { OEM_PROJECT_ID } from '../pages/oem/ih-review';
import { useDoseSpotAccess } from './useDoseSpotAccess';

vi.mock('@mantine/notifications', () => ({ showNotification: vi.fn() }));
vi.mock('@medplum/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@medplum/react')>()),
  useMedplum: vi.fn(),
  useSearchResources: vi.fn(),
}));

const authorizedRole = { resourceType: 'PractitionerRole' as const, id: 'authorized-dose-role',
  code: [{ coding: [{ system: DOSESPOT_PRACTITIONER_ROLE_TYPE_SYSTEM }] }] };
const authorizedRoles = Object.assign([authorizedRole], { bundle: {
  resourceType: 'Bundle' as const, type: 'searchset' as const, entry: [{ resource: authorizedRole }],
} });

describe('useDoseSpotAccess Project isolation', () => {
  let client: MockClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MockClient();
    vi.mocked(useMedplum).mockReturnValue(client);
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID, name: 'Army OEM Synthetic Demo' });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'demo-practitioner' });
    vi.spyOn(client, 'getProjectMembership').mockReturnValue(undefined);
    vi.mocked(useSearchResources).mockReturnValue([undefined, false, undefined]);
  });

  test('OEM disables enrollment searches and all access flags', () => {
    const { result } = renderHook(useDoseSpotAccess);
    expect(useSearchResources).toHaveBeenCalledWith('PractitionerRole', expect.any(Object), { enabled: false });
    expect(result.current).toEqual({ enrolled: false, hasAccess: false, needsSelfEnroll: false, loading: false });
  });

  test('OEM ignores stale authorization, loading and denied outcomes without notifications', () => {
    vi.mocked(useSearchResources).mockReturnValue([authorizedRoles, true,
    { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden' }] }]);
    const { result } = renderHook(useDoseSpotAccess);
    expect(result.current).toEqual({ enrolled: false, hasAccess: false, needsSelfEnroll: false, loading: false });
    expect(showNotification).not.toHaveBeenCalled();
  });

  test('Red Rover read-only test project disables enrollment and ignores stale role outcomes', () => {
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: '8588313a-c8c6-4e07-8c1d-e684ed25e522', name: 'Red Rover UAT Five Patient Test' });
    vi.mocked(useSearchResources).mockReturnValue([authorizedRoles, true,
      { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden' }] }]);
    const { result } = renderHook(useDoseSpotAccess);
    expect(useSearchResources).toHaveBeenCalledWith('PractitionerRole', expect.any(Object), { enabled: false });
    expect(result.current).toEqual({ enrolled: false, hasAccess: false, needsSelfEnroll: false, loading: false });
    expect(showNotification).not.toHaveBeenCalled();
  });

  test('another Project still checks enrollment and reports permission failures', () => {
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'another-project', name: 'Another Project' });
    vi.mocked(useSearchResources).mockReturnValue([undefined, false,
      { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden' }] }]);
    renderHook(useDoseSpotAccess);
    expect(useSearchResources).toHaveBeenCalledWith('PractitionerRole', expect.any(Object), { enabled: true });
    expect(showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'DoseSpot Access Check Failed' }));
  });

  test('another Project retains authorized self-enrollment', () => {
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'another-project', name: 'Another Project' });
    vi.mocked(useSearchResources).mockReturnValue([authorizedRoles, false, undefined]);
    const { result } = renderHook(useDoseSpotAccess);
    expect(result.current.hasAccess).toBe(true);
    expect(result.current.needsSelfEnroll).toBe(true);
  });

  test('switching into OEM drops cached access without changing native membership', () => {
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'another-project', name: 'Another Project' });
    vi.mocked(useSearchResources).mockReturnValue([authorizedRoles, false, undefined]);
    const { result, rerender } = renderHook(useDoseSpotAccess);
    expect(result.current.hasAccess).toBe(true);
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID, name: 'Army OEM Synthetic Demo' });
    rerender();
    expect(result.current.hasAccess).toBe(false);
    expect(result.current.needsSelfEnroll).toBe(false);
    expect(useSearchResources).toHaveBeenLastCalledWith('PractitionerRole', expect.any(Object), { enabled: false });
  });
});