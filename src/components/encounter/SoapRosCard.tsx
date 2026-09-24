import { Alert, Card, LoadingOverlay, Select, Stack, Title } from '@mantine/core';
import type { Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface RosTemplateState {
  url: string;
  label: string;
  questionnaire: Questionnaire | undefined;
  response: QuestionnaireResponse | undefined;
  loading?: boolean;
  error?: string;
}

export interface SoapRosCardProps {
  templates: RosTemplateState[];
  disabled?: boolean;
  onChange: (questionnaireUrl: string, response: QuestionnaireResponse) => void;
  onRemove: (questionnaireUrl: string) => Promise<void>;
}

const SAVE_DEBOUNCE_MS = 750;
const NONE_TEMPLATE_VALUE = '__none__';

export function SoapRosCard(props: SoapRosCardProps): JSX.Element {
  const { templates, disabled, onChange, onRemove } = props;
  const existingTemplate = templates.find((template) => template.response);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(existingTemplate?.url ?? null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const selectedTemplate = templates.find((template) => template.url === selectedUrl);

  useEffect(() => {
    if (!selectedUrl && existingTemplate) {
      setSelectedUrl(existingTemplate.url);
    }
  }, [existingTemplate, selectedUrl]);

  useEffect(() => () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);

  const handleChange = useCallback((response: QuestionnaireResponse): void => {
    if (!selectedUrl || disabled) {
      return;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => onChange(selectedUrl, response), SAVE_DEBOUNCE_MS);
  }, [disabled, onChange, selectedUrl]);

  const handleTemplateChange = useCallback(async (value: string | null): Promise<void> => {
    if (disabled) {
      return;
    }
    const existingResponses = templates.filter((template) => template.response);
    const nextUrl = value === NONE_TEMPLATE_VALUE ? null : value;
    const needsRemoval = nextUrl === null || existingResponses.some((template) => template.url !== nextUrl);

    if (needsRemoval && existingResponses.length > 0) {
      const action = nextUrl ? 'Changing the ROS template' : 'Selecting None';
      if (!window.confirm(`${action} removes the current ROS response. Continue?`)) {
        return;
      }
      await Promise.all(existingResponses.map((template) => onRemove(template.url)));
    }

    setSelectedUrl(nextUrl);
    if (nextUrl && !templates.some((template) => template.url === nextUrl && template.response)) {
      onChange(nextUrl, { resourceType: 'QuestionnaireResponse', status: 'in-progress', item: [] });
    }
  }, [disabled, onChange, onRemove, templates]);

  return (
    <Card withBorder shadow="sm" mt="md" pos="relative">
      <LoadingOverlay visible={templates.some((template) => template.loading)} overlayProps={{ radius: 'sm', blur: 2 }} />
      <Stack gap="sm">
        <Title order={3}>Review of Systems</Title>
        <Select
          label="ROS template"
          placeholder="Search and select a ROS template"
          searchable
          data={[{ value: NONE_TEMPLATE_VALUE, label: 'None' }, ...templates.map((template) => ({ value: template.url, label: template.label }))]}
          value={selectedUrl}
          onChange={handleTemplateChange}
          disabled={disabled}
        />
        {selectedTemplate?.error && <Alert color="red" title="Unable to load template">{selectedTemplate.error}</Alert>}
        {selectedTemplate?.questionnaire && !selectedTemplate.error && (
          <QuestionnaireForm
            key={selectedTemplate.url}
            questionnaire={selectedTemplate.questionnaire}
            questionnaireResponse={selectedTemplate.response}
            excludeButtons={true}
            onChange={handleChange}
          />
        )}
      </Stack>
    </Card>
  );
}