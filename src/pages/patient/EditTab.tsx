// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Anchor } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { deepClone, normalizeErrorString, normalizeOperationOutcome } from '@medplum/core';
import type { OperationOutcome, Resource } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ResourceFormWithRequiredProfile } from '../../components/ResourceFormWithRequiredProfile';
import { getDefaultProfileUrl } from '../resource/utils';

export function EditTab(): JSX.Element | null {
  const medplum = useMedplum();
  const { patientId } = useParams() as { patientId: string };
  const [value, setValue] = useState<Resource | undefined>();
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<OperationOutcome | undefined>();
  const profileUrl = getDefaultProfileUrl('Patient', medplum.getProject());
  const missingProfileMessage = profileUrl ? (
    <>
      Could not find the required Patient profile{' '}
      <Anchor href={profileUrl} target="_blank">
        {profileUrl}
      </Anchor>
    </>
  ) : undefined;

  useEffect(() => {
    medplum
      .readResource('Patient', patientId)
      .then((resource) => setValue(deepClone(resource)))
      .catch((err) => {
        setOutcome(normalizeOperationOutcome(err));
        showNotification({ color: 'red', message: normalizeErrorString(err), autoClose: false });
      });
  }, [medplum, patientId]);

  const handleSubmit = useCallback(
    (newResource: Resource): void => {
      setOutcome(undefined);
      medplum
        .updateResource(newResource)
        .then(() => {
          navigate(`/Patient/${patientId}/timeline`)?.catch(console.error);
          showNotification({ color: 'green', message: 'Success' });
        })
        .catch((err) => {
          setOutcome(normalizeOperationOutcome(err));
          showNotification({ color: 'red', message: normalizeErrorString(err), autoClose: false });
        });
    },
    [medplum, navigate, patientId]
  );

  if (!value) {
    return null;
  }

  return (
    <Document>
      <ResourceFormWithRequiredProfile
        missingProfileMessage={missingProfileMessage}
        defaultValue={value}
        onSubmit={handleSubmit}
        outcome={outcome}
        profileUrl={profileUrl}
      />
    </Document>
  );
}
