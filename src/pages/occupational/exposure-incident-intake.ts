import type { MedplumClient } from '@medplum/core';
import { createReference, getReferenceString } from '@medplum/core';
import type {
  CodeableConcept,
  Encounter,
  EpisodeOfCare,
  Location as FhirLocation,
  Observation,
  ObservationComponent,
  Organization,
  Patient,
  Practitioner,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
  Reference,
  Task,
} from '@medplum/fhirtypes';

export const DEMO_CODE_SYSTEM = 'https://hiivecare.example/fhir/CodeSystem/medplum-ubix-demo';
export const EXPOSURE_INCIDENT_QUESTIONNAIRE_NAME = 'OccupationalIncidentIntakeQuestionnaire';
export const EXPOSURE_INCIDENT_QUESTIONNAIRE_TITLE = 'Occupational incident intake';
export const EXPOSURE_INCIDENT_CODE = 'exposure-incident';
export const RETURN_TO_WORK_STATUS_CODE = 'return-to-work-status';
export const RTW_FOLLOW_UP_TASK_CODE = 'rtw-follow-up';

const ENHANCED_LINK_IDS = [
  'incidentType',
  'component',
  'dutyLocation',
  'jobRole',
  'incidentDateTime',
  'incidentDescription',
  'returnToWorkStatus',
  'restrictionType',
  'restrictionSummary',
  'restrictionLimit',
  'restrictionEffectiveDate',
  'restrictionExpirationDate',
  'restrictionReevaluationDate',
] as const;

type IntakeLinkId = (typeof ENHANCED_LINK_IDS)[number];

export type ExposureIncidentAnswers = {
  incidentTypeCode: string;
  incidentTypeDisplay: string;
  componentCode?: string;
  componentDisplay: string;
  dutyLocationCode?: string;
  dutyLocationDisplay: string;
  jobRole: string;
  incidentDateTime: string;
  incidentDescription: string;
  returnToWorkStatusCode: string;
  returnToWorkStatusDisplay: string;
  restrictionTypeCode: string;
  restrictionTypeDisplay: string;
  restrictionSummary: string;
  restrictionLimit: string;
  restrictionEffectiveDate: string;
  restrictionExpirationDate: string;
  restrictionReevaluationDate: string;
};

export type ExposureIncidentSubmissionResult = {
  questionnaireResponse: QuestionnaireResponse;
  episode: EpisodeOfCare;
  encounter: Encounter;
  observation: Observation;
  task: Task;
};

const FALLBACK_ITEMS: Record<IntakeLinkId, QuestionnaireItem> = {
  incidentType: choiceItem('incidentType', 'Incident type', [
    ['work-related-injury', 'Work-related injury'],
    ['occupational-illness', 'Occupational illness'],
    ['exposure-incident', 'Exposure incident'],
    ['near-miss', 'Near miss'],
    ['critical-incident', 'Critical incident'],
  ]),
  component: choiceItem('component', 'Work unit / agency component', [
    ['component-a', 'Office of Health Security'],
    ['component-b', 'Field Operations'],
    ['component-c', 'Mission Support'],
  ]),
  dutyLocation: choiceItem('dutyLocation', 'Duty location', [
    ['headquarters', 'Headquarters'],
    ['field-office', 'Field office'],
    ['processing-center', 'Processing center'],
  ]),
  jobRole: choiceItem('jobRole', 'Job role', [
    ['field-response', 'Field response'],
    ['clinical-staff', 'Clinical staff'],
    ['program-analyst', 'Program analyst'],
  ]),
  incidentDateTime: {
    linkId: 'incidentDateTime',
    text: 'Incident date and time',
    type: 'dateTime',
    required: true,
  },
  incidentDescription: {
    linkId: 'incidentDescription',
    text: 'Incident description',
    type: 'text',
  },
  returnToWorkStatus: choiceItem('returnToWorkStatus', 'Return-to-work status', [
    ['full-duty', 'Full duty'],
    ['restricted-duty', 'Restricted duty'],
    ['not-fit', 'Not fit'],
    ['pending-reevaluation', 'Pending reevaluation'],
  ]),
  restrictionType: choiceItem('restrictionType', 'Restriction type', [
    ['no-restrictions', 'No restrictions'],
    ['field-duty-restricted', 'Field duty restricted'],
    ['limited-lifting', 'Limited lifting'],
    ['ppe-required', 'PPE required'],
    ['not-cleared', 'Not cleared'],
  ]),
  restrictionSummary: {
    linkId: 'restrictionSummary',
    text: 'Restriction summary',
    type: 'text',
  },
  restrictionLimit: {
    linkId: 'restrictionLimit',
    text: 'Restriction limit',
    type: 'text',
  },
  restrictionEffectiveDate: {
    linkId: 'restrictionEffectiveDate',
    text: 'Restriction effective date',
    type: 'date',
  },
  restrictionExpirationDate: {
    linkId: 'restrictionExpirationDate',
    text: 'Restriction expiration date',
    type: 'date',
  },
  restrictionReevaluationDate: {
    linkId: 'restrictionReevaluationDate',
    text: 'Restriction reevaluation date',
    type: 'date',
  },
};

