import { indexStructureDefinitionBundle } from '@medplum/core';
import type { Bundle, Project, StructureDefinition } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import profiles from '../../../config/cui/profiles.json';
import { CUI_ENABLED_URL } from '../../cui/policy';
import { render, screen, userEvent, waitFor } from '../../test-utils/render';
import { CuiPolicyPage } from './CuiPolicyPage';

const fixture = vi.hoisted(() => ({ canManage: true, refresh: vi.fn() }));
vi.mock('../../cui/CuiPolicyProvider', () => ({
  useCuiPolicy: () => ({
    state: { status: 'ready', policy: { projectId: 'p1', enabled: false, canManage: fixture.canManage } },
    refresh: fixture.refresh,
  }),
}));

async function setup(enabled: boolean | null = false) {
  const medplum = new MockClient();
  await medplum.createResource<Project>({
    resourceType: 'Project',
    id: 'p1',
    name: 'Clinic',
    extension: enabled === null ? undefined : [{ url: CUI_ENABLED_URL, valueBoolean: enabled }],
  });
  vi.spyOn(medplum, 'requestProfileSchema').mockImplementation(async () => {
    indexStructureDefinitionBundle(profiles as unknown as Bundle<StructureDefinition>);
  });
  const read = vi.spyOn(medplum, 'readResource');
  const update = vi.spyOn(medplum, 'updateResource');
  render(
    <MemoryRouter>
      <MedplumProvider medplum={medplum}>
        <CuiPolicyPage />
      </MedplumProvider>
    </MemoryRouter>
  );
  return { medplum, read, update };
}

beforeEach(() => {
  fixture.canManage = true;
  fixture.refresh.mockReset();
});

test('unauthorized member never reads protected Project or sees editor', async () => {
  fixture.canManage = false;
  const { read } = await setup();
  expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  expect(read).not.toHaveBeenCalledWith('Project', 'p1', expect.anything());
  expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
});

test.each([false, true])(
  'profile renders CUI boolean and toggles from %s with optimistic concurrency',
  async (enabled) => {
    const { update } = await setup(enabled);
    await screen.findByTestId('slice-cuiBannerEnabled');
    const checkbox = within(await screen.findByTestId('slice-cuiBannerEnabled')).getByRole('checkbox');
    expect((checkbox as HTMLInputElement).checked).toBe(enabled);
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const [resource, options] = update.mock.calls[0];
    expect((resource as Project).extension).toContainEqual({ url: CUI_ENABLED_URL, valueBoolean: !enabled });
    expect(options?.headers).toEqual(expect.objectContaining({ 'If-Match': expect.stringMatching(/^W\/".+"$/) }));
    expect(await screen.findByText('Project configuration saved.')).toBeInTheDocument();
  }
);

test('an absent policy renders an unchecked toggle without writing a default', async () => {
  const { update } = await setup(null);
  const checkbox = within(await screen.findByTestId('slice-cuiBannerEnabled')).getByRole('checkbox');
  expect(checkbox).not.toBeChecked();
  expect(update).not.toHaveBeenCalled();
});
