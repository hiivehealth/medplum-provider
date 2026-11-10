import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { getDisplayString } from '@medplum/core';
import type {
  DocumentReference,
  Observation,
  Patient,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
} from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum, useMedplumProfile } from '@medplum/react';
import { IconCheck, IconEye, IconHistory, IconPlus, IconX } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { OEM_PROJECT_ID, OEM_REVIEW_BOT_ID } from './ih-review';
import type { AmendmentReason, ExposureAmendmentDetails, IntakeRequest, IntakeResult, LifecycleInspection } from './intake';
import {
  exposureTimelineDetails,
  inspectRetainedWork,
  LIFECYCLE_WORKER_ID,
  LIFECYCLE_EXPOSURE,
  LIFECYCLE_RECOMMENDATION,
  loadExposureAmendmentDetails,
  loadIntake,
  loadIntakeAssessments,
  loadIntakeEvidence,
  loadIntakeExposures,
  measurementResult,
  measurementFormDefinition,
  prepareIntake,
  previewIntake,
  saveIntake,
} from './intake';
import { NoiseAdvisoryPreview } from './NoiseAdvisoryPreview';
import { ClinicianDecision } from './ClinicianDecision';
import { CompletionPreview } from './CompletionPreview';
import { ExposureMeasurements } from './ExposureMeasurements';
import { NativeEvidenceHistory, NativeHistory, NativeLineageHistory, NativeRecordedTime, NativeRuleHistory, NativeMatrixHistory, NativeMatrixPdf, NativeReport } from './NativeReport';

export function DemoPolicyAssumptions(): JSX.Element {
  const assumptions = [
    { label: 'Baseline review', value: 'Zero-day review marker at the later exposure/enrollment start; not a clinical deadline or permission to begin hazardous work.', sme: 'SME-03' },
    { label: 'Periodic example', value: '12 calendar months from the test performed date. Final synthetic evidence or a labelled attestation; clinical completion unverified.', sme: 'SME-01, SME-02, SME-04, SME-09' },
    { label: 'Ended exposure', value: 'Clinician review. Retain accepted work and history; no automatic cancellation or new routine work.', sme: 'SME-07' },
    { label: 'Enrollment', value: 'Existing clinician-attributed synthetic determinations only. Missing evidence stays needs-review; no enrollment inferred from measurements.', sme: 'SME-05' },
    { label: 'Supplementary policy', value: 'Additional Army/site policy not assessed. Unclassified; Noise 503 only.', sme: 'SME-06' },
  ];
  return <Accordion variant="default" style={{ minWidth: 0 }}>
    <Accordion.Item value="demo-policy">
      <Accordion.Control>Demo policy assumptions</Accordion.Control>
      <Accordion.Panel>
        <Stack component="section" aria-label="Demo policy details" gap="sm" style={{ minWidth: 0 }}
          data-demo-policy="matrix-13-noise-503-demo-v1" data-clinically-approved="false" data-periodic-months="12">
          <Text size="sm">Matrix Edition 13, Noise 503, printed page 208. Demo-only implementation assumptions; clinical approval pending.</Text>
          {assumptions.map(assumption => <Stack key={assumption.label} gap={2}>
            <Title order={4} size="sm">{assumption.label}</Title>
            <Text size="sm">{assumption.value}</Text>
            <Text size="xs" c="dimmed">Clinical review: {assumption.sme}</Text>
          </Stack>)}
          <Text size="sm">No clinical scheduling, order activation or external delivery.</Text>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  </Accordion>;
}

function formDefinition(
  questionnaire: Questionnaire,
  evidence: DocumentReference[],
  clinician: boolean,
  availability?: string
): Questionnaire {
  const adapt = (items: QuestionnaireItem[]): QuestionnaireItem[] =>
    items
      .filter((item) => clinician || item.linkId !== 'enrollment')
      .map((item) => ({
        ...item,
        ...(item.item ? { item: adapt(item.item) } : {}),
        ...(item.type === 'reference'
          ? {
              type: 'choice' as const,
              answerOption: evidence.map((document) => ({
                valueReference: {
                  reference: `DocumentReference/${document.id}/_history/${document.meta!.versionId}`,
                  display: `${document.description ?? document.content[0]?.attachment.title ?? document.id} (${document.meta!.versionId})`,
                },
              })),
            }
          : {}),
        ...(item.answerOption
          ? {
              answerOption: item.answerOption.map((option) =>
                option.valueCoding
                  ? {
                      ...option,
                      valueCoding: { ...option.valueCoding, display: option.valueCoding.code?.replaceAll('-', ' ') },
                    }
                  : option
              ),
            }
          : {}),
      }));
  const definition = measurementFormDefinition(questionnaire, availability);
  return { ...definition, item: adapt(definition.item ?? []) };
}