export async function loadExposureIncidentQuestionnaire(medplum: MedplumClient): Promise<Questionnaire> {
  const questionnaires = await medplum.searchResources(
    'Questionnaire',
    new URLSearchParams([
      ['name', EXPOSURE_INCIDENT_QUESTIONNAIRE_NAME],
      ['_count', '20'],
      ['_sort', '-_lastUpdated'],
    ]),
    { cache: 'no-cache' }
  );
  return buildExposureIncidentQuestionnaire(selectBestExposureIncidentQuestionnaire(questionnaires));
}

export function selectBestExposureIncidentQuestionnaire(questionnaires: Questionnaire[]): Questionnaire | undefined {
  return [...questionnaires]
    .filter((questionnaire) => questionnaire.name === EXPOSURE_INCIDENT_QUESTIONNAIRE_NAME)
    .sort((left, right) => scoreQuestionnaire(right) - scoreQuestionnaire(left))[0];
}

export function buildExposureIncidentQuestionnaire(source?: Questionnaire): Questionnaire {
  const existingItems = source?.item || [];
  const enhancedItems = ENHANCED_LINK_IDS.map((linkId) => normalizeItem(existingItems, linkId));

  return {
    ...(source || { resourceType: 'Questionnaire' as const, status: 'active' as const }),
    name: EXPOSURE_INCIDENT_QUESTIONNAIRE_NAME,
    title: EXPOSURE_INCIDENT_QUESTIONNAIRE_TITLE,
    status: source?.status || 'active',
    item: enhancedItems,
  };
}

export function getExposureIncidentAnswers(
  response: QuestionnaireResponse,
  fallbackDateTime = new Date().toISOString()
): ExposureIncidentAnswers {
  const incidentType = answerCoding(response, 'incidentType');
  const component = answerCoding(response, 'component');
  const dutyLocation = answerCoding(response, 'dutyLocation');
  const returnToWorkStatus = answerCoding(response, 'returnToWorkStatus');
  const restrictionType = answerCoding(response, 'restrictionType');
  const fallbackDate = fallbackDateTime.split('T')[0];

  return {
    incidentTypeCode: incidentType.code || EXPOSURE_INCIDENT_CODE,
    incidentTypeDisplay: incidentType.display || 'Exposure incident',
    componentCode: component.code,
    componentDisplay: component.display || 'Work unit not documented',
    dutyLocationCode: dutyLocation.code,
    dutyLocationDisplay: dutyLocation.display || 'Duty location not documented',
    jobRole: answerString(response, 'jobRole') || 'Job role not documented',
    incidentDateTime: answerString(response, 'incidentDateTime') || fallbackDateTime,
    incidentDescription: answerString(response, 'incidentDescription') || 'Occupational incident intake submitted.',
    returnToWorkStatusCode: returnToWorkStatus.code || 'pending-reevaluation',
    returnToWorkStatusDisplay: returnToWorkStatus.display || 'Pending reevaluation',
    restrictionTypeCode: restrictionType.code || 'field-duty-restricted',
    restrictionTypeDisplay: restrictionType.display || 'Field duty restricted',
    restrictionSummary: answerString(response, 'restrictionSummary') || 'Restriction pending occupational review.',
    restrictionLimit: answerString(response, 'restrictionLimit') || 'Avoid field deployment until reevaluation.',
    restrictionEffectiveDate: answerString(response, 'restrictionEffectiveDate') || fallbackDate,
    restrictionExpirationDate:
      answerString(response, 'restrictionExpirationDate') ||
      answerString(response, 'restrictionReevaluationDate') ||
      fallbackDate,
    restrictionReevaluationDate: answerString(response, 'restrictionReevaluationDate') || fallbackDate,
  };
}

