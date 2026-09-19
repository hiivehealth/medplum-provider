import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Card,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import type {
  AllergyIntolerance,
  CarePlan,
  CareTeam,
  Condition,
  Coverage,
  DiagnosticReport,
  DocumentReference,
  Encounter,
  Immunization,
  MedicationRequest,
  Observation,
  Procedure,
  RelatedPerson,
  Resource,
} from '@medplum/fhirtypes';
import { useMedplum, useSearchResources } from '@medplum/react';
import { IconFileExport, IconPrinter } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { usePatient } from '../../hooks/usePatient';
import { recordCaliforniaViewerAudit } from './californiaViewerAudit';

type SourceOption = { label: string; value: string };

export function CaliforniaViewerTab(): JSX.Element {
  const medplum = useMedplum();
  const patient = usePatient();
  const [source, setSource] = useState('all');
  const patientReference = patient?.id ? `Patient/${patient.id}` : undefined;
  const enabled = Boolean(patientReference);
  const [conditions, conditionsLoading] = useSearchResources(
    'Condition',
    { subject: patientReference, _count: '100' },
    { enabled }
  );
  const [allergies, allergiesLoading] = useSearchResources(
    'AllergyIntolerance',
    { patient: patientReference, _count: '100' },
    { enabled }
  );
  const [medications, medicationsLoading] = useSearchResources(
    'MedicationRequest',
    { subject: patientReference, _count: '100' },
    { enabled }
  );
  const [observations, observationsLoading] = useSearchResources(
    'Observation',
    { subject: patientReference, _count: '100' },
    { enabled }
  );
  const [encounters, encountersLoading] = useSearchResources(
    'Encounter',
    { patient: patientReference, _count: '100' },
    { enabled }
  );
  const [documents, documentsLoading] = useSearchResources(
    'DocumentReference',
    { subject: patientReference, _count: '100' },
    { enabled }
  );
  const [coverages, coveragesLoading] = useSearchResources(
    'Coverage',
    { beneficiary: patientReference, _count: '100' },
    { enabled }
  );
  const [carePlans, carePlansLoading] = useSearchResources(
    'CarePlan',
    { subject: patientReference, _count: '100' },
    { enabled }
  );
  const [diagnosticReports, diagnosticReportsLoading] = useSearchResources(
    'DiagnosticReport',
    { subject: patientReference, _count: '100' },
    { enabled }
  );
  const [immunizations, immunizationsLoading] = useSearchResources(
    'Immunization',
    { patient: patientReference, _count: '100' },
    { enabled }
  );
  const [procedures, proceduresLoading] = useSearchResources(
    'Procedure',
    { subject: patientReference, _count: '100' },
    { enabled }
  );
  const [careTeams, careTeamsLoading] = useSearchResources(
    'CareTeam',
    { subject: patientReference, _count: '100' },
    { enabled }
  );
  const [contacts, contactsLoading] = useSearchResources(
    'RelatedPerson',
    { patient: patientReference, _count: '100' },
    { enabled }
  );

  useEffect(() => {
    if (!patient?.id) {
      return;
    }
    void recordCaliforniaViewerAudit(medplum, {
      action: 'record-view',
      patient: { reference: `Patient/${patient.id}` },
      source: 'All contributing sources',
    }).catch(console.error);
  }, [medplum, patient?.id]);

  if (!patient) {
    return <Loader />;
  }

  const sourceOptions = getSourceOptions(patient);
  const sourceLabel = sourceOptions.find((option) => option.value === source)?.label ?? 'All contributing sources';
  const recordAudit = (action: Parameters<typeof recordCaliforniaViewerAudit>[1]['action']): void => {
    void recordCaliforniaViewerAudit(medplum, {
      action,
      patient: { reference: `Patient/${patient.id}` },
      source: sourceLabel,
    }).catch(console.error);
  };
  const isLoading = [
    conditionsLoading,
    allergiesLoading,
    medicationsLoading,
    observationsLoading,
    encountersLoading,
    documentsLoading,
    coveragesLoading,
    carePlansLoading,
    diagnosticReportsLoading,
    immunizationsLoading,
    proceduresLoading,
    careTeamsLoading,
    contactsLoading,
  ].some(Boolean);
  const filteredConditions = filterBySource(conditions, source);
  const filteredAllergies = filterBySource(allergies, source);
  const filteredMedications = filterBySource(medications, source);
  const filteredObservations = filterBySource(observations, source);
  const filteredEncounters = filterBySource(encounters, source);
  const filteredDocuments = filterBySource(documents, source);
  const filteredCoverages = filterBySource(coverages, source);
  const filteredCarePlans = filterBySource(carePlans, source);
  const filteredDiagnosticReports = filterBySource(diagnosticReports, source);
  const filteredImmunizations = filterBySource(immunizations, source);
  const filteredProcedures = filterBySource(procedures, source);
  const filteredCareTeams = filterBySource(careTeams, source);
  const filteredContacts = filterBySource(contacts, source);
  const criticalAllergies = filteredAllergies.filter((allergy) => allergy.criticality === 'high');
  const criticalObservations = filteredObservations.filter((observation) =>
    observation.interpretation?.some((interpretation) =>
      interpretation.coding?.some((coding) => coding.code === 'HH' || coding.code === 'LL')
    )
  );

  return (
    <Stack p="md" gap="md">
      <Group justify="space-between" align="end">
        <div>
          <Title order={3}>California HIE Clinical Viewer</Title>
          <Text size="sm" c="dimmed">
            Synthetic demonstration record
          </Text>
        </div>
        <Group align="end" gap="xs">
          <Select
            label="Record source"
            value={source}
            data={sourceOptions}
            onChange={(value) => {
              const nextSource = value ?? 'all';
              setSource(nextSource);
              void recordCaliforniaViewerAudit(medplum, {
                action: 'source-filter',
                patient: { reference: `Patient/${patient.id}` },
                source:
                  sourceOptions.find((option) => option.value === nextSource)?.label ?? 'All contributing sources',
              }).catch(console.error);
            }}
            w={280}
          />
          <Tooltip label="Print visible summary" position="bottom" openDelay={500}>
            <ActionIcon
              aria-label="Print visible summary"
              variant="default"
              onClick={() => {
                recordAudit('print');
                window.print();
              }}
            >
              <IconPrinter size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Export patient data" position="bottom" openDelay={500}>
            <ActionIcon
              aria-label="Export patient data"
              component={Link}
              to={`/Patient/${patient.id}/export`}
              variant="default"
              onClick={() => recordAudit('export')}
            >
              <IconFileExport size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {(criticalAllergies.length > 0 || criticalObservations.length > 0) && (
        <Alert color="red" title="Clinical safety alerts">
          {criticalAllergies.length > 0 && <Text size="sm">High-criticality allergy documented.</Text>}
          {criticalObservations.length > 0 && <Text size="sm">Critical laboratory result requires review.</Text>}
        </Alert>
      )}

      {isLoading ? (
        <Loader />
      ) : (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
            <SummaryCard label="Problems" count={filteredConditions.length} />
            <SummaryCard label="Allergies" count={filteredAllergies.length} />
            <SummaryCard label="Medications" count={filteredMedications.length} />
            <SummaryCard label="Results" count={filteredObservations.length} />
            <SummaryCard label="Encounters" count={filteredEncounters.length} />
            <SummaryCard label="Documents" count={filteredDocuments.length} />
            <SummaryCard label="Coverage" count={filteredCoverages.length} />
            <SummaryCard label="Care plans" count={filteredCarePlans.length} />
            <SummaryCard label="Reports" count={filteredDiagnosticReports.length} />
            <SummaryCard label="Immunizations" count={filteredImmunizations.length} />
            <SummaryCard label="Procedures" count={filteredProcedures.length} />
            <SummaryCard label="Care teams" count={filteredCareTeams.length} />
            <SummaryCard label="Contacts" count={filteredContacts.length} />
          </SimpleGrid>
          <ClinicalDetails
            conditions={filteredConditions}
            allergies={filteredAllergies}
            medications={filteredMedications}
            observations={filteredObservations}
            encounters={filteredEncounters}
            documents={filteredDocuments}
            coverages={filteredCoverages}
            carePlans={filteredCarePlans}
            patientId={patient.id}
            onDocumentOpen={() => recordAudit('document-view')}
            diagnosticReports={filteredDiagnosticReports}
            immunizations={filteredImmunizations}
            procedures={filteredProcedures}
            careTeams={filteredCareTeams}
            contacts={filteredContacts}
          />
        </>
      )}
    </Stack>
  );
}

