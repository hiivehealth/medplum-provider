import type { MedplumClient } from '@medplum/core';
import type { AuditEvent, Patient, Reference } from '@medplum/fhirtypes';

const CALIFORNIA_DEMO_TAG_SYSTEM = 'https://hiivehealth.com/fhir/identifier/california-hie-demo';

export type CaliforniaViewerAuditAction = 'document-view' | 'export' | 'print' | 'record-view' | 'source-filter';

export function buildCaliforniaViewerAuditEvent({
  action,
  patient,
  source,
}: {
  action: CaliforniaViewerAuditAction;
  patient: Reference<Patient>;
  source: string;
}): AuditEvent {
  return {
    resourceType: 'AuditEvent',
    meta: { tag: [{ system: CALIFORNIA_DEMO_TAG_SYSTEM, code: 'viewer-audit' }] },
    type: {
      system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
      code: 'rest',
      display: 'Restful Operation',
    },
    action: action === 'record-view' || action === 'document-view' ? 'R' : 'E',
    recorded: new Date().toISOString(),
    outcome: '0',
    agent: [{ who: { display: 'HiiveCare Provider clinician' }, requestor: true }],
    source: { observer: { display: 'HiiveCare California Viewer' } },
    entity: [
      {
        what: patient,
        detail: [
          { type: 'viewer-action', valueString: action },
          { type: 'source-selection', valueString: source },
        ],
      },
    ],
  };
}

export async function recordCaliforniaViewerAudit(
  medplum: MedplumClient,
  input: Parameters<typeof buildCaliforniaViewerAuditEvent>[0]
): Promise<void> {
  await medplum.createResource(buildCaliforniaViewerAuditEvent(input));
}
