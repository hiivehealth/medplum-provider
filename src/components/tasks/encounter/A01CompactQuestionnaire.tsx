import { Accordion, Alert, Anchor, Button, Group, Modal, Paper, Radio, Stack, Text, Title } from '@mantine/core';
import type { Questionnaire, QuestionnaireItem, QuestionnaireResponse, QuestionnaireResponseItem } from '@medplum/fhirtypes';
import { IconExternalLink, IconFileText } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';

interface A01CompactQuestionnaireProps {
  questionnaire: Questionnaire;
  questionnaireResponse?: QuestionnaireResponse;
  onSubmit: (response: QuestionnaireResponse) => void;
}

interface A01Answer {
  linkId: string;
  value: string;
}

const BOOLEAN_SYSTEM = 'urn:hiivehealth:adtmc-boolean';
const RED_FLAG_IDS = ['shortness-of-breath', 'stridor', 'deviated-uvula', 'drooling-trouble-swallowing', 'stiff-neck'];
const DP1_IDS = ['symptoms-more-than-10-days', 'immunosuppression', 'inhaled-steroid', 'fever'];
const STREP_CRITERIA_IDS = ['dp2-fever', 'no-cough', 'tonsillar-exudate', 'swollen-anterior-cervical-nodes'];
const PROVIDER_NOW_IDS = [...RED_FLAG_IDS, ...DP1_IDS];
const SCOPE_OF_PRACTICE_DOCUMENTS = [
  { title: 'A-1 Sore Throat/Hoarseness', href: '/documents/adtmc/a01/scope-of-practice.html?document=a01-sore-throat-hoarseness' },
  { title: 'Policy Guide', href: '/documents/adtmc/a01/scope-of-practice.html?document=policy-guide' },
  { title: 'Obtain a Throat Culture', href: '/documents/adtmc/a01/scope-of-practice.html?document=obtain-a-throat-culture' },
  { title: 'Perform an HEENT Exam', href: '/documents/adtmc/a01/scope-of-practice.html?document=perform-an-heent-exam' },
  { title: 'Care for Common Throat Infections', href: '/documents/adtmc/a01/scope-of-practice.html?document=care-for-common-throat-infections' },
] as const;

