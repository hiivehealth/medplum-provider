import { MantineProvider } from '@mantine/core';
import type { WithId } from '@medplum/core';
import { calculateAge, ReadablePromise } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { ResourceDetailPage, ResourceVersionPage } from './ResourceDetailPage';

const namespace = 'https://ehr.hiivehealth.net/fhir';

function renderVersion(medplum: MockClient): void {
  render(
    <MedplumProvider medplum={medplum}>
      <MantineProvider>
        <MemoryRouter initialEntries={['/Patient/worker/_history/old-version']}>
          <Link to="/Patient/worker/_history/other-version">Another version</Link>
          <Routes>
            <Route path="/:resourceType/:id/_history/:versionId" element={<ResourceVersionPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    </MedplumProvider>
  );
}

test('reads and displays only the requested historical version without current-resource reads or edit controls', async () => {
  const medplum = new MockClient();
  const read = vi
    .spyOn(medplum, 'readVersion')
    .mockResolvedValue({
      resourceType: 'Patient',
      id: 'worker',
      meta: { versionId: 'old-version' },
      name: [{ text: 'Historical worker' }],
    });
  const current = vi.spyOn(medplum, 'readResource');
  renderVersion(medplum);
  expect(await screen.findByText('Historical worker')).toBeInTheDocument();
  expect(read).toHaveBeenCalledWith('Patient', 'worker', 'old-version', { cache: 'no-cache' });
  expect(current).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'View resource history' })).toHaveAttribute(
    'href',
    '/Patient/worker/history'
  );
  expect(screen.queryByRole('button', { name: /edit|save/i })).not.toBeInTheDocument();
});

test.each(['denied', 'wrong-version', 'wrong-resource'])(
  'shows an explicit unavailable state for %s without fallback',
  async (failure) => {
    const medplum = new MockClient();
    const read = vi.spyOn(medplum, 'readVersion');
    if (failure === 'denied') read.mockRejectedValue(new Error('Forbidden'));
    else
      read.mockResolvedValue({
        resourceType: 'Patient',
        id: failure === 'wrong-resource' ? 'other' : 'worker',
        meta: { versionId: failure === 'wrong-version' ? 'latest' : 'old-version' },
        name: [{ text: 'Must not display' }],
      });
    const current = vi.spyOn(medplum, 'readResource');
    renderVersion(medplum);
    expect(await screen.findByRole('alert', { name: 'Version unavailable' })).toBeInTheDocument();
    expect(screen.queryByText('Must not display')).not.toBeInTheDocument();
    expect(current).not.toHaveBeenCalled();
  }
);

test('keeps an explicit loading state until the exact version arrives', async () => {
  const medplum = new MockClient();
  let finish!: (value: WithId<Patient>) => void;
  vi.spyOn(medplum, 'readVersion').mockReturnValue(
    new ReadablePromise(
      new Promise<WithId<Patient>>((resolve) => {
        finish = resolve;
      })
    )
  );
  renderVersion(medplum);
  expect(screen.getByLabelText('Loading resource version')).toBeInTheDocument();
  await act(async () => finish({ resourceType: 'Patient', id: 'worker', meta: { versionId: 'old-version' } }));
  expect(screen.queryByLabelText('Loading resource version')).not.toBeInTheDocument();
});

test('retains the verified historical body as read-only FHIR when display metadata is unavailable', async () => {
  const medplum = new MockClient();
  vi.spyOn(medplum, 'readVersion').mockResolvedValue({
    resourceType: 'Patient',
    id: 'worker',
    meta: { versionId: 'old-version' },
    name: [{ text: 'Historical worker' }],
  });
  vi.spyOn(medplum, 'requestSchema').mockRejectedValue(new Error('Schema unavailable'));
  const current = vi.spyOn(medplum, 'readResource');
  renderVersion(medplum);
  expect(await screen.findByText('Structured display unavailable')).toBeInTheDocument();
  const content = screen.getByText(/"resourceType": "Patient"/);
  expect(content).toHaveTextContent('old-version');
  expect(content).toHaveTextContent('Historical worker');
  expect(screen.queryByRole('alert', { name: 'Version unavailable' })).not.toBeInTheDocument();
  expect(current).not.toHaveBeenCalled();
});

