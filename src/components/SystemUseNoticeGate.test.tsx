// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../test-utils/render';
import type { SystemUseNoticeResponse } from './SystemUseNoticeGate';
import { SystemUseNoticeGate } from './SystemUseNoticeGate';

const ENABLED_NOTICE: Extract<SystemUseNoticeResponse, { enabled: true }> = {
  enabled: true,
  version: 'usg-system-use-2026-09-10',
  title: 'U.S. Government System Use Acknowledgment',
  body: 'Approved notice text',
  actionLabel: 'OK',
};

function mockSystemUseNotice(client: MedplumClient, notice: unknown): void {
  const originalGet = client.get.bind(client);
  vi.spyOn(client, 'get').mockImplementation((url, options) => {
    if (String(url).includes('auth/system-use-notice')) {
      if (notice instanceof Error) {
        return Promise.reject(notice) as ReturnType<MedplumClient['get']>;
      }
      return Promise.resolve(notice) as ReturnType<MedplumClient['get']>;
    }
    return originalGet(url, options);
  });
}

function LoginProbe(): JSX.Element {
  const medplum = useMedplum();
  return (
    <button
      type="button"
      onClick={() => void medplum.startLogin({ email: 'admin@example.com', password: 'password' })}
    >
      Probe login
    </button>
  );
}

function setup(client: MedplumClient, props: { skip?: boolean } = {}): void {
  render(
    <MedplumProvider medplum={client}>
      <SystemUseNoticeGate clientId="client-1" projectId="project-1" skip={props.skip}>
        <div>Credentials form</div>
        <LoginProbe />
      </SystemUseNoticeGate>
    </MedplumProvider>
  );
}

describe('SystemUseNoticeGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('Shows children when notice is disabled', async () => {
    const client = new MockClient({ profile: null });
    mockSystemUseNotice(client, { enabled: false });
    setup(client);

    expect(await screen.findByText('Credentials form')).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledWith(expect.stringContaining('auth/system-use-notice?clientId=client-1'));
  });

  test('Blocks credentials until the current notice is acknowledged', async () => {
    const client = new MockClient({ profile: null });
    mockSystemUseNotice(client, ENABLED_NOTICE);
    const startLogin = vi.spyOn(client, 'startLogin');
    setup(client);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Approved notice text')).toBeInTheDocument();
    expect(screen.queryByText('Credentials form')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    });

    expect(await screen.findByText('Credentials form')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Probe login' }));
    });
    expect(startLogin.mock.calls[0][0]).toEqual(
      expect.objectContaining({ systemUseNoticeVersion: 'usg-system-use-2026-09-10' })
    );
  });

  test('Fails closed when the notice cannot be loaded', async () => {
    const client = new MockClient({ profile: null });
    mockSystemUseNotice(client, new Error('network'));
    setup(client);

    expect(await screen.findByText('Sign in unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Credentials form')).not.toBeInTheDocument();
  });

  test('Skips discovery when resuming an existing login', async () => {
    const client = new MockClient({ profile: null });
    const get = vi.spyOn(client, 'get');
    setup(client, { skip: true });

    expect(await screen.findByText('Credentials form')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining('auth/system-use-notice'), expect.anything());
    expect(get.mock.calls.some(([url]) => String(url).includes('auth/system-use-notice'))).toBe(false);
  });
});
