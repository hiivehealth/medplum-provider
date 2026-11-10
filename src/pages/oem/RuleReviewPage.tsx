import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import type { Task } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconAlertCircle, IconCheck, IconChevronRight, IconRefresh } from '@tabler/icons-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import { Link } from 'react-router';
import { OEM_PROJECT_ID } from './ih-review';
import {
  loadRuleReviewDetail,
  loadRuleReviews,
  RULE_CHANGE_REASONS,
  ruleTaskReference,
  submitRuleReview,
  type RuleDecision,
  type RuleReason,
  type RuleReviewDetail,
} from './rule-review';

export function RuleReviewPage(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const actor = profile ? `${profile.resourceType}/${profile.id}` : '';
  const project = medplum.getProject()?.id;
  if (project !== OEM_PROJECT_ID)
    return (
      <Container py="xl">
        <Alert color="yellow" title="OEM Project required">
          Rule reviews are restricted to the Army OEM synthetic demo Project.
        </Alert>
      </Container>
    );
  return <RuleReviewContent key={`${project}|${actor}`} />;
}

function RuleReviewContent(): JSX.Element {
  const medplum = useMedplum();
  const [status, setStatus] = useState<'requested' | 'completed'>('requested');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Task>();
  const [detail, setDetail] = useState<RuleReviewDetail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [detailError, setDetailError] = useState<string>();
  const [decision, setDecision] = useState<RuleDecision>('request-changes');
  const [reason, setReason] = useState<RuleReason | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [receipt, setReceipt] = useState<string>();
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setTasks([]);
    setSelected(undefined);
    setDetail(undefined);
    setConfirm(false);
    loadRuleReviews(medplum, status)
      .then((result) => {
        if (active) setTasks(result);
      })
      .catch(() => {
        if (active) setError('Admin rule reviews are unavailable. Configuration-admin access is required.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [medplum, status, refresh]);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setDetailError(undefined);
    setReason(null);
    setDecision('request-changes');
    setConfirm(false);
    setUncertain(false);
    if (!selected)
      return () => {
        active = false;
      };
    setDetailLoading(true);
    loadRuleReviewDetail(medplum, selected)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch(() => {
        if (active) setDetailError('The exact rule, fingerprint or cited policy history could not be verified.');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [medplum, selected]);

  const current = selected && detail?.task === ruleTaskReference(selected) ? detail : undefined;
  const closed = selected?.status === 'completed';
  const locked =
    saving ||
    uncertain ||
    !current ||
    current.stale ||
    closed ||
    !reason ||
    (decision === 'approve' && current.approvalBlocked);

  async function submit(): Promise<void> {
    if (locked || !selected || !reason || !confirm || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setDetailError(undefined);
    try {
      const result = await submitRuleReview(medplum, selected, decision, reason);
      setReceipt(result);
      setRefresh((value) => value + 1);
    } catch {
      setUncertain(true);
      setDetailError('Decision completion was not confirmed. Reload the review before another decision.');
    } finally {
      inFlight.current = false;
      setSaving(false);
      setConfirm(false);
    }
  }

  return (
    <Container size="xl" py="lg" style={{ overflowWrap: 'anywhere' }}>
      <Stack gap="lg">
        <Group justify="space-between" wrap="wrap">
          <Group>
            <Title order={2}>Noise rule review</Title>
            <Badge color="yellow" variant="light">
              Draft governance
            </Badge>
          </Group>
          <Tooltip label="Reload rule reviews">
            <ActionIcon
              aria-label="Reload rule reviews"
              size="lg"
              variant="default"
              disabled={saving}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Alert color="yellow" title="Clinical execution inactive">
          Admin content approval is separate from clinical activation. No patient evaluation or orders are enabled.
        </Alert>
        {receipt && (
          <Alert color="green" icon={<IconCheck size={18} />} title="Decision recorded">
            <Anchor component={Link} to={`/${receipt.split('/').slice(0, 2).join('/')}/history`}>
              {receipt}
            </Anchor>
          </Alert>
        )}
        <Group justify="space-between" wrap="wrap">
          <SegmentedControl
            aria-label="Rule review status"
            value={status}
            disabled={saving}
            data={[
              { value: 'requested', label: 'Open' },
              { value: 'completed', label: 'Reviewed' },
            ]}
            onChange={(value) => setStatus(value as 'requested' | 'completed')}
          />
          {!loading && !error && (
            <Text size="sm" c="dimmed">
              {tasks.length === 50 ? 'Latest 50 reviews; additional records may exist' : `${tasks.length} reviews`}
            </Text>
          )}
        </Group>
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />} title="Reviews unavailable">
            {error}
          </Alert>
        )}
        {loading ? (
          <Group>
            <Loader size="sm" />
            <Text>Loading rule reviews</Text>
          </Group>
        ) : (
          !error && (
            <Table.ScrollContainer minWidth={640}>
              <Table highlightOnHover style={{ whiteSpace: 'nowrap', overflowWrap: 'normal' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Rule</Table.Th>
                    <Table.Th>Requested</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {tasks.map((task) => (
                    <Table.Tr key={task.id}>
                      <Table.Td>Noise 503</Table.Td>
                      <Table.Td>{task.authoredOn ?? 'Not recorded'}</Table.Td>
                      <Table.Td>{task.status === 'completed' ? 'Reviewed' : 'Open'}</Table.Td>
                      <Table.Td>
                        <Tooltip label="Open rule review">
                          <ActionIcon
                            aria-label={`Open rule review ${task.id}`}
                            variant="subtle"
                            disabled={saving}
                            onClick={() => setSelected(task)}
                          >
                            <IconChevronRight size={18} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )
        )}
        {!loading && !error && tasks.length === 0 && (
          <Text c="dimmed">No {status === 'requested' ? 'open' : 'reviewed'} rule reviews.</Text>
        )}
        {detailLoading && selected && (
          <Group>
            <Loader size="sm" />
            <Text>Verifying rule and policy histories</Text>
          </Group>
        )}
        {detailError && (
          <Alert color="red" title="Review unavailable">
            {detailError}
          </Alert>
        )}
        {current && (
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Title order={3}>{current.rule.title ?? 'Noise 503 / Matrix Edition 13'}</Title>
              <Badge color="gray">Not activated</Badge>
            </Group>
            <Text size="sm">Rule version: {current.rule.version}</Text>
            <Anchor component={Link} to={`/PlanDefinition/${current.rule.id}/history`}>
              {selected?.focus?.reference}
            </Anchor>
            <Text size="sm">SHA-256: {current.fingerprint}</Text>
            {current.rule.relatedArtifact?.map((item, index) => (
              <Text key={index} size="sm">
                {item.display}
              </Text>
            ))}
            <Title order={4}>Source and policy evidence</Title>
            {[current.source, ...current.policyDocuments].map((document) => (
              <Stack key={document.id} gap={2}>
                <Text size="sm">
                  {document.content?.[0]?.attachment.title ?? document.description ?? 'Policy document'}
                </Text>
                <Anchor
                  component={Link}
                  to={`/DocumentReference/${document.id}/history`}
                >{`DocumentReference/${document.id}/_history/${document.meta?.versionId}`}</Anchor>
              </Stack>
            ))}
            <Title order={4}>Source-derived actions</Title>
            {current.rule.action?.map((action) => (
              <Stack key={action.id} gap="xs" component="section" aria-label={action.title ?? action.id}>
                <Text fw={600}>{action.title}</Text>
                <Text size="sm">{action.description ?? 'No interpretation recorded'}</Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  {(action.id === 'baseline' || action.timingDuration) && (
                    <Stack gap={2}>
                      <Text size="sm">Duration: {action.timingDuration?.value ?? 'Not recorded'}</Text>
                      <Text size="sm">
                        Duration unit: {action.timingDuration?.code ?? action.timingDuration?.unit ?? 'Not recorded'}
                      </Text>
                      <Text size="sm">Unit system: {action.timingDuration?.system ?? 'Not recorded'}</Text>
                    </Stack>
                  )}
                  {(action.id === 'periodic' || action.timingTiming) && (
                    <Stack gap={2}>
                      <Text size="sm">Frequency: {action.timingTiming?.repeat?.frequency ?? 'Not recorded'}</Text>
                      <Text size="sm">Period: {action.timingTiming?.repeat?.period ?? 'Not recorded'}</Text>
                      <Text size="sm">Period unit: {action.timingTiming?.repeat?.periodUnit ?? 'Not recorded'}</Text>
                    </Stack>
                  )}
                </SimpleGrid>
                {[
                  ['baseline', 'Baseline anchor', 'oem-baseline-anchor'],
                  ['periodic', 'Periodic anchor', 'oem-periodic-anchor'],
                  ['termination', 'Termination handling', 'oem-termination-policy'],
                ]
                  .filter(([id]) => id === action.id)
                  .map(([, label, extension]) => (
                    <Text key={extension} size="sm">
                      {label}:{' '}
                      {action.extension?.find(
                        (item) => item.url === `https://hiivehealth.com/fhir/StructureDefinition/${extension}`
                      )?.valueCode ?? 'Not recorded'}
                    </Text>
                  ))}
              </Stack>
            ))}
            {!current.rule.action?.length && <Text size="sm">No structured actions recorded.</Text>}
            <Title order={4}>Policy resolutions</Title>
            {current.rule.extension
              ?.filter((item) => item.url === 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule-resolution')
              .map((resolution, index) => {
                const code = resolution.extension?.find((item) => item.url === 'code')?.valueCode;
                const disposition = resolution.extension?.find((item) => item.url === 'disposition')?.valueCode;
                const evidence = resolution.extension?.find((item) => item.url === 'evidence')?.valueReference
                  ?.reference;
                return (
                  <Stack key={index} gap={2} component="section" aria-label={`Policy resolution ${code ?? index + 1}`}>
                    <Text fw={600}>{code?.replaceAll('-', ' ') ?? 'Requirement not recorded'}</Text>
                    <Text size="sm">Disposition: {disposition ?? 'Not recorded'}</Text>
                    {evidence ? (
                      <Anchor component={Link} to={`/${evidence.split('/').slice(0, 2).join('/')}/history`}>
                        {evidence}
                      </Anchor>
                    ) : (
                      <Text size="sm">Evidence: Not recorded</Text>
                    )}
                  </Stack>
                );
              })}
            {!current.rule.extension?.some(
              (item) => item.url === 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule-resolution'
            ) && <Text size="sm">No policy resolutions recorded.</Text>}
            <Title order={4}>Unresolved requirements</Title>
            {current.blockers.length ? (
              current.blockers.map((item) => (
                <Stack key={item.code} gap={2}>
                  <Text fw={600}>{item.code.replaceAll('-', ' ')}</Text>
                  <Text size="sm">{item.description}</Text>
                </Stack>
              ))
            ) : (
              <Text>No open requirement markers.</Text>
            )}
            {current.stale && (
              <Alert color="yellow" title="Review changed">
                The current rule or review Task differs. Reload before deciding.
              </Alert>
            )}
            {current.approvalBlocked && !closed && (
              <Alert color="yellow" title="Approval blocked">
                Cited policy resolutions are incomplete.
              </Alert>
            )}
            {closed ? (
              <Stack gap="xs">
                <Title order={4}>Recorded decision</Title>
                {selected?.output?.map((output, index) => (
                  <Text key={index} size="sm">
                    {output.type.text}:{' '}
                    {output.valueCode ??
                      output.valueDateTime ??
                      output.valueReference?.reference ??
                      output.valueString ??
                      'Not recorded'}
                  </Text>
                ))}
                <Text size="sm">Reason: {selected?.statusReason?.coding?.[0]?.code ?? 'Not recorded'}</Text>
              </Stack>
            ) : (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Select
                    label="Decision"
                    value={decision}
                    disabled={saving || uncertain || current.stale}
                    data={[
                      { value: 'request-changes', label: 'Request changes' },
                      { value: 'approve', label: 'Approve content', disabled: current.approvalBlocked },
                    ]}
                    onChange={(value) => {
                      setDecision(value as RuleDecision);
                      setReason(null);
                    }}
                  />
                  <Select
                    label="Decision reason"
                    placeholder="Select reason"
                    value={reason}
                    disabled={saving || uncertain || current.stale}
                    data={
                      decision === 'approve'
                        ? [{ value: 'source-contract-verified', label: 'Source and contract verified' }]
                        : [...RULE_CHANGE_REASONS]
                    }
                    onChange={(value) => setReason(value as RuleReason | null)}
                  />
                </SimpleGrid>
                <Button
                  leftSection={<IconCheck size={16} />}
                  disabled={Boolean(locked)}
                  onClick={() => setConfirm(true)}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Review decision
                </Button>
              </>
            )}
          </Stack>
        )}
        <Modal
          opened={confirm}
          onClose={() => {
            if (!saving) setConfirm(false);
          }}
          title="Confirm rule-content decision"
          closeOnClickOutside={!saving}
          closeOnEscape={!saving}
          withCloseButton={!saving}
        >
          <Stack>
            <Text>Decision: {decision === 'approve' ? 'Approve content' : 'Request changes'}</Text>
            <Text>Reason: {reason}</Text>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {current?.task}
            </Text>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {selected?.focus?.reference}
            </Text>
            <Text size="sm">Clinical activation: inactive</Text>
            <Group justify="flex-end">
              <Button variant="default" disabled={saving} onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button
                leftSection={<IconCheck size={16} />}
                loading={saving}
                disabled={Boolean(locked)}
                onClick={() => void submit()}
              >
                Record decision
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}