export async function submitExposureIncidentIntake(
  medplum: MedplumClient,
  patient: Patient,
  questionnaire: Questionnaire,
  response: QuestionnaireResponse,
  practitioner?: Practitioner
): Promise<ExposureIncidentSubmissionResult> {
  const now = new Date().toISOString();
  const answers = getExposureIncidentAnswers(response, now);
  const questionnaireResponse = await medplum.createResource(
    buildQuestionnaireResponse(questionnaire, patient, response, practitioner, now)
  );
  const episode = await medplum.createResource(buildEpisodeOfCare(patient, answers, now));
  const encounter = await medplum.createResource(buildEncounter(patient, episode, answers, practitioner, now));
  const observation = await medplum.createResource(
    buildReturnToWorkObservation(patient, episode, encounter, answers, now)
  );
  const task = await medplum.createResource(
    buildReturnToWorkTask(patient, episode, encounter, answers, practitioner, now)
  );

  return { questionnaireResponse, episode, encounter, observation, task };
}

export function buildQuestionnaireResponse(
  questionnaire: Questionnaire,
  patient: Patient,
  response: QuestionnaireResponse,
  practitioner: Practitioner | undefined,
  authored: string
): QuestionnaireResponse {
  return {
    ...response,
    resourceType: 'QuestionnaireResponse',
    status: 'completed',
    questionnaire: questionnaire.url || (questionnaire.id ? `Questionnaire/${questionnaire.id}` : undefined),
    subject: createReference(patient),
    source: practitioner ? createReference(practitioner) : response.source,
    authored,
  };
}

export function buildEpisodeOfCare(patient: Patient, answers: ExposureIncidentAnswers, now: string): EpisodeOfCare {
  return {
    resourceType: 'EpisodeOfCare',
    status: 'active',
    type: [codeableConcept(answers.incidentTypeCode, answers.incidentTypeDisplay)],
    patient: createReference(patient),
    managingOrganization: componentReference(answers),
    period: { start: answers.incidentDateTime || now },
  };
}

export function buildEncounter(
  patient: Patient,
  episode: EpisodeOfCare,
  answers: ExposureIncidentAnswers,
  practitioner: Practitioner | undefined,
  now: string
): Encounter {
  return {
    resourceType: 'Encounter',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    type: [codeableConcept(answers.incidentTypeCode, answers.incidentTypeDisplay)],
    subject: createReference(patient),
    episodeOfCare: episode.id ? [{ reference: getReferenceString(episode) }] : undefined,
    participant: practitioner ? [{ individual: createReference(practitioner) }] : undefined,
    serviceProvider: componentReference(answers),
    period: { start: answers.incidentDateTime || now, end: now },
    reasonCode: [codeableConcept(answers.incidentTypeCode, answers.incidentTypeDisplay)],
    location: [{ location: dutyLocationReference(answers) }],
  };
}

export function buildReturnToWorkObservation(
  patient: Patient,
  episode: EpisodeOfCare,
  encounter: Encounter,
  answers: ExposureIncidentAnswers,
  now: string
): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    code: codeableConcept(RETURN_TO_WORK_STATUS_CODE, 'Return-to-work status'),
    subject: createReference(patient),
    encounter: encounter.id ? { reference: getReferenceString(encounter) } : undefined,
    focus: episode.id ? [{ reference: getReferenceString(episode) }] : undefined,
    effectiveDateTime: now,
    valueString: answers.returnToWorkStatusCode,
    component: [
      component('restriction-type', 'Restriction type', {
        valueCodeableConcept: codeableConcept(answers.restrictionTypeCode, answers.restrictionTypeDisplay),
      }),
      component('restriction-summary', 'Restriction summary', { valueString: answers.restrictionSummary }),
      component('restriction-limit', 'Restriction limit', { valueString: answers.restrictionLimit }),
      component('restriction-effective-date', 'Restriction effective date', {
        valueDateTime: answers.restrictionEffectiveDate,
      }),
      component('restriction-expiration-date', 'Restriction expiration date', {
        valueDateTime: answers.restrictionExpirationDate,
      }),
      component('restriction-reevaluation-date', 'Restriction reevaluation date', {
        valueDateTime: answers.restrictionReevaluationDate,
      }),
    ],
  };
}