function SummaryCard({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <Card withBorder padding="sm">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Title order={3}>{count}</Title>
    </Card>
  );
}

function ClinicalDetails({
  conditions,
  allergies,
  medications,
  observations,
  encounters,
  documents,
  coverages,
  carePlans,
  patientId,
  onDocumentOpen,
  diagnosticReports,
  immunizations,
  procedures,
  careTeams,
  contacts,
}: {
  conditions: Condition[];
  allergies: AllergyIntolerance[];
  medications: MedicationRequest[];
  observations: Observation[];
  encounters: Encounter[];
  documents: DocumentReference[];
  coverages: Coverage[];
  carePlans: CarePlan[];
  patientId: string;
  onDocumentOpen: () => void;
  diagnosticReports: DiagnosticReport[];
  immunizations: Immunization[];
  procedures: Procedure[];
  careTeams: CareTeam[];
  contacts: RelatedPerson[];
}): JSX.Element {
  const [section, setSection] = useState<ClinicalSection>('all');
  const [detailFilter, setDetailFilter] = useState('');
  const [sortBy, setSortBy] = useState('type');
  const entries: ClinicalEntry[] = [
    ...conditions.map((resource) => ({
      type: 'Problem',
      value: resource.code?.text ?? resource.code?.coding?.[0]?.display ?? 'Unnamed condition',
    })),
    ...allergies.map((resource) => ({
      type: 'Allergy',
      value: resource.code?.text ?? resource.code?.coding?.[0]?.display ?? 'Unnamed allergy',
    })),
    ...medications.map((resource) => ({
      type: 'Medication',
      value:
        resource.medicationCodeableConcept?.text ??
        resource.medicationCodeableConcept?.coding?.[0]?.display ??
        'Unnamed medication',
    })),
    ...observations.map((resource) => ({
      type: isSocialNeedObservation(resource) ? 'Social need' : 'Result',
      value: getObservationDescription(resource),
    })),
    ...encounters.map((resource) => ({ type: 'Encounter', value: resource.period?.start ?? 'Undated encounter' })),
    ...documents.map((resource) => ({
      type: 'Document',
      value: resource.content?.[0]?.attachment?.title ?? resource.type?.text ?? 'Untitled document',
      documentId: resource.id,
    })),
    ...coverages.map((resource) => ({ type: 'Coverage', value: resource.payor?.[0]?.display ?? 'Unnamed coverage' })),
    ...carePlans.map((resource) => ({ type: 'Care plan', value: resource.title ?? 'Untitled care plan' })),
    ...diagnosticReports.map((resource) => ({
      type: 'Diagnostic report',
      value: resource.code?.text ?? resource.code?.coding?.[0]?.display ?? 'Unnamed diagnostic report',
    })),
    ...immunizations.map((resource) => ({
      type: 'Immunization',
      value: resource.vaccineCode.text ?? resource.vaccineCode.coding?.[0]?.display ?? 'Unnamed immunization',
    })),
    ...procedures.map((resource) => ({
      type: 'Procedure',
      value: resource.code?.text ?? resource.code?.coding?.[0]?.display ?? 'Unnamed procedure',
    })),
    ...careTeams.map((resource) => ({ type: 'Care team', value: resource.name ?? 'Unnamed care team' })),
    ...contacts.map((resource) => ({ type: 'Contact', value: getRelatedPersonName(resource) })),
  ];
  const visibleEntries = entries
    .filter(
      (entry) =>
        (section === 'all' || getClinicalSection(entry) === section) &&
        `${entry.type} ${entry.value}`.toLocaleLowerCase().includes(detailFilter.toLocaleLowerCase())
    )
    .sort((left, right) =>
      sortBy === 'type' ? left.type.localeCompare(right.type) : left.value.localeCompare(right.value)
    );
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Title order={4}>Clinical record details</Title>
        <Tabs value={section} onChange={(value) => setSection((value ?? 'all') as ClinicalSection)}>
          <Tabs.List>
            <Tabs.Tab value="all">All ({entries.length})</Tabs.Tab>
            <Tabs.Tab value="clinical">
              Clinical ({entries.filter((entry) => getClinicalSection(entry) === 'clinical').length})
            </Tabs.Tab>
            <Tabs.Tab value="care">
              Care and support ({entries.filter((entry) => getClinicalSection(entry) === 'care').length})
            </Tabs.Tab>
            <Tabs.Tab value="history">
              History and documents ({entries.filter((entry) => getClinicalSection(entry) === 'history').length})
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Group grow align="end">
          <TextInput
            label="Filter details"
            value={detailFilter}
            onChange={(event) => setDetailFilter(event.currentTarget.value)}
          />
          <Select
            label="Sort details"
            value={sortBy}
            data={[
              { label: 'Type', value: 'type' },
              { label: 'Name', value: 'name' },
            ]}
            onChange={(value) => setSortBy(value ?? 'type')}
          />
        </Group>
        {visibleEntries.length === 0 ? (
          <Text c="dimmed">No clinical data is available for this source selection.</Text>
        ) : (
          visibleEntries.map((entry, index) => (
            <Group key={`${entry.type}-${index}`} justify="space-between">
              {entry.documentId ? (
                <Anchor
                  component={Link}
                  to={`/Patient/${patientId}/DocumentReference/${entry.documentId}`}
                  onClick={onDocumentOpen}
                >
                  {entry.value}
                </Anchor>
              ) : (
                <Text>{entry.value}</Text>
              )}
              <Badge variant="light">{entry.type}</Badge>
            </Group>
          ))
        )}
      </Stack>
    </Card>
  );
}