export function A01CompactQuestionnaire({
  questionnaire,
  questionnaireResponse,
  onSubmit,
}: A01CompactQuestionnaireProps): JSX.Element {
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>(() => getAnswers(questionnaireResponse));
  const [showValidation, setShowValidation] = useState(false);
  const [providerNowModalOpen, setProviderNowModalOpen] = useState(false);
  const [aemNowModalOpen, setAemNowModalOpen] = useState(false);
  const groups = questionnaire.item ?? [];
  const hasRedFlag = RED_FLAG_IDS.some((linkId) => answers[linkId] === 'true');
  const redFlagsAnswered = RED_FLAG_IDS.every((linkId) => answers[linkId] !== undefined);
  const redFlagsCleared = RED_FLAG_IDS.every((linkId) => answers[linkId] === 'false');
  const dp1Cleared = DP1_IDS.every((linkId) => answers[linkId] === 'false');
  const strepCriteriaCount = STREP_CRITERIA_IDS.filter((linkId) => answers[linkId] === 'true').length;
  const dp2ScreenCompleted = STREP_CRITERIA_IDS.every((linkId) => answers[linkId] !== undefined);
  const strepTestCompleted = answers['rapid-strep-culture-result'] !== undefined;
  const minorCarePath = dp2ScreenCompleted && (
    strepCriteriaCount < 3 || (strepTestCompleted && answers['rapid-strep-culture-result'] === 'negative')
  );
  const visibleGroups = groups.filter((group, index) => {
    if (index === 0) {
      return true;
    }
    if (group.linkId === 'dp1-screen') {
      return redFlagsCleared;
    }
    if (group.linkId === 'dp2-screen') {
      return dp1Cleared;
    }
    if (group.linkId === 'strep-test') {
      return dp2ScreenCompleted && strepCriteriaCount >= 3;
    }
    if (group.linkId === 'additional-screen') {
      return dp1Cleared && minorCarePath;
    }
    return redFlagsCleared;
  });
  const questions = visibleGroups.flatMap((group) => group.item ?? []);
  const unanswered = questions.filter((question) => question.required && !answers[question.linkId]);

  const setAnswer = (linkId: string, value: string): void => {
    setAnswers((currentAnswers) => {
      const updatedAnswers = { ...currentAnswers, [linkId]: value };
      if (shouldOpenProviderNowModal(linkId, updatedAnswers)) {
        setProviderNowModalOpen(true);
      }
      if (shouldOpenAemNowModal(linkId, updatedAnswers)) {
        setAemNowModalOpen(true);
      }
      return updatedAnswers;
    });
  };

  const submit = (): void => {
    if (unanswered.length > 0) {
      setShowValidation(true);
      return;
    }

    onSubmit(buildCompletedResponse(questionnaire, groups, answers));
  };

  const routeProviderNow = (): void => {
    setProviderNowModalOpen(false);
    const redFlagGroup = groups[0];
    onSubmit({
      resourceType: 'QuestionnaireResponse',
      questionnaire: questionnaire.url ? `${questionnaire.url}|${questionnaire.version}` : `Questionnaire/${questionnaire.id}`,
      status: 'completed',
      item: redFlagGroup
        ? [{ linkId: redFlagGroup.linkId, text: redFlagGroup.text, item: (redFlagGroup.item ?? []).map((question) => buildResponseItem(question, answers[question.linkId])) }]
        : [],
    });
  };

  const routeAemNow = (): void => {
    setAemNowModalOpen(false);
    onSubmit(buildCompletedResponse(questionnaire, groups, answers));
  };

  return (
    <Stack gap="md">
      <Title order={3}>{questionnaire.title}</Title>
      {questionnaire.description && <Text size="sm" fw={500}>{questionnaire.description}</Text>}
      <Accordion variant="separated" radius="sm">
        <Accordion.Item value="scope-of-practice">
          <Accordion.Control icon={<IconFileText size={18} />}>Scope of Practice</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {SCOPE_OF_PRACTICE_DOCUMENTS.map((document) => (
                <Anchor key={document.href} href={document.href} target="_blank" rel="noreferrer" underline="hover">
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm">{document.title}</Text>
                    <IconExternalLink size={16} aria-hidden />
                  </Group>
                </Anchor>
              ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      {visibleGroups.map((group) => {
        const questionPrompt = group.item?.find((item) => item.linkId?.endsWith('-question-prompt'));
        const renderedItems = group.item?.filter((item) => item.linkId !== questionPrompt?.linkId) ?? [];

        return (
          <Paper key={group.linkId} withBorder radius="sm">
            <Group justify="flex-start" px="md" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
              <Text fw={600}>{group.text}</Text>
              {questionPrompt && <Text size="sm">{questionPrompt.text}</Text>}
            </Group>
            {renderedItems.map((question) => (
            <QuestionRow
              key={question.linkId}
              question={question}
              value={answers[question.linkId]}
              invalid={showValidation && question.required === true && !answers[question.linkId]}
              onChange={setAnswer}
            />
          ))}
          </Paper>
        );
      })}
      {showValidation && unanswered.length > 0 && <Text c="red" size="sm">Answer each required question before completing A-01.</Text>}
      {(!hasRedFlag || !redFlagsAnswered) && (
        <Group justify="flex-end">
          <Button onClick={submit} disabled={!redFlagsAnswered}>Complete A-01</Button>
        </Group>
      )}
      <Modal
        opened={providerNowModalOpen}
        onClose={() => undefined}
        centered
        closeOnClickOutside={false}
        closeOnEscape={false}
        withCloseButton={false}
      >
        <Stack gap="md">
          <Alert color="red" title="Provider Now">
            Provider Now alerts are a hard stop during the screening of your patient. Please discontinue the ADTMC
            screening process at this time.
          </Alert>
          <Text size="sm">
            Routing records the ADTMC response and assigns a ready handoff task to the Provider Now Queue.
          </Text>
          <Group justify="flex-end">
            <Button color="red" onClick={routeProviderNow}>Route to Provider Now</Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={aemNowModalOpen}
        onClose={() => undefined}
        centered
        closeOnClickOutside={false}
        closeOnEscape={false}
        withCloseButton={false}
      >
        <Stack gap="md">
          <Alert color="red" title="AEM Now">
            A positive rapid strep/culture result requires immediate AEM routing. Please discontinue the ADTMC
            screening process at this time.
          </Alert>
          <Text size="sm">
            Routing records the ADTMC response and assigns a ready handoff task to the AEM Now Queue.
          </Text>
          <Group justify="flex-end">
            <Button color="red" onClick={routeAemNow}>Route to AEM Now</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function shouldOpenProviderNowModal(
  linkId: string,
  answers: Readonly<Record<string, string>>
): boolean {
  if (!PROVIDER_NOW_IDS.includes(linkId)) {
    return false;
  }

  const currentStageIds = RED_FLAG_IDS.includes(linkId) ? RED_FLAG_IDS : DP1_IDS;
  return (
    currentStageIds.every((stageId) => answers[stageId] !== undefined) &&
    currentStageIds.some((stageId) => answers[stageId] === 'true')
  );
}

export function shouldOpenAemNowModal(linkId: string, answers: Readonly<Record<string, string>>): boolean {
  return (
    linkId === 'rapid-strep-culture-result' &&
    answers[linkId] === 'positive' &&
    STREP_CRITERIA_IDS.filter((criterionId) => answers[criterionId] === 'true').length >= 3
  );
}

function buildCompletedResponse(
  questionnaire: Questionnaire,
  groups: QuestionnaireItem[],
  answers: Readonly<Record<string, string>>
): QuestionnaireResponse {
  return {
    resourceType: 'QuestionnaireResponse',
    questionnaire: questionnaire.url ? `${questionnaire.url}|${questionnaire.version}` : `Questionnaire/${questionnaire.id}`,
    status: 'completed',
    item: groups.map((group) => ({
      linkId: group.linkId,
      text: group.text,
      item: (group.item ?? []).map((question) => buildResponseItem(question, answers[question.linkId])),
    })),
  };
}

function QuestionRow({
  question,
  value,
  invalid,
  onChange,
}: {
  question: QuestionnaireItem;
  value?: string;
  invalid: boolean;
  onChange: (linkId: string, value: string) => void;
}): JSX.Element {
  if (question.type === 'display') {
    return <Text px="md" py="sm" size="sm" lh={1.45}>{question.text}</Text>;
  }

  const isTestResult = question.linkId === 'rapid-strep-culture-result';
  const choices = isTestResult ? ['positive', 'negative'] : ['true', 'false'];
  const labels = isTestResult ? ['Positive', 'Negative'] : ['Yes', 'No'];

  return (
    <Group
      justify="space-between"
      align="center"
      px="md"
      py="xs"
      style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', backgroundColor: invalid ? 'var(--mantine-color-red-0)' : undefined }}
    >
      <Text size="sm" fw={500}>{question.text}{question.required ? ' *' : ''}</Text>
      <Radio.Group value={value} onChange={(answer) => onChange(question.linkId, answer)} aria-label={question.text}>
        <Group gap="xs" wrap="nowrap">
          {choices.map((choice, index) => <Radio key={choice} value={choice} label={labels[index]} />)}
        </Group>
      </Radio.Group>
    </Group>
  );
}

function buildResponseItem(question: QuestionnaireItem, value: string | undefined): QuestionnaireResponseItem {
  if (question.type === 'display') {
    return { linkId: question.linkId, text: question.text };
  }

  const isTestResult = question.linkId === 'rapid-strep-culture-result';
  return {
    linkId: question.linkId,
    text: question.text,
    answer: value
      ? [
          isTestResult
            ? { valueCoding: { code: value, display: value === 'positive' ? 'Positive' : 'Negative' } }
            : { valueCoding: { system: BOOLEAN_SYSTEM, code: value, display: value === 'true' ? 'Yes' : 'No' } },
        ]
      : undefined,
  };
}

function getAnswers(response: QuestionnaireResponse | undefined): Readonly<Record<string, string>> {
  const answers: Record<string, string> = {};
  const collect = (items: QuestionnaireResponse['item'] = []): void => {
    for (const item of items) {
      const answer = item.answer?.[0];
      const value = answer?.valueCoding?.code ?? answer?.valueBoolean?.toString();
      if (value) {
        answers[item.linkId] = value;
      }
      collect(item.item);
      for (const nestedAnswer of item.answer ?? []) {
        collect(nestedAnswer.item);
      }
    }
  };
  collect(response?.item);
  return answers;
}