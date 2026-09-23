// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Modal, Stack, Text } from '@mantine/core';
import type { MedplumClient } from '@medplum/core';
import { useMedplum } from '@medplum/react';
import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';

export type SystemUseNoticeResponse =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly version: string;
      readonly title: string;
      readonly body: string;
      readonly actionLabel: string;
    };

export interface SystemUseNoticeGateProps {
  readonly clientId?: string;
  readonly projectId?: string;
  readonly skip?: boolean;
  readonly children: ReactNode;
}

export function buildSystemUseNoticePath(clientId?: string, projectId?: string): string {
  const search = new URLSearchParams();
  if (clientId) {
    search.set('clientId', clientId);
  }
  if (projectId) {
    search.set('projectId', projectId);
  }
  const query = search.toString();
  return query ? `auth/system-use-notice?${query}` : 'auth/system-use-notice';
}

function isSystemUseNoticeResponse(value: unknown): value is SystemUseNoticeResponse {
  if (!value || typeof value !== 'object' || !('enabled' in value)) {
    return false;
  }
  const notice = value as SystemUseNoticeResponse;
  if (notice.enabled === false) {
    return true;
  }
  return (
    notice.enabled === true &&
    typeof notice.version === 'string' &&
    notice.version.length > 0 &&
    typeof notice.title === 'string' &&
    typeof notice.body === 'string' &&
    typeof notice.actionLabel === 'string'
  );
}

/**
 * Blocks sign-in credentials until the current system use notice is acknowledged.
 * Acknowledgement is in-memory only and is required again on every fresh mount.
 */
export function SystemUseNoticeGate(props: SystemUseNoticeGateProps): JSX.Element {
  const medplum = useMedplum();
  const [notice, setNotice] = useState<SystemUseNoticeResponse | undefined>(props.skip ? { enabled: false } : undefined);
  const [noticeVersion, setNoticeVersion] = useState<string>();
  const [noticeError, setNoticeError] = useState(false);
  const [noticeRequest, setNoticeRequest] = useState(0);

  useEffect(() => {
    if (props.skip) {
      return;
    }
    let active = true;
    setNotice(undefined);
    setNoticeError(false);
    void Promise.resolve()
      .then(() => medplum.get(buildSystemUseNoticePath(props.clientId, props.projectId)))
      .then((result: unknown) => {
        if (!active) {
          return;
        }
        if (isSystemUseNoticeResponse(result)) {
          setNotice(result);
        } else {
          setNoticeError(true);
        }
      })
      .catch(() => {
        if (active) {
          setNoticeError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [medplum, noticeRequest, props.clientId, props.projectId, props.skip]);

  useEffect(() => {
    const originalStartLogin = medplum.startLogin.bind(medplum);
    medplum.startLogin = ((loginRequest, options) => {
      const next = noticeVersion ? { ...loginRequest, systemUseNoticeVersion: noticeVersion } : loginRequest;
      return originalStartLogin(next, options);
    }) as MedplumClient['startLogin'];
    return () => {
      medplum.startLogin = originalStartLogin;
    };
  }, [medplum, noticeVersion]);

  if (noticeError) {
    return (
      <Alert title="Sign in unavailable" color="red">
        <Stack>
          <Text>The system use notice could not be loaded. Credentials cannot be entered.</Text>
          <Button onClick={() => setNoticeRequest((value) => value + 1)}>Retry</Button>
        </Stack>
      </Alert>
    );
  }

  if (!notice) {
    return <Text ta="center">Loading system use notice…</Text>;
  }

  if (notice.enabled && noticeVersion !== notice.version) {
    return (
      <Modal
        opened
        onClose={() => undefined}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title={notice.title}
      >
        <Text style={{ whiteSpace: 'pre-wrap' }}>{notice.body}</Text>
        <Button fullWidth mt="md" onClick={() => setNoticeVersion(notice.version)}>
          {notice.actionLabel}
        </Button>
      </Modal>
    );
  }

  return <>{props.children}</>;
}
