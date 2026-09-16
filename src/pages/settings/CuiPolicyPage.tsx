import { Alert, Button, Stack, Title } from '@mantine/core';
import { normalizeOperationOutcome } from '@medplum/core';
import type { OperationOutcome, Project, Resource } from '@medplum/fhirtypes';
import { Document, Loading, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ResourceFormWithRequiredProfile } from '../../components/ResourceFormWithRequiredProfile';
import { useCuiPolicy } from '../../cui/CuiPolicyProvider';
import { CUI_ENABLED_URL, CUI_PROJECT_PROFILE_URL, setCuiEnabled } from '../../cui/policy';

/** Profile-driven Project editor. Server permissions remain authoritative for every save. */
export function CuiPolicyPage(): JSX.Element {
  const medplum = useMedplum();
  const { state, refresh } = useCuiPolicy();
  const projectId = state.status === 'ready' && state.policy.canManage ? state.policy.projectId : undefined;
  const [project, setProject] = useState<Project>();
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<OperationOutcome>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setProject(undefined);
    setError(undefined);
    if (!projectId) {
      return;
    }
    let cancelled = false;
    medplum
      .readResource('Project', projectId, { cache: 'no-store' })
      .then((value) => {
        if (!cancelled) {
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
  }, [medplum, projectId]);

  const save = async (resource: Resource): Promise<void> => {
    if (resource.resourceType !== 'Project' || resource.id !== projectId || !project?.meta?.versionId) {
      return;
    }
    setOutcome(undefined);
    setSaved(false);
    try {
      const updated = await medplum.updateResource(resource, {
        headers: { 'If-Match': `W/"${project.meta.versionId}"` },
      });
      setProject(updated);
      setSaved(true);
      refresh();
    } catch (err) {
      setOutcome(normalizeOperationOutcome(err));
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
        {projectId && project?.id === projectId && (
          <ResourceFormWithRequiredProfile
            key={`${projectId}/${project.meta?.versionId}`}
            defaultValue={project}
            profileUrl={CUI_PROJECT_PROFILE_URL}
            missingProfileMessage="The CUI Project profile must be installed by a platform operator."
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
