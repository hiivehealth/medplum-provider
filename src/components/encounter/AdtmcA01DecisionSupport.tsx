import { Alert, Anchor, Button, Group, List, Modal, Stack, Text, Title } from '@mantine/core';
import type { ClinicalImpression, QuestionnaireResponse } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useState } from 'react';
import { ADTMC_ALGORITHM_ID_URL } from '../../hooks/useAdtmcA01Result';

const ADTMC_DECISION_RULE_URL = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/adtmc-decision-rule';
const ADTMC_DISPOSITION_URL = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/adtmc-disposition';
export const A01_PARTIAL_DIFFERENTIALS = [
  'Viral infections',
  'Bacterial infections',
  'Meningitis',
  'Neck deep tissue infection',
  'Candida infection',
  'Strep throat',
] as const;
const LEGACY_A01_PARTIAL_DIFFERENTIAL_PREFIX = 'A-01 partial differential for clinician review:';

export interface AdtmcA01DecisionSupportProps {
  section: 'assessment' | 'plan';
  clinicalImpression: ClinicalImpression;
  questionnaireResponse: QuestionnaireResponse;
  soapResponse: QuestionnaireResponse | undefined;
  disabled?: boolean;
  onDraft: (response: QuestionnaireResponse) => void;
}

export function AdtmcA01DecisionSupport(props: AdtmcA01DecisionSupportProps): JSX.Element {
  const { section, clinicalImpression, questionnaireResponse, soapResponse, disabled, onDraft } = props;
  const [confirming, setConfirming] = useState(false);
  const algorithm = clinicalImpression.extension?.find((extension) => extension.url === ADTMC_ALGORITHM_ID_URL)?.valueString;
  const rule = clinicalImpression.extension?.find((extension) => extension.url === ADTMC_DECISION_RULE_URL)?.valueString;
  const disposition = clinicalImpression.extension?.find((extension) => extension.url === ADTMC_DISPOSITION_URL)?.valueCode;
  const guidance = clinicalImpression.description ?? 'No A-01 guidance was recorded.';
  const isAssessment = section === 'assessment';
  const targetLinkId = isAssessment ? 'differential-diagnoses' : 'plan-free-text';
  const draftTexts = isAssessment
    ? [...A01_PARTIAL_DIFFERENTIALS]
    : [`A-01 ${disposition ?? 'decision support'} guidance: ${guidance}`];

  const confirmDraft = (): void => {
    onDraft(
      isAssessment
        ? appendA01PartialDifferentials(soapResponse)
        : appendSoapTexts(soapResponse, targetLinkId, draftTexts)
    );
    setConfirming(false);
  };

  return (
    <Alert color="blue" title="A-01 Decision Support">
      <Stack gap="xs">
        <Text size="sm">{guidance}</Text>
        {isAssessment && (
          <>
            <Text size="sm" fw={600}>A-01 partial differential for clinician review</Text>
            <List size="sm" spacing={2} withPadding>
              {A01_PARTIAL_DIFFERENTIALS.map((differential) => <List.Item key={differential}>{differential}</List.Item>)}
            </List>
            <Text size="xs">This source list is decision support, not an automatically recorded diagnosis.</Text>
          </>
        )}
        <Text size="xs">Algorithm: {algorithm ?? 'A-01'}{rule ? ` | Rule: ${rule}` : ''}{disposition ? ` | Disposition: ${disposition}` : ''}</Text>
        {questionnaireResponse.id && (
          <Anchor size="xs" href={`/QuestionnaireResponse/${questionnaireResponse.id}`} target="_blank" rel="noreferrer">
            Review completed A-01 screen
          </Anchor>
        )}
        <Group justify="flex-end">
          <Button size="xs" variant="light" disabled={disabled} onClick={() => setConfirming(true)}>
            {isAssessment ? 'Add differential consideration' : 'Draft plan guidance'}
          </Button>
        </Group>
      </Stack>
      <Modal opened={confirming} onClose={() => setConfirming(false)} title={isAssessment ? 'Add differential consideration' : 'Draft plan guidance'} centered>
        <Stack>
          {isAssessment ? (
            <List size="sm" spacing={2} withPadding>
              {draftTexts.map((text) => <List.Item key={text}>{text}</List.Item>)}
            </List>
          ) : (
            <Text size="sm">{draftTexts[0]}</Text>
          )}
          <Text size="sm">This adds editable draft content to the SOAP {isAssessment ? 'Assessment' : 'Plan'}; it does not create a diagnosis, order, or care plan automatically.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button onClick={confirmDraft}>Add to SOAP {isAssessment ? 'Assessment' : 'Plan'}</Button>
          </Group>
        </Stack>
      </Modal>
    </Alert>
  );
}

export function appendSoapText(
  response: QuestionnaireResponse | undefined,
  linkId: string,
  text: string
): QuestionnaireResponse {
  return appendSoapTexts(response, linkId, [text]);
}

export function appendSoapTexts(
  response: QuestionnaireResponse | undefined,
  linkId: string,
  texts: readonly string[]
): QuestionnaireResponse {
  const item = response?.item ?? [];
  const existing = item.find((candidate) => candidate.linkId === linkId);
  const answers = texts.map((text) => ({ valueString: text }));
  return {
    ...response,
    resourceType: 'QuestionnaireResponse',
    status: 'in-progress',
    item: existing
      ? item.map((candidate) => candidate.linkId === linkId ? { ...candidate, answer: [...(candidate.answer ?? []), ...answers] } : candidate)
      : [...item, { linkId, answer: answers }],
  };
}

export function appendA01PartialDifferentials(
  response: QuestionnaireResponse | undefined
): QuestionnaireResponse {
  const item = response?.item ?? [];
  const withoutLegacyDraft = {
    ...response,
    item: item.map((candidate) =>
      candidate.linkId === 'differential-diagnoses'
        ? {
            ...candidate,
            answer: candidate.answer?.filter(
              (answer) => !answer.valueString?.startsWith(LEGACY_A01_PARTIAL_DIFFERENTIAL_PREFIX)
            ),
          }
        : candidate
    ),
  };
  return appendSoapTexts(withoutLegacyDraft, 'differential-diagnoses', A01_PARTIAL_DIFFERENTIALS);
}