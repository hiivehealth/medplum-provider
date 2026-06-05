// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { VisibilityTesterPage } from './VisibilityTesterPage';

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
      <MemoryRouter initialEntries={['/admin/rbac/test']}>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <VisibilityTesterPage />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  });
}

describe('VisibilityTesterPage', () => {
  test('shows hidden/visible matrix from selected policy', async () => {
    const medplum = new MockClient();
    const user = userEvent.setup();

    vi.spyOn(medplum, 'getProjectMembership').mockReturnValue(adminMembership());
    vi.spyOn(medplum, 'readResource').mockImplementation(async (resourceType: string, id: string) => {
      if (resourceType === 'AccessPolicy') {
        return {
          resourceType: 'AccessPolicy',
          id,
          name: 'RBAC: Supervisor/HR Minimum Necessary',
          resource: [
            {
              resourceType: 'Patient',
              interaction: ['read', 'search'],
              hiddenFields: ['address', 'birthDate', 'telecom'],
            },
          ],
        } as any;
      }

      if (resourceType === 'Patient') {
        return {
          resourceType: 'Patient',
          id,
          birthDate: '1990-01-01',
          address: [{ line: ['123 Main St'] }],
          telecom: [{ value: '555-555-1000' }],
          gender: 'female',
        } as any;
      }

      throw new Error(`Unexpected readResource: ${resourceType}/${id}`);
    });

    await setup(medplum);

    await user.type(screen.getByLabelText('AccessPolicy ID'), 'policy-hr');
    await user.type(screen.getByLabelText('Patient ID'), 'patient-1');
    await user.click(screen.getByRole('button', { name: 'Load Preview' }));

    await waitFor(() => {
      expect(screen.getByText('Policy loaded')).toBeInTheDocument();
    });

    expect(screen.getByText('address')).toBeInTheDocument();
    expect(screen.getByText('birthDate')).toBeInTheDocument();
    expect(screen.getByText('telecom')).toBeInTheDocument();

    // We expect both labels to appear in table content for mixed field rules.
    expect(screen.getAllByText('Hidden').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Visible').length).toBeGreaterThan(0);
  });
});
