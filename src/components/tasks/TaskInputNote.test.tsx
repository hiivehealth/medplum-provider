// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { Practitioner, Task } from '@medplum/fhirtypes';
import { DrAliceSmith, MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { TaskInputNote } from './TaskInputNote';

describe('TaskInputNote', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
    medplum.setProfile(DrAliceSmith as Practitioner);
    vi.clearAllMocks();
  });

  const setup = (
    task: Task,
    props: Partial<React.ComponentProps<typeof TaskInputNote>> = {}
  ): ReturnType<typeof render> => {
    return render(
      <MemoryRouter initialEntries={['/Task/task-123']}>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Routes>
              <Route path="/Task/:taskId" element={<TaskInputNote task={task} {...props} />} />
              <Route path="/Patient/:patientId/Encounter/:encounterId" element={<LocationDisplay />} />
            </Routes>
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  };

  const mockTask: Task = {
    resourceType: 'Task',
    id: 'task-123',
    status: 'in-progress',
    intent: 'order',
    code: { text: 'Test Task' },
    note: [{ text: 'Existing note', time: '2023-01-01T12:00:00Z' }],
  };

  test('renders existing notes', async () => {
    await medplum.createResource(mockTask);
    setup(mockTask);

    // Wait for useResource to resolve
    await waitFor(() => {
      expect(screen.getByText('Existing note')).toBeInTheDocument();
    });
  });

  test('allows adding a new note', async () => {
    await medplum.createResource(mockTask);
    const onTaskChange = vi.fn();
    setup(mockTask, { onTaskChange });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Add a note...')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Add a note...');
    fireEvent.change(input, { target: { value: 'New note content' } });

    const submitButton = screen.getByText('Submit');
    await act(async () => {
      fireEvent.click(submitButton);
    });

    expect(onTaskChange).toHaveBeenCalledWith(
      expect.objectContaining({
        note: expect.arrayContaining([expect.objectContaining({ text: 'New note content' })]),
      })
    );
  });

  test('shows delete confirmation modal', async () => {
    await medplum.createResource(mockTask);
    const onDeleteTask = vi.fn();
    setup(mockTask, { onDeleteTask });

    await waitFor(() => {
      expect(screen.getByLabelText('Delete Task')).toBeInTheDocument();
    });

    const deleteButton = screen.getByLabelText('Delete Task');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('Delete Task', { selector: '.mantine-Modal-title' })).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to delete this task/)).toBeInTheDocument();
    });
  });

  test('calls onDeleteTask when confirmed', async () => {
    await medplum.createResource(mockTask);
    const onDeleteTask = vi.fn();
    setup(mockTask, { onDeleteTask });

    await waitFor(() => {
      expect(screen.getByLabelText('Delete Task')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Delete Task'));

    // Wait for modal to appear
    await waitFor(() => {
      expect(screen.getByText(/Are you sure you want to delete this task/)).toBeInTheDocument();
    });

    const confirmButton = screen.getByRole('button', { name: 'Delete' });

    await act(async () => {
      fireEvent.click(confirmButton);
    });

    expect(onDeleteTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-123' }));
  });

  test('marks task as completed', async () => {
    await medplum.createResource(mockTask);
    const onTaskChange = vi.fn();
    setup(mockTask, { onTaskChange });

    await waitFor(() => {
      expect(screen.getByLabelText('Mark as Completed')).toBeInTheDocument();
    });

    const completeButton = screen.getByLabelText('Mark as Completed');
    await act(async () => {
      fireEvent.click(completeButton);
    });

    expect(onTaskChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  test('claims a linked encounter task before opening the chart', async () => {
    const taskWithEncounter: Task = {
      ...mockTask,
      for: { reference: 'Patient/patient-123' },
      encounter: { reference: 'Encounter/encounter-123' },
    };
    medplum.updateResource = vi.fn().mockResolvedValue({
      ...taskWithEncounter,
      owner: { reference: `Practitioner/${DrAliceSmith.id}` },
      status: 'in-progress',
    });

    setup(taskWithEncounter);

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Claim & Open Encounter' }));
    });

    await waitFor(() => {
      expect(medplum.updateResource).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: expect.objectContaining({ reference: `Practitioner/${DrAliceSmith.id}` }),
          status: 'in-progress',
        })
      );
    });
    expect(await screen.findByText('/Patient/patient-123/Encounter/encounter-123')).toBeInTheDocument();
  });
});

function LocationDisplay(): React.JSX.Element {
  const location = useLocation();
  return <div>{location.pathname}</div>;
}
