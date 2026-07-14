// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Card, LoadingOverlay, Stack, Title } from '@mantine/core';
import type { Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback } from 'react';

export interface SoapSectionCardProps {
  title: string;
  questionnaire: Questionnaire | undefined;
  questionnaireResponse: QuestionnaireResponse | undefined;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onChange: (response: QuestionnaireResponse) => void;
}

export function SoapSectionCard(props: SoapSectionCardProps): JSX.Element {
  const { title, questionnaire, questionnaireResponse, loading, error, disabled, onChange } = props;

  const handleChange = useCallback(
    (response: QuestionnaireResponse): void => {
      if (disabled) {
        return;
      }
      onChange(response);
    },
    [disabled, onChange]
  );

  return (
    <Card withBorder shadow="sm" mt="md" pos="relative">
      <LoadingOverlay visible={loading ?? false} overlayProps={{ radius: 'sm', blur: 2 }} />
      <Stack gap="sm">
        <Title order={3}>{title}</Title>
        {error && (
          <Alert color="red" title="Unable to load section">
            {error}
          </Alert>
        )}
        {questionnaire && !error && (
          <QuestionnaireForm
            questionnaire={questionnaire}
            questionnaireResponse={questionnaireResponse}
            excludeButtons={true}
            onChange={handleChange}
          />
        )}
        {!questionnaire && !loading && !error && (
          <Alert color="yellow" title="Questionnaire not available">
            This SOAP section has not been configured yet.
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
