// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AuditEvent } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import {
  buildAuditSearchParams,
  exportAuditEventsToCsv,
  getAuditEventEntity,
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