test('does not display a late response after navigating to another version', async () => {
  const medplum = new MockClient();
  let finishOld!: (value: WithId<Patient>) => void;
  let finishNew!: (value: WithId<Patient>) => void;
  vi.spyOn(medplum, 'readVersion')
    .mockReturnValueOnce(
      new ReadablePromise(
        new Promise<WithId<Patient>>((resolve) => {
          finishOld = resolve;
        })
      )
    )
    .mockReturnValueOnce(
      new ReadablePromise(
        new Promise<WithId<Patient>>((resolve) => {
          finishNew = resolve;
        })
      )
    );
  renderVersion(medplum);
  fireEvent.click(screen.getByRole('link', { name: 'Another version' }));
  await act(async () =>
    finishOld({
      resourceType: 'Patient',
      id: 'worker',
      meta: { versionId: 'old-version' },
      name: [{ text: 'Stale response' }],
    })
  );
  expect(screen.queryByText('Stale response')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Loading resource version')).toBeInTheDocument();
  await act(async () =>
    finishNew({
      resourceType: 'Patient',
      id: 'worker',
      meta: { versionId: 'other-version' },
      name: [{ text: 'Requested version' }],
    })
  );
  expect(await screen.findByText('Requested version')).toBeInTheDocument();
});

describe('Patient resource details', () => {
  test('keeps non-Army Patient details unchanged', async () => {
    const medplum = new MockClient();
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'Smith', given: ['Alex'] }],
    });

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <MemoryRouter initialEntries={[`/Patient/${patient.id}`]}>
            <Routes>
              <Route path="/:resourceType/:id" element={<ResourceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </MantineProvider>
      </MedplumProvider>
    );

    expect(await screen.findByText('Alex Smith')).toBeInTheDocument();
    expect(screen.queryByText('Army Demographics')).not.toBeInTheDocument();
  });

  test('shows Army demographic extensions on the Details tab', async () => {
    const medplum = new MockClient();
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'Armtest', given: ['Taylor'] }],
      gender: 'female',
      birthDate: '2000-03-04',
      meta: { profile: [`${namespace}/StructureDefinition/hiive-army-demographics-patient`] },
      identifier: [{ system: `${namespace}/identifier/dod-id`, value: '1234567890' }],
      extension: [
        {
          url: `${namespace}/StructureDefinition/military-service`,
          extension: [
            { url: 'affiliation', valueCoding: { code: 'active', display: 'Active Duty' } },
            { url: 'branch', valueCoding: { code: 'army', display: 'Army' } },
            { url: 'grade', valueCoding: { code: 'E-5' } },
          ],
        },
        {
          url: `${namespace}/StructureDefinition/administrative-blood-type`,
          valueCoding: { code: 'A-', display: 'A negative' },
        },
        { url: `${namespace}/StructureDefinition/vip-status`, valueBoolean: false },
      ],
    });

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <MemoryRouter initialEntries={[`/Patient/${patient.id}`]}>
            <Routes>
              <Route path="/:resourceType/:id" element={<ResourceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </MantineProvider>
      </MedplumProvider>
    );

    expect(await screen.findByText('DoD ID')).toBeInTheDocument();
    expect(await screen.findByText('Identifier')).toBeInTheDocument();
    expect(screen.getByText('DoD ID').tagName).toBe('DT');
    expect(screen.getByText('DoD ID').closest('dl')).toBeTruthy();
    const armyRows = screen.getByText('DoD ID').closest('dl') as HTMLElement;
    expect(within(armyRows).getByText('Gender')).toBeInTheDocument();
    expect(within(armyRows).getByText('Female')).toBeInTheDocument();
    expect(within(armyRows).getByText('Age')).toBeInTheDocument();
    expect(within(armyRows).getByText(String(calculateAge('2000-03-04').years))).toBeInTheDocument();
    expect(within(armyRows).getByText('Birthday')).toBeInTheDocument();
    expect(within(armyRows).getByText('3/4/2000')).toBeInTheDocument();
    expect(screen.getByText('DoD ID').closest('dl')?.previousElementSibling?.previousElementSibling?.tagName).toBe(
      'DL'
    );
    expect(screen.getByText('Active Duty')).toBeInTheDocument();
    expect(screen.getByText('Army')).toBeInTheDocument();
    expect(screen.getByText('E-5')).toBeInTheDocument();
    expect(within(armyRows).getByText('A-')).toBeInTheDocument();
    expect(screen.queryByText('A negative')).not.toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument();
    expect(screen.queryByText('******7890')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /(?:Show|Hide) DoD ID/ })).not.toBeInTheDocument();
  });

  test('shows unrecorded Army fields on a Patient with a DoD ID', async () => {
    const medplum = new MockClient();
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      identifier: [{ system: `${namespace}/identifier/dod-id`, value: '1234567890' }],
    });

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <MemoryRouter initialEntries={[`/Patient/${patient.id}`]}>
            <Routes>
              <Route path="/:resourceType/:id" element={<ResourceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </MantineProvider>
      </MedplumProvider>
    );

    expect(await screen.findByText('DoD ID')).toBeInTheDocument();
    const armyRows = screen.getByText('DoD ID').closest('dl') as HTMLElement;
    expect(screen.getByText('Affiliation')).toBeInTheDocument();
    expect(within(armyRows).getByText('Gender')).toBeInTheDocument();
    expect(within(armyRows).getByText('Age')).toBeInTheDocument();
    expect(within(armyRows).getByText('Birthday')).toBeInTheDocument();
    expect(screen.getByText('Branch')).toBeInTheDocument();
    expect(screen.getByText('Grade')).toBeInTheDocument();
    expect(screen.getByText('Blood Type')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded')).toHaveLength(8);
  });
});
