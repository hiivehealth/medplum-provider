import { Alert, Badge, Button, Group, Loader, Modal, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { deepEquals, formatDateTime, getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Encounter, Observation, Patient, Practitioner, QuestionnaireResponse } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconDeviceFloppy, IconPlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  RED_ROVER_AUTHORING_TEMPLATES as questionnaires,
  RED_ROVER_AUTHORING_SECTIONS as sections,
} from '../../data/red-rover-full-authoring-templates';
import { isRedRoverLocalEncounter } from '../../utils/encounter';
import { buildRedRoverLocalVitals, LOCAL_VITAL_IDENTIFIER_SYSTEM } from '../../utils/vitals';
import { A01CompactQuestionnaire } from '../tasks/encounter/A01CompactQuestionnaire';
import { SoapObjectiveCard } from './SoapObjectiveCard';
import { SoapPhysicalExamCard } from './SoapPhysicalExamCard';
import { SoapRosCard } from './SoapRosCard';
import { SoapSectionCard } from './SoapSectionCard/SoapSectionCard';
import { SoapSubjectiveCard } from './SoapSubjectiveCard';

const localBase = 'https://hiivehealth.com/fhir/red-rover/local-authoring';
const linksUrl = `${localBase}/sections`;
const measurementUrl = `${localBase}/vitals-measured-at`;
const selectedUrl = `${localBase}/template-selected`;
const pendingVitalsKey = (encounterId: string): string => `hiive.local-vitals.pending:${encounterId}`;
const options = (): { cache: 'no-cache'; maxRetries: number } => ({ cache: 'no-cache', maxRetries: 0 });

function assertDraft(response: QuestionnaireResponse, encounter: Encounter, index: number): void {
  const expected = questionnaires[index];
  if (
    !response.id ||
    !response.meta?.versionId ||
    response.meta.project !== encounter.meta?.project ||
    response.meta.source ||
    response.status !== 'in-progress' ||
    response.subject?.reference !== encounter.subject?.reference ||
    response.encounter?.reference !== getReferenceString(encounter) ||
    response.author?.reference !== encounter.participant?.[0]?.individual?.reference ||
    response.source?.reference !== encounter.participant?.[0]?.individual?.reference ||
    response.identifier?.system !== `${localBase}/draft` ||
    response.identifier.value !== `${encounter.id}:${index}` ||
    response.questionnaire !== `${expected.url}${expected.version ? `|${expected.version}` : ''}`
  ) {
    throw new Error('Draft identity, status, template or patient/visit linkage does not match this local visit');
  }
}

function hasVitalValues(items: QuestionnaireResponse['item']): boolean {
  return (
    items?.some(
      (item) =>
        item.linkId === 'vitals' &&
        item.item?.some((child) =>
          child.answer?.some((answer) => answer.valueDecimal !== undefined || answer.valueInteger !== undefined)
        )
    ) ?? false
  );
}

function hasAnswers(items: QuestionnaireResponse['item']): boolean {
  return (
    items?.some(
      (item) =>
        item.answer?.some((answer) =>
          Object.entries(answer).some(
            ([field, value]) => field !== 'item' && value !== undefined && value !== null && value !== ''
          )
        ) || hasAnswers(item.item)
    ) ?? false
  );
}

