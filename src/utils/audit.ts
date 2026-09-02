// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type {
  AuditEvent,
  Bot,
  ClientApplication,
  Device,
  Organization,
  Patient,
  Practitioner,
  PractitionerRole,
  Provenance,
  Reference,
  RelatedPerson,
  Subscription,
} from '@medplum/fhirtypes';

type AuditEventActorReference = Reference<
  | Patient
  | Practitioner
  | PractitionerRole
  | RelatedPerson
  | Device
  | Organization
  | Bot
  | ClientApplication
>;

type ObserverReference = AuditEventActorReference | Reference<Subscription>;

type ProvenanceActorReference = Reference<
  Patient | Practitioner | PractitionerRole | RelatedPerson | Device | Organization
>;

export interface BreakGlassAuditOptions {
  consentStatus?: string;
  correlationId?: string;
  outcome?: '0' | '4' | '8' | '12';
}

/**
 * Creates an AuditEvent documenting break-the-glass access to a patient record.
 *
 * @param patientId - The FHIR ID of the patient whose record was accessed.
 * @param reason - Free-text reason for the emergency access.
 * @param profile - The current user's profile reference (e.g. Practitioner/123).
 * @param options - Optional consent, correlation, and outcome metadata.
 * @returns AuditEvent resource ready to be created.
 */
export function createBreakGlassAudit(
  patientId: string,
  reason: string,
  profile?: Reference,
  options: BreakGlassAuditOptions = {}
): AuditEvent {
  const now = new Date().toISOString();
  const who: AuditEventActorReference = (profile ?? {
    reference: 'Practitioner/unknown',
    display: 'Unknown user',
  }) as AuditEventActorReference;
  const observer: ObserverReference = (profile ?? {
    reference: 'Practitioner/unknown',
    display: 'Unknown user',
  }) as ObserverReference;

  const audit: AuditEvent = {
    resourceType: 'AuditEvent',
    recorded: now,
    type: {
      system: 'http://dicom.nema.org/resources/ontology/DCM',
      code: '110113',
      display: 'Security Alert',
    },
    subtype: [
      {
        system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
        code: 'emergency-access',
        display: 'Emergency access (break the glass)',
      },
    ],
    action: 'R',
    outcome: options.outcome ?? '0',
    outcomeDesc: reason,
    agent: [
      {
        who,
        requestor: true,
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
              code: 'humanuser',
              display: 'Human User',
            },
          ],
        },
      },
    ],
    source: {
      observer,
      type: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/security-source-type',
          code: '3',
          display: 'Web Server',
        },
      ],
    },
    entity: [
      {
        what: { reference: `Patient/${patientId}` },
        type: {
          system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type',
          code: '1',
          display: 'Person',
        },
        role: {
          system: 'http://terminology.hl7.org/CodeSystem/object-role',
          code: '1',
          display: 'Patient',
        },
      },
    ],
  };

  if (options.correlationId) {
    audit.extension = [
      ...(audit.extension ?? []),
      {
        url: 'https://hiivehealth.com/fhir/StructureDefinition/break-glass-correlation-id',
        valueString: options.correlationId,
      },
    ];
  }

  if (options.consentStatus) {
    audit.extension = [
      ...(audit.extension ?? []),
      {
        url: 'https://hiivehealth.com/fhir/StructureDefinition/consent-status-at-access',
        valueCode: options.consentStatus,
      },
    ];
  }

  return audit;
}

/**
 * Creates a Provenance resource documenting a break-the-glass access decision.
 *
 * Provenance is appropriate for tracking that a specific action was taken because
 * of an emergency access decision.
 *
 * @param patientId - The FHIR ID of the patient whose record was accessed.
 * @param reason - Free-text reason for the emergency access.
 * @param profile - The current user's profile reference.
 * @returns Provenance resource ready to be created.
 */
export function createBreakGlassProvenance(patientId: string, reason: string, profile?: Reference): Provenance {
  const now = new Date().toISOString();
  const who: ProvenanceActorReference = (profile ?? {
    reference: 'Practitioner/unknown',
    display: 'Unknown user',
  }) as ProvenanceActorReference;

  return {
    resourceType: 'Provenance',
    target: [{ reference: `Patient/${patientId}` }],
    recorded: now,
    reason: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason',
            code: 'EMERG',
            display: 'Emergency',
          },
        ],
        text: reason,
      },
    ],
    activity: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-DocumentCompletion',
          code: 'AU',
          display: 'authenticated',
        },
      ],
      text: 'Break-the-glass patient record access',
    },
    agent: [
      {
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type',
              code: 'author',
              display: 'Author',
            },
          ],
        },
        who,
      },
    ],
  };
}
