// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button } from '@mantine/core';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { WithId } from '@medplum/core';
import type { Encounter, Patient, Practitioner, Task } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconStethoscope } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { showErrorNotification } from '../../utils/notifications';

const A01_QUESTIONNAIRE_URL = 'https://ehr.hiivehealth.net/fhir/Questionnaire/a01-sore-throat';
const A01_QUESTIONNAIRE_VERSION = '1.0.0';

export interface AdtmcA01LaunchProps {
  patient: WithId<Patient>;
  encounter: WithId<Encounter>;
  disabled?: boolean;
  onTaskCreated: (task: WithId<Task>) => void;
}

export function AdtmcA01Launch({ patient, encounter, disabled, onTaskCreated }: AdtmcA01LaunchProps): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [creating, setCreating] = useState(false);

  const launchA01 = async (): Promise<void> => {
    setCreating(true);
    try {
      const questionnaire = await medplum.searchOne<'Questionnaire'>('Questionnaire', {
        url: A01_QUESTIONNAIRE_URL,
        version: A01_QUESTIONNAIRE_VERSION,
      });
      if (!questionnaire?.id) {
        throw new Error('The A-01 Sore Throat questionnaire is not published for this project');
      }
      const questionnaireReference = createReference(questionnaire);
      const task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'ready',
        intent: 'order',
        priority: 'routine',
        code: { text: 'ADTMC A-01 Sore Throat/Hoarseness' },
        description: 'Complete the approved A-01 Sore Throat/Hoarseness algorithm.',
        for: createReference(patient),
        encounter: createReference(encounter),
        requester: profile ? createReference(profile as Practitioner) : undefined,
        authoredOn: new Date().toISOString(),
        focus: questionnaireReference,
        input: [
          {
            type: { text: 'Questionnaire' },
            valueReference: questionnaireReference,
          },
        ],
      });
      onTaskCreated(task);
    } catch (error) {
      showErrorNotification(normalizeErrorString(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Button leftSection={<IconStethoscope size={16} />} onClick={launchA01} loading={creating} disabled={disabled}>
      Start A-01 Sore Throat
    </Button>
  );
}