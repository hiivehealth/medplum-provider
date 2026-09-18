import { Alert, Stack } from '@mantine/core';
import type { Patient, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ComputedQuestionnaireField } from './ComputedQuestionnaireField';
import {
  applyArmyDemographicsResponse,
  questionnaireResponseForPatient,
  validateArmyDemographicsResponse,
} from '../utils/army-demographics';

interface ArmyDemographicsQuestionnaireFormProps {
  questionnaire: Questionnaire;
  patient?: Patient;
  onSubmit: (patient: Patient, response: QuestionnaireResponse) => Promise<void>;
}

export function ArmyDemographicsQuestionnaireForm({
  questionnaire,
  patient,
  onSubmit,
}: ArmyDemographicsQuestionnaireFormProps): JSX.Element {
  const [response, setResponse] = useState<QuestionnaireResponse>();
  const [error, setError] = useState<string>();
  const [initialResponse, setInitialResponse] = useState<QuestionnaireResponse>();

  useEffect(() => {
    setInitialResponse(patient ? questionnaireResponseForPatient(questionnaire.url, patient) : undefined);
  }, [patient, questionnaire]);

  return (
    <Stack>
      {error && <Alert color="red">{error}</Alert>}
      <QuestionnaireForm
        questionnaire={questionnaire}
        questionnaireResponse={initialResponse}
        subject={patient ? { reference: `Patient/${patient.id}` } : undefined}
        onChange={setResponse}
        onSubmit={async (completedResponse) => {
          const validationErrors = validateArmyDemographicsResponse(completedResponse);
          if (validationErrors.length > 0) {
            setError(validationErrors.join('\n'));
            return;
          }
          setError(undefined);
          const nextPatient = applyArmyDemographicsResponse(patient ?? { resourceType: 'Patient' }, completedResponse);
          await onSubmit(nextPatient, completedResponse);
        }}
        afterHeader={
          <ComputedQuestionnaireField
            label="Age"
            response={response}
            watchLinkIds={['date-of-birth']}
            compute={(answers) => {
              const birthDate = answers['date-of-birth']?.[0]?.valueDate;
              if (!birthDate) return undefined;
              const birth = new Date(`${birthDate}T00:00:00`);
              const today = new Date();
              let age = today.getFullYear() - birth.getFullYear();
              const month = today.getMonth() - birth.getMonth();
              if (month < 0 || (month === 0 && today.getDate() < birth.getDate())) age--;
              return age >= 0 ? age : undefined;
            }}
            format={(age) => `${age}`}
          />
        }
      />
    </Stack>
  );
}
