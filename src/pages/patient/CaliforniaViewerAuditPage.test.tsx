import { MantineProvider } from '@mantine/core';
import type { AuditEvent } from '@medplum/fhirtypes';
import { useSearchResources } from '@medplum/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CaliforniaViewerAuditPage } from './CaliforniaViewerAuditPage';

vi.mock('@medplum/react', () => ({ useSearchResources: vi.fn() }));

const auditEvents: AuditEvent[] = [
  {
    resourceType: 'AuditEvent',
    id: 'audit-1',
    meta: { tag: [{ system: 'https://hiivehealth.com/fhir/identifier/california-hie-demo', code: 'viewer-audit' }] },
    type: { code: 'rest' },
    recorded: '2026-09-18T09:00:00Z',
    agent: [{ who: { display: 'HiiveCare Provider clinician' } }],
    source: { observer: { display: 'HiiveCare California Viewer' } },
    entity: [
      {
        what: { reference: 'Patient/california-demo-patient-maya-chen' },
        detail: [
          { type: 'viewer-action', valueString: 'print' },
          { type: 'source-selection', valueString: 'Bay Care Network' },
        ],
      },
    ],
  },
];

describe('CaliforniaViewerAuditPage', () => {
  beforeEach(() => {
    vi.mocked(useSearchResources).mockReturnValue([auditEvents, false] as never);
  });

  test('filters California viewer audit events and exposes a CSV download', async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <CaliforniaViewerAuditPage />
      </MantineProvider>
    );

    expect(screen.getByText('print')).toBeInTheDocument();
    expect(screen.getByText('Patient/california-demo-patient-maya-chen')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download filtered audit report' })).toHaveAttribute(
      'download',
      'california-hie-viewer-audit.csv'
    );

    await user.type(screen.getByLabelText('Patient or resource'), 'other-patient');

    expect(screen.queryByText('print')).not.toBeInTheDocument();
  });
});
