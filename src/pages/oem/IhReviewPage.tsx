import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
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
import { useEffect, useState, type JSX } from 'react';
import { Link } from 'react-router';
import {
  keepCurrent,
  loadReviewDetail,
  loadReviews,
  OEM_PROJECT_ID,
  OEM_REVIEW_BOT_ID,
  REVIEW_REASONS,
  reviewReference,
  type ReviewDetail,
  type ReviewReason,
} from './ih-review';

function date(value: string | undefined): string {
  return value ?? 'Not recorded';
}
function label(value: string | undefined): string {
  return value?.replaceAll('-', ' ') ?? 'Not recorded';
}

export function IhReviewPage(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const actor = profile ? `${profile.resourceType}/${profile.id}` : '';
  const projectId = medplum.getProject()?.id;
  const [status, setStatus] = useState<'requested' | 'completed'>('requested');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Task>();
  const [detail, setDetail] = useState<ReviewDetail>();
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [detailError, setDetailError] = useState<string>();
  const [canReview, setCanReview] = useState(false);
  const [reason, setReason] = useState<ReviewReason | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    setSelected(undefined);
    setDetail(undefined);
    setCanReview(false);
    setError(undefined);
    setTasks([]);
    if (projectId !== OEM_PROJECT_ID) {
      return () => {
        active = false;
      };
    }
    setLoading(true);
    loadReviews(medplum, status)
      .then((result) => {
        if (active) {
          setTasks(result);
        }
      })
      .catch(() => {
        if (active) {
          setError('Source reviews are unavailable.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    medplum
      .readResource('Bot', OEM_REVIEW_BOT_ID, { cache: 'no-cache' })
      .then((bot) => {
        if (active) {
          setCanReview(bot.id === OEM_REVIEW_BOT_ID && bot.meta?.project === OEM_PROJECT_ID);
        }
      })
      .catch(() => {
        if (active) {
          setCanReview(false);
        }
      });
    return () => {
      active = false;
    };
  }, [medplum, projectId, actor, status, refresh]);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setDetailError(undefined);
    setReason(null);
    setConfirm(false);
    if (!selected || projectId !== OEM_PROJECT_ID) {
      return () => {
        active = false;
      };
    }
    setDetailLoading(true);
    loadReviewDetail(medplum, selected)
      .then((result) => {
        if (active) {
          setDetail(result);
        }
      })
      .catch(() => {
        if (active) {
          setDetailError('The worker or exact source evidence could not be verified.');
        }
      })
      .finally(() => {
        if (active) {
          setDetailLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [medplum, projectId, actor, selected]);

  async function resolve(): Promise<void> {
    if (!selected || !detail || detail.stale || !reason || !canReview || saving) {
      return;
    }
    setSaving(true);
    setDetailError(undefined);
    try {
      await keepCurrent(medplum, selected, reason);
      if (medplum.getProject()?.id === OEM_PROJECT_ID) {
        setSuccess(true);
        setRefresh((value) => value + 1);
      }
    } catch {
      setDetailError('Review completion was not confirmed. Reload before retrying.');
    } finally {
      setSaving(false);
      setConfirm(false);
    }
  }

  if (projectId !== OEM_PROJECT_ID) {
    return (
      <Container py="xl">
        <Alert icon={<IconAlertCircle size={18} />} color="yellow" title="OEM Project required">
          Army OEM source reviews are restricted to the synthetic demo Project.
        </Alert>
      </Container>
    );
  }

  const currentDetail = selected && detail?.task === reviewReference(selected) ? detail : undefined;
  const name = currentDetail?.patient.name?.[0];
  const workerName = name?.text ?? [...(name?.given ?? []), name?.family].filter(Boolean).join(' ');
  const quantity = currentDetail?.incoming.valueQuantity;
  const measurement =
    quantity?.value !== undefined ? `${quantity.value} ${quantity.unit ?? quantity.code ?? ''}` : 'Unknown';
  const reviewed = selected?.status === 'completed';
  const disabled = !currentDetail || currentDetail.stale || !canReview || !reason || saving;

  return (
    <Container size="xl" py="lg" style={{ overflowWrap: 'anywhere' }}>
      <Stack gap="lg">
        <Group justify="space-between" wrap="wrap">
          <Stack gap={4}>
            <Group gap="sm">
              <Title order={2}>IH source review</Title>
              <Badge color="yellow" variant="light">
                Synthetic
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              Army OEM
            </Text>
          </Stack>
          <Tooltip label="Reload reviews">
            <ActionIcon
              aria-label="Reload reviews"
              variant="default"
              size="lg"
              disabled={saving}
              onClick={() => {
                setSuccess(false);
                setRefresh((value) => value + 1);
              }}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {success && (
          <Alert color="green" icon={<IconCheck size={18} />} title="Current record retained">
            Review recorded. Incoming source facts were not applied.
          </Alert>
        )}
        <Group justify="space-between">
          <SegmentedControl
            aria-label="Review status"
            value={status}
            disabled={saving}
            data={[
              { value: 'requested', label: 'Open' },
              { value: 'completed', label: 'Reviewed' },
            ]}
            onChange={(value) => {
              setSuccess(false);
              setStatus(value as 'requested' | 'completed');
            }}
          />
          <Text size="sm" c="dimmed">
            {tasks.length === 50 ? 'Latest 50 reviews' : `${tasks.length} ${tasks.length === 1 ? 'review' : 'reviews'}`}
          </Text>
        </Group>
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        )}
        {loading ? (
          <Group>
            <Loader size="sm" />
            <Text>Loading source reviews</Text>
          </Group>
        ) : (
          !error && (
            <Table.ScrollContainer minWidth={720}>
              <Table highlightOnHover style={{ overflowWrap: 'normal', whiteSpace: 'nowrap' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Worker</Table.Th>
                    <Table.Th>Source change</Table.Th>
                    <Table.Th>Version</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {tasks.map((task) => (
                    <Table.Tr key={task.id} bg={selected?.id === task.id ? 'var(--mantine-color-gray-0)' : undefined}>
                      <Table.Td>
                        <Text size="sm">{task.for?.display ?? task.for?.reference?.split('/')[1]}</Text>
                      </Table.Td>
                      <Table.Td>{label(task.code?.coding?.[0]?.code)}</Table.Td>
                      <Table.Td>{task.input?.[0]?.valueString}</Table.Td>
                      <Table.Td>
                        <Badge color={task.status === 'completed' ? 'green' : 'yellow'} variant="light">
                          {task.status === 'completed' ? 'Reviewed' : 'Open'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label="Open review">
                          <ActionIcon
                            aria-label={`Open review ${task.id}`}
                            variant="subtle"
                            disabled={saving}
                            onClick={() => {
                              setDetail(undefined);
                              setSelected(task);
                              setSuccess(false);
                            }}
                          >
                            <IconChevronRight size={18} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {!tasks.length && (
                <Text py="lg" c="dimmed">
                  No {status === 'requested' ? 'open' : 'completed'} source reviews.
                </Text>
              )}
            </Table.ScrollContainer>
          )
        )}
        {selected && (
          <>
            <Divider />
            <Stack gap="md">
              <Group justify="space-between" wrap="wrap">
                <Title order={3}>{workerName || selected.for?.display || 'Source comparison'}</Title>
                <Badge color={reviewed ? 'green' : 'gray'} variant="light">
                  {reviewed ? 'Reviewed' : 'Source comparison'}
                </Badge>
              </Group>
              {detailLoading && <Loader size="sm" aria-label="Loading review evidence" />}
              {detailError && (
                <Alert color="red" icon={<IconAlertCircle size={18} />}>
                  {detailError}
                </Alert>
              )}
              {currentDetail && (
                <>
                  {currentDetail.stale && (
                    <Alert color="yellow" title="Exposure version changed">
                      This conflict no longer references the latest exposure version.
                    </Alert>
                  )}
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
                    <Stack gap="xs">
                      <Title order={4}>Retained exposure</Title>
                      <Text size="sm" c="dimmed">
                        {selected.focus?.reference}
                      </Text>
                      <Text size="sm">Start: {date(currentDetail.exposure.effectivePeriod?.start)}</Text>
                      <Text size="sm">End: {date(currentDetail.exposure.effectivePeriod?.end)}</Text>
                      <Text size="sm">
                        Worksite: {currentDetail.exposure.note?.map((note) => note.text).join('; ') || 'Not recorded'}
                      </Text>
                    </Stack>
                    <Stack gap="xs">
                      <Title order={4}>Incoming source</Title>
                      <Text size="sm" c="dimmed">
                        Source version {currentDetail.sourceVersion}
                      </Text>
                      <Text size="sm">Start: {date(currentDetail.incomingExposure.effectivePeriod?.start)}</Text>
                      <Text size="sm">End: {date(currentDetail.incomingExposure.effectivePeriod?.end)}</Text>
                      <Text size="sm">
                        Worksite:{' '}
                        {currentDetail.incomingExposure.note?.map((note) => note.text).join('; ') || 'Not recorded'}
                      </Text>
                      <Text fw={600}>Measurement: {measurement}</Text>
                    </Stack>
                  </SimpleGrid>
                  <Group gap="sm" wrap="wrap">
                    <Text size="sm" fw={600}>
                      Exact evidence
                    </Text>
                    <Anchor component={Link} to={`/DocumentReference/${currentDetail.evidence.id}/history`} size="sm">
                      {currentDetail.evidence.content?.[0]?.attachment.title ?? 'IH evidence'}
                    </Anchor>
                    <Text size="sm" c="dimmed">
                      Version {currentDetail.evidence.meta?.versionId}
                    </Text>
                  </Group>
                  {reviewed ? (
                    <Paper withBorder p="md" radius="sm">
                      <Stack gap="xs">
                        <Title order={4}>Recorded decision</Title>
                        <Text>{label(selected.output?.[0]?.valueCoding?.code)}</Text>
                        <Text size="sm">Reason: {label(selected.output?.[1]?.valueCoding?.code)}</Text>
                        <Text size="sm">
                          Clinician: {selected.output?.[2]?.valueReference?.reference ?? 'Not recorded'}
                        </Text>
                        <Text size="sm">Recorded: {selected.note?.at(-1)?.time ?? 'Not recorded'}</Text>
                      </Stack>
                    </Paper>
                  ) : (
                    <Stack gap="sm">
                      {!canReview && <Alert color="gray">Review action unavailable for this account.</Alert>}
                      <Select
                        label="Keep-current reason"
                        placeholder="Select a reason"
                        data={[...REVIEW_REASONS]}
                        value={reason}
                        onChange={(value) => setReason(value as ReviewReason | null)}
                        disabled={!canReview || currentDetail.stale || saving}
                        maw={420}
                      />
                      <Group>
                        <Button
                          leftSection={<IconCheck size={16} />}
                          disabled={disabled}
                          onClick={() => setConfirm(true)}
                        >
                          Keep current record
                        </Button>
                      </Group>
                    </Stack>
                  )}
                </>
              )}
            </Stack>
          </>
        )}
      </Stack>
      <Modal
        opened={confirm}
        onClose={() => {
          if (!saving) {
            setConfirm(false);
          }
        }}
        title="Keep current exposure?"
        centered
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
        withCloseButton={!saving}
      >
        <Stack>
          <Text>{REVIEW_REASONS.find((item) => item.value === reason)?.label}</Text>
          <Text size="sm">
            Incoming source facts will remain attached to the review and will not replace the clinical record.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" disabled={saving} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              leftSection={<IconCheck size={16} />}
              loading={saving}
              disabled={disabled}
              onClick={() => void resolve()}
            >
              Confirm keep current
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
