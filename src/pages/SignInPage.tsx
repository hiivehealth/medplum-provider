// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Title } from '@mantine/core';
import { SignInForm } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import HiiveHealthLogo from '../../hiive-website-assets/Hiive Health Logo_Blue.svg';
import { MEDPLUM_CLIENT_ID, MEDPLUM_GOOGLE_CLIENT_ID, MEDPLUM_LOGIN_SCOPE, MEDPLUM_PROJECT_ID } from '../config/constants';

export function SignInPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  return (
    <SignInForm
      googleClientId={MEDPLUM_GOOGLE_CLIENT_ID}
      onSuccess={() => navigate('/')?.catch(console.error)}
      onForgotPassword={() => navigate('/resetpassword')?.catch(console.error)}
      projectId={searchParams.get('project') || MEDPLUM_PROJECT_ID}
      clientId={searchParams.get('client') || MEDPLUM_CLIENT_ID}
      scope={MEDPLUM_LOGIN_SCOPE}
      login={searchParams.get('login') || undefined}
    >
      <img src={HiiveHealthLogo} alt="Hiive Health" style={{ width: 200, marginBottom: 8 }} />
      <Title order={3} py="lg">
        Sign in to Provider
      </Title>
    </SignInForm>
  );
}