export function RedRoverLocalVisit(props: { encounterId: string }): JSX.Element {
  const medplum = useMedplum();
  const [encounter, setEncounter] = useState<Encounter>();
  const [drafts, setDrafts] = useState<QuestionnaireResponse[]>();
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [vitals, setVitals] = useState<Observation[]>([]);
  const [decisionFlow, setDecisionFlow] = useState<string | null>(null);
  const [, refreshSelections] = useState(0);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [measuredAt, setMeasuredAt] = useState('');
  const inputs = useRef(new Map<number, QuestionnaireResponse>());
  const pending = useRef(false);
  const recording = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setEncounter(undefined);
    setDrafts(undefined);
    setError(undefined);
    setBlocked(false);
    setMeasuredAt('');
    setVitals([]);
    setDecisionFlow(null);
    inputs.current.clear();
    const load = async (): Promise<void> => {
      const visit = await medplum.readResource('Encounter', props.encounterId, options());
      if (!isRedRoverLocalEncounter(visit) || visit.status !== 'in-progress' || visit.period?.end) {
        throw new Error('This is not the approved active TESTONE local visit');
      }
      const profile = medplum.getProfile();
      if (profile?.resourceType !== 'Practitioner' || profile.meta?.project !== visit.meta?.project) {
        throw new Error('A clinician in the TESTONE project is required');
      }
      const manifests = visit.extension?.filter((extension) => extension.url === linksUrl);
      const links = manifests?.[0]?.extension;
      if (manifests?.length !== 1 || !links || ![5, questionnaires.length].includes(links.length)) {
        throw new Error('Local visit draft manifest is incomplete');
      }
      const references = questionnaires.slice(0, links.length).map((_, index) => {
        const matches = links.filter((link) => link.url === String(index));
        const reference = matches[0]?.valueReference?.reference;
        if (matches.length !== 1 || !reference || !/^QuestionnaireResponse\/[A-Za-z0-9.-]{1,64}$/.test(reference)) {
          throw new Error('Invalid local draft reference');
        }
        return reference;
      });
      if (new Set(references).size !== references.length) throw new Error('Duplicate local draft references');
      const loaded = await Promise.all(
        references.map((reference) => medplum.readResource('QuestionnaireResponse', reference.split('/')[1], options()))
      );
      loaded.forEach((draft, index) => assertDraft(draft, visit, index));
      const observations =
        links.length === questionnaires.length
          ? await medplum.search(
              'Observation',
              {
                subject: visit.subject!.reference!,
                encounter: getReferenceString(visit),
                identifier: `${LOCAL_VITAL_IDENTIFIER_SYSTEM}|${visit.id}`,
                _count: '100',
              },
              options()
            )
          : undefined;
      if (observations?.link?.some((link) => link.relation === 'next'))
        throw new Error('Local vital history is truncated');
      const recorded = (observations?.entry ?? []).map((entry) => entry.resource as Observation);
      if (
        recorded.some(
          (vital) =>
            vital.resourceType !== 'Observation' ||
            vital.meta?.project !== visit.meta?.project ||
            vital.meta?.source ||
            vital.subject?.reference !== visit.subject?.reference ||
            vital.encounter?.reference !== getReferenceString(visit) ||
            !vital.identifier?.some(
              (identifier) => identifier.system === LOCAL_VITAL_IDENTIFIER_SYSTEM && identifier.value === visit.id
            )
        )
      ) {
        throw new Error('Vital history contains a record outside this local visit');
      }
      if (!cancelled) {
        setEncounter(visit);
        setDrafts(loaded);
        setVitals(recorded);
        if (loaded[4].item?.some((item) => item.item?.some((child) => child.answer?.length)))
          setDecisionFlow(questionnaires[4].url!);
        if (sessionStorage.getItem(pendingVitalsKey(visit.id!))) {
          setBlocked(true);
          setError(
            'An earlier vitals recording is unconfirmed. Reconcile it before further writes; no retry is enabled.'
          );
        }
        const measured = loaded[1].extension?.find((extension) => extension.url === measurementUrl)?.valueDateTime;
        if (measured) {
          const date = new Date(measured);
          setMeasuredAt(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
        }
      }
    };
    load().catch((reason) => {
      if (!cancelled) setError(normalizeErrorString(reason));
    });
    return () => {
      cancelled = true;
    };
  }, [medplum, props.encounterId]);

  const save = async (requested?: number[]): Promise<boolean> => {
    if (!encounter || !drafts || pending.current || blocked) return false;
    pending.current = true;
    setSaving(true);
    setError(undefined);
    setSaved(undefined);
    let dispatched = false;
    try {
      const indices =
        requested ?? (inputs.current.size ? [...inputs.current.keys()] : [hasVitalValues(drafts[1].item) ? 1 : 0]);
      for (const index of indices) {
        const initial = drafts[index];
        const draftInput = inputs.current.get(index) ?? initial;
        const measurement = index === 1 && measuredAt ? new Date(measuredAt).toISOString() : undefined;
        if (index === 1 && hasVitalValues(draftInput.item) && !measurement) {
          throw new Error('A measurement time is required for recorded vital signs');
        }
        if (measurement && Date.parse(measurement) < Date.parse(encounter.period!.start!)) {
          throw new Error('Vital signs must be measured during this new visit');
        }
        const currentVisit = await medplum.readResource('Encounter', encounter.id!, options());
        if (
          !isRedRoverLocalEncounter(currentVisit) ||
          currentVisit.status !== 'in-progress' ||
          currentVisit.period?.end
        ) {
          throw new Error('The local visit is no longer active');
        }
        const fresh = await medplum.readResource('QuestionnaireResponse', initial.id!, options());
        assertDraft(fresh, currentVisit, index);
        if (fresh.meta!.versionId !== initial.meta!.versionId) {
          setBlocked(true);
          throw new Error('This draft changed elsewhere. Reload the visit before saving');
        }
        const profile = medplum.getProfile();
        if (profile?.resourceType !== 'Practitioner' || profile.meta?.project !== encounter.meta?.project) {
          throw new Error('The current clinician does not belong to this test project');
        }
        const updated: QuestionnaireResponse = {
          ...fresh,
          status: 'in-progress',
          author: { reference: getReferenceString(profile) },
          source: { reference: getReferenceString(profile) },
          authored: new Date().toISOString(),
          item: draftInput.item,
          extension: [
            ...(draftInput.extension ?? fresh.extension ?? []).filter((extension) => extension.url !== measurementUrl),
            ...(measurement ? [{ url: measurementUrl, valueDateTime: measurement }] : []),
          ],
        };
        dispatched = true;
        const result = await medplum.updateResource(updated, {
          ...options(),
          headers: { 'If-Match': `W/"${fresh.meta!.versionId}"` },
        });
        const readback = await medplum.readResource('QuestionnaireResponse', initial.id!, options());
        assertDraft(readback, currentVisit, index);
        if (
          readback.meta?.versionId !== result.meta?.versionId ||
          !deepEquals(readback.item, updated.item) ||
          !deepEquals(readback.extension ?? [], updated.extension ?? [])
        ) {
          throw new Error('Draft save could not be independently confirmed');
        }
        dispatched = false;
        setDrafts((current) => current?.map((draft, position) => (position === index ? readback : draft)));
        inputs.current.delete(index);
      }
      setSaved(`${indices.map((index) => sections[index]).join(', ')} draft${indices.length === 1 ? '' : 's'} saved`);
      return true;
    } catch (reason) {
      if (dispatched) setBlocked(true);
      setError(
        `${normalizeErrorString(reason)}${dispatched ? '. Save not confirmed; reload this visit before trying again' : ''}`
      );
      return false;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const stash = (index: number, response: QuestionnaireResponse): void => {
    if (!drafts?.[index] || blocked || pending.current) return;
    if (index < 5 && !hasAnswers((inputs.current.get(index) ?? drafts[index]).item) && !hasAnswers(response.item))
      return;
    inputs.current.set(index, {
      ...drafts[index],
      ...response,
      status: 'in-progress',
      extension:
        index < 5
          ? (response.extension ?? drafts[index].extension)
          : [
              ...(response.extension ?? drafts[index].extension ?? []).filter(
                (extension) => extension.url !== selectedUrl
              ),
              { url: selectedUrl, valueBoolean: true },
            ],
    });
  };

  const selectTemplate = (url: string, response: QuestionnaireResponse): void => {
    stash(
      questionnaires.findIndex((template) => template.url === url),
      response
    );
  };

  const removeTemplate = async (url: string): Promise<void> => {
    const index = questionnaires.findIndex((template) => template.url === url);
    if (!drafts?.[index] || blocked || pending.current) return;
    inputs.current.set(index, {
      ...drafts[index],
      item: [],
      extension: [
        ...(drafts[index].extension ?? []).filter((extension) => extension.url !== selectedUrl),
        { url: selectedUrl, valueBoolean: false },
      ],
    });
    refreshSelections((value) => value + 1);
  };

  const recordVitals = async (response: QuestionnaireResponse): Promise<void> => {
    if (!encounter || drafts?.length !== questionnaires.length || blocked || recording.current || pending.current)
      return;
    recording.current = true;
    let dispatched = false;
    try {
      const profile = medplum.getProfile();
      if (profile?.resourceType !== 'Practitioner') throw new Error('A clinician is required');
      const patient: Patient = {
        resourceType: 'Patient',
        id: encounter.subject!.reference!.split('/')[1],
        meta: { project: encounter.meta?.project },
      };
      const measurement = measuredAt ? new Date(measuredAt).toISOString() : '';
      const observations = buildRedRoverLocalVitals(patient, encounter, profile, response, measurement);
      stash(1, response);
      if (!(await save([1]))) throw new Error('Save the Objective draft before recording vitals');
      pending.current = true;
      setSaving(true);
      const fresh = await medplum.readResource('Encounter', encounter.id!, options());
      if (!deepEquals(fresh, encounter)) throw new Error('Visit changed; reload before recording vitals');
      const key = pendingVitalsKey(encounter.id!);
      if (sessionStorage.getItem(key)) throw new Error('An unconfirmed vitals recording requires reconciliation');
      sessionStorage.setItem(key, 'unconfirmed');
      dispatched = true;
      const result = await medplum.executeBatch(
        {
          resourceType: 'Bundle',
          type: 'transaction',
          entry: observations.map((observation) => ({
            resource: observation,
            request: {
              method: 'POST',
              url: 'Observation',
              ifNoneExist: `identifier=${encodeURIComponent(`${observation.identifier![1].system}|${observation.identifier![1].value}`)}`,
            },
          })),
        },
        options()
      );
      if (result.entry?.length !== observations.length) throw new Error('Incomplete vital recording response');
      const recorded: Observation[] = [];
      for (const [index, entry] of result.entry.entries()) {
        const id =
          entry.resource?.id ??
          entry.response?.location?.match(/(?:^|\/)Observation\/([A-Za-z0-9.-]{1,64})(?:\/|$)/)?.[1];
        if (!id || !/^20[01]/.test(entry.response?.status ?? ''))
          throw new Error('Vital recording response was not confirmed');
        const readback = await medplum.readResource('Observation', id, options());
        const expected = observations[index];
        if (
          !readback.meta?.versionId ||
          readback.meta.project !== encounter.meta?.project ||
          readback.meta.source ||
          Object.keys(expected).some(
            (field) =>
              field !== 'meta' &&
              !deepEquals(readback[field as keyof Observation], expected[field as keyof Observation])
          )
        ) {
          throw new Error('Recorded vital did not match independent readback');
        }
        recorded.push(readback);
      }
      sessionStorage.removeItem(key);
      setVitals((current) => [...new Map([...current, ...recorded].map((vital) => [vital.id, vital])).values()]);
      setSaved('Vitals recorded; SOAP remains an unsigned draft');
      setVitalsOpen(false);
    } catch (reason) {
      if (dispatched) setBlocked(true);
      setError(
        `${normalizeErrorString(reason)}${dispatched ? '. Vitals recording not confirmed; reconciliation is required. No retry is enabled' : ''}`
      );
      throw reason;
    } finally {
      recording.current = false;
      pending.current = false;
      setSaving(false);
    }
  };

  if (!drafts || !encounter)
    return error ? <Alert color="red">{error}</Alert> : <Loader aria-label="Loading local visit" />;
  const disabled = saving || blocked;
  const fullAuthoring = drafts.length === questionnaires.length;
  const response = (index: number): QuestionnaireResponse => inputs.current.get(index) ?? drafts[index];
  const templateStates = (start: number, end: number) =>
    questionnaires.slice(start, end).map((template, offset) => {
      const current = response(start + offset);
      const selected = current?.extension?.find((extension) => extension.url === selectedUrl)?.valueBoolean;
      return {
        url: template.url!,
        label: sections[start + offset],
        questionnaire: template,
        response: selected === true || (selected !== false && current?.item?.length) ? current : undefined,
      };
    });
  const patient: Patient = {
    resourceType: 'Patient',
    id: encounter.subject!.reference!.split('/')[1],
    meta: { project: encounter.meta?.project },
  };
  return (
    <Stack p="md" gap="md">
      <Group justify="space-between" wrap="wrap">
        <Title order={3}>SOAP Note</Title>
        <Group gap="xs">
          <Badge color="teal">In progress</Badge>
          <Badge color="gray">Unsigned draft</Badge>
        </Group>
      </Group>
      <Text size="sm" c="dimmed">
        Red Rover delivery disabled
      </Text>
      {error && <Alert color="red">{error}</Alert>}
      {saved && (
        <Text role="status" c="teal" size="sm">
          {saved}
        </Text>
      )}
      <SoapSubjectiveCard
        questionnaireResponse={response(0)}
        disabled={disabled}
        onChange={(value) => stash(0, value)}
        onDraftChange={(value) => stash(0, value)}
      />
      <Stack gap="sm" mt="md">
        <Title order={3}>Clinical Decision Support</Title>
        <Select
          label="Decision flow"
          placeholder="Search decision flows"
          searchable
          data={[{ value: questionnaires[4].url!, label: 'A-01 Sore Throat / Hoarseness' }]}
          value={decisionFlow}
          disabled={disabled}
          onChange={setDecisionFlow}
        />
        {decisionFlow && (
          <>
            <Alert color="yellow">A-01 draft only. Evaluation and clinical routing are inactive.</Alert>
            <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <A01CompactQuestionnaire
                key={drafts[4].meta?.versionId}
                questionnaire={questionnaires[4]}
                questionnaireResponse={response(4)}
                draftOnly
                onSubmit={() => undefined}
                onDraftChange={(value) => stash(4, value)}
              />
            </fieldset>
          </>
        )}
      </Stack>
      {!fullAuthoring && (
        <Alert color="yellow">
          Additional ROS, physical-exam drafts and vitals recording are not yet provisioned for this visit.
        </Alert>
      )}
      <SoapRosCard
        templates={templateStates(5, 8)}
        disabled={disabled || !fullAuthoring}
        onChange={selectTemplate}
        onDraftChange={selectTemplate}
        onRemove={removeTemplate}
      />
      <Stack gap="sm" mt="md">
        <Group justify="space-between">
          <Title order={3}>Objective</Title>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setVitalsOpen(true)} disabled={disabled}>
            Add vitals
          </Button>
        </Group>
        {vitals.length === 0 && (
          <Text size="sm" c="dimmed">
            No vitals recorded for this local visit.
          </Text>
        )}
        {vitals.map((vital) => (
          <Group key={vital.id} justify="space-between" wrap="wrap">
            <Text size="sm">{vital.code?.coding?.[0]?.display ?? vital.code?.text}</Text>
            <Text size="sm">
              {vital.valueQuantity?.value} {vital.valueQuantity?.unit}
            </Text>
            <Text size="xs" c="dimmed">
              {formatDateTime(vital.effectiveDateTime)}
            </Text>
          </Group>
        ))}
      </Stack>
      <SoapPhysicalExamCard
        templates={templateStates(8, 12)}
        disabled={disabled || !fullAuthoring}
        onChange={selectTemplate}
        onDraftChange={selectTemplate}
        onRemove={removeTemplate}
      />
      {[2, 3].map((index) => (
        <fieldset key={index} disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <SoapSectionCard
            title={sections[index]}
            questionnaire={questionnaires[index]}
            questionnaireResponse={response(index)}
            disabled={disabled}
            onChange={(value) => stash(index, value)}
            onDraftChange={(value) => stash(index, value)}
          />
        </fieldset>
      ))}
      <Modal
        opened={vitalsOpen}
        onClose={() => {
          if (!saving) setVitalsOpen(false);
        }}
        title="Add Vitals"
        size="md"
      >
        <TextInput
          type="datetime-local"
          label="Vitals measured at"
          value={measuredAt}
          disabled={disabled}
          onChange={(event) => setMeasuredAt(event.currentTarget.value)}
        />
        <SoapObjectiveCard
          patient={patient}
          encounter={encounter}
          practitioner={medplum.getProfile() as Practitioner}
          questionnaireResponse={response(1)}
          disabled={disabled}
          onChange={(value) => stash(1, value)}
          onDraftChange={(value) => stash(1, value)}
          onRecordVitals={fullAuthoring ? recordVitals : undefined}
        />
        {error && (
          <Alert color="red" mt="md">
            {error}
          </Alert>
        )}
      </Modal>
      <Group justify="flex-end">
        <Button
          leftSection={<IconDeviceFloppy size={16} />}
          loading={saving}
          disabled={blocked}
          onClick={() => {
            save().catch(console.error);
          }}
        >
          Save draft
        </Button>
      </Group>
    </Stack>
  );
}
