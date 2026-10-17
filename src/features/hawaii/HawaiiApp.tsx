import { Text } from '@mantine/core';
import { AppShell, useMedplum, useMedplumProfile } from '@medplum/react';
import { IconBuildingHospital, IconClipboardCheck, IconListCheck, IconUsers } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { CuiBanner } from '../../components/CuiBanner/CuiBanner';
import { SignInPage } from '../../pages/SignInPage';
import { useCuiPolicy } from '../cui/CuiPolicyProvider';
import { HawaiiAuditPage, HawaiiDiscoveryPage, HawaiiPatientPage } from './HawaiiWorkspace';
import { HawaiiFollowUpPage } from './HawaiiFollowUpPage';
import { HawaiiOnboardingPage } from './HawaiiOnboardingPage';

export function HawaiiApp(): JSX.Element | null {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { state } = useCuiPolicy();
  const cuiEnabled = state.status === 'ready' ? state.policy.enabled : state.status === 'error' && state.lastKnown?.enabled;
  if (medplum.isLoading()) {
    return null;
  }
  return <AppShell logo={<Text fw={700} size="sm" style={{ whiteSpace: 'nowrap' }}>Hiive</Text>}
    pathname={location.pathname} searchParams={searchParams} layoutVersion="v2" showLayoutVersionToggle={false}
    menus={profile ? [{ links: [
      { icon: <IconUsers />, label: 'Patient Discovery', href: '/hie' },
      { icon: <IconListCheck />, label: 'Follow-up Work', href: '/hie/follow-up' },
      { icon: <IconClipboardCheck />, label: 'Access Activity', href: '/hie/audit' },
      { icon: <IconBuildingHospital />, label: 'Participant Operations', href: '/hie/operations' },
    ] }] : undefined} resourceTypeSearchDisabled spotlightPatientsOnly spotlightActions={[]}>
    {profile && cuiEnabled && <CuiBanner />}
    <Routes>{profile ? <>
      <Route path="/hie" element={<HawaiiDiscoveryPage />} />
      <Route path="/hie/follow-up" element={<HawaiiFollowUpPage />} />
      <Route path="/hie/patients/:patientId" element={<HawaiiPatientPage />} />
      <Route path="/hie/audit" element={<HawaiiAuditPage />} />
      <Route path="/hie/operations" element={<HawaiiOnboardingPage />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="*" element={<Navigate to="/hie" replace />} />
    </> : <>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="*" element={<Navigate to="/signin" replace />} />
    </>}</Routes>
  </AppShell>;
}