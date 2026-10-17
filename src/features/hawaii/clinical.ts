import type { Attachment, CodeableConcept, Observation, Resource } from '@medplum/fhirtypes';

export interface HawaiiClinicalEntry {
  resource: Resource;
  dateTime?: string;
  date: string;
  sortTime: number;
  label: string;
  value: string;
  source: string;
  kind: string;
}

function conceptDisplay(concept: CodeableConcept | undefined): string | undefined {
  return concept?.text ?? concept?.coding?.[0]?.display ?? concept?.coding?.[0]?.code;
}

function observationValue(observation: Observation): string {
  const quantity = observation.valueQuantity;
  if (quantity?.value !== undefined) {
    return [quantity.comparator, quantity.value, quantity.unit ?? quantity.code].filter((part) => part !== undefined).join(' ');
  }
  if (observation.valueBoolean !== undefined) {
    return observation.valueBoolean ? 'Yes' : 'No';
  }
  return observation.valueString ?? conceptDisplay(observation.valueCodeableConcept) ??
    observation.valueInteger?.toString() ?? conceptDisplay(observation.dataAbsentReason) ?? 'Not recorded';
}

function displayDate(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return 'Date not recorded';
  }
  if (/^\d{4}(-\d{2})?$/.test(value)) {
    return value;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'Pacific/Honolulu', timeZoneName: 'short',
  }).format(new Date(value));
}

export function describeHawaiiRecord(resource: Resource): HawaiiClinicalEntry {
  let dateTime: string | undefined;
  let label: string = resource.resourceType;
  let value = 'Not recorded';
  let source = resource.meta?.source ?? 'Source not recorded';
  let kind: string = resource.resourceType;
  switch (resource.resourceType) {
    case 'Encounter':
      dateTime = resource.status === 'finished' ? resource.period?.end ?? resource.period?.start : resource.period?.start;
      label = conceptDisplay(resource.type?.[0]) ?? 'Encounter';
      value = resource.status;
      source = resource.serviceProvider?.display ?? resource.serviceProvider?.reference ?? source;
      kind = 'Visit';
      break;
    case 'Observation':
      dateTime = resource.effectiveDateTime ?? resource.effectivePeriod?.end ?? resource.effectivePeriod?.start ?? resource.issued;
      label = conceptDisplay(resource.code) ?? 'Observation';
      value = observationValue(resource);
      source = resource.performer?.[0]?.display ?? resource.performer?.[0]?.reference ?? source;
      kind = 'Result';
      break;
    case 'Condition':
      dateTime = resource.onsetDateTime ?? resource.recordedDate;
      label = conceptDisplay(resource.code) ?? 'Condition';
      value = conceptDisplay(resource.clinicalStatus) ?? 'Not recorded';
      source = resource.recorder?.display ?? resource.recorder?.reference ?? source;
      kind = 'Condition';
      break;
    case 'DocumentReference':
      dateTime = resource.date;
      label = resource.description ?? resource.content[0]?.attachment.title ?? 'Clinical document';
      value = resource.content[0]?.attachment.contentType ?? 'Document';
      source = resource.custodian?.display ?? resource.custodian?.reference ?? source;
      kind = 'Document';
      break;
  }
  const parsed = Date.parse(dateTime ?? '');
  return { resource, dateTime, date: displayDate(dateTime), sortTime: Number.isFinite(parsed) ? parsed : -Infinity,
    label, value, source, kind };
}

export function sortHawaiiRecords(resources: Resource[]): HawaiiClinicalEntry[] {
  return resources.map(describeHawaiiRecord).sort((first, second) =>
    first.sortTime === second.sortTime ? 0 : second.sortTime - first.sortTime);
}

export function readHawaiiTextAttachment(attachment: Attachment | undefined): string {
  if (attachment?.contentType?.split(';')[0].trim().toLowerCase() !== 'text/plain' || !attachment.data ||
    attachment.data.length > 1400000) {
    throw new Error('Unsupported document attachment');
  }
  const bytes = Uint8Array.from(atob(attachment.data), (character) => character.charCodeAt(0));
  if (bytes.length > 1024 * 1024) {
    throw new Error('Document exceeds the preview limit');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}