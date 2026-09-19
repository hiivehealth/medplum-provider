import { MantineProvider } from '@mantine/core';
import type { Patient } from '@medplum/fhirtypes';
import { useSearchResources } from '@medplum/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CaliforniaPatientSearchPage } from './CaliforniaPatientSearchPage';

vi.mock('@medplum/react', () => ({ useSearchResources: vi.fn() }));

const mayaChen: Patient = {
  resourceType: 'Patient',
  id: 'california-demo-patient-maya-chen',
  name: [{ given: ['Maya'], family: 'Chen' }],
  birthDate: '1982-04-18',
  identifier: [
    {
      system: 'https://hiivehealth.com/fhir/identifier/california-demo-org-bay-care',
      assigner: { display: 'Bay Care Network' },
    },
    {
      system: 'https://hiivehealth.com/fhir/identifier/california-demo-org-central-valley',
      assigner: { display: 'Central Valley Community Health' },
    },
  ],
};

describe('CaliforniaPatientSearchPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useSearchResources).mockReturnValue([[mayaChen], false] as never);
  });

  test('searches by demographic criteria and records recently viewed patients', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MantineProvider>
          <CaliforniaPatientSearchPage />
        </MantineProvider>
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText('Given name'), 'Maya');

    expect(screen.getByText('Maya Chen')).toBeInTheDocument();
    expect(screen.getAllByText('Bay Care Network').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Central Valley Community Health').length).toBeGreaterThan(0);
    expect(useSearchResources).toHaveBeenLastCalledWith('Patient', expect.objectContaining({ given: 'Maya' }), {
      enabled: true,
    });

    await user.click(screen.getByRole('link', { name: 'Maya Chen' }));

    expect(screen.getByText('Recently viewed')).toBeInTheDocument();
    expect(localStorage.getItem('california-hie-recent-patients')).toContain('california-demo-patient-maya-chen');
  });
});