function RetainedWorkInspection({ patient }: { patient: Patient }): JSX.Element {
  const medplum = useMedplum();
  const [requested, setRequested] = useState(false);
  const [result, setResult] = useState<LifecycleInspection>();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!requested) return;
    let active = true;
    inspectRetainedWork(medplum, patient).then(value => {
      if (active) setResult(value);
    }).catch(() => {
      if (active) setUnavailable(true);
    });
    return () => { active = false; };
  }, [medplum, patient, requested]);
  return (
    <Stack gap="xs" style={{ minWidth: 0 }}>
      <Group justify="space-between">
        <Title order={3}>Retained work</Title>
        <Button variant="subtle" w={200} maw="100%" aria-expanded={requested}
          leftSection={requested ? <IconX size={16} /> : <IconEye size={16} />}
          onClick={() => {
            setResult(undefined);
            setUnavailable(false);
            setRequested(!requested);
          }}>
          {requested ? 'Dismiss retained work' : 'Inspect retained work'}
        </Button>
      </Group>
      {requested && !result && !unavailable && <Loader size="sm" aria-label="Inspecting retained work" />}
      {unavailable && <Alert color="yellow" title="Inspection unavailable">Retained work inspection is unavailable.</Alert>}
      {result && (
        <Stack gap={4}>
          <Text size="sm">Inspected {result.inspectedAt} (UTC)</Text>
          <Text size="sm">Exposure: {result.activity}. Recommendation: {result.status}.</Text>
          <Text size="sm">Scope: bounded worker search.</Text>
          <Text size="sm">Visible audiogram Tasks: {result.searchedRecommendations}. Retained recommendations: {result.recommendations.length}.</Text>
          {result.headState === 'changed' ? (
            <Alert color="yellow" title="Selected versions changed">The selected versions no longer match the checked resource heads.</Alert>
          ) : <Text size="sm">Selected versions matched at read checks.</Text>}
          {result.reviewRequired && <Alert color="yellow" title="Outstanding work requires review">Retained work is not cancelled or completed.</Alert>}
          <Group gap="md">
            <Anchor size="sm" href={`/${LIFECYCLE_EXPOSURE}`}>View inspected exposure</Anchor>
          </Group>
          {result.recommendations.map((recommendation, index) => (
            <Group key={recommendation.reference} gap="md">
              <Text size="sm">{recommendation.status}</Text>
              <Anchor size="sm" href={`/${recommendation.reference}`}>
                {result.recommendations.length === 1 ? 'View retained recommendation' : `View retained recommendation ${index + 1}`}
              </Anchor>
            </Group>
          ))}
          {result.proposals?.map((proposal, index) => (
            <Group key={proposal.reference} gap="md">
              <Text size="sm">Local proposal: {proposal.status}</Text>
              <Anchor size="sm" href={`/${proposal.reference}`}>
                {result.proposals?.length === 1 ? 'View retained local draft proposal' : `View retained local draft proposal ${index + 1}`}
              </Anchor>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function AmendmentAttribution({ patient, exposure }: { patient: Patient; exposure: Observation }): JSX.Element {
  const medplum = useMedplum();
  const [opened, setOpened] = useState(false);
  const [details, setDetails] = useState<ExposureAmendmentDetails>();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    setDetails(undefined);
    setUnavailable(false);
    loadExposureAmendmentDetails(medplum, patient, exposure)
      .then((result) => {
        if (active) setDetails(result);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [medplum, patient, exposure, opened]);
  return (
    <>
      <Tooltip label="View amendment attribution">
        <ActionIcon variant="subtle" size={32} aria-label="View amendment attribution" onClick={() => setOpened(true)}>
          <IconEye size={18} />
        </ActionIcon>
      </Tooltip>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Amendment attribution"
        closeButtonProps={{ 'aria-label': 'Close amendment attribution' }}
      >
        {unavailable ? (
          <Alert color="yellow" title="Attribution unavailable">
            Verified amendment attribution is unavailable.
          </Alert>
        ) : details ? (
          <Stack gap="sm" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <div>
              <Text size="sm" c="dimmed">
                Recorded by
              </Text>
              <Anchor href={`/${details.actor}`}>{details.actor}</Anchor>
            </div>
            <div>
              <Text size="sm" c="dimmed">
                Recorded at (UTC)
              </Text>
              <Text>{details.recorded}</Text>
            </div>
            <div>
              <Text size="sm" c="dimmed">
                Reason
              </Text>
              <Text>{details.reason}</Text>
            </div>
            <Anchor href={`/Observation/${exposure.id}/_history/${exposure.meta!.versionId}`}>
              Amended exposure version
            </Anchor>
            <Anchor href={`/${details.previous}`}>Prior exposure version</Anchor>
            <Anchor href={`/${details.lineage}`}>Amendment lineage</Anchor>
          </Stack>
        ) : (
          <Group>
            <Loader size="sm" />
            <Text>Loading amendment attribution</Text>
          </Group>
        )}
      </Modal>
    </>
  );
}

function AssessmentTimeline({
  records,
  kind,
  unverified,
  limited,
}: {
  records: Observation[];
  kind: 'measurement' | 'enrollment';
  unverified: number;
  limited: boolean;
}): JSX.Element {
  const title = kind === 'measurement' ? 'Noise measurements' : 'Enrollment determinations';
  const link = (reference: string): JSX.Element => (
    <Anchor href={`/${reference.split('/').slice(0, 2).join('/')}/history`}>{reference}</Anchor>
  );
  return (
    <Stack component="section" aria-label={title} gap="xs" style={{ minWidth: 0 }}>
      <Group justify="space-between">
        <Title order={3}>{title}</Title>
        {unverified > 0 && <Badge color="orange">Needs review: {unverified}</Badge>}
      </Group>
      {limited && (
        <Alert color="yellow" title={`${title}: record limit reached`}>
          Showing up to 50 recently updated records; older records may not be included.
        </Alert>
      )}
      {records.length === 0 ? (
        <Text size="sm" c="dimmed">
          {unverified > 0
            ? 'No verified records in this result.'
            : `No recorded ${kind === 'measurement' ? 'noise measurements' : 'enrollment determinations'} in this result.`}
        </Text>
      ) : (
        <>
          <Table.ScrollContainer minWidth={800}>
            <Table aria-label={title} striped highlightOnHover style={{ whiteSpace: 'nowrap' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{kind === 'measurement' ? 'Assessed' : 'Effective from'}</Table.Th>
                  <Table.Th>{kind === 'measurement' ? 'Metric / basis' : 'Effective through'}</Table.Th>
                  <Table.Th>{kind === 'measurement' ? 'Measurement' : 'Determination'}</Table.Th>
                  <Table.Th>{kind === 'measurement' ? 'Method' : 'Recorded authority'}</Table.Th>
                  <Table.Th>Exposure reference</Table.Th>
                  <Table.Th>Evidence references</Table.Th>
                  <Table.Th>Version history</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {records.map((record) => (
                  <Table.Tr key={record.id}>
                    <Table.Td>{record.effectiveDateTime ?? record.effectivePeriod?.start ?? 'Not recorded'}</Table.Td>
                    <Table.Td>
                      {kind === 'measurement'
                        ? `${record.code.coding?.find((coding) => coding.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-noise-metric')?.code?.replaceAll('-', ' ') ?? 'Not recorded'} / ${record.extension?.find((extension) => extension.url === 'https://hiivehealth.com/fhir/StructureDefinition/measurement-basis')?.valueString ?? 'Not recorded'}`
                        : (record.effectivePeriod?.end ?? 'Not recorded')}
                    </Table.Td>
                    <Table.Td>
                      {kind === 'measurement'
                        ? measurementResult(record)
                        : record.valueCodeableConcept?.text?.replaceAll('-', ' ')}
                    </Table.Td>
                    <Table.Td>
                      {kind === 'measurement'
                        ? (record.method?.text ?? 'Not recorded')
                        : record.note?.map((note) => note.text).join('; ') || 'Not recorded'}
                    </Table.Td>
                    <Table.Td>
                      {record.focus?.map((focus) => (
                        <div key={focus.reference}>{link(focus.reference!)}</div>
                      ))}
                    </Table.Td>
                    <Table.Td>
                      {record.derivedFrom?.map((evidence) => (
                        <div key={evidence.reference}>{link(evidence.reference!)}</div>
                      ))}
                    </Table.Td>
                    <Table.Td>{link(`Observation/${record.id}/_history/${record.meta!.versionId}`)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}
    </Stack>
  );
}

export function IntakePage(): JSX.Element {
  const timelineAsOf = new Date().toISOString().slice(0, 10);
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const actor = profile ? `${profile.resourceType}/${profile.id}` : '';
  const project = medplum.getProject()?.id;
  const markerKey = `oem-intake-pending:${project}:${actor}`;
  const [context, setContext] = useState<Awaited<ReturnType<typeof loadIntake>>>();
  const [clinician, setClinician] = useState(false);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [workerData, setWorkerData] = useState<{ evidence: DocumentReference[]; exposures: Observation[] }>();
  const [assessments, setAssessments] = useState<Awaited<ReturnType<typeof loadIntakeAssessments>>>();
  const [assessmentError, setAssessmentError] = useState('');
  const [exposureId, setExposureId] = useState<string | null>('new');
  const [reason, setReason] = useState<string | null>(null);
  const [response, setResponse] = useState<QuestionnaireResponse>();
  const [form, setForm] = useState<{ questionnaire: Questionnaire; response: QuestionnaireResponse; availability?: string }>();
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState('');
  const [confirmation, setConfirmation] = useState<{ request: IntakeRequest; state: string; actor: string }>();
  const [result, setResult] = useState<IntakeResult>();
  const [reviewSaved, setReviewSaved] = useState(false);
  const timelineRef = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    generation.current++;
    inFlight.current = false;
    setBusy(false);
    setPending('');
    setContext(undefined);
    setWorkerId(null);
    setWorkerData(undefined);
    setResponse(undefined);
    setConfirmation(undefined);
    setResult(undefined);
    setReviewSaved(false);
    setClinician(false);
    setError('');
    setLoading(true);
    if (project !== OEM_PROJECT_ID) {
      setLoading(false);
      return;
    }
    try {
      setPending(sessionStorage.getItem(markerKey) ?? '');
    } catch {
      setError('Submission safety storage is unavailable. Saving is blocked.');
      setLoading(false);
      return;
    }
    loadIntake(medplum)
      .then(async (data) => {
        let permitted = false;
        try {
          const bot = await medplum.readResource('Bot', OEM_REVIEW_BOT_ID, { cache: 'no-cache' });
          permitted = bot.id === OEM_REVIEW_BOT_ID && bot.meta?.project === OEM_PROJECT_ID;
        } catch {
          permitted = false;
        }
        if (!cancelled) {
          setContext(data);
          setClinician(permitted);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Intake access or the pinned definition could not be verified.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      generation.current++;
    };
  }, [medplum, project, actor, markerKey]);

  const worker = context?.workers.find((patient) => patient.id === workerId);
  useEffect(() => {
    let cancelled = false;
    setWorkerData(undefined);
    setAssessments(undefined);
    setAssessmentError('');
    setExposureId('new');
    setReason(null);
    setResponse(undefined);
    setConfirmation(undefined);
    setDetailError('');
    if (!worker || project !== OEM_PROJECT_ID) return;
    loadIntakeAssessments(medplum, worker)
      .then((data) => {
        if (!cancelled) setAssessments(data);
      })
      .catch(() => {
        if (!cancelled) setAssessmentError('Measurement and enrollment history could not be verified.');
      });
    Promise.all([loadIntakeEvidence(medplum, worker), loadIntakeExposures(medplum, worker)])
      .then(([evidence, exposures]) => {
        if (!cancelled) setWorkerData({ evidence, exposures });
      })
      .catch(() => {
        if (!cancelled) setDetailError('Worker evidence or exposure history could not be verified.');
      });
    return () => {
      cancelled = true;
    };
  }, [medplum, worker, project, actor, reviewSaved]);

  useEffect(() => {
    if (reviewSaved && workerData) {
      timelineRef.current?.scrollIntoView?.({ block: 'start' });
      timelineRef.current?.focus({ preventScroll: true });
    }
  }, [reviewSaved, workerData]);

  const exposure = workerData?.exposures.find((item) => item.id === exposureId);
  useEffect(() => {
    setForm(undefined);
    setResponse(undefined);
    if (!context || !workerData || !worker) return;
    const worksite = exposure?.extension?.find(
      (extension) => extension.url === 'https://hiivehealth.com/fhir/StructureDefinition/synthetic-worksite'
    )?.valueCode;
    const initialResponse: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      subject: { reference: `Patient/${worker.id}` },
      ...(exposure
        ? {
            item: [
              {
                linkId: 'exposure',
                item: [
                  {
                    linkId: 'worksite',
                    answer: [
                      {
                        valueCoding: {
                          system: 'https://hiivehealth.com/fhir/CodeSystem/synthetic-oem-intake',
                          code: worksite,
                          display: worksite?.replaceAll('-', ' '),
                        },
                      },
                    ],
                  },
                  { linkId: 'start', answer: [{ valueDate: exposure.effectivePeriod?.start?.slice(0, 10) }] },
                  ...(exposure.effectivePeriod?.end
                    ? [{ linkId: 'end', answer: [{ valueDate: exposure.effectivePeriod.end.slice(0, 10) }] }]
                    : []),
                ],
              },
            ],
          }
        : {}),
    };
    setForm({
      questionnaire: formDefinition(context.questionnaire, workerData.evidence, clinician),
      response: initialResponse,
    });
  }, [context, workerData, worker, exposure, clinician]);

  async function preview(): Promise<void> {
    if (!context || !worker || !workerData || !response || busy || inFlight.current || pending || result || project !== OEM_PROJECT_ID)
      return;
    const current = generation.current;
    inFlight.current = true;
    setError('');
    setBusy(true);
    try {
      if (exposureId !== 'new' && (!clinician || !exposure || !reason))
        throw new Error('Select an exposure and amendment reason.');
      const preparedResponse = clinician
        ? response
        : {
            ...response,
            item: [
              ...(response.item ?? []),
              {
                linkId: 'enrollment',
                item: [
                  {
                    linkId: 'determination',
                    answer: [
                      {
                        valueCoding: {
                          system: 'https://hiivehealth.com/fhir/CodeSystem/synthetic-oem-intake',
                          code: 'not-provided',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          };
      const request = prepareIntake(
        context.questionnaire,
        preparedResponse,
        worker,
        workerData.evidence,
        exposure
          ? {
              exposure: `Observation/${exposure.id}/_history/${exposure.meta!.versionId}`,
              reason: reason as AmendmentReason,
            }
          : undefined
      );
      const state = await previewIntake(medplum, request);
      if (
        generation.current === current &&
        medplum.getProject()?.id === OEM_PROJECT_ID &&
        `${medplum.getProfile()?.resourceType}/${medplum.getProfile()?.id}` === actor
      )
        setConfirmation({ request, state, actor });
    } catch (failure) {
      if (generation.current === current) setError(
        failure instanceof Error && !('outcome' in failure) ? failure.message : 'The intake preview was not confirmed.'
      );
    } finally {
      if (generation.current === current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function confirm(): Promise<void> {
    if (
      !confirmation ||
      busy ||
      inFlight.current ||
      pending ||
      medplum.getProject()?.id !== OEM_PROJECT_ID ||
      `${medplum.getProfile()?.resourceType}/${medplum.getProfile()?.id}` !== confirmation.actor
    )
      return;
    const current = generation.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const marker = JSON.stringify({
      submissionId: confirmation.request.submissionId,
      patient: confirmation.request.patient,
      at: confirmation.request.at,
    });
    try {
      sessionStorage.setItem(markerKey, marker);
      setPending(marker);
      const saved = await saveIntake(medplum, confirmation.request);
      if (
        generation.current === current &&
        medplum.getProject()?.id === OEM_PROJECT_ID &&
        `${medplum.getProfile()?.resourceType}/${medplum.getProfile()?.id}` === confirmation.actor
      ) {
        sessionStorage.removeItem(markerKey);
        setPending('');
        setResult(saved);
        setConfirmation(undefined);
      }
    } catch {
      if (generation.current === current) setError(
        'Save completion was not confirmed. Inspect the submission receipt before another save; staged records may already exist.'
      );
    } finally {
      if (generation.current === current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  if (project !== OEM_PROJECT_ID)
    return (
      <Container py="md">
        <Alert title="OEM Project required">Army OEM intake is restricted to the synthetic demo Project.</Alert>
      </Container>
    );
  const confirmedAnswers = confirmation?.request.response.item?.flatMap((item) => item.item ?? []) ?? [];
  const confirmedValue = (linkId: string): string | number => {
    const answer = confirmedAnswers.find((item) => item.linkId === linkId)?.answer?.[0];
    return (
      answer?.valueDate ?? answer?.valueDecimal ?? answer?.valueCoding?.code?.replaceAll('-', ' ') ?? 'Not provided'
    );
  };
  return (
    <Container size="lg" py="md" style={{ overflowWrap: 'anywhere' }}>
      <Stack>
        <Group justify="space-between">
          <Title order={2}>Noise intake</Title>
          <Badge color="teal">Synthetic</Badge>
        </Group>
        {error && (
          <Alert color="red" title="Intake not confirmed">
            {error}
          </Alert>
        )}
        {pending && (
          <Alert color="yellow" title="Submission requires inspection">
            <Text size="sm">{pending}</Text>
          </Alert>
        )}
        {loading ? (
          <Group>
            <Loader size="sm" />
            <Text>Loading intake</Text>
          </Group>
        ) : (
          context &&
          (!result || reviewSaved) && (
            <>
              <Select
                label="Worker"
                placeholder="Select worker"
                data={context.workers.map((patient) => ({ value: patient.id!, label: getDisplayString(patient) }))}
                value={workerId}
                onChange={setWorkerId}
                disabled={busy || Boolean(pending) || reviewSaved}
                searchable
              />
              {detailError && (
                <Alert color="red" title="Worker data unavailable">
                  {detailError}
                </Alert>
              )}
              {worker && !workerData && !detailError && <Loader size="sm" />}
              {worker && workerData && (
                <>
                  {!reviewSaved && <>
                  {clinician && (
                    <Select
                      label="Exposure episode"
                      value={exposureId}
                      disabled={busy || Boolean(pending)}
                      data={[
                        { value: 'new', label: 'New exposure episode' },
                        ...workerData.exposures.map((item) => ({
                          value: item.id!,
                          label: `${item.effectivePeriod?.start ?? 'Date unknown'} / ${item.id}`,
                        })),
                      ]}
                      onChange={(value) => {
                        if (!value || value === exposureId) return;
                        setExposureId(value);
                        setReason(null);
                        setResponse(undefined);
                        setForm(undefined);
                        setConfirmation(undefined);
                      }}
                    />
                  )}
                  {exposure && (
                    <>
                      <Text size="sm">{`Observation/${exposure.id}/_history/${exposure.meta!.versionId}`}</Text>
                      <Select
                        label="Amendment reason"
                        placeholder="Select amendment reason"
                        value={reason}
                        onChange={setReason}
                        disabled={busy || Boolean(pending)}
                        data={[
                          { value: 'correct-dates', label: 'Correct dates' },
                          { value: 'correct-worksite', label: 'Correct worksite' },
                          { value: 'end-exposure', label: 'End exposure' },
                        ]}
                      />
                    </>
                  )}
                  <fieldset
                    disabled={busy || Boolean(pending)}
                    style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                  >
                    {form && (
                      <QuestionnaireForm
                        key={`${actor}:${workerId}:${exposureId}:${form.availability ?? ''}`}
                        questionnaire={form.questionnaire}
                        questionnaireResponse={form.response}
                        excludeButtons
                        onChange={(next) => {
                          setResponse(next);
                          const availability = next.item?.find((item) => item.linkId === 'measurement')?.item
                            ?.find((item) => item.linkId === 'availability')?.answer?.[0]?.valueCoding?.code;
                          if (availability !== form.availability) setForm({
                            ...form, response: next, availability,
                            questionnaire: formDefinition(context.questionnaire, workerData.evidence, clinician, availability),
                          });
                        }}
                      />
                    )}
                  </fieldset>
                  <Group>
                    <Button
                      leftSection={<IconEye size={16} />}
                      onClick={() => void preview()}
                      loading={busy}
                      disabled={!response || Boolean(pending) || Boolean(exposure && !reason)}
                    >
                      Preview intake
                    </Button>
                  </Group>
                  </>}
                  <Stack gap="xs" style={{ minWidth: 0 }}>
                    <Title order={3} ref={timelineRef} tabIndex={-1}>Exposure timeline</Title>
                    <Text size="sm" c="dimmed">
                      Status as of {timelineAsOf} (UTC)
                    </Text>
                    {workerData.exposures.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No recorded exposure episodes.
                      </Text>
                    ) : (
                      <>
                        {workerData.exposures.length >= 50 && (
                          <Alert color="yellow" title="Record limit reached">
                            Showing up to 50 recently updated exposure episodes; older records may not be included.
                          </Alert>
                        )}
                        <Table.ScrollContainer minWidth={900}>
                          <Table
                            aria-label="Exposure timeline"
                            striped
                            highlightOnHover
                            style={{ whiteSpace: 'nowrap' }}
                          >
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>Exposure</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th>Source</Table.Th>
                                <Table.Th>Started</Table.Th>
                                <Table.Th>Ended</Table.Th>
                                <Table.Th>Worksite</Table.Th>
                                <Table.Th w={88}>History</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {workerData.exposures.map((episode) => {
                                const details = exposureTimelineDetails(episode, timelineAsOf);
                                return (
                                  <Table.Tr key={episode.id}>
                                    <Table.Td>{details.type}</Table.Td>
                                    <Table.Td>
                                      <Badge
                                        style={{ minWidth: 96 }}
                                        color={
                                          details.status === 'Active'
                                            ? 'teal'
                                            : details.status === 'Unknown'
                                              ? 'yellow'
                                              : 'gray'
                                        }
                                      >
                                        {details.status}
                                      </Badge>
                                    </Table.Td>
                                    <Table.Td>{details.source}</Table.Td>
                                    <Table.Td>{episode.effectivePeriod?.start ?? 'Not recorded'}</Table.Td>
                                    <Table.Td>{episode.effectivePeriod?.end ?? 'Not recorded'}</Table.Td>
                                    <Table.Td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: 240 }}>
                                      {episode.extension
                                        ?.find(
                                          (extension) =>
                                            extension.url ===
                                            'https://hiivehealth.com/fhir/StructureDefinition/synthetic-worksite'
                                        )
                                        ?.valueCode?.replaceAll('-', ' ') ?? 'Not recorded'}
                                    </Table.Td>
                                    <Table.Td>
                                      <Group gap={4} wrap="nowrap">
                                        <Tooltip label="View exposure history">
                                          <ActionIcon
                                            component="a"
                                            href={`/Observation/${episode.id}/history`}
                                            variant="subtle"
                                            size={32}
                                            aria-label="View exposure history"
                                          >
                                            <IconHistory size={18} />
                                          </ActionIcon>
                                        </Tooltip>
                                        {details.source === 'Clinician-amended' &&
                                          episode.subject?.reference === `Patient/${worker.id}` && (
                                            <AmendmentAttribution
                                              key={`${project}:${actor}:${worker.id}:${episode.meta!.versionId}`}
                                              patient={worker}
                                              exposure={episode}
                                            />
                                          )}
                                        {clinician && <ExposureMeasurements
                                          key={`measurements:${project}:${actor}:${worker.id}:${episode.id}:${episode.meta!.versionId}`}
                                          worker={worker} exposure={episode} measurements={assessments?.measurements ?? []} asOf={timelineAsOf}
                                          onSaved={records => setAssessments(current => {
                                            if (!current) return current;
                                            const updated = [...records, ...current.measurements.filter(record => !records.some(saved => saved.id === record.id))]
                                              .sort((first, second) => (second.meta?.lastUpdated ?? '').localeCompare(first.meta?.lastUpdated ?? ''));
                                            return { ...current, measurements: updated.slice(0, 50),
                                              limited: { ...current.limited, measurement: current.limited.measurement || updated.length > 50 } };
                                          })}
                                        />}
                                      </Group>
                                    </Table.Td>
                                  </Table.Tr>
                                );
                              })}
                            </Table.Tbody>
                          </Table>
                        </Table.ScrollContainer>
                      </>
                    )}
                  </Stack>
                  {assessmentError ? (
                    <Alert color="red" title="Assessment history unavailable">
                      {assessmentError}
                    </Alert>
                  ) : assessments ? (
                    <>
                      {assessments.unverified.length > 0 && (
                        <Alert color="yellow" title="Records need source review">
                          <Stack gap="xs">
                            <Text size="sm">Record facts or sources could not be verified for this worker.</Text>
                            {assessments.unverified.map((record) => (
                              <Stack key={record.reference} gap={2}>
                                <Text size="sm">{record.reason}</Text>
                                <Anchor href={`/${record.reference}`}>View {record.kind} record</Anchor>
                              </Stack>
                            ))}
                          </Stack>
                        </Alert>
                      )}
                      <AssessmentTimeline
                        kind="measurement"
                        records={assessments.measurements}
                        unverified={assessments.unverified.filter((record) => record.kind === 'measurement').length}
                        limited={assessments.limited.measurement}
                      />
                      <AssessmentTimeline
                        kind="enrollment"
                        records={assessments.enrollments}
                        unverified={assessments.unverified.filter((record) => record.kind === 'enrollment').length}
                        limited={assessments.limited.enrollment}
                      />
                    </>
                  ) : (
                    <Group>
                      <Loader size="sm" />
                      <Text>Loading measurement and enrollment history</Text>
                    </Group>
                  )}
                  {clinician && (
                    <NoiseAdvisoryPreview
                      key={`${actor}:${worker.id}:${result?.receipt ?? 'existing'}`}
                      worker={worker}
                      exposures={workerData.exposures}
                      enrollments={assessments?.enrollments ?? []}
                      initialExposureId={result?.resources.find((resource) => resource.step === 'exposure')?.reference.split('/')[1]}
                      initialEnrollmentId={result?.resources.find((resource) => resource.step === 'enrollment')?.reference.split('/')[1]}
                    />
                  )}
                  {clinician && <DemoPolicyAssumptions />}
                  {clinician && worker.id === LIFECYCLE_WORKER_ID && !reviewSaved && (
                    <Accordion>
                      <Accordion.Item value="earlier-examples">
                        <Accordion.Control>Earlier saved examples</Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap="md">
                      <RetainedWorkInspection key={`${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} patient={worker} />
                      <ClinicianDecision key={`decision:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                      <CompletionPreview key={`completion-preview:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                      <NativeReport key={`native-report:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                      <NativeHistory key={`native-history:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                      <NativeEvidenceHistory key={`native-evidence-history:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                      <NativeLineageHistory key={`native-lineage-history:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                      <NativeRecordedTime key={`native-recorded-time:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                      <NativeRuleHistory key={`native-rule-history:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                      <NativeMatrixHistory key={`native-matrix-history:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                      <NativeMatrixPdf key={`native-matrix-pdf:${medplum.getProject()?.id}:${profile?.id}:${worker.id}`} />
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>
                    </Accordion>
                  )}
                </>
              )}
            </>
          )
        )}
        {result && (
          <>
            <Alert color="teal" title="Intake saved">
              {result.replayed ? 'Existing submission verified.' : 'Submission completed.'}
            </Alert>
            <Anchor href={`/${result.receipt}`}>Submission receipt</Anchor>
            {result.resources.map((resource) => (
              <Anchor key={resource.step} href={`/${resource.reference.split('/').slice(0, 2).join('/')}/history`}>
                {resource.step}: {resource.reference}
              </Anchor>
            ))}
            <Group>
              <Button
                leftSection={<IconEye size={16} />}
                onClick={() => setReviewSaved(true)}
                disabled={reviewSaved}
              >
                View saved exposure
              </Button>
              <Button
                variant="default"
                leftSection={<IconPlus size={16} />}
                onClick={() => {
                  setReviewSaved(false);
                  setResult(undefined);
                  setWorkerId(null);
                  setWorkerData(undefined);
                  setResponse(undefined);
                }}
              >
                New intake
              </Button>
            </Group>
          </>
        )}
        <Modal
          opened={Boolean(confirmation)}
          onClose={() => {
            if (!busy) setConfirmation(undefined);
          }}
          title="Save synthetic intake?"
          closeOnClickOutside={!busy}
          closeOnEscape={!busy}
          withCloseButton={!busy}
        >
          <Stack>
            <Text>{worker && getDisplayString(worker)}</Text>
            <Text size="sm">Exposure state: {confirmation?.state}</Text>
            <Text size="sm">
              Start: {confirmedValue('start')} / End: {confirmedValue('end')}
            </Text>
            <Text size="sm">Worksite: {confirmedValue('worksite')}</Text>
            <Text size="sm">
              Measurement: {confirmedValue('availability')}
              {confirmedValue('availability') === 'measured'
                ? ` / ${confirmedValue('value')} ${confirmedValue('unit')}`
                : ''}
            </Text>
            <Text size="sm">Enrollment: {confirmedValue('determination')}</Text>
            {confirmation?.request.amendmentReason && (
              <Text size="sm">Amendment: {confirmation.request.amendmentReason.replaceAll('-', ' ')}</Text>
            )}
            <Text size="sm">Omitted enrollment is not inferred. No clinical order will be created.</Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                leftSection={<IconX size={16} />}
                onClick={() => setConfirmation(undefined)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                leftSection={<IconCheck size={16} />}
                onClick={() => void confirm()}
                loading={busy}
                disabled={Boolean(pending)}
              >
                Confirm save
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}
