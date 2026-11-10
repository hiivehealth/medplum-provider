// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Loader, Modal, Paper, ScrollArea, Text } from '@mantine/core';
import { getReferenceString, isOk } from '@medplum/core';
import type { OperationOutcome } from '@medplum/fhirtypes';
import {
  createPharmaciesSection,
  DemographicsSection,
  Document,
  getDefaultSections,
  LinkTabs,
  OperationOutcomeAlert,
  PatientSummary,
  useMedplum,
} from '@medplum/react';
import type { ComponentProps, JSX } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { usePharmacyDialog } from '../../components/pharmacy/usePharmacyDialog';
import { useDoseSpotAccess } from '../../hooks/useDoseSpotAccess';
import { usePatient } from '../../hooks/usePatient';
import { OrderLabsPage } from '../labs/OrderLabsPage';
import { armyDemographicsSection, isArmyDemographicsPatient } from './ArmyDemographicsSection';
import classes from './PatientPage.module.css';
import { getPatientPageTabs, patientPathPrefix } from './PatientPage.utils';
import { redRoverChiefComplaintsSection } from './RedRoverChiefComplaintsSection';
import { redRoverConditionsSection } from './RedRoverConditionsSection';
import { redRoverMedicationOrdersSection } from './RedRoverMedicationOrdersSection';

function RedRoverDemographics(props: ComponentProps<typeof DemographicsSection.component>): JSX.Element {
  const NativeDemographics = DemographicsSection.component;
  const identifiers = props.patient.identifier?.filter((identifier) =>
    identifier.system?.startsWith('https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/identifiers/mrn/pool/')
  );
  return (
    <>
      <NativeDemographics {...props} />
      {identifiers?.map((identifier) => (
        <Text fz="sm" py={4} key={`${identifier.system}|${identifier.value}`}>
          MRN: {identifier.value}
        </Text>
      ))}
    </>
  );
}

export function PatientPage(): JSX.Element {
  const navigate = useNavigate();
  const medplum = useMedplum();
  const membership = medplum.getProjectMembership();
  const [outcome, setOutcome] = useState<OperationOutcome>();
  const patient = usePatient({ setOutcome });
  const [isLabsModalOpen, setIsLabsModalOpen] = useState(false);
  const PharmacyDialogComponent = usePharmacyDialog();
  const { hasAccess: hasDoseSpotAccess } = useDoseSpotAccess();
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

  const redRoverTestPatient =
    patient?.meta?.project === '8588313a-c8c6-4e07-8c1d-e684ed25e522' &&
    patient.identifier?.some(
      (identifier) =>
        identifier.system === 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/patient' &&
        ['19128435', '19128437', '19128439', '19128441', '19128443'].includes(identifier.value ?? '')
    );
  const sections = useMemo(() => {
    const defaults = getDefaultSections(() => setIsLabsModalOpen(true))
      .filter((section) => !redRoverTestPatient || ['demographics', 'allergies', 'problemList'].includes(section.key))
      .map((s) => {
        if (redRoverTestPatient && s.key === 'demographics') {
          return { ...s, component: RedRoverDemographics };
        }
        if (s.key === 'pharmacies') {
          return createPharmaciesSection(PharmacyDialogComponent);
        }
        return s.key === redRoverConditionsSection.key ? redRoverConditionsSection : s;
      });
    if (redRoverTestPatient) {
      defaults.push(redRoverMedicationOrdersSection, redRoverChiefComplaintsSection);
    }
    if (patient && isArmyDemographicsPatient(patient)) {
      const demographicsIndex = defaults.findIndex((section) => section.key === 'demographics');
      defaults.splice(demographicsIndex, 1, armyDemographicsSection);
    }
    return defaults;
  }, [PharmacyDialogComponent, patient, redRoverTestPatient]);

  if (outcome && !isOk(outcome)) {
    return (
      <Document>
        <OperationOutcomeAlert outcome={outcome} />
      </Document>
    );
  }

  const patientId = patient?.id;
  if (!patientId) {
    return (
      <Document>
        <Loader />
      </Document>
    );
  }

  return (
    <>
      <div
        key={getReferenceString(patient)}
        className={`${classes.container}${redRoverTestPatient ? ` ${classes.redRoverReview}` : ''}`}
      >
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
            <Outlet />
          </div>
        </div>
      </div>
      <Modal opened={isLabsModalOpen} onClose={handleCloseLabsModal} size="xl" centered title="Order Labs">
        <OrderLabsPage onSubmitLabOrder={handleCloseLabsModal} />
      </Modal>
    </>
  );
}
