// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { normalizeErrorStringSpy, showSpy } = vi.hoisted(() => ({
  normalizeErrorStringSpy: vi.fn(),
  showSpy: vi.fn(() => 'id'),
}));

vi.mock('@medplum/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@medplum/core')>();
  return {
    ...actual,
    normalizeErrorString: normalizeErrorStringSpy,
  };
});

vi.mock('@mantine/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/notifications')>();
  return {
    ...actual,
    notifications: {
      ...actual.notifications,
      show: showSpy,
    },
  };
});

import { showErrorNotification } from './notifications';

describe('notifications utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    normalizeErrorStringSpy.mockReturnValue('Mock error');
  });

  test('normalizes error and shows notification', () => {
    showErrorNotification('Original error');

    expect(normalizeErrorStringSpy).toHaveBeenCalledWith('Original error');
    expect(showSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'red',
        title: 'Error',
        message: 'Mock error',
      })
    );
  });
});
