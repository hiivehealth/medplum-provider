import { Alert, Stack } from '@mantine/core';
import { createReference } from '@medplum/core';
import type { Bundle, Patient, Parameters, Questionnaire, QuestionnaireResponse, Resource } from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useState } from 'react';
import { removeEmptyAnswers, validateQuestionnaireResponse } from '../utils/questionnaire-validation';

interface TenantQuestionnaireFormProps {
  questionnaire: Questionnaire;
  patient?: Patient;
  onSubmit: (resource: Resource, response: QuestionnaireResponse) => Promise<void>;
}

export function TenantQuestionnaireForm({ questionnaire, patient, onSubmit }: TenantQuestionnaireFormProps): JSX.Element {
  const medplum = useMedplum();
  const [error, setError] = useState<string>();
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  async function handleSubmit(response: QuestionnaireResponse): Promise<void> {
    const cleanedResponse = removeEmptyAnswers(response);
    const errors = validateQuestionnaireResponse(questionnaire, cleanedResponse);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    try {
      const responseWithSubject = patient ? { ...cleanedResponse, subject: createReference(patient) } : cleanedResponse;
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
      {validationErrors.length > 0 && <Alert color="red">{validationErrors.join('\n')}</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      <QuestionnaireForm
        questionnaire={questionnaire}
        questionnaireResponse={patient ? undefined : undefined}
        subject={patient ? createReference(patient) : undefined}
        onChange={(nextResponse) => setValidationErrors(validateQuestionnaireResponse(questionnaire, removeEmptyAnswers(nextResponse)))}
        onSubmit={handleSubmit}
      />
    </Stack>
  );
}