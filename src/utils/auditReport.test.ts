// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AuditEvent } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import {
  buildAuditSearchParams,
  exportAuditEventsToCsv,
  getAuditEventAction,
  getAuditEventEntity,
  getAuditEventOutcome,
  getAuditEventType,
  getAuditEventUser,
} from './auditReport';

describe('auditReport utilities', () => {
  test('buildAuditSearchParams includes all filters', () => {
    const params = buildAuditSearchParams({
      agent: 'Practitioner/123',
      entity: 'Patient/456',
      action: 'R',
      startDate: '2026-07-01',
      endDate: '2026-07-23',
    });
    expect(params.agent).toBe('Practitioner/123');
    expect(params.entity).toBe('Patient/456');
    expect(params.action).toBe('R');
    expect(params._sort).toBe('-_lastUpdated');
    expect(params._count).toBe('100');
  });

  test('buildAuditSearchParams omits empty filters', () => {
    const params = buildAuditSearchParams({});
    expect(params.agent).toBeUndefined();
    expect(params.entity).toBeUndefined();
    expect(params.action).toBeUndefined();
  });

  test('getAuditEventUser returns display when available', () => {
    const event: AuditEvent = {
      resourceType: 'AuditEvent',
      agent: [{ who: { reference: 'Practitioner/123', display: 'Dr. Alex' } }],
    } as AuditEvent;
    expect(getAuditEventUser(event)).toBe('Dr. Alex');
  });

  test('getAuditEventUser falls back to reference', () => {
    const event: AuditEvent = {
      resourceType: 'AuditEvent',
      agent: [{ who: { reference: 'Practitioner/123' } }],
    } as AuditEvent;
    expect(getAuditEventUser(event)).toBe('Practitioner/123');
  });

  test('getAuditEventEntity returns reference when display missing', () => {
    const event: AuditEvent = {
      resourceType: 'AuditEvent',
      entity: [{ what: { reference: 'Patient/456' } }],
    } as AuditEvent;
    expect(getAuditEventEntity(event)).toBe('Patient/456');
  });

  test('getAuditEventType returns code when display missing', () => {
    const event: AuditEvent = {
      resourceType: 'AuditEvent',
      type: { code: '110112' },
    } as AuditEvent;
    expect(getAuditEventType(event)).toBe('110112');
  });

  test('getAuditEventOutcome maps FHIR codes to labels', () => {
    expect(getAuditEventOutcome({ resourceType: 'AuditEvent', outcome: '0' } as AuditEvent)).toBe('Success');
    expect(getAuditEventOutcome({ resourceType: 'AuditEvent', outcome: '4' } as AuditEvent)).toBe('Minor failure');
    expect(getAuditEventOutcome({ resourceType: 'AuditEvent', outcome: '8' } as AuditEvent)).toBe('Serious failure');
    expect(getAuditEventOutcome({ resourceType: 'AuditEvent', outcome: '12' } as AuditEvent)).toBe('Major failure');
  });

  test('getAuditEventOutcome falls back to raw value or Unknown', () => {
    expect(getAuditEventOutcome({ resourceType: 'AuditEvent', outcome: '99' } as AuditEvent)).toBe('99');
    expect(getAuditEventOutcome({ resourceType: 'AuditEvent' } as AuditEvent)).toBe('Unknown');
  });

  test('getAuditEventAction maps FHIR codes to labels', () => {
    expect(getAuditEventAction({ resourceType: 'AuditEvent', action: 'C' } as AuditEvent)).toBe('Create');
    expect(getAuditEventAction({ resourceType: 'AuditEvent', action: 'R' } as AuditEvent)).toBe('Read');
    expect(getAuditEventAction({ resourceType: 'AuditEvent', action: 'U' } as AuditEvent)).toBe('Update');
    expect(getAuditEventAction({ resourceType: 'AuditEvent', action: 'D' } as AuditEvent)).toBe('Delete');
    expect(getAuditEventAction({ resourceType: 'AuditEvent', action: 'E' } as AuditEvent)).toBe('Execute');
  });

  test('getAuditEventAction falls back to raw value or Unknown', () => {
    expect(getAuditEventAction({ resourceType: 'AuditEvent', action: 'X' } as AuditEvent)).toBe('X');
    expect(getAuditEventAction({ resourceType: 'AuditEvent' } as AuditEvent)).toBe('Unknown');
  });

  test('exportAuditEventsToCsv escapes commas and quotes', () => {
    const events: AuditEvent[] = [
      {
        resourceType: 'AuditEvent',
        recorded: '2026-07-23T12:00:00Z',
        action: 'R',
        agent: [{ who: { display: 'Smith, Alex' } }],
        entity: [{ what: { reference: 'Patient/456' } }],
        type: { display: 'Query' },
        outcome: '0',
      } as AuditEvent,
    ];
    const csv = exportAuditEventsToCsv(events);
    expect(csv).toContain('"Smith, Alex"');
  });
});
