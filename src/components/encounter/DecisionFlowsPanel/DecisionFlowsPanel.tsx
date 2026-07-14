// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Card, Select, Stack, Title } from '@mantine/core';
import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm } from '@medplum/react';
import type { JSX } from 'react';
import { DECISION_FLOWS } from '../../../data/decision-flows';
import type { UseDecisionFlowsResult } from '../../../hooks/useDecisionFlows';

export interface DecisionFlowsPanelProps {
  decisionFlows: UseDecisionFlowsResult;
  disabled?: boolean;
}

export function DecisionFlowsPanel(props: DecisionFlowsPanelProps): JSX.Element {
  const { decisionFlows, disabled } = props;
  const { flows, selectedFlowUrl, setSelectedFlowUrl, saveResponse } = decisionFlows;

  const options = [
    { value: '', label: 'Select a decision flow...' },
    ...DECISION_FLOWS.map((flow) => ({ value: flow.url, label: flow.title })),
  ];

  const selectedState = selectedFlowUrl ? flows.get(selectedFlowUrl) : undefined;

  return (
    <Card withBorder shadow="sm" mt="md">
      <Stack gap="sm">
        <Title order={3}>Clinical Decision Flows</Title>
        <Select
          label="Decision flow"
          placeholder="Select a decision flow"
          data={options}
          value={selectedFlowUrl || ''}
          onChange={(value) => setSelectedFlowUrl(value || null)}
          disabled={disabled}
        />

        {selectedFlowUrl && selectedState?.error && (
          <Alert color="red" title="Unable to load decision flow">
            {selectedState.error}
          </Alert>
        )}

        {selectedFlowUrl && selectedState?.questionnaire && !selectedState.error && (
          <QuestionnaireForm
            questionnaire={selectedState.questionnaire}
            questionnaireResponse={selectedState.response}
            excludeButtons={true}
            onChange={(response: QuestionnaireResponse): void => {
              if (disabled) {
                return;
              }
              saveResponse(selectedFlowUrl, response).catch(console.error);
            }}
          />
        )}
      </Stack>
    </Card>
  );
}
