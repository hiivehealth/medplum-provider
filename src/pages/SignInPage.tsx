// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Title } from '@mantine/core';
import { SignInForm } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { MEDPLUM_CLIENT_ID, MEDPLUM_GOOGLE_CLIENT_ID, MEDPLUM_LOGIN_SCOPE, MEDPLUM_PROJECT_ID } from '../config/constants';

const PROJECT_ID_STORAGE_KEY = 'medplum_project_id';
const CLIENT_ID_STORAGE_KEY = 'medplum_client_id';

export function SignInPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project') || sessionStorage.getItem(PROJECT_ID_STORAGE_KEY) || MEDPLUM_PROJECT_ID;
  const clientId = searchParams.get('client') || sessionStorage.getItem(CLIENT_ID_STORAGE_KEY) || MEDPLUM_CLIENT_ID;
  return (
    <SignInForm
      googleClientId={MEDPLUM_GOOGLE_CLIENT_ID}
      onSuccess={() => navigate('/')?.catch(console.error)}
      projectId={projectId}
      clientId={clientId}
      scope={MEDPLUM_LOGIN_SCOPE}
      login={searchParams.get('login') || undefined}
    >
      <Title order={3} py="lg">
        Sign in to Provider
      </Title>
    </SignInForm>
  );
}
