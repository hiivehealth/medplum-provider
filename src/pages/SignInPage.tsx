// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Title } from '@mantine/core';
import { Logo, SignInForm } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { SystemUseNoticeGate } from '../components/SystemUseNoticeGate';
import { getRuntimeConfig } from '../config/runtime';

export function SignInPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const clientId = getRuntimeConfig().medplumClientId || import.meta.env.MEDPLUM_CLIENT_ID;
  const projectId = searchParams.get('project') || import.meta.env.MEDPLUM_PROJECT_ID || undefined;

  return (
    <SystemUseNoticeGate clientId={clientId} projectId={projectId}>
      <SignInForm
        // Configure according to your settings
        googleClientId={import.meta.env.GOOGLE_CLIENT_ID}
        clientId={clientId}
        onSuccess={() => navigate('/')?.catch(console.error)}
        onRegister={
          import.meta.env.MEDPLUM_REGISTER_ENABLED === 'true'
            ? () => navigate('/register')?.catch(console.error)
            : undefined
        }
        projectId={projectId}
        login={searchParams.get('login') || undefined}
      >
        <Logo size={32} />
        <Title order={3} py="lg">
          Sign in to Provider
        </Title>
      </SignInForm>
    </SystemUseNoticeGate>
  );
}
