// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { MembershipManagerPage } from './MembershipManagerPage';

function adminMembership() {
  return {
    resourceType: 'ProjectMembership' as const,
    id: 'membership-admin',
    project: { reference: 'Project/ubix' },
    user: { reference: 'User/admin' },
    profile: { reference: 'Practitioner/admin' },
    admin: true,
  };
}

async function setup(medplum: MockClient): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/admin/rbac/members']}>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Notifications />
            <MembershipManagerPage />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  });
}

describe('MembershipManagerPage', () => {
  test('shows access denied when user is not project admin', async () => {
    const medplum = new MockClient();
    vi.spyOn(medplum, 'getProjectMembership').mockReturnValue({
      resourceType: 'ProjectMembership',
      id: 'not-admin',
      project: { reference: 'Project/ubix' },
      user: { reference: 'User/test' },
      profile: { reference: 'Practitioner/test' },
      admin: false,
    });

    await setup(medplum);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  test('creates a project membership with selected policy', async () => {
    const medplum = new MockClient();
    const user = userEvent.setup();

    vi.spyOn(medplum, 'getProjectMembership').mockReturnValue(adminMembership());
    vi.spyOn(medplum, 'searchResources').mockImplementation(async (resourceType, _query) => {
      if (resourceType === 'ProjectMembership') {
        return [] as any;
      }
      if (resourceType === 'AccessPolicy') {
        return [
          {
            resourceType: 'AccessPolicy',
            id: 'policy-1',
            name: 'RBAC: Supervisor/HR Minimum Necessary',
            resource: [{ resourceType: 'Patient', interaction: ['read'] }],
          },
        ] as any;
      }
      if (resourceType === 'User') {
        return [{ resourceType: 'User', id: 'user-123', email: 'rbac.user@example.com' }] as any;
      }
      return [] as any;
    });

    const createSpy = vi.spyOn(medplum, 'createResource').mockResolvedValue({
      resourceType: 'ProjectMembership',
      id: 'pm-1',
      project: { reference: 'Project/ubix' },
      user: { reference: 'User/user-123' },
      profile: { reference: 'RelatedPerson/rp-1' },
      accessPolicy: { reference: 'AccessPolicy/policy-1' },
      admin: false,
    } as any);

    await setup(medplum);

    await waitFor(() => {
      expect(screen.getByText('Membership Manager')).toBeInTheDocument();
    });

    const userIdInput = screen.getByRole('textbox', { name: 'User ID' });
    const profileRefInput = screen.getByRole('textbox', { name: 'Profile Reference' });
    const policyIdInput = screen.getByRole('textbox', { name: 'AccessPolicy ID' });

    await user.clear(userIdInput);
    await user.type(userIdInput, 'user-123');
    await user.clear(profileRefInput);
    await user.type(profileRefInput, 'RelatedPerson/rp-1');
    await user.clear(policyIdInput);
    await user.type(policyIdInput, 'policy-1');
    await user.click(screen.getByRole('button', { name: 'Create Membership' }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalled();
    });

    const payload = createSpy.mock.calls[0][0] as any;
    expect(payload.resourceType).toBe('ProjectMembership');
    expect(payload.project).toEqual({ reference: 'Project/ubix' });
    expect(payload.user).toEqual({ reference: 'User/user-123' });
    expect(payload.profile).toEqual({ reference: 'RelatedPerson/rp-1' });
    expect(payload.accessPolicy).toEqual({ reference: 'AccessPolicy/policy-1' });
  });
});
