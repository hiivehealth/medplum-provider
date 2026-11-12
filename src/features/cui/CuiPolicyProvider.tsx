// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { useMedplum, useMedplumProfile } from '@medplum/react';
import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { CuiPolicy } from './policy';
import { resolveCuiPolicy } from './policy';

export type CuiPolicyState =
  | { status: 'unauthenticated' }
  | { status: 'loading'; projectId: string }
  | { status: 'ready'; policy: CuiPolicy }
  | { status: 'error'; projectId: string; error: string; lastKnown?: CuiPolicy };

const Context = createContext<{ state: CuiPolicyState; refresh: () => void }>({
  state: { status: 'unauthenticated' },
  refresh: () => {},
});

export function CuiPolicyProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const projectId = profile ? medplum.getProject()?.id : undefined;
  const identity = projectId && profile ? `${projectId}/${profile.resourceType}/${profile.id}` : undefined;
  const [result, setResult] = useState<{ identity: string; state: CuiPolicyState }>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);

  useEffect(() => {
    if (!projectId || !identity) {
      setResult(undefined);
      return undefined;
    }
    let cancelled = false;
    let requestNumber = 0;
    const load = (): void => {
      const request = ++requestNumber;
      resolveCuiPolicy(medplum, projectId).then((policy) => {
        if (!cancelled && request === requestNumber) {
          setResult({ identity, state: { status: 'ready', policy } });
        }
      }).catch((error: unknown) => {
        if (!cancelled && request === requestNumber) {
          setResult((previous) => {
            const state = previous?.identity === identity ? previous.state : undefined;
            let lastKnown: CuiPolicy | undefined;
            if (state?.status === 'ready') {
              lastKnown = state.policy;
            } else if (state?.status === 'error') {
              lastKnown = state.lastKnown;
            }
            return {
              identity,
              state: {
                status: 'error',
                projectId,
                error: error instanceof Error ? error.message : 'Unable to load project policy',
                lastKnown,
              },
            };
          });
        }
      });
    };
    load();
    const interval = window.setInterval(load, 60000);
    const onFocus = load;
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [identity, medplum, projectId, revision]);

  // Synchronous identity check prevents even one render of a previous project's policy.
  let state: CuiPolicyState = { status: 'unauthenticated' };
  if (identity && projectId) {
    state = result?.identity === identity ? result.state : { status: 'loading', projectId };
  }
  return <Context.Provider value={{ state, refresh }}>{children}</Context.Provider>;
}

export function useCuiPolicy(): { state: CuiPolicyState; refresh: () => void } {
  return useContext(Context);
}
