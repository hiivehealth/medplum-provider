// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Loader, Stack } from '@mantine/core';
import type { JSX } from 'react';
import { useParams } from 'react-router';
import { CcdaExportCard } from '../../components/ccda/CcdaExportCard';
import { PatientTimelineWithCcda } from '../../components/timeline/PatientTimelineWithCcda';
import { usePatient } from '../../hooks/usePatient';

export function TimelineTab(): JSX.Element {
  const { patientId } = useParams();
  const patient = usePatient();

  if (!patient) {
    return <Loader />;
  }

  return (
    <Stack gap="md">
      <CcdaExportCard patientId={patientId ?? patient.id ?? ''} />
      <PatientTimelineWithCcda patient={patient} />
    </Stack>
  );
}
