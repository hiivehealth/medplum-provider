import type { AuditEvent, Reference } from '@medplum/fhirtypes';

function referenceLabel(reference: Reference | undefined): string | undefined {
  return reference?.display || reference?.reference || reference?.identifier?.value;
}

export function describeHawaiiAuditEvent(event: AuditEvent): {
  recorded: string;
  action: string;
  activity: string;
  actors: string[];
  resources: string[];
  observer: string;
  outcome: string;
  outcomeColor: string;
} {
  const actions: Record<string, string> = { C: 'Create', R: 'Read', U: 'Update', D: 'Delete', E: 'Execute' };
  const outcomes: Record<string, { label: string; color: string }> = {
    '0': { label: 'Success', color: 'green' },
    '4': { label: 'Minor failure', color: 'yellow' },
    '8': { label: 'Serious failure', color: 'red' },
    '12': { label: 'Major failure', color: 'red' },
  };
  const outcome = event.outcome === undefined ? { label: 'Not recorded', color: 'gray' } :
    outcomes[event.outcome] ?? { label: `Unknown (${event.outcome})`, color: 'gray' };
  const recorded = Number.isFinite(Date.parse(event.recorded)) ? new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
    timeZone: 'Pacific/Honolulu', timeZoneName: 'short',
  }).format(new Date(event.recorded)) : 'Not recorded';
  return {
    recorded,
    action: event.action ? actions[event.action] ?? `Unknown (${event.action})` : 'Not recorded',
    activity: event.type?.display || event.type?.code || 'Not recorded',
    actors: (event.agent ?? []).map((agent) => {
      const identity = referenceLabel(agent.who) || agent.name;
      return identity ? `${identity}${agent.requestor ? ' (requestor)' : ''}` :
        `${agent.type?.text || agent.type?.coding?.[0]?.display || 'Actor'} (identity not recorded)`;
    }),
    resources: (event.entity ?? []).map((entity) => referenceLabel(entity.what) || entity.name || 'Resource not recorded'),
    observer: referenceLabel(event.source?.observer) || 'Not recorded',
    outcome: outcome.label,
    outcomeColor: outcome.color,
  };
}