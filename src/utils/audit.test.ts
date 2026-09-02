import { describe, expect, test } from 'vitest';
import { createBreakGlassAudit, createBreakGlassProvenance } from './audit';

describe('Break-Glass audit records', () => {
  test('records consent state and correlation identifier', () => {
    const audit = createBreakGlassAudit(
      'patient-1',
      'Emergency evaluation',
      { reference: 'Practitioner/provider-1' },
      { consentStatus: 'not-declared', correlationId: 'request-1' }
    );

    expect(audit).toMatchObject({
      resourceType: 'AuditEvent',
      outcome: '0',
      outcomeDesc: 'Emergency evaluation',
      extension: [
        {
          url: 'https://hiivehealth.com/fhir/StructureDefinition/break-glass-correlation-id',
          valueString: 'request-1',
        },
        {
          url: 'https://hiivehealth.com/fhir/StructureDefinition/consent-status-at-access',
          valueCode: 'not-declared',
        },
      ],
    });
  });

  test('creates provenance linked to the patient and provider', () => {
    const provenance = createBreakGlassProvenance(
      'patient-1',
      'Emergency evaluation',
      { reference: 'Practitioner/provider-1' }
    );

    expect(provenance).toMatchObject({
      resourceType: 'Provenance',
      target: [{ reference: 'Patient/patient-1' }],
      agent: [{ who: { reference: 'Practitioner/provider-1' } }],
    });
  });
});