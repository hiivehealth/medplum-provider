import { Alert, Button, Stack, Title } from '@mantine/core';
import { normalizeOperationOutcome } from '@medplum/core';
import type { Basic, OperationOutcome, Resource } from '@medplum/fhirtypes';
import { Document, Loading, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ResourceFormWithRequiredProfile } from '../../components/ResourceFormWithRequiredProfile';
import { useCuiPolicy } from '../../features/cui/CuiPolicyProvider';
import {
  CUI_CONFIGURATION_PROFILE_URL,
  CUI_ENABLED_URL,
  createCuiConfiguration,
  setCuiEnabled,
} from '../../features/cui/policy';

/** Profile-driven configuration editor. Server permissions remain authoritative for every save. */
export function CuiPolicyPage(): JSX.Element {
  const { state } = useCuiPolicy();
  const identity =
    state.status === 'ready'
      ? `${state.policy.projectId}/${state.policy.configurationId ?? 'new'}/${state.policy.canManage}`
      : state.status;
  return <CuiPolicyEditor key={identity} />;
}

function CuiPolicyEditor(): JSX.Element {
  const medplum = useMedplum();
  const { state, refresh } = useCuiPolicy();
  const projectId = state.status === 'ready' && state.policy.canManage ? state.policy.projectId : undefined;
  const configurationId = state.status === 'ready' && state.policy.canManage ? state.policy.configurationId : undefined;
  const [project, setProject] = useState<Basic>();
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<OperationOutcome>();
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    setProject(undefined);
    setError(undefined);
    if (!projectId) {
      return;
    }
    if (!configurationId) {
      setProject(createCuiConfiguration(projectId));
      return;
    }
    let cancelled = false;
    medplum
      .readResource('Basic', configurationId, { cache: 'no-store' })
      .then((value) => {
        if (!cancelled) {
          if (value.meta?.project !== projectId) throw new Error('Configuration project mismatch');
          setProject(
            setCuiEnabled(value, value.extension?.find((e) => e.url === CUI_ENABLED_URL)?.valueBoolean === true)
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Unable to read project security configuration.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [medplum, projectId, configurationId]);

  const save = async (resource: Resource): Promise<void> => {
    if (
      saving.current ||
      !active.current ||
      resource.resourceType !== 'Basic' ||
      resource.meta?.project !== projectId ||
      (configurationId ? resource.id !== configurationId || !project?.meta?.versionId : Boolean(resource.id))
    ) {
      return;
    }
    saving.current = true;
    setOutcome(undefined);
    setSaved(false);
    try {
      const updated = configurationId
        ? await medplum.updateResource(resource, {
            headers: { 'If-Match': `W/"${project?.meta?.versionId}"` },
          })
        : await medplum.createResource(resource);
      if (!active.current) return;
      setProject(updated);
      setSaved(true);
      refresh();
    } catch (err) {
      if (active.current) setOutcome(normalizeOperationOutcome(err));
    } finally {
      saving.current = false;
    }
  };

  return (
    <Document>
      <Stack>
        <Title order={1}>Project security configuration</Title>
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && (
          <Alert color="red" title="Configuration unavailable">
            The project policy service could not be reached. <Button onClick={refresh}>Retry</Button>
          </Alert>
        )}
        {(state.status === 'unauthenticated' || (state.status === 'ready' && !state.policy.canManage)) && (
          <Alert color="red" title="Permission denied">
            Project security administrator access is required.
          </Alert>
        )}
        {error && <Alert color="red">{error}</Alert>}
        {projectId && !project && !error && <Loading />}
        {projectId && project && project.meta?.project === projectId && (
          <ResourceFormWithRequiredProfile
            key={`${projectId}/${project.meta?.versionId}`}
            defaultValue={project}
            profileUrl={CUI_CONFIGURATION_PROFILE_URL}
            missingProfileMessage="The CUI configuration profile must be installed by a platform operator."
            outcome={outcome}
            onSubmit={(resource) => {
              void save(resource);
            }}
          />
        )}
        {saved && <Alert color="green">Project configuration saved.</Alert>}
      </Stack>
    </Document>
  );
}
