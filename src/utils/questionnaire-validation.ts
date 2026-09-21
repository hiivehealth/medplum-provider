import type {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
} from '@medplum/fhirtypes';

const REGEX_EXTENSION_URL = 'http://hl7.org/fhir/StructureDefinition/regex';

export function validateQuestionnaireResponse(
  questionnaire: Questionnaire,
  response: QuestionnaireResponse
): string[] {
  const responseItems = indexResponseItems(response.item);
  const errors: string[] = [];
  validateItems(questionnaire.item ?? [], responseItems, errors);
  return errors;
}

export function removeEmptyAnswers(response: QuestionnaireResponse): QuestionnaireResponse {
  return {
    ...response,
    item: removeEmptyAnswersFromItems(response.item),
  };
}

function validateItems(
  items: QuestionnaireItem[],
  responseItems: Map<string, QuestionnaireResponseItem>,
  errors: string[]
): void {
  for (const item of items) {
    const responseItem = responseItems.get(item.linkId);
    const answers = responseItem?.answer ?? [];
    const hasAnswer = answers.some(isAnswerPopulated);

    if (item.required && !hasAnswer) {
      errors.push(`${item.text ?? item.linkId} is required.`);
    }

    const regex = item.extension?.find((extension) => extension.url === REGEX_EXTENSION_URL)?.valueString;
    for (const answer of answers) {
      const value = getStringAnswer(answer);
      if (value === undefined) continue;
      if (item.maxLength !== undefined && value.length > item.maxLength) {
        errors.push(`${item.text ?? item.linkId} must be at most ${item.maxLength} characters.`);
      }
      if (regex && !new RegExp(regex).test(value)) {
        errors.push(`${item.text ?? item.linkId} has an invalid format.`);
      }
    }

    validateItems(item.item ?? [], responseItems, errors);
  }
}

function indexResponseItems(
  items: QuestionnaireResponseItem[] | undefined,
  result: Map<string, QuestionnaireResponseItem> = new Map()
): Map<string, QuestionnaireResponseItem> {
  for (const item of items ?? []) {
    result.set(item.linkId, item);
    indexResponseItems(item.item, result);
  }
  return result;
}

function getStringAnswer(answer: QuestionnaireResponseItemAnswer): string | undefined {
  return answer.valueString ?? answer.valueUri;
}

function removeEmptyAnswersFromItems(items: QuestionnaireResponseItem[] | undefined): QuestionnaireResponseItem[] | undefined {
  return items?.map(({ answer, ...item }) => {
    const answers = answer
      ?.map((answer) => ({ ...answer, item: removeEmptyAnswersFromItems(answer.item) }))
      .filter(isAnswerPopulated);
    return {
      ...item,
      item: removeEmptyAnswersFromItems(item.item),
      ...(answers?.length ? { answer: answers } : {}),
    };
  });
}

function isAnswerPopulated(answer: QuestionnaireResponseItemAnswer): boolean {
  return Object.entries(answer).some(([key, value]) => key.startsWith('value') && value !== undefined) ||
    (answer.item?.length ?? 0) > 0;
}
