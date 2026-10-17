import type { AuditEvent } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { describeHawaiiAuditEvent } from './audit';

describe('Hawaii audit evidence formatting', () => {
  const event: AuditEvent = {
    resourceType: 'AuditEvent', recorded: '2026-10-16T12:00:00Z', type: { code: 'rest' }, action: 'R', outcome: '0',
    agent: [{ requestor: true, who: { reference: 'Practitioner/clinician' } }],
    source: { observer: { reference: 'Device/server' } },
    entity: [{ what: { reference: 'Patient/synthetic' } }],
  };

  test('shows stored actor/resource references and readable Hawaii time, action, and outcome', () => {
    const entry = describeHawaiiAuditEvent(event);
    expect(entry.recorded).toContain('Oct 16, 2026');
    expect(entry.recorded).toContain('HST');
    expect(entry.action).toBe('Read');
    expect(entry.outcome).toBe('Success');
    expect(entry.actors).toEqual(['Practitioner/clinician (requestor)']);
    expect(entry.resources).toEqual(['Patient/synthetic']);
    expect(entry.observer).toBe('Device/server');
  });

  test('does not substitute the recording service for a missing actor or invent a read action', () => {
    const entry = describeHawaiiAuditEvent({ ...event, action: undefined, type: { code: 'transmit' },
      agent: [{ requestor: false, type: { text: 'Subscription' } }],
    });
    expect(entry.actors).toEqual(['Subscription (identity not recorded)']);
    expect(entry.observer).toBe('Device/server');
    expect(entry.activity).toBe('transmit');
    expect(entry.action).toBe('Not recorded');
  });

  test('uses an actor name only when that name is actually stored in the audit record', () => {
    expect(describeHawaiiAuditEvent({ ...event, agent: [{ requestor: true, name: 'Recorded synthetic actor' }] }).actors)
      .toEqual(['Recorded synthetic actor (requestor)']);
  });

  test.each([['4', 'Minor failure'], ['8', 'Serious failure'], ['12', 'Major failure'], [undefined, 'Not recorded'], ['99', 'Unknown (99)']])(
    'preserves the meaning of outcome %s', (outcome, label) => {
      expect(describeHawaiiAuditEvent({ ...event, outcome: outcome as AuditEvent['outcome'] }).outcome).toBe(label);
    }
  );

  test('keeps invalid timestamps unknown and only displays resource labels supplied by the event', () => {
    const entry = describeHawaiiAuditEvent({ ...event, recorded: 'invalid', entity: [{ name: 'Stored resource label' }] });
    expect(entry.recorded).toBe('Not recorded');
    expect(entry.resources).toEqual(['Stored resource label']);
  });
});