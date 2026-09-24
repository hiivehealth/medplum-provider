// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box, Card, Stack, Title } from '@mantine/core';
import type { WithId } from '@medplum/core';
import { createReference, getReferenceString } from '@medplum/core';
import type { ClinicalImpression, Encounter, Practitioner, Provenance, QuestionnaireResponse, Reference, Task } from '@medplum/fhirtypes';
import { Loading, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SOAP_ASSESSMENT_URL,
  SOAP_OBJECTIVE_URL,
  SOAP_PLAN_URL,
  SOAP_SUBJECTIVE_URL,
  ROS_BRIEF_NORMAL_URL,
  ROS_EXTENDED_NORMAL_URL,
  ROS_UNABLE_TO_OBTAIN_URL,
  PHYSICAL_EXAM_ADULT_BRIEF_URL,
  PHYSICAL_EXAM_ADULT_EXTENDED_URL,
  PHYSICAL_EXAM_PEDIATRIC_BRIEF_URL,
  PHYSICAL_EXAM_PEDIATRIC_EXTENDED_URL,
} from '../../data/soap-questionnaires';
import { useDecisionFlows } from '../../hooks/useDecisionFlows';
import { useAdtmcA01Result } from '../../hooks/useAdtmcA01Result';
import { useEncounterChart } from '../../hooks/useEncounterChart';
import { useSoapQuestionnaires } from '../../hooks/useSoapQuestionnaires';
import { ChartNoteStatus } from '../../types/encounter';
import { updateEncounterStatus } from '../../utils/encounter';
import { buildSoapComposition } from '../../utils/soap-composition';
import { showErrorNotification } from '../../utils/notifications';
import { TaskPanel } from '../tasks/encounter/TaskPanel';
import { AdtmcA01DecisionSupport } from './AdtmcA01DecisionSupport';
import { BillingTab } from './BillingTab';
import { DecisionFlowsPanel } from './DecisionFlowsPanel/DecisionFlowsPanel';
import { EncounterHeader } from './EncounterHeader';
import { LocationSelector } from './LocationSelector';
import { OccupationalReturnToWorkPanel } from './OccupationalReturnToWorkPanel';
import { OrdersPanel } from './OrdersPanel/OrdersPanel';
import { SignAddendum } from './SignAddendum';
import { SoapObjectiveCard } from './SoapObjectiveCard';
import { SoapPhysicalExamCard } from './SoapPhysicalExamCard';
import { SoapRosCard } from './SoapRosCard';
import { SoapSectionCard } from './SoapSectionCard/SoapSectionCard';
import { hasExactlyOneChiefComplaint, hasNonEmptyComplaint, SoapSubjectiveCard } from './SoapSubjectiveCard';

const FHIR_ACT_REASON_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-ActReason';
const FHIR_PROVENANCE_PARTICIPANT_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/provenance-participant-type';
const FHIR_DOCUMENT_COMPLETION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-DocumentCompletion';
const CARE_TEMPLATE_EXTENSION_URL = 'https://hiivehealth.com/fhir/StructureDefinition/encounter-care-template';
const SOAP_PLAN_DEFINITION_URL = 'https://hiivehealth.com/plandefinition/soap-note';

const TASK_COMPLETED_STATUSES = new Set<Task['status']>([
  'completed',
  'cancelled',
  'failed',
  'rejected',
  'entered-in-error',
]);

function getCareTemplateUrl(encounter: Encounter): string | undefined {
  return encounter.extension?.find((e) => e.url === CARE_TEMPLATE_EXTENSION_URL)?.valueCanonical;
}

function isSoapNoteEncounter(encounter: Encounter): boolean {
  const templateUrl = getCareTemplateUrl(encounter);
  return templateUrl === undefined || templateUrl === SOAP_PLAN_DEFINITION_URL;
}

export interface EncounterChartProps {
  encounter: WithId<Encounter> | Reference<Encounter>;
}

