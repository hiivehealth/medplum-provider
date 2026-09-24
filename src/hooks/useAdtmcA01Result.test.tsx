import type { WithId } from '@medplum/core';
import type { ClinicalImpression, Encounter, QuestionnaireResponse } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  ADTMC_ALGORITHM_ID_URL,
  getMostRecentAdtmcA01ClinicalImpression,
  useAdtmcA01Result,
} from './useAdtmcA01Result';

const encounter: WithId<Encounter> = {
  resourceType: 'Encounter',
  id: 'a01-encounter',
  status: 'in-progress',
  class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
};

function a01ClinicalImpression(id: string, date: string, sourceResponseId?: string): ClinicalImpression {
  return {
    resourceType: 'ClinicalImpression',
    id,
    status: 'completed',
    encounter: { reference: 'Encounter/a01-encounter' },
    date,
    extension: [{ url: ADTMC_ALGORITHM_ID_URL, valueString: 'A-01' }],
    supportingInfo: sourceResponseId ? [{ reference: `QuestionnaireResponse/${sourceResponseId}` }] : undefined,
  };
}

describe('useAdtmcA01Result', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
  });

  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <MedplumProvider medplum={medplum}>{children}</MedplumProvider>
  );

  test('returns an empty state when the encounter has no A-01 result', async () => {
    await medplum.createResource(encounter);

    const { result } = renderHook(() => useAdtmcA01Result(encounter), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.clinicalImpression).toBeUndefined();
    expect(result.current.questionnaireResponse).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  test('loads the newest A-01 result and its completed source response', async () => {
    await medplum.createResource(encounter);
    const sourceResponse: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      id: 'a01-response',
      status: 'completed',
      questionnaire: 'https://ehr.hiivehealth.net/fhir/Questionnaire/a01-sore-throat|1.0.0',
      encounter: { reference: 'Encounter/a01-encounter' },
    };
    await medplum.createResource(sourceResponse);
    await medplum.createResource(a01ClinicalImpression('older-a01', '2026-09-20T10:00:00Z', 'a01-response'));
    await medplum.createResource(a01ClinicalImpression('newer-a01', '2026-09-21T10:00:00Z', 'a01-response'));

    const { result } = renderHook(() => useAdtmcA01Result(encounter), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.clinicalImpression?.id).toBe('newer-a01');
    expect(result.current.questionnaireResponse?.id).toBe('a01-response');
    expect(result.current.error).toBeUndefined();
  });

  test('refreshes after an A-01 result is created for the encounter', async () => {
    await medplum.createResource(encounter);
    const { result } = renderHook(() => useAdtmcA01Result(encounter), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const sourceResponse = await medplum.createResource<QuestionnaireResponse>({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      questionnaire: 'https://ehr.hiivehealth.net/fhir/Questionnaire/a01-sore-throat|1.0.0',
    });
    const createdResult = await medplum.createResource(
      a01ClinicalImpression('created-after-load', '2026-09-21T10:00:00Z', sourceResponse.id)
    );

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.clinicalImpression?.id).toBe(createdResult.id));
    expect(result.current.questionnaireResponse?.id).toBe(sourceResponse.id);
  });

  test('reports a malformed A-01 result without a source response reference', async () => {
    await medplum.createResource(encounter);
    await medplum.createResource(a01ClinicalImpression('invalid-a01', '2026-09-21T10:00:00Z'));

    const { result } = renderHook(() => useAdtmcA01Result(encounter), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.clinicalImpression).toBeUndefined();
    expect(result.current.error).toContain('missing its source QuestionnaireResponse');
  });

  test('does not select non-A-01 clinical impressions', () => {
    const nonA01: ClinicalImpression = {
      resourceType: 'ClinicalImpression',
      status: 'completed',
      date: '2026-09-22T10:00:00Z',
      extension: [{ url: ADTMC_ALGORITHM_ID_URL, valueString: 'A-02' }],
    };

    expect(getMostRecentAdtmcA01ClinicalImpression([nonA01])).toBeUndefined();
  });
});