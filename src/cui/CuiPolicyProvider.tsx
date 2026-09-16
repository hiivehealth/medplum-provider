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

/** One resolver per authenticated shell; state is never persisted in browser storage. */
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
      return;
    }
    let cancelled = false;
    let requestNumber = 0;
    const load = async (): Promise<void> => {
      const request = ++requestNumber;
      try {
        const policy = await resolveCuiPolicy(medplum, projectId);
        if (!cancelled && request === requestNumber) {
          setResult({ identity, state: { status: 'ready', policy } });
        }
      } catch (error) {
        if (!cancelled && request === requestNumber) {
          setResult((previous) => {
            const state = previous?.identity === identity ? previous.state : undefined;
            const lastKnown =
              state?.status === 'ready' ? state.policy : state?.status === 'error' ? state.lastKnown : undefined;
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
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 60000);
    const onFocus = (): void => {
      void load();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [identity, medplum, projectId, revision]);

  // Synchronous identity check prevents even one render of a previous project's policy.
  const state: CuiPolicyState =
    !identity || !projectId
      ? { status: 'unauthenticated' }
      : result?.identity === identity
        ? result.state
        : { status: 'loading', projectId };
  return <Context.Provider value={{ state, refresh }}>{children}</Context.Provider>;
}

export function useCuiPolicy(): { state: CuiPolicyState; refresh: () => void } {
  return useContext(Context);
}
