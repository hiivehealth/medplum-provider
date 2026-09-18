import { Alert, Stack } from '@mantine/core';
import { createReference } from '@medplum/core';
import type { Bundle, Patient, Parameters, Questionnaire, QuestionnaireResponse, Resource } from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useState } from 'react';

interface TenantQuestionnaireFormProps {
  questionnaire: Questionnaire;
  patient?: Patient;
  onSubmit: (resource: Resource, response: QuestionnaireResponse) => Promise<void>;
}

export function TenantQuestionnaireForm({ questionnaire, patient, onSubmit }: TenantQuestionnaireFormProps): JSX.Element {
  const medplum = useMedplum();
  const [error, setError] = useState<string>();

  async function handleSubmit(response: QuestionnaireResponse): Promise<void> {
    try {
      const responseWithSubject = patient ? { ...response, subject: createReference(patient) } : response;
      const parameters: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'questionnaire-response', resource: responseWithSubject },
          { name: 'questionnaire', resource: questionnaire },
        ],
      };
      const extracted = (await medplum.post('/fhir/R4/QuestionnaireResponse/$extract', parameters)) as Bundle;
      const extractedPatient = extracted.entry?.map((entry) => entry.resource).find((resource) => resource?.resourceType === 'Patient');
      if (!extractedPatient) {
        throw new Error('The Questionnaire extraction did not produce a Patient resource.');
      }

      await onSubmit(
        patient ? { ...patient, ...extractedPatient, id: patient.id } : extractedPatient,
        responseWithSubject
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <Stack>
      {error && <Alert color="red">{error}</Alert>}
      <QuestionnaireForm
        questionnaire={questionnaire}
        questionnaireResponse={patient ? undefined : undefined}
        subject={patient ? createReference(patient) : undefined}
        onSubmit={handleSubmit}
      />
    </Stack>
  );
}