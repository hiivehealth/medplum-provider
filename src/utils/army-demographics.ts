import { createReference, getQuestionnaireAnswers } from '@medplum/core';
import type { Patient, QuestionnaireResponse, QuestionnaireResponseItemAnswer } from '@medplum/fhirtypes';

export const ARMY_PATIENT_PROFILE_URL =
  'https://ehr.hiivehealth.net/fhir/StructureDefinition/hiive-army-demographics-patient';
export const ARMY_QUESTIONNAIRE_URL =
  'https://ehr.hiivehealth.net/fhir/Questionnaire/hiive-army-demographics-intake';

const DOD_ID_SYSTEM = 'https://ehr.hiivehealth.net/fhir/identifier/dod-id';
const MILITARY_SERVICE_URL = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/military-service';
const MILITARY_AFFILIATION_URL = 'affiliation';
const MILITARY_BRANCH_URL = 'branch';
const MILITARY_GRADE_URL = 'grade';
const VIP_STATUS_URL = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/vip-status';
const BLOOD_TYPE_URL = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/administrative-blood-type';

export function validateArmyDemographicsResponse(response: QuestionnaireResponse): string[] {
  const answers = getQuestionnaireAnswers(response);
  const dodId = answers['dod-id']?.valueString;
  const branch = answers.branch?.valueCoding;
  const grade = answers.grade?.valueCoding;
  const affiliation = answers.affiliation?.valueCoding;
  const errors: string[] = [];

  if (dodId && !/^[0-9]{10}$/.test(dodId)) {
    errors.push('DoD ID must contain exactly 10 digits.');
  }
  if ((branch || grade) && !affiliation) {
    errors.push('Affiliation is required when Branch or Grade is provided.');
  }
  if (!!branch !== !!grade) {
    errors.push('Branch and Grade must be provided together.');
  }

  return errors;
}

export function applyArmyDemographicsResponse(patient: Patient, response: QuestionnaireResponse): Patient {
  const answers = getQuestionnaireAnswers(response);
  const updated: Patient = {
    ...patient,
    meta: {
      ...patient.meta,
      profile: Array.from(new Set([...(patient.meta?.profile ?? []), ARMY_PATIENT_PROFILE_URL])),
    },
  };

  if (answers.gender?.valueCoding?.code) {
    updated.gender = answers.gender.valueCoding.code as Patient['gender'];
  }
  if (answers['date-of-birth']?.valueDate) {
    updated.birthDate = answers['date-of-birth'].valueDate;
  }

  updated.identifier = (patient.identifier ?? []).filter((identifier) => identifier.system !== DOD_ID_SYSTEM);
  if (answers['dod-id']?.valueString) {
    updated.identifier.push({ system: DOD_ID_SYSTEM, value: answers['dod-id'].valueString });
  }

  const answersByLinkId = answers as Record<string, QuestionnaireResponseItemAnswer>;
  const militaryChildren = ['affiliation', 'branch', 'grade']
    .map((linkId) => {
      const value = answersByLinkId[linkId]?.valueCoding;
      return value ? { url: linkId, valueCoding: value } : undefined;
    })
    .filter((value): value is { url: string; valueCoding: NonNullable<QuestionnaireResponseItemAnswer['valueCoding']> } => !!value);
  updated.extension = (patient.extension ?? []).filter(
    (extension) => ![MILITARY_SERVICE_URL, VIP_STATUS_URL, BLOOD_TYPE_URL].includes(extension.url)
  );
  if (militaryChildren.length > 0) {
    updated.extension.push({ url: MILITARY_SERVICE_URL, extension: militaryChildren });
  }
  if (answers['vip-status']?.valueBoolean !== undefined) {
    updated.extension.push({ url: VIP_STATUS_URL, valueBoolean: answers['vip-status'].valueBoolean });
  }
  if (answers['blood-type']?.valueCoding) {
    updated.extension.push({ url: BLOOD_TYPE_URL, valueCoding: answers['blood-type'].valueCoding });
  }

  return updated;
}

export function questionnaireResponseForPatient(
  questionnaire: QuestionnaireResponse['questionnaire'],
  patient: Patient
): QuestionnaireResponse {
  const items: QuestionnaireResponse['item'] = [];
  const dodId = patient.identifier?.find((identifier) => identifier.system === DOD_ID_SYSTEM)?.value;
  if (dodId) items.push({ linkId: 'dod-id', answer: [{ valueString: dodId }] });
  if (patient.gender) items.push({ linkId: 'gender', answer: [{ valueCoding: { code: patient.gender } }] });
  if (patient.birthDate) items.push({ linkId: 'date-of-birth', answer: [{ valueDate: patient.birthDate }] });

  const service = patient.extension?.find((extension) => extension.url === MILITARY_SERVICE_URL);
  for (const child of service?.extension ?? []) {
    const value = child.valueCoding;
    if (value) items.push({ linkId: child.url, answer: [{ valueCoding: value }] });
  }
  const vip = patient.extension?.find((extension) => extension.url === VIP_STATUS_URL)?.valueBoolean;
  if (vip !== undefined) items.push({ linkId: 'vip-status', answer: [{ valueBoolean: vip }] });
  const bloodType = patient.extension?.find((extension) => extension.url === BLOOD_TYPE_URL)?.valueCoding;
  if (bloodType) items.push({ linkId: 'blood-type', answer: [{ valueCoding: bloodType }] });

  return { resourceType: 'QuestionnaireResponse', questionnaire, subject: createReference(patient), status: 'in-progress', item: items };
}