type ClinicalEntry = { type: string; value: string; documentId?: string };
type ClinicalSection = 'all' | 'care' | 'clinical' | 'history';

function getClinicalSection(entry: ClinicalEntry): Exclude<ClinicalSection, 'all'> {
  if (['Coverage', 'Care plan', 'Care team', 'Contact', 'Social need'].includes(entry.type)) {
    return 'care';
  }
  if (['Encounter', 'Document'].includes(entry.type)) {
    return 'history';
  }
  return 'clinical';
}

function isSocialNeedObservation(observation: Observation): boolean {
  return observation.code?.coding?.some((coding) => coding.code === '71802-3') ?? false;
}

function getObservationDescription(observation: Observation): string {
  const label = observation.code?.text ?? observation.code?.coding?.[0]?.display ?? 'Unnamed result';
  const value =
    observation.valueCodeableConcept?.text ?? observation.valueString ?? observation.valueQuantity?.value?.toString();
  return value ? `${label}: ${value}` : label;
}

function getRelatedPersonName(contact: RelatedPerson): string {
  const name = contact.name?.[0];
  return [name?.given?.join(' '), name?.family].filter(Boolean).join(' ') || 'Unnamed contact';
}

function getSourceOptions(patient: {
  identifier?: Array<{ system?: string; assigner?: { display?: string; reference?: string } }>;
}): SourceOption[] {
  const options =
    patient.identifier
      ?.filter((identifier) =>
        identifier.system?.startsWith('https://hiivehealth.com/fhir/identifier/california-demo-org-')
      )
      .map((identifier) => ({
        label: identifier.assigner?.display ?? identifier.assigner?.reference ?? 'Unknown source',
        value: identifier.assigner?.reference ? `https://hiivehealth.com/fhir/${identifier.assigner.reference}` : '',
      }))
      .filter((option) => option.value) ?? [];
  return [{ label: 'All contributing sources', value: 'all' }, ...options];
}

function filterBySource<T extends Resource>(resources: T[] | undefined, source: string): T[] {
  const resourceList = resources ?? [];
  return source === 'all' ? resourceList : resourceList.filter((resource) => resource.meta?.source === source);
}
