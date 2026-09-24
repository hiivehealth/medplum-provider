// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { WithId } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { ClinicalImpression, Encounter, Practitioner, Provenance, QuestionnaireResponse, Task } from '@medplum/fhirtypes';
import { HomerSimpson, MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { SOAP_SUBJECTIVE_URL } from '../../data/soap-questionnaires';
import { EncounterChart } from './EncounterChart';

const mockPractitioner: WithId<Practitioner> = {
  resourceType: 'Practitioner',
  id: 'practitioner-123',
  name: [{ given: ['Dr.'], family: 'Test' }],
};

const mockEncounter: WithId<Encounter> = {
  resourceType: 'Encounter',
  id: 'encounter-123',
  status: 'in-progress',
  class: {
    system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
    code: 'AMB',
  },
  subject: { reference: `Patient/${HomerSimpson.id}` },
  participant: [
    {
      individual: createReference(mockPractitioner),
    },
  ],
};

const mockClinicalImpression: ClinicalImpression = {
  resourceType: 'ClinicalImpression',
  id: 'clinical-123',
  status: 'in-progress',
  subject: createReference(HomerSimpson),
  encounter: createReference(mockEncounter),
  note: [{ text: 'Test clinical note' }],
};

const mockTask: Task = {
  resourceType: 'Task',
  id: 'task-123',
  status: 'in-progress',
  intent: 'order',
  encounter: createReference(mockEncounter),
  authoredOn: '2024-01-01T10:00:00Z',
};

const mockSubjectiveResponse: QuestionnaireResponse = {
  resourceType: 'QuestionnaireResponse',
  status: 'in-progress',
  questionnaire: SOAP_SUBJECTIVE_URL,
  subject: createReference(HomerSimpson),
  encounter: createReference(mockEncounter),
  item: [
    {
      linkId: 'complaint',
      item: [
        { linkId: 'complaint-text', answer: [{ valueString: 'Sore throat' }] },
        { linkId: 'complaint-is-chief', answer: [{ valueBoolean: true }] },
      ],
    },
  ],
};

describe('EncounterChart', () => {
  let medplum: MockClient;

  beforeEach(async () => {
    medplum = new MockClient();
    await medplum.createResource(mockPractitioner);
    await medplum.createResource(mockEncounter);
    await medplum.createResource(mockClinicalImpression);
    await medplum.createResource({ resourceType: 'Questionnaire', status: 'active', url: SOAP_SUBJECTIVE_URL });
    await medplum.createResource(mockSubjectiveResponse);
    vi.clearAllMocks();
  });

  const setup = (props: Partial<Parameters<typeof EncounterChart>[0]> = {}): ReturnType<typeof render> => {
    return render(
      <MemoryRouter>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <EncounterChart encounter={mockEncounter} {...props} />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  };

  test('renders loading spinner initially', async () => {
    setup();
    // The Loading component renders a spinner, not text
    const loader = document.querySelector('.mantine-Loader-root');
    expect(loader).toBeInTheDocument();
    // Drain pending async state updates so they don't escape the test
    await act(async () => {});
  });

  test('renders encounter header after loading', async () => {
    setup();

    await waitFor(() => {
      expect(screen.getByText('Visit')).toBeInTheDocument();
    });
  });

  test('displays tasks when available', async () => {
    await medplum.createResource(mockTask);

    setup();

    await waitFor(() => {
      expect(screen.getByText('Visit')).toBeInTheDocument();
    });
  });

  test('hides Room and Station for SOAP notes by default', async () => {
    setup();

    await waitFor(() => {
      expect(screen.getByText('Visit')).toBeInTheDocument();
    });

    expect(screen.queryByText('Room and Station')).not.toBeInTheDocument();
  });

  test('switches to details tab when clicked', async () => {
    const user = userEvent.setup();
    setup();

    await waitFor(() => {
      expect(screen.getByText('Visit')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Subjective')).toBeInTheDocument();
    });

    const detailsTab = screen.getByText('Details & Billing');
    await user.click(detailsTab);

    await waitFor(() => {
      expect(screen.queryByText('Room and Station')).not.toBeInTheDocument();
    });
  });

  test('switches back to notes tab when clicked', async () => {
    const user = userEvent.setup();
    setup();

    await waitFor(() => {
      expect(screen.getByText('Visit')).toBeInTheDocument();
    });

    const detailsTab = screen.getByText('Details & Billing');
    await user.click(detailsTab);

    await waitFor(() => {
      expect(screen.queryByText('Room and Station')).not.toBeInTheDocument();
    });

    const notesTab = screen.getByText('Note & Tasks');
    await user.click(notesTab);

    await waitFor(() => {
      expect(screen.getByText('Subjective')).toBeInTheDocument();
    });
  });

  test('displays billing tab content when details tab is active', async () => {
    const user = userEvent.setup();
    setup();

    await waitFor(() => {
      expect(screen.getByText('Visit')).toBeInTheDocument();
    });

    const detailsTab = screen.getByText('Details & Billing');
    await user.click(detailsTab);

    await waitFor(() => {
      expect(screen.queryByText('Room and Station')).not.toBeInTheDocument();
    });
  });

  test('fetches provenances on mount', async () => {
    vi.spyOn(medplum, 'searchResources').mockResolvedValue([] as any);

    setup();

    await waitFor(() => {
      expect(medplum.searchResources).toHaveBeenCalledWith(
        'Provenance',
        expect.stringContaining('target=Encounter/encounter-123')
      );
    });
  });

  test('handles encounter status change', async () => {
    const user = userEvent.setup();
    vi.spyOn(medplum, 'updateResource').mockResolvedValue({ ...mockEncounter, status: 'finished' } as any);

    setup();

    await waitFor(() => {
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });

    const statusButton = screen.getByText('In Progress');
    await user.click(statusButton);

    await waitFor(() => {
      expect(screen.getByText('Finished')).toBeInTheDocument();
    });
  });

  test('renders with encounter reference', async () => {
    const encounterRef = { reference: 'Encounter/encounter-123' };

    await act(async () => {
      setup({ encounter: encounterRef });
    });

    await waitFor(() => {
      expect(screen.getByText('Visit')).toBeInTheDocument();
    });
  });

  test('fetches tasks for encounter', async () => {
    await medplum.createResource(mockTask);

    vi.spyOn(medplum, 'searchResources');

    setup();

    await waitFor(() => {
      expect(medplum.searchResources).toHaveBeenCalledWith(
        'Task',
        expect.stringContaining('encounter=Encounter/encounter-123'),
        expect.any(Object)
      );
    });
  });

  test('fetches clinical impressions for encounter', async () => {
    vi.spyOn(medplum, 'searchResources');

    setup();

    await waitFor(() => {
      expect(medplum.searchResources).toHaveBeenCalledWith(
        'ClinicalImpression',
        expect.stringContaining('encounter=Encounter/encounter-123')
      );
    });
  });

  describe('signing functionality', () => {
    const finishedEncounter: WithId<Encounter> = {
      ...mockEncounter,
      status: 'finished',
    };

    const getSignButton = (): HTMLElement | null => {
      const buttons = screen.getAllByRole('button');
      return buttons.find((btn) => btn.querySelector('svg') && !btn.textContent?.trim()) || null;
    };

    test('signs without locking - textarea remains enabled', async () => {
      const user = userEvent.setup();
      const mockProvenance: Provenance = {
        resourceType: 'Provenance',
        id: 'provenance-1',
        target: [createReference(finishedEncounter)],
        recorded: new Date().toISOString(),
        agent: [
          {
            who: createReference(mockPractitioner),
          },
        ],
      };

      // Mock searchResources to return empty initially, then return provenance after signing
      let provenanceReturned = false;
      vi.spyOn(medplum, 'searchResources').mockImplementation((resourceType: string) => {
        if (resourceType === 'Provenance') {
          return Promise.resolve(provenanceReturned ? [mockProvenance] : []) as any;
        }
        if (resourceType === 'ClinicalImpression') {
          return Promise.resolve([mockClinicalImpression]) as any;
        }
        if (resourceType === 'Task') {
          return Promise.resolve([]) as any;
        }
        return Promise.resolve([]) as any;
      });

      vi.spyOn(medplum, 'createResource').mockImplementation(async (resource: any) => {
        if (resource.resourceType === 'Provenance') {
          provenanceReturned = true;
          return mockProvenance as any;
        }
        return resource;
      });

      await medplum.createResource(finishedEncounter);
      setup({ encounter: finishedEncounter });

      await waitFor(() => {
        expect(screen.getByText('Subjective')).toBeInTheDocument();
      });

      await waitFor(() => {
        const signButton = getSignButton();
        expect(signButton).toBeInTheDocument();
      });

      const signButton = getSignButton();
      if (signButton) {
        await user.click(signButton);
      }

      await waitFor(() => {
        expect(screen.getByText('Just Sign')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Just Sign'));

      await waitFor(() => {
        expect(medplum.createResource).toHaveBeenCalledWith(
          expect.objectContaining({
            resourceType: 'Provenance',
            target: [createReference(finishedEncounter)],
          })
        );
      });

    });

    test('signs with locking', async () => {
      const user = userEvent.setup();
      const completedClinicalImpression: ClinicalImpression = {
        ...mockClinicalImpression,
        status: 'completed',
      };
      const mockProvenance: Provenance = {
        resourceType: 'Provenance',
        id: 'provenance-1',
        target: [createReference(finishedEncounter)],
        recorded: new Date().toISOString(),
        agent: [
          {
            who: createReference(mockPractitioner),
          },
        ],
      };

      // Mock searchResources to return empty initially, then return provenance after signing
      let provenanceReturned = false;
      vi.spyOn(medplum, 'searchResources').mockImplementation((resourceType: string) => {
        if (resourceType === 'Provenance') {
          return Promise.resolve(provenanceReturned ? [mockProvenance] : []) as any;
        }
        if (resourceType === 'ClinicalImpression') {
          return Promise.resolve([completedClinicalImpression]) as any;
        }
        if (resourceType === 'Task') {
          return Promise.resolve([]) as any;
        }
        return Promise.resolve([]) as any;
      });

      vi.spyOn(medplum, 'createResource').mockImplementation(async (resource: any) => {
        if (resource.resourceType === 'Provenance') {
          provenanceReturned = true;
          return mockProvenance as any;
        }
        return resource;
      });

      await medplum.createResource(finishedEncounter);
      setup({ encounter: finishedEncounter });

      await waitFor(() => {
        expect(screen.getByText('Subjective')).toBeInTheDocument();
      });

      await waitFor(() => {
        const signButton = getSignButton();
        expect(signButton).toBeInTheDocument();
      });

      const signButton = getSignButton();
      if (signButton) {
        await user.click(signButton);
      }

      await waitFor(() => {
        expect(screen.getByText('Sign & Lock Note')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Sign & Lock Note'));

      await waitFor(() => {
        expect(medplum.createResource).toHaveBeenCalledWith(
          expect.objectContaining({
            resourceType: 'Provenance',
            target: [createReference(finishedEncounter)],
          })
        );
      });

    });

    test('signs with locking - completes incomplete tasks', async () => {
      const user = userEvent.setup();
      const incompleteTask: Task = {
        ...mockTask,
        id: 'task-incomplete',
        status: 'in-progress',
      };
      const completedTask: Task = {
        ...incompleteTask,
        status: 'completed',
      };

      const completedClinicalImpression: ClinicalImpression = {
        ...mockClinicalImpression,
        status: 'completed',
      };
      const mockProvenance: Provenance = {
        resourceType: 'Provenance',
        id: 'provenance-1',
        target: [createReference(finishedEncounter)],
        recorded: new Date().toISOString(),
        agent: [
          {
            who: createReference(mockPractitioner),
          },
        ],
      };

      await medplum.createResource(incompleteTask);
      let provenanceReturned = false;
      vi.spyOn(medplum, 'updateResource').mockResolvedValue(completedTask as any);
      vi.spyOn(medplum, 'createResource').mockImplementation(async (resource: any) => {
        if (resource.resourceType === 'Provenance') {
          provenanceReturned = true;
          return mockProvenance as any;
        }
        return resource;
      });
      vi.spyOn(medplum, 'searchResources').mockImplementation((resourceType: string) => {
        if (resourceType === 'Provenance') {
          return Promise.resolve(provenanceReturned ? [mockProvenance] : []) as any;
        }
        if (resourceType === 'ClinicalImpression') {
          return Promise.resolve([completedClinicalImpression]) as any;
        }
        if (resourceType === 'Task') {
          return Promise.resolve([incompleteTask]) as any;
        }
        return Promise.resolve([]) as any;
      });

      await medplum.createResource(finishedEncounter);
      setup({ encounter: finishedEncounter });

      await waitFor(() => {
        expect(screen.getByText('Subjective')).toBeInTheDocument();
      });

      await waitFor(() => {
        const signButton = getSignButton();
        expect(signButton).toBeInTheDocument();
      });

      const signButton = getSignButton();
      if (signButton) {
        await user.click(signButton);
      }

      await waitFor(() => {
        expect(screen.getByText('Sign & Lock Note')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Sign & Lock Note'));

      // Verify that incomplete tasks are updated to completed
      await waitFor(
        () => {
          expect(medplum.updateResource).toHaveBeenCalledWith(
            expect.objectContaining({
              resourceType: 'Task',
              id: 'task-incomplete',
              status: 'completed',
            })
          );
        },
        { timeout: 3000 }
      );
    });

    test('signs with locking - does not update already completed tasks', async () => {
      const user = userEvent.setup();
      const completedTask: Task = {
        ...mockTask,
        id: 'task-completed',
        status: 'completed',
      };

      const completedClinicalImpression: ClinicalImpression = {
        ...mockClinicalImpression,
        status: 'completed',
      };
      const mockProvenance: Provenance = {
        resourceType: 'Provenance',
        id: 'provenance-1',
        target: [createReference(finishedEncounter)],
        recorded: new Date().toISOString(),
        agent: [
          {
            who: createReference(mockPractitioner),
          },
        ],
      };

      await medplum.createResource(completedTask);
      let provenanceReturned = false;
      vi.spyOn(medplum, 'updateResource');
      vi.spyOn(medplum, 'createResource').mockImplementation(async (resource: any) => {
        if (resource.resourceType === 'Provenance') {
          provenanceReturned = true;
          return mockProvenance as any;
        }
        return resource;
      });
      vi.spyOn(medplum, 'searchResources').mockImplementation((resourceType: string) => {
        if (resourceType === 'Provenance') {
          return Promise.resolve(provenanceReturned ? [mockProvenance] : []) as any;
        }
        if (resourceType === 'ClinicalImpression') {
          return Promise.resolve([completedClinicalImpression]) as any;
        }
        if (resourceType === 'Task') {
          return Promise.resolve([completedTask]) as any;
        }
        return Promise.resolve([]) as any;
      });

      await medplum.createResource(finishedEncounter);
      setup({ encounter: finishedEncounter });

      await waitFor(() => {
        expect(screen.getByText('Subjective')).toBeInTheDocument();
      });

      await waitFor(() => {
        const signButton = getSignButton();
        expect(signButton).toBeInTheDocument();
      });

      const signButton = getSignButton();
      if (signButton) {
        await user.click(signButton);
      }

      await waitFor(() => {
        expect(screen.getByText('Sign & Lock Note')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Sign & Lock Note'));

      await waitFor(
        () => {
          expect(medplum.createResource).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // Verify that completed tasks are not updated
      const updateCalls = vi.mocked(medplum.updateResource).mock.calls;
      const taskUpdateCalls = updateCalls.filter((call) => call[0]?.resourceType === 'Task');
      expect(taskUpdateCalls).toHaveLength(0);
    });

  });
});
