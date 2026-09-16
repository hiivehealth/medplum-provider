import type { MedplumClient } from '@medplum/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import { CuiPolicyProvider, useCuiPolicy } from './CuiPolicyProvider';

const fixture = vi.hoisted(() => ({
  projectId: 'a',
  profile: { resourceType: 'Practitioner', id: 'p' } as { resourceType: string; id: string } | undefined,
  get: vi.fn(),
}));
const medplum = { get: fixture.get, getProject: () => ({ id: fixture.projectId }) } as unknown as MedplumClient;
vi.mock('@medplum/react', () => ({ useMedplum: () => medplum, useMedplumProfile: () => fixture.profile }));

function Probe() {
  const { state, refresh } = useCuiPolicy();
  return (
    <>
      <pre data-testid="state">{JSON.stringify(state)}</pre>
      <button onClick={refresh}>Refresh</button>
    </>
  );
}
const shell = () => (
  <CuiPolicyProvider>
    <Probe />
  </CuiPolicyProvider>
);
const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}');
beforeEach(() => {
  fixture.projectId = 'a';
  fixture.profile = { resourceType: 'Practitioner', id: 'p' };
  fixture.get.mockReset();
});

test('does not fetch before authentication', () => {
  fixture.profile = undefined;
  render(shell());
  expect(state().status).toBe('unauthenticated');
  expect(fixture.get).not.toHaveBeenCalled();
});

test('exposes loaded policy and clears it immediately on logout', async () => {
  fixture.get.mockResolvedValue({ projectId: 'a', enabled: true, canManage: false });
  const view = render(shell());
  await waitFor(() => expect(state().status).toBe('ready'));
  fixture.profile = undefined;
  view.rerender(shell());
  expect(state().status).toBe('unauthenticated');
});

test('project switch never exposes a previous policy or accepts a late response', async () => {
  let finishA!: (value: unknown) => void;
  fixture.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishA = resolve;
      })
  );
  const view = render(shell());
  expect(state()).toEqual({ status: 'loading', projectId: 'a' });
  fixture.projectId = 'b';
  fixture.get.mockResolvedValue({ projectId: 'b', enabled: false, canManage: false });
  view.rerender(shell());
  expect(state()).toEqual({ status: 'loading', projectId: 'b' });
  await waitFor(() => expect(state().policy?.projectId).toBe('b'));
  await act(async () => finishA({ projectId: 'a', enabled: true, canManage: true }));
  expect(state().policy).toEqual({ projectId: 'b', enabled: false, canManage: false });
});

test('refresh failure retains last confirmed value separately from error status', async () => {
  fixture.get.mockResolvedValue({ projectId: 'a', enabled: true, canManage: false });
  render(shell());
  await waitFor(() => expect(state().status).toBe('ready'));
  fixture.get.mockRejectedValue(new Error('Offline'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(state().status).toBe('error'));
  expect(state().lastKnown.enabled).toBe(true);
});
