// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { DrAliceSmith, HomerSimpson, MockClient } from '@medplum/mock';
import type * as MedplumReactModule from '@medplum/react';
import { MedplumProvider } from '@medplum/react';
import { within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { Link, MemoryRouter, Outlet } from 'react-router';
import { App } from '../App';
import cuiShellClasses from '../features/cui/CuiAppShell.module.css';
import type { UserEvent } from '../test-utils/render';
import { render, screen, userEvent } from '../test-utils/render';

const fixture = vi.hoisted(() => ({
  refresh: vi.fn(),
  state: {
    status: 'ready',
    policy: {
      projectId: 'project-1',
      enabled: true,
      canManage: false,
      configurationId: 'cui-configuration',
    },
  },
}));

vi.mock('../features/cui/CuiPolicyProvider', () => ({
  CuiPolicyProvider: ({ children }: { children: ReactNode }) => children,
  useCuiPolicy: () => ({ state: fixture.state, refresh: fixture.refresh }),
}));

vi.mock('@medplum/react', async (importOriginal) => {
  const actual = await importOriginal<typeof MedplumReactModule>();
  return {
    ...actual,
    AppShell: ({ children }: { children: ReactNode }) => <main data-testid="provider-app-shell">{children}</main>,
    Logo: () => <span>Provider logo</span>,
  };
});

vi.mock('../pages/getstarted/GetStartedPage', () => ({
  GetStartedPage: () => <div>Provider dashboard</div>,
}));

vi.mock('../pages/patient/PatientPage', () => ({
  PatientPage: () => (
    <div>
      Patient chart
      <Outlet />
    </div>
  ),
}));

vi.mock('../pages/patient/TimelineTab', () => ({
  TimelineTab: () => <div>Patient timeline</div>,
}));

vi.mock('../pages/resource/ResourcePage', () => ({
  ResourcePage: () => <Outlet />,
}));

vi.mock('../pages/resource/ResourceDetailPage', () => ({
  ResourceDetailPage: () => <div>Resource error</div>,
}));

vi.mock('../pages/settings/CuiPolicyPage', () => ({
  CuiPolicyPage: () => <div>Security settings</div>,
}));

vi.mock('../pages/SignInPage', () => ({
  SignInPage: () => <div>Provider sign in</div>,
}));

function RouteControls(): JSX.Element {
  return (
    <nav aria-label="Test routes">
      <Link to="/getstarted">Dashboard route</Link>
      <Link to={`/Patient/${HomerSimpson.id}`}>Chart route</Link>
      <Link to="/Practitioner/missing">Resource route</Link>
      <Link to="/Settings/Security">Settings route</Link>
    </nav>
  );
}

function setup(path: string, authenticated = true): UserEvent {
  const medplum = new MockClient({ profile: authenticated ? DrAliceSmith : null });
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <RouteControls />
      <MedplumProvider medplum={medplum}>
        <App />
      </MedplumProvider>
    </MemoryRouter>
  );
  return user;
}

beforeEach(() => {
  fixture.refresh.mockReset();
  fixture.state = {
    status: 'ready',
    policy: {
      projectId: 'project-1',
      enabled: true,
      canManage: false,
      configurationId: 'cui-configuration',
    },
  };
});

test.each([
  ['/getstarted', 'Provider dashboard'],
  [`/Patient/${HomerSimpson.id}`, 'Patient chart'],
])('shows CUI inside the authenticated provider shell at %s', (path, routeContent) => {
  setup(path);

  const shell = screen.getByTestId('provider-app-shell');
  const banner = within(shell).getByRole('complementary', { name: 'CUI' });
  expect(banner.parentElement).toHaveClass(cuiShellClasses.banner);
  expect(banner).toBeVisible();
  expect(within(shell).getByText(routeContent)).toBeVisible();
});

test('does not show CUI when the project policy is disabled', () => {
  fixture.state.policy.enabled = false;
  setup('/getstarted');

  expect(screen.getByText('Provider dashboard')).toBeVisible();
  expect(screen.queryByRole('complementary', { name: 'CUI' })).not.toBeInTheDocument();
});

test('blocks authenticated Provider content when the CUI policy is unavailable', async () => {
  fixture.state = {
    status: 'error',
    projectId: 'project-1',
    error: 'Offline',
  } as unknown as typeof fixture.state;
  setup('/getstarted');

  expect(screen.getByRole('heading', { name: 'Security configuration unavailable' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(fixture.refresh).toHaveBeenCalledOnce();
  expect(screen.queryByTestId('provider-app-shell')).not.toBeInTheDocument();
  expect(screen.queryByText('Provider dashboard')).not.toBeInTheDocument();
});

test('blocks authenticated Provider content while the CUI policy is loading', () => {
  fixture.state = { status: 'loading', projectId: 'project-1' } as unknown as typeof fixture.state;
  setup('/getstarted');

  expect(screen.getByText('Loading security configuration')).toBeVisible();
  expect(screen.queryByTestId('provider-app-shell')).not.toBeInTheDocument();
  expect(screen.queryByText('Provider dashboard')).not.toBeInTheDocument();
});

test('does not show CUI on the sign-in route even when an authenticated profile and enabled policy are loaded', () => {
  setup('/signin');

  expect(screen.getByText('Provider sign in')).toBeVisible();
  expect(screen.queryByRole('complementary', { name: 'CUI' })).not.toBeInTheDocument();
});

test('preserves the unauthenticated redirect to sign in without showing CUI', async () => {
  setup(`/Patient/${HomerSimpson.id}`, false);

  expect(await screen.findByText('Provider sign in')).toBeVisible();
  expect(screen.queryByRole('complementary', { name: 'CUI' })).not.toBeInTheDocument();
});

test('keeps the same CUI banner mounted across authenticated route changes', async () => {
  const user = setup('/getstarted');
  const banner = screen.getByRole('complementary', { name: 'CUI' });

  for (const [link, content] of [
    ['Chart route', 'Patient chart'],
    ['Resource route', 'Resource error'],
    ['Settings route', 'Security settings'],
    ['Dashboard route', 'Provider dashboard'],
  ]) {
    await user.click(screen.getByRole('link', { name: link }));
    expect(await screen.findByText(content)).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'CUI' })).toBe(banner);
  }
});
