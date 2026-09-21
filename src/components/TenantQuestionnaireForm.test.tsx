import { MantineProvider } from '@mantine/core';
import type { Bundle, Patient, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TenantQuestionnaireForm } from './TenantQuestionnaireForm';

const questionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'active',
  item: [
    {
      linkId: 'dod-id',
      text: 'DoD ID',
      type: 'string',
      required: true,
      maxLength: 10,
      extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/regex', valueString: '^[0-9]{10}$' }],
    },
  ],
};

const patient: Patient = {
  resourceType: 'Patient',
  id: 'patient-1',
  name: [{ family: 'Existing' }],
};

let medplum: MockClient;
let responseToSubmit: QuestionnaireResponse = {
  resourceType: 'QuestionnaireResponse',
  status: 'completed',
  item: [{ linkId: 'dod-id', answer: [{ valueString: '1234567890' }] }],
};

vi.mock('@medplum/react', async () => {
  const actual = await vi.importActual<typeof import('@medplum/react')>('@medplum/react');
  return {
    ...actual,
    QuestionnaireForm: ({ onSubmit }: { onSubmit: (response: QuestionnaireResponse) => void }): JSX.Element => (
      <button onClick={() => onSubmit(responseToSubmit)}>Submit questionnaire</button>
    ),
  };
});

function TestHarness({ onSubmit }: { onSubmit: (resource: Patient, response: QuestionnaireResponse) => Promise<void> }): JSX.Element {
  return (
    <MedplumProvider medplum={medplum}>
      <MantineProvider>
        <TenantQuestionnaireForm questionnaire={questionnaire} patient={patient} onSubmit={onSubmit} />
      </MantineProvider>
    </MedplumProvider>
  );
}

describe('TenantQuestionnaireForm', () => {
  beforeEach(() => {
    medplum = new MockClient();
    vi.spyOn(medplum, 'post').mockResolvedValue({
      entry: [{ resource: { resourceType: 'Patient', id: 'patient-1', name: [{ family: 'Updated' }] } }],
    } as Bundle);
    responseToSubmit = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [{ linkId: 'dod-id', answer: [{ valueString: '1234567890' }] }],
    };
  });

  test('extracts a valid response and submits the extracted Patient', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TestHarness onSubmit={onSubmit} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit questionnaire' })).toBeInTheDocument());
    screen.getByRole('button', { name: 'Submit questionnaire' }).click();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'Patient', id: 'patient-1' }),
      expect.objectContaining({ subject: expect.objectContaining({ reference: 'Patient/patient-1' }) })
    );
  });

  test('blocks invalid responses before extraction', async () => {
    responseToSubmit.item = [{ linkId: 'dod-id', answer: [{ valueString: 'invalid' }] }];
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TestHarness onSubmit={onSubmit} />);

    screen.getByRole('button', { name: 'Submit questionnaire' }).click();

    expect(await screen.findByText('DoD ID has an invalid format.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