export const EncounterChart = (props: EncounterChartProps): JSX.Element => {
  const { encounter: encounterProp } = props;
  const medplum = useMedplum();

  const [activeTab, setActiveTab] = useState('notes');
  const {
    encounter,
    patient: patientResource,
    claim,
    practitioner,
    tasks,
    clinicalImpression,
    chargeItems,
    appointment,
    setEncounter,
    setClaim,
    setPractitioner,
    setTasks,
    setClinicalImpression,
    setChargeItems,
  } = useEncounterChart(encounterProp);

  const [provenances, setProvenances] = useState<Provenance[]>([]);
  const [chartNoteStatus, setChartNoteStatus] = useState(ChartNoteStatus.Unsigned);

  const { questionnaires, saveResponse, removeResponse, persistAll } = useSoapQuestionnaires(encounter, patientResource);
  const subjectiveDraftRef = useRef<QuestionnaireResponse | undefined>(undefined);
  const decisionFlows = useDecisionFlows(encounter, patientResource);
  const adtmcA01Result = useAdtmcA01Result(encounter);

  useEffect(() => {
    subjectiveDraftRef.current = questionnaires.get(SOAP_SUBJECTIVE_URL)?.response;
  }, [questionnaires]);

  useEffect(() => {
    if (!encounter) {
      return;
    }

    const fetchProvenance = async (): Promise<void> => {
      const provenance = await medplum.searchResources('Provenance', `target=${getReferenceString(encounter)}`);
      setProvenances(provenance);
      if (provenance.length > 0 && clinicalImpression?.status === 'completed') {
        setChartNoteStatus(ChartNoteStatus.SignedAndLocked);
      } else if (provenance.length > 0) {
        setChartNoteStatus(ChartNoteStatus.Signed);
      } else {
        setChartNoteStatus(ChartNoteStatus.Unsigned);
      }
    };

    fetchProvenance().catch((err) => showErrorNotification(err));
  }, [clinicalImpression, encounter, medplum]);

  const updateTaskList = useCallback(
    (updatedTask: WithId<Task>): void => {
      setTasks((prevTasks) => prevTasks.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
    },
    [setTasks]
  );

  const handleEncounterStatusChange = useCallback(
    async (newStatus: Encounter['status']): Promise<void> => {
      if (!encounter) {
        return;
      }

      try {
        const updatedEncounter = await updateEncounterStatus(medplum, encounter, appointment, newStatus);
        setEncounter(updatedEncounter);
      } catch (err) {
        showErrorNotification(err);
      }
    },
    [encounter, medplum, setEncounter, appointment]
  );

  const handleTabChange = (tab: string): void => {
    setActiveTab(tab);
  };

  const handleSign = async (practitionerRef: Reference<Practitioner>, lock: boolean): Promise<void> => {
    if (!encounter || !patientResource || !practitioner) {
      return;
    }
    if (isSoapNoteEncounter(encounter) && !hasNonEmptyComplaint(subjectiveDraftRef.current)) {
      showErrorNotification(new Error('Add at least one complaint before signing this SOAP note.'));
      return;
    }
    if (isSoapNoteEncounter(encounter) && !hasExactlyOneChiefComplaint(subjectiveDraftRef.current)) {
      showErrorNotification(new Error('Select one chief complaint before signing this SOAP note.'));
      return;
    }

    if (lock) {
      // Complete all incomplete tasks
      const tasksToUpdate = tasks.filter((task) => !TASK_COMPLETED_STATUSES.has(task.status));
      const updatedTasks = await Promise.all(
        tasksToUpdate.map((task) =>
          medplum.updateResource({
            ...task,
            status: 'completed',
          })
        )
      );

      setTasks(
        tasks.map((task) => {
          const updated = updatedTasks.find((t) => t.id === task.id);
          return updated || task;
        })
      );

      // Mark clinical impression as completed
      if (clinicalImpression) {
        const updatedImpression = await medplum.updateResource({ ...clinicalImpression, status: 'completed' });
        setClinicalImpression(updatedImpression);
      }
    }

    // Create provenance record with signature
    const newProvenance = await medplum.createResource<Provenance>({
      resourceType: 'Provenance',
      target: [
        createReference(encounter),
        ...(adtmcA01Result.clinicalImpression?.id ? [createReference(adtmcA01Result.clinicalImpression)] : []),
        ...(adtmcA01Result.questionnaireResponse?.id ? [createReference(adtmcA01Result.questionnaireResponse)] : []),
      ],
      recorded: new Date().toISOString(),
      reason: [
        {
          coding: [
            {
              system: FHIR_ACT_REASON_SYSTEM,
              code: 'SIGN',
              display: 'Signed',
            },
          ],
        },
      ],
      agent: [
        {
          type: {
            coding: [
              {
                system: FHIR_PROVENANCE_PARTICIPANT_TYPE_SYSTEM,
                code: 'author',
              },
            ],
          },
          who: practitionerRef,
        },
      ],
      signature: [
        {
          type: [
            {
              system: FHIR_DOCUMENT_COMPLETION_SYSTEM,
              code: 'LA',
              display: 'legally authenticated',
            },
          ],
          when: new Date().toISOString(),
          who: practitionerRef,
        },
      ],
    });

    setProvenances([...provenances, newProvenance]);

    // Persist all QuestionnaireResponses and create the signed SOAP Composition
    if (isSoapNoteEncounter(encounter)) {
      try {
        const { observations, conditions, carePlans, questionnaireResponses } = await persistAll();
        const recordedVitals = await medplum.searchResources(
          'Observation',
          `encounter=${encodeURIComponent(getReferenceString(encounter) ?? '')}&category=vital-signs&_sort=-date`,
          { cache: 'no-cache' }
        );
        const compositionObservations = [...observations];
        for (const vital of recordedVitals) {
          if (!compositionObservations.some((observation) => observation.id === vital.id)) {
            compositionObservations.push(vital);
          }
        }
        const composition = buildSoapComposition({
          patient: patientResource,
          encounter,
          practitioner: createReference(practitioner),
          clinicalImpression,
          adtmcA01ClinicalImpression: adtmcA01Result.clinicalImpression,
          adtmcA01QuestionnaireResponse: adtmcA01Result.questionnaireResponse,
          observations: compositionObservations,
          conditions,
          carePlans,
          questionnaireResponses,
        });
        await medplum.createResource(composition);
      } catch (err) {
        showErrorNotification(err);
      }
    }

    if (lock) {
      setChartNoteStatus(ChartNoteStatus.SignedAndLocked);
    } else {
      setChartNoteStatus(ChartNoteStatus.Signed);
    }
  };

  if (!patientResource || !encounter) {
    return <Loading />;
  }

  return (
    <>
      <Stack justify="space-between" gap={0}>
        <EncounterHeader
          encounter={encounter}
          chartNoteStatus={chartNoteStatus}
          practitioner={practitioner}
          onStatusChange={handleEncounterStatusChange}
          onTabChange={handleTabChange}
          onSign={handleSign}
        />
        <Box p="md">
          {activeTab === 'notes' && (
            <Stack gap="md">
              <SignAddendum encounter={encounter} provenances={provenances} chartNoteStatus={chartNoteStatus} />

              {!isSoapNoteEncounter(encounter) && (
                <Card withBorder shadow="sm" mt="md">
                  <Title order={3}>Room and Station</Title>
                  <LocationSelector
                    encounter={encounter}
                    onChange={setEncounter}
                    disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                  />
                </Card>
              )}

              {isSoapNoteEncounter(encounter) && (
                <>
                  <SoapSubjectiveCard
                    questionnaireResponse={questionnaires.get(SOAP_SUBJECTIVE_URL)?.response}
                    loading={questionnaires.get(SOAP_SUBJECTIVE_URL)?.loading}
                    error={questionnaires.get(SOAP_SUBJECTIVE_URL)?.error}
                    disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                    onChange={(response) => saveResponse(SOAP_SUBJECTIVE_URL, response)}
                    onDraftChange={(response) => {
                      subjectiveDraftRef.current = response;
                    }}
                  />

                  <SoapRosCard
                    templates={[
                      { url: ROS_BRIEF_NORMAL_URL, label: 'ROS Brief - Normal', ...questionnaires.get(ROS_BRIEF_NORMAL_URL) },
                      { url: ROS_EXTENDED_NORMAL_URL, label: 'ROS Extended - Normal', ...questionnaires.get(ROS_EXTENDED_NORMAL_URL) },
                      { url: ROS_UNABLE_TO_OBTAIN_URL, label: 'ROS Unable to Obtain', ...questionnaires.get(ROS_UNABLE_TO_OBTAIN_URL) },
                    ]}
                    disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                    onChange={saveResponse}
                    onRemove={removeResponse}
                  />

                  <SoapObjectiveCard
                    patient={patientResource}
                    encounter={encounter}
                    practitioner={practitioner}
                    questionnaireResponse={questionnaires.get(SOAP_OBJECTIVE_URL)?.response}
                    loading={questionnaires.get(SOAP_OBJECTIVE_URL)?.loading}
                    error={questionnaires.get(SOAP_OBJECTIVE_URL)?.error}
                    disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                    onChange={(response) => saveResponse(SOAP_OBJECTIVE_URL, response)}
                  />

                  <SoapPhysicalExamCard
                    templates={[
                      { url: PHYSICAL_EXAM_ADULT_BRIEF_URL, label: 'Physical Exam - Adult Brief', ...questionnaires.get(PHYSICAL_EXAM_ADULT_BRIEF_URL) },
                      { url: PHYSICAL_EXAM_ADULT_EXTENDED_URL, label: 'Physical Exam - Adult Extended', ...questionnaires.get(PHYSICAL_EXAM_ADULT_EXTENDED_URL) },
                      { url: PHYSICAL_EXAM_PEDIATRIC_BRIEF_URL, label: 'Physical Exam - Pediatric Brief', ...questionnaires.get(PHYSICAL_EXAM_PEDIATRIC_BRIEF_URL) },
                      { url: PHYSICAL_EXAM_PEDIATRIC_EXTENDED_URL, label: 'Physical Exam - Pediatric Extended', ...questionnaires.get(PHYSICAL_EXAM_PEDIATRIC_EXTENDED_URL) },
                    ]}
                    disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                    onChange={saveResponse}
                    onRemove={removeResponse}
                  />

                  <SoapSectionCard
                    title="Assessment"
                    questionnaire={questionnaires.get(SOAP_ASSESSMENT_URL)?.questionnaire}
                    questionnaireResponse={questionnaires.get(SOAP_ASSESSMENT_URL)?.response}
                    loading={questionnaires.get(SOAP_ASSESSMENT_URL)?.loading}
                    error={questionnaires.get(SOAP_ASSESSMENT_URL)?.error}
                    disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                    onChange={(response) => saveResponse(SOAP_ASSESSMENT_URL, response)}
                  />

                  {adtmcA01Result.clinicalImpression && adtmcA01Result.questionnaireResponse && (
                    <AdtmcA01DecisionSupport
                      section="assessment"
                      clinicalImpression={adtmcA01Result.clinicalImpression}
                      questionnaireResponse={adtmcA01Result.questionnaireResponse}
                      soapResponse={questionnaires.get(SOAP_ASSESSMENT_URL)?.response}
                      disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                      onDraft={(response) => saveResponse(SOAP_ASSESSMENT_URL, response)}
                    />
                  )}

                  <SoapSectionCard
                    title="Plan"
                    questionnaire={questionnaires.get(SOAP_PLAN_URL)?.questionnaire}
                    questionnaireResponse={questionnaires.get(SOAP_PLAN_URL)?.response}
                    loading={questionnaires.get(SOAP_PLAN_URL)?.loading}
                    error={questionnaires.get(SOAP_PLAN_URL)?.error}
                    disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                    onChange={(response) => saveResponse(SOAP_PLAN_URL, response)}
                  />

                  {adtmcA01Result.clinicalImpression && adtmcA01Result.questionnaireResponse && (
                    <AdtmcA01DecisionSupport
                      section="plan"
                      clinicalImpression={adtmcA01Result.clinicalImpression}
                      questionnaireResponse={adtmcA01Result.questionnaireResponse}
                      soapResponse={questionnaires.get(SOAP_PLAN_URL)?.response}
                      disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                      onDraft={(response) => saveResponse(SOAP_PLAN_URL, response)}
                    />
                  )}
                </>
              )}

              <OrdersPanel
                encounter={encounter}
                patient={patientResource}
                practitioner={practitioner}
                disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
              />

              <DecisionFlowsPanel
                decisionFlows={decisionFlows}
                disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                onA01Completed={adtmcA01Result.refresh}
              />

              <OccupationalReturnToWorkPanel
                patient={patientResource}
                encounter={encounter}
                tasks={tasks}
                onUpdateTask={updateTaskList}
                enabled={chartNoteStatus !== ChartNoteStatus.SignedAndLocked}
              />
              {tasks.map((task) => (
                <TaskPanel
                  key={task.id}
                  task={task}
                  onUpdateTask={updateTaskList}
                  enabled={chartNoteStatus !== ChartNoteStatus.SignedAndLocked}
                />
              ))}
            </Stack>
          )}
          {activeTab === 'details' && (
            <BillingTab
              encounter={encounter}
              setEncounter={setEncounter}
              claim={claim}
              patient={patientResource}
              practitioner={practitioner}
              setPractitioner={setPractitioner}
              chargeItems={chargeItems}
              setChargeItems={setChargeItems}
              setClaim={setClaim}
              chartNoteStatus={chartNoteStatus}
            />
          )}
        </Box>
      </Stack>
    </>
  );
};
