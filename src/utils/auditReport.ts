// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AuditEvent } from '@medplum/fhirtypes';

export interface AuditEventFilters {
  agent?: string;
  entity?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
}

export function buildAuditSearchParams(filters: AuditEventFilters): Record<string, string> {
  const params: Record<string, string> = {
    _sort: '-_lastUpdated',
    _count: '100',
  };

  if (filters.agent) {
    params.agent = filters.agent;
  }
  if (filters.entity) {
    params.entity = filters.entity;
  }
  if (filters.action) {
    params.action = filters.action;
  }
  if (filters.startDate) {
    params.date = `ge${filters.startDate}`;
  }
  if (filters.endDate) {
    params.date = `${params.date ? `${params.date}&date=` : ''}le${filters.endDate}`;
  }

  return params;
}

export function getAuditEventUser(event: AuditEvent): string {
  const who = event.agent?.[0]?.who;
  return who?.display ?? who?.reference ?? 'Unknown';
}

export function getAuditEventEntity(event: AuditEvent): string {
  const what = event.entity?.[0]?.what;
  return what?.display ?? what?.reference ?? 'Unknown';
}

export function getAuditEventEntityReference(event: AuditEvent): string | undefined {
  return event.entity?.[0]?.what?.reference;
}

export function getAuditEventType(event: AuditEvent): string {
  return event.type?.display ?? event.type?.code ?? 'Unknown';
}

export function getAuditEventOutcome(event: AuditEvent): string {
  // FHIR AuditEvent outcome codes (https://www.hl7.org/fhir/valueset-audit-event-outcome.html)
  switch (event.outcome) {
    case '0':
      return 'Success';
    case '4':
      return 'Minor failure';
    case '8':
      return 'Serious failure';
    case '12':
      return 'Major failure';
    default:
      return event.outcome ?? 'Unknown';
  }
}

export function getAuditEventAction(event: AuditEvent): string {
  // FHIR AuditEvent action codes (https://www.hl7.org/fhir/valueset-audit-event-action.html)
  switch (event.action) {
    case 'C':
      return 'Create';
    case 'R':
      return 'Read';
    case 'U':
      return 'Update';
    case 'D':
      return 'Delete';
    case 'E':
      return 'Execute';
    default:
      return event.action ?? 'Unknown';
  }
}

export function exportAuditEventsToCsv(events: AuditEvent[]): string {
  const headers = ['Recorded', 'User', 'Action', 'Type', 'Entity', 'Outcome'];
  const rows = events.map((event) => [
    event.recorded ?? '',
    getAuditEventUser(event),
    getAuditEventAction(event),
    getAuditEventType(event),
    getAuditEventEntity(event),
    getAuditEventOutcome(event),
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
