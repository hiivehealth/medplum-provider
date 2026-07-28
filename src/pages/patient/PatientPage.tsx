// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Loader, Modal, Paper, ScrollArea, Text } from '@mantine/core';
import { getReferenceString, isOk } from '@medplum/core';
import type { OperationOutcome, Practitioner } from '@medplum/fhirtypes';
import {
  createPharmaciesSection,
  Document,
  getDefaultSections,
  LinkTabs,
  OperationOutcomeAlert,
  PatientSummary,
  useMedplum,
  useMedplumProfile,
} from '@medplum/react';
import type { PatientSummarySectionConfig } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { ConsentBanner } from '../../components/consent/ConsentBanner';
import { PatientIdentifiersPanel } from '../../components/patient/PatientIdentifiersPanel';
import { usePharmacyDialog } from '../../components/pharmacy/usePharmacyDialog';
import { useDoseSpotAccess } from '../../hooks/useDoseSpotAccess';
import { usePatient } from '../../hooks/usePatient';
import { isNevadaDemoPatient, usePatientConsent } from '../../hooks/usePatientConsent';
import { useBreakGlassRecorded } from '../../hooks/useBreakGlassRecorded';
import { isPayerRosterMember } from '../../utils/roster';
import { OrderLabsPage } from '../labs/OrderLabsPage';
import classes from './PatientPage.module.css';
import { getPatientPageTabs, patientPathPrefix } from './PatientPage.utils';

export function PatientPage(): JSX.Element {
  const navigate = useNavigate();
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const membership = medplum.getProjectMembership();
  const [outcome, setOutcome] = useState<OperationOutcome>();
  const patient = usePatient({ setOutcome });
  const [isLabsModalOpen, setIsLabsModalOpen] = useState(false);
  const PharmacyDialogComponent = usePharmacyDialog();
  const { hasAccess: hasDoseSpotAccess } = useDoseSpotAccess();
  const patientId = patient?.id;
  const isDemoPatient = patient ? isNevadaDemoPatient(patient) : false;
  const { status: consentStatus } = usePatientConsent(patientId);
  const { recorded: breakGlassRecorded, refresh: refreshBreakGlass } = useBreakGlassRecorded(patientId);
  const chartHidden = isDemoPatient && consentStatus === 'not-declared' && !breakGlassRecorded;
  const tabs = getPatientPageTabs(membership, { hasDoseSpotAccess });
  const resolvedTabs = useMemo(
    () =>
      tabs.map((t) => ({
        label: t.label,
        value: (t.url ? t.url.replace('%patient.id', patient?.id ?? '') : t.id) || t.id,
      })),
    [patient?.id, tabs]
  );

  const handleCloseLabsModal = useCallback(() => {
    setIsLabsModalOpen(false);
  }, []);

  const identifiersSection: PatientSummarySectionConfig = useMemo(
    () => ({
      key: 'identifiers',
      title: 'Identifiers',
      component: PatientIdentifiersPanel,
    }),
    []
  );

  const isPayerUser = isPayerRosterMember(membership, profile as Practitioner | undefined);

  const sections = useMemo(
    () => {
      const defaults = getDefaultSections(() => setIsLabsModalOpen(true)).map((s) =>
        s.key === 'pharmacies' ? createPharmaciesSection(PharmacyDialogComponent) : s
      );
      // Insert the identifiers section right after demographics for Nevada demo patients.
      if (patient && isNevadaDemoPatient(patient)) {
        const demographicsIndex = defaults.findIndex((s) => s.key === 'demographics');
        const insertIndex = demographicsIndex >= 0 ? demographicsIndex + 1 : 0;
        defaults.splice(insertIndex, 0, identifiersSection);
      }
      // Payer roster users are limited to a subset of clinical resources, so hide
      // sections that search resources their AccessPolicy does not allow.
      if (isPayerUser) {
        const allowedPayerSections = new Set([
          'demographics',
          'identifiers',
          'problemList',
          'medications',
          'sexualOrientation',
          'smokingStatus',
          'vitals',
          'pharmacies',
        ]);
        return defaults.filter((s) => allowedPayerSections.has(s.key));
      }
      return defaults;
    },
    [setIsLabsModalOpen, PharmacyDialogComponent, identifiersSection, patient, isPayerUser]
  );

  if (outcome && !isOk(outcome)) {
    return (
      <Document>
        <OperationOutcomeAlert outcome={outcome} />
      </Document>
    );
  }

  if (!patientId) {
    return (
      <Document>
        <Loader />
      </Document>
    );
  }

  return (
    <>
      <div key={getReferenceString(patient)} className={classes.container}>
        <div className={classes.sidebar}>
          <ScrollArea className={classes.scrollArea}>
            <PatientSummary
              patient={patient}
              onClickResource={(resource) =>
                navigate(`/Patient/${patientId}/${resource.resourceType}/${resource.id}`)?.catch(console.error)
              }
              sections={sections}
            />
          </ScrollArea>
        </div>

        <div className={classes.content}>
          {isDemoPatient && <ConsentBanner patientId={patientId} onBreakGlassRecorded={refreshBreakGlass} />}
          <Paper w="100%" radius={0} style={{ borderBottom: '1px solid var(--app-shell-border-color)' }}>
            <ScrollArea>
              <LinkTabs
                baseUrl={patientPathPrefix(patientId)}
                tabs={resolvedTabs}
                variant="unstyled"
                className="pill-tabs"
                p="sm"
              />
            </ScrollArea>
          </Paper>
          <div className={classes.contentBody}>
            {chartHidden ? (
              <div className={classes.hiddenChart}>
                <Text fw={700} size="lg">
                  Clinical chart hidden
                </Text>
                <Text c="dimmed" size="sm">
                  This patient has not made a consent choice. Click Break the glass in the banner above to document
                  access.
                </Text>
              </div>
            ) : (
              <Outlet />
            )}
          </div>
        </div>
      </div>
      <Modal opened={isLabsModalOpen} onClose={handleCloseLabsModal} size="xl" centered title="Order Labs">
        <OrderLabsPage onSubmitLabOrder={handleCloseLabsModal} />
      </Modal>
    </>
  );
}