export function buildReturnToWorkTask(
  patient: Patient,
  episode: EpisodeOfCare,
  encounter: Encounter,
  answers: ExposureIncidentAnswers,
  practitioner: Practitioner | undefined,
  now: string
): Task {
  return {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: answers.returnToWorkStatusCode === 'not-fit' ? 'urgent' : 'routine',
    code: codeableConcept(RTW_FOLLOW_UP_TASK_CODE, 'RTW case follow-up'),
    description: `${answers.returnToWorkStatusDisplay}: ${answers.restrictionSummary}`,
    focus: episode.id ? { reference: getReferenceString(episode), display: answers.incidentTypeDisplay } : undefined,
    for: createReference(patient),
    encounter: encounter.id ? { reference: getReferenceString(encounter) } : undefined,
    authoredOn: now,
    requester: practitioner ? createReference(practitioner) : undefined,
    owner: practitioner ? createReference(practitioner) : undefined,
    reasonCode: codeableConcept(answers.incidentTypeCode, answers.incidentTypeDisplay),
    restriction: { period: { end: answers.restrictionReevaluationDate } },
  };
}

function scoreQuestionnaire(questionnaire: Questionnaire): number {
  const itemLinkIds = new Set(questionnaire.item?.map((item) => item.linkId));
  const enhancedScore = ENHANCED_LINK_IDS.filter((linkId) => itemLinkIds.has(linkId)).length * 10;
  const choiceScore = (questionnaire.item || []).filter((item) => item.type === 'choice').length;
  return enhancedScore + choiceScore;
}

function normalizeItem(existingItems: QuestionnaireItem[], linkId: IntakeLinkId): QuestionnaireItem {
  const fallback = FALLBACK_ITEMS[linkId];
  const existing = existingItems.find((item) => item.linkId === linkId);
  if (!existing) {
    return fallback;
  }

  if (fallback.type === 'choice') {
    return {
      ...existing,
      type: 'choice',
      text: fallback.linkId === 'component' ? fallback.text : existing.text || fallback.text,
      answerOption: fallback.answerOption || existing.answerOption,
    };
  }

  return { ...fallback, ...existing, text: existing.text || fallback.text };
}

function choiceItem(linkId: IntakeLinkId, text: string, options: [string, string][]): QuestionnaireItem {
  return {
    linkId,
    text,
    type: 'choice',
    required: linkId === 'incidentType' || linkId === 'component' || linkId === 'dutyLocation',
    answerOption: options.map(([code, display]) => ({ valueCoding: { system: DEMO_CODE_SYSTEM, code, display } })),
  };
}

function codeableConcept(code: string, display: string): CodeableConcept {
  return { coding: [{ system: DEMO_CODE_SYSTEM, code, display }], text: display };
}

function component(code: string, display: string, value: Partial<ObservationComponent>): ObservationComponent {
  return { code: codeableConcept(code, display), ...value };
}

function answerCoding(response: QuestionnaireResponse, linkId: IntakeLinkId): { code?: string; display?: string } {
  const answer = findAnswer(response.item, linkId);
  const coding = answer?.valueCoding;
  if (coding) {
    return { code: coding.code, display: coding.display || coding.code };
  }

  const display = answerString(response, linkId);
  return display ? { code: slugify(display), display } : {};
}

function answerString(response: QuestionnaireResponse, linkId: IntakeLinkId): string | undefined {
  const answer = findAnswer(response.item, linkId);
  return (
    answer?.valueString ||
    answer?.valueDateTime ||
    answer?.valueDate ||
    answer?.valueCoding?.display ||
    answer?.valueCoding?.code
  );
}

function findAnswer(
  items: QuestionnaireResponseItem[] | undefined,
  linkId: IntakeLinkId
): QuestionnaireResponseItemAnswer | undefined {
  for (const item of items || []) {
    if (item.linkId === linkId) {
      return item.answer?.[0];
    }
    const nestedAnswer = findAnswer(item.item, linkId);
    if (nestedAnswer) {
      return nestedAnswer;
    }
  }
  return undefined;
}

function componentReference(answers: ExposureIncidentAnswers): Reference<Organization> {
  const normalizedDisplay = answers.componentDisplay.toLowerCase();
  if (
    answers.componentCode === 'component-a' ||
    normalizedDisplay === 'component a' ||
    normalizedDisplay === 'office of health security'
  ) {
    return { reference: 'Organization/11d523d6-7c9f-5e18-91d5-24d67c9f1fcb', display: 'Office of Health Security' };
  }
  return { display: answers.componentDisplay };
}

function dutyLocationReference(answers: ExposureIncidentAnswers): Reference<FhirLocation> {
  if (answers.dutyLocationCode === 'headquarters' || answers.dutyLocationDisplay.toLowerCase() === 'headquarters') {
    return { reference: 'Location/c8b8e306-1947-4a17-95dd-082cca4fe2ba', display: 'Headquarters' };
  }
  return { display: answers.dutyLocationDisplay };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
