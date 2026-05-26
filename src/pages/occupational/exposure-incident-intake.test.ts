import type { Practitioner, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import {
  buildEncounter,
  buildEpisodeOfCare,
  buildExposureIncidentQuestionnaire,
  buildReturnToWorkObservation,
  buildReturnToWorkTask,
  getExposureIncidentAnswers,
  selectBestExposureIncidentQuestionnaire,
} from './exposure-incident-intake';
import { occupationalPatient } from './occupational-test-data';

describe('exposure incident intake', () => {
  test('prefers the generated choice-based questionnaire and augments missing dashboard fields', () => {
    const stringQuestionnaire = questionnaire('string-source', [
      { linkId: 'incidentType', text: 'Incident type', type: 'string' },
      { linkId: 'component', text: 'Component', type: 'string' },
      { linkId: 'dutyLocation', text: 'Duty location', type: 'string' },
      { linkId: 'jobRole', text: 'Job role', type: 'string' },
    ]);
    const choiceQuestionnaire = questionnaire('choice-source', [
      choice('incidentType', 'Incident type'),
      choice('component', 'Component'),
      choice('dutyLocation', 'Duty location'),
      choice('jobRole', 'Job role'),
    ]);

    const selected = selectBestExposureIncidentQuestionnaire([stringQuestionnaire, choiceQuestionnaire]);
    const enhanced = buildExposureIncidentQuestionnaire(selected);

    expect(selected?.id).toBe('choice-source');
    expect(enhanced.item?.map((item) => item.linkId)).toEqual([
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
    ]);
    expect(enhanced.item?.find((item) => item.linkId === 'incidentType')?.type).toBe('choice');
    expect(enhanced.item?.find((item) => item.linkId === 'returnToWorkStatus')?.type).toBe('choice');
    const componentItem = enhanced.item?.find((item) => item.linkId === 'component');
    expect(componentItem?.text).toBe('Work unit / agency component');
    expect(componentItem?.answerOption?.[0]?.valueCoding?.display).toBe('Office of Health Security');
  });

  test('maps questionnaire answers to the FHIR resources consumed by dashboards', () => {
    const response: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      item: [
        answerCoding('incidentType', 'exposure-incident', 'Exposure incident'),
        answerCoding('component', 'component-a', 'Office of Health Security'),
        answerCoding('dutyLocation', 'headquarters', 'Headquarters'),
        answerString('jobRole', 'Field response'),
        answerString('incidentDateTime', '2026-05-22T14:30:00Z'),
        answerString('incidentDescription', 'Possible respiratory exposure during site visit.'),
        answerCoding('returnToWorkStatus', 'restricted-duty', 'Restricted duty'),
        answerCoding('restrictionType', 'field-duty-restricted', 'Field duty restricted'),
        answerString('restrictionSummary', 'Administrative duty only pending reevaluation.'),
        answerString('restrictionLimit', 'Avoid field deployment and prolonged standing.'),
        answerString('restrictionEffectiveDate', '2026-05-22'),
        answerString('restrictionExpirationDate', '2026-06-05'),
        answerString('restrictionReevaluationDate', '2026-06-05'),
      ],
    };
    const practitioner: Practitioner = {
      resourceType: 'Practitioner',
      id: 'provider-1',
      name: [{ given: ['Alex'], family: 'Demo' }],
    };
    const now = '2026-05-22T15:00:00Z';
    const answers = getExposureIncidentAnswers(response, now);
    const episode = { ...buildEpisodeOfCare(occupationalPatient, answers, now), id: 'episode-1' };
    const encounter = {
      ...buildEncounter(occupationalPatient, episode, answers, practitioner, now),
      id: 'encounter-1',
    };
    const observation = buildReturnToWorkObservation(occupationalPatient, episode, encounter, answers, now);
    const task = buildReturnToWorkTask(occupationalPatient, episode, encounter, answers, practitioner, now);

    expect(encounter.type?.[0].coding?.[0].code).toBe('exposure-incident');
    expect(encounter.location?.[0].location.reference).toBe('Location/c8b8e306-1947-4a17-95dd-082cca4fe2ba');
    expect(episode.managingOrganization?.reference).toBe('Organization/11d523d6-7c9f-5e18-91d5-24d67c9f1fcb');
    expect(observation.code.coding?.[0].code).toBe('return-to-work-status');
    expect(observation.valueString).toBe('restricted-duty');
    expect(
      observation.component?.find((item) => item.code.coding?.[0].code === 'restriction-summary')?.valueString
    ).toBe('Administrative duty only pending reevaluation.');
    expect(task.code?.coding?.[0].code).toBe('rtw-follow-up');
    expect(task.focus?.reference).toBe('EpisodeOfCare/episode-1');
    expect(task.owner?.reference).toBe('Practitioner/provider-1');
  });
});

function questionnaire(id: string, item: Questionnaire['item']): Questionnaire {
  return {
    resourceType: 'Questionnaire',
    id,
    name: 'OccupationalIncidentIntakeQuestionnaire',
    status: 'active',
    item,
  };
}

function choice(linkId: string, text: string): NonNullable<Questionnaire['item']>[number] {
  return {
    linkId,
    text,
    type: 'choice',
    answerOption: [
      { valueCoding: { system: 'https://hiivecare.example/fhir/CodeSystem/medplum-ubix-demo', code: linkId } },
    ],
  };
}

function answerCoding(
  linkId: string,
  code: string,
  display: string
): NonNullable<QuestionnaireResponse['item']>[number] {
  return {
    linkId,
    answer: [{ valueCoding: { system: 'https://hiivecare.example/fhir/CodeSystem/medplum-ubix-demo', code, display } }],
  };
}

function answerString(linkId: string, value: string): NonNullable<QuestionnaireResponse['item']>[number] {
  return { linkId, answer: [{ valueString: value }] };
}
