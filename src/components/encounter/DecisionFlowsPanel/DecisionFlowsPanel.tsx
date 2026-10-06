// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Card, Select, Stack, Title } from '@mantine/core';
import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { A01CompactQuestionnaire } from '../../tasks/encounter/A01CompactQuestionnaire';
import { A01_SORE_THROAT_DECISION_FLOW_URL, DECISION_FLOWS } from '../../../data/decision-flows';
import type { UseDecisionFlowsResult } from '../../../hooks/useDecisionFlows';

export interface DecisionFlowsPanelProps {
  decisionFlows: UseDecisionFlowsResult;
  disabled?: boolean;
  onA01Completed?: () => void;
}

const SAVE_DEBOUNCE_MS = 750;

export function DecisionFlowsPanel(props: DecisionFlowsPanelProps): JSX.Element {
  const { decisionFlows, disabled, onA01Completed } = props;
  const { flows, selectedFlowUrl, setSelectedFlowUrl, saveResponse, completeResponse } = decisionFlows;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingResponseRef = useRef<QuestionnaireResponse | undefined>(undefined);
  const a01RefreshTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const options = [
    { value: '', label: 'Select a decision flow...' },
    ...DECISION_FLOWS.map((flow) => ({ value: flow.url, label: flow.title })),
  ];

  const selectedState = selectedFlowUrl ? flows.get(selectedFlowUrl) : undefined;

  const handleChange = useCallback(
    (response: QuestionnaireResponse): void => {
      if (disabled || !selectedFlowUrl) {
        return;
      }
      pendingResponseRef.current = response;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = undefined;
        const pending = pendingResponseRef.current;
        pendingResponseRef.current = undefined;
        if (pending && selectedFlowUrl) {
          saveResponse(selectedFlowUrl, pending);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [disabled, selectedFlowUrl, saveResponse]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      a01RefreshTimeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  const refreshA01Result = useCallback((): void => {
    onA01Completed?.();
    a01RefreshTimeoutsRef.current = [1000, 3000].map((delay) =>
      setTimeout(() => onA01Completed?.(), delay)
    );
  }, [onA01Completed]);

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
          <>
            {selectedFlowUrl === A01_SORE_THROAT_DECISION_FLOW_URL ? (
              <A01CompactQuestionnaire
                questionnaire={selectedState.questionnaire}
                questionnaireResponse={selectedState.response}
                onSubmit={async (response) => {
                  await completeResponse(selectedFlowUrl, response);
                  refreshA01Result();
                }}
              />
            ) : (
              <QuestionnaireForm
                questionnaire={selectedState.questionnaire}
                questionnaireResponse={selectedState.response}
                excludeButtons={true}
                onChange={handleChange}
              />
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
