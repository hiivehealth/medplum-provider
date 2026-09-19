import { describe, expect, test } from 'vitest';
import { buildCaliforniaViewerAuditEvent } from './californiaViewerAudit';

describe('buildCaliforniaViewerAuditEvent', () => {
  test('captures the viewer action, selected source, and patient target', () => {
    const event = buildCaliforniaViewerAuditEvent({
      action: 'source-filter',
      patient: { reference: 'Patient/california-demo-patient-maya-chen' },
      source: 'Bay Care Network',
    });

    expect(event.resourceType).toBe('AuditEvent');
    expect(event.action).toBe('E');
    expect(event.entity?.[0]?.what?.reference).toBe('Patient/california-demo-patient-maya-chen');
    expect(event.entity?.[0]?.detail).toEqual([
      { type: 'viewer-action', valueString: 'source-filter' },
      { type: 'source-selection', valueString: 'Bay Care Network' },
    ]);
  });
});
