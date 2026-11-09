import type { Basic, Resource } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CUI_ENABLED_URL } from '../../../features/cui/policy';
import { render, screen, userEvent, waitFor } from '../../../test-utils/render';
import { CuiPolicyPage } from '../CuiPolicyPage';

const fixture = vi.hoisted(() => ({ canManage: true, refresh: vi.fn() }));
vi.mock('../../../features/cui/CuiPolicyProvider', () => ({
  useCuiPolicy: () => ({
    state: {
      status: 'ready',
      policy: { projectId: 'p1', configurationId: 'c1', enabled: false, canManage: fixture.canManage },
    },
    refresh: fixture.refresh,
  }),
}));

vi.mock('../../../components/ResourceFormWithRequiredProfile', async () => {
  const React = await import('react');
  return {
    ResourceFormWithRequiredProfile: ({
      defaultValue,
      onSubmit,
    }: {
      defaultValue: Basic;
      onSubmit: (resource: Resource) => void;
    }) => {
      const [resource, setResource] = React.useState(defaultValue);
      const enabled = resource.extension?.find((extension) => extension.url === CUI_ENABLED_URL)?.valueBoolean === true;
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(resource);
          }}
        >
          <label data-testid="slice-cuiBannerEnabled">
            Show CUI banner
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) =>
                setResource({
                  ...resource,
                  extension: [{ url: CUI_ENABLED_URL, valueBoolean: event.currentTarget.checked }],
                })
              }
            />
          </label>
          <button type="submit">Update</button>
        </form>
      );
    },
  };
});

async function setup(enabled: boolean | null = false) {
  const medplum = new MockClient();
  await medplum.createResource<Basic>({
    resourceType: 'Basic',
    id: 'c1',
    meta: { project: 'p1' },
    code: { text: 'CUI configuration' },
    extension: enabled === null ? undefined : [{ url: CUI_ENABLED_URL, valueBoolean: enabled }],
  });
  const read = vi.spyOn(medplum, 'readResource');
  const update = vi.spyOn(medplum, 'updateResource');
  const view = render(
    <MemoryRouter>
      <MedplumProvider medplum={medplum}>
        <CuiPolicyPage />
      </MedplumProvider>
    </MemoryRouter>
  );
  return { medplum, read, update, ...view };
}

beforeEach(() => {
  fixture.canManage = true;
  fixture.refresh.mockReset();
});

test('unauthorized member never reads protected configuration or sees editor', async () => {
  fixture.canManage = false;
  const { read } = await setup();
  expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  expect(read).not.toHaveBeenCalledWith('Basic', 'c1', expect.anything());
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
    expect((resource as Basic).extension).toContainEqual({ url: CUI_ENABLED_URL, valueBoolean: !enabled });
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

test('ignores duplicate submissions and save completion after leaving the editor', async () => {
  const { update, unmount } = await setup();
  let finish!: (resource: Basic & { id: string }) => void;
  update.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const button = await screen.findByRole('button', { name: 'Update' });
  await userEvent.click(button);
  await userEvent.click(button);
  expect(update).toHaveBeenCalledTimes(1);
  const resource = update.mock.calls[0][0] as Basic & { id: string };
  unmount();
  finish(resource);
  await Promise.resolve();
  expect(fixture.refresh).not.toHaveBeenCalled();
});
