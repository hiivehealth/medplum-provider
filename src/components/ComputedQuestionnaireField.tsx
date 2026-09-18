import { Stack, Text } from '@mantine/core';
import type { QuestionnaireResponse, QuestionnaireResponseItemAnswer } from '@medplum/fhirtypes';
import type { JSX } from 'react';

export interface ComputedQuestionnaireFieldProps<T> {
  label: string;
  response: QuestionnaireResponse | undefined;
  watchLinkIds: string[];
  compute: (answers: Record<string, QuestionnaireResponseItemAnswer[]>) => T | undefined;
  format: (value: T) => string;
}

export function ComputedQuestionnaireField<T>({
  label,
  response,
  watchLinkIds,
  compute,
  format,
}: ComputedQuestionnaireFieldProps<T>): JSX.Element | null {
  if (!response) {
    return null;
  }

  const answers = getAnswersByLinkId(response.item);
  if (watchLinkIds.some((linkId) => !(linkId in answers))) {
    return null;
  }

  const value = compute(answers);
  if (value === undefined) {
    return null;
  }

  return (
    <Stack gap={2}>
      <Text fw={500}>{label}</Text>
      <Text>{format(value)}</Text>
    </Stack>
  );
}

function getAnswersByLinkId(
  items: QuestionnaireResponse['item'] | undefined,
  result: Record<string, QuestionnaireResponseItemAnswer[]> = {}
): Record<string, QuestionnaireResponseItemAnswer[]> {
  for (const item of items ?? []) {
    if (item.linkId && item.answer) {
      result[item.linkId] = item.answer;
    }
    getAnswersByLinkId(item.item, result);
  }
  return result;
}
