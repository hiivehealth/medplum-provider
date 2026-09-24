// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react';
import '@medplum/react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { App } from './App';
import { MEDPLUM_BASE_URL, MEDPLUM_CLIENT_ID, MEDPLUM_PROJECT_ID } from './config/constants';

const PROJECT_ID_STORAGE_KEY = 'medplum_project_id';
const CLIENT_ID_STORAGE_KEY = 'medplum_client_id';
const loginParameters = new URLSearchParams(window.location.search);
const queryProjectId = loginParameters.get('project');
const queryClientId = loginParameters.get('client');

if (queryProjectId) {
  sessionStorage.setItem(PROJECT_ID_STORAGE_KEY, queryProjectId);
}
if (queryClientId) {
  sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, queryClientId);
}

const projectId = sessionStorage.getItem(PROJECT_ID_STORAGE_KEY) || MEDPLUM_PROJECT_ID;
const clientId = sessionStorage.getItem(CLIENT_ID_STORAGE_KEY) || MEDPLUM_CLIENT_ID;

function signInUrl(): string {
  const parameters = new URLSearchParams({ project: projectId, client: clientId });
  return `/signin?${parameters.toString()}`;
}

const medplum = new MedplumClient({
  onUnauthenticated: () => (window.location.href = signInUrl()),
  baseUrl: sessionStorage.getItem('medplum_base_url') || MEDPLUM_BASE_URL,
  clientId,
  cacheTime: 60000,
  autoBatchTime: 100,
});

const theme = createTheme({
  headings: {
    sizes: {
      h1: {
        fontSize: '1.125rem',
        fontWeight: '500',
        lineHeight: '2.0',
      },
    },
  },
  fontSizes: {
    xs: '0.6875rem',
    sm: '0.875rem',
    md: '0.875rem',
    lg: '1.0rem',
    xl: '1.125rem',
  },
});

const router = createBrowserRouter([{ path: '*', element: <App /> }]);

const navigate = (path: string): Promise<void> => router.navigate(path);

const container = document.getElementById('root') as HTMLDivElement;
const root = createRoot(container);
root.render(
  <StrictMode>
    <MedplumProvider medplum={medplum} navigate={navigate}>
      <MantineProvider theme={theme}>
        <Notifications position="bottom-right" />
        <RouterProvider router={router} />
      </MantineProvider>
    </MedplumProvider>
  </StrictMode>
);
