// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box, Stack } from '@mantine/core';
import type { WithId } from '@medplum/core';
import { createReference, getReferenceString } from '@medplum/core';
import type { Encounter, Practitioner, Provenance, QuestionnaireResponse, Reference, Task } from '@medplum/fhirtypes';
import { Loading, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
import { useAdtmcA01Result } from '../../hooks/useAdtmcA01Result';
import { useDecisionFlows } from '../../hooks/useDecisionFlows';
import { useEncounterChart } from '../../hooks/useEncounterChart';
import { useSoapQuestionnaires } from '../../hooks/useSoapQuestionnaires';
import { ChartNoteStatus } from '../../types/encounter';
import { updateEncounterStatus } from '../../utils/encounter';
import { showErrorNotification } from '../../utils/notifications';
import { buildSoapComposition } from '../../utils/soap-composition';
import { TaskDetailsModal } from '../tasks/TaskDetailsModal';
import { AdtmcA01DecisionSupport } from './AdtmcA01DecisionSupport';
import { TaskPanel } from '../tasks/encounter/TaskPanel';
import { BillingTab } from './BillingTab';
import { DecisionFlowsPanel } from './DecisionFlowsPanel/DecisionFlowsPanel';
import { EncounterHeader } from './EncounterHeader';
import { SoapObjectiveCard } from './SoapObjectiveCard';
import { SoapPhysicalExamCard } from './SoapPhysicalExamCard';
import { SoapRosCard } from './SoapRosCard';
import { hasExactlyOneChiefComplaint, hasNonEmptyComplaint, SoapSubjectiveCard } from './SoapSubjectiveCard';
import { SignAddendum } from './SignAddendum';
import { SoapSectionCard } from './SoapSectionCard/SoapSectionCard';

const FHIR_ACT_REASON_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-ActReason';
const FHIR_PROVENANCE_PARTICIPANT_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/provenance-participant-type';
const FHIR_DOCUMENT_COMPLETION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-DocumentCompletion';

const TASK_COMPLETED_STATUSES = new Set<Task['status']>([
  'completed',
  'cancelled',
  'failed',
  'rejected',
  'entered-in-error',
]);

export interface EncounterChartProps {
  encounter: WithId<Encounter> | Reference<Encounter>;
  task?: WithId<Task> | Reference<Task>;
  onEncounterChange?: (encounter: WithId<Encounter>) => void;
}

export const EncounterChart = (props: EncounterChartProps): JSX.Element => {
  const { encounter: encounterProp, task: taskProp, onEncounterChange } = props;
  const medplum = useMedplum();

  const [activeTab, setActiveTab] = useState('notes');
  const {
    encounter,
    patient: patientResource,
    practitioner,
    tasks,
    clinicalImpression,
    appointment,
    setEncounter,
    setPractitioner,
    setTasks,
    setClinicalImpression,
  } = useEncounterChart(encounterProp);

  const [provenances, setProvenances] = useState<Provenance[]>([]);
  const [chartNoteStatus, setChartNoteStatus] = useState(ChartNoteStatus.Unsigned);
  const soapQuestionnaires = useSoapQuestionnaires(encounter, patientResource);
  const decisionFlows = useDecisionFlows(encounter, patientResource);
  const adtmcA01Result = useAdtmcA01Result(encounter);
  const subjectiveDraftRef = useRef<QuestionnaireResponse | undefined>(undefined);

  useEffect(() => {
    subjectiveDraftRef.current = soapQuestionnaires.questionnaires.get(SOAP_SUBJECTIVE_URL)?.response;
  }, [soapQuestionnaires.questionnaires]);

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
        onEncounterChange?.(updatedEncounter);
      } catch (err) {
        showErrorNotification(err);
      }
    },
    [encounter, medplum, setEncounter, onEncounterChange, appointment]
  );

  const handleTabChange = (tab: string): void => {
    setActiveTab(tab);
  };

  const handleSign = async (practitioner: Reference<Practitioner>, lock: boolean): Promise<void> => {
    if (!encounter || !patientResource) {
      return;
    }
    if (!hasNonEmptyComplaint(subjectiveDraftRef.current)) {
      showErrorNotification(new Error('Add at least one complaint before signing this SOAP note.'));
      return;
    }
    if (!hasExactlyOneChiefComplaint(subjectiveDraftRef.current)) {
      showErrorNotification(new Error('Select one chief complaint before signing this SOAP note.'));
      return;
    }

    if (lock) {
      // Complete all incomplete tasks
      const tasksToUpdate = tasks.filter((task) => !TASK_COMPLETED_STATUSES.has(task.status));
      const updatedTasks = await Promise.all(
        tasksToUpdate.map((task) =>
          medplum.patchResource('Task', task.id, [{ op: 'replace', path: '/status', value: 'completed' }])
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
        const updatedImpression = await medplum.patchResource('ClinicalImpression', clinicalImpression.id, [
          { op: 'replace', path: '/status', value: 'completed' },
        ]);
        setClinicalImpression(updatedImpression);
      }
    }

    // Create provenance record with signature
    const newProvenance = await medplum.createResource<Provenance>({
      resourceType: 'Provenance',
      target: [createReference(encounter)],
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
          who: practitioner,
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
          who: practitioner,
        },
      ],
    });

    setProvenances([...provenances, newProvenance]);

    try {
      const { observations, conditions, carePlans, questionnaireResponses } = await soapQuestionnaires.persistAll();
      const composition = buildSoapComposition({
        patient: patientResource,
        encounter,
        practitioner,
        clinicalImpression,
        adtmcA01ClinicalImpression: adtmcA01Result.clinicalImpression,
        adtmcA01QuestionnaireResponse: adtmcA01Result.questionnaireResponse,
        observations,
        conditions,
        carePlans,
        questionnaireResponses,
      });
      await medplum.createResource(composition);
    } catch (err) {
      showErrorNotification(err);
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

              <SoapSubjectiveCard
                questionnaireResponse={soapQuestionnaires.questionnaires.get(SOAP_SUBJECTIVE_URL)?.response}
                loading={soapQuestionnaires.questionnaires.get(SOAP_SUBJECTIVE_URL)?.loading}
                error={soapQuestionnaires.questionnaires.get(SOAP_SUBJECTIVE_URL)?.error}
                disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                onChange={(response) => soapQuestionnaires.saveResponse(SOAP_SUBJECTIVE_URL, response)}
                onDraftChange={(response) => {
                  subjectiveDraftRef.current = response;
                }}
              />
              <DecisionFlowsPanel
                decisionFlows={decisionFlows}
                disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                onA01Completed={adtmcA01Result.refresh}
              />
              <SoapRosCard
                templates={[
                  { url: ROS_BRIEF_NORMAL_URL, label: 'ROS Brief - Normal', ...soapQuestionnaires.questionnaires.get(ROS_BRIEF_NORMAL_URL) },
                  { url: ROS_EXTENDED_NORMAL_URL, label: 'ROS Extended - Normal', ...soapQuestionnaires.questionnaires.get(ROS_EXTENDED_NORMAL_URL) },
                  { url: ROS_UNABLE_TO_OBTAIN_URL, label: 'ROS Unable to Obtain', ...soapQuestionnaires.questionnaires.get(ROS_UNABLE_TO_OBTAIN_URL) },
                ]}
                disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                onChange={soapQuestionnaires.saveResponse}
                onRemove={soapQuestionnaires.removeResponse}
              />
              <SoapObjectiveCard
                patient={patientResource}
                encounter={encounter}
                practitioner={practitioner}
                questionnaireResponse={soapQuestionnaires.questionnaires.get(SOAP_OBJECTIVE_URL)?.response}
                loading={soapQuestionnaires.questionnaires.get(SOAP_OBJECTIVE_URL)?.loading}
                error={soapQuestionnaires.questionnaires.get(SOAP_OBJECTIVE_URL)?.error}
                disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                onChange={(response) => soapQuestionnaires.saveResponse(SOAP_OBJECTIVE_URL, response)}
              />
              <SoapPhysicalExamCard
                templates={[
                  { url: PHYSICAL_EXAM_ADULT_BRIEF_URL, label: 'Physical Exam - Adult Brief', ...soapQuestionnaires.questionnaires.get(PHYSICAL_EXAM_ADULT_BRIEF_URL) },
                  { url: PHYSICAL_EXAM_ADULT_EXTENDED_URL, label: 'Physical Exam - Adult Extended', ...soapQuestionnaires.questionnaires.get(PHYSICAL_EXAM_ADULT_EXTENDED_URL) },
                  { url: PHYSICAL_EXAM_PEDIATRIC_BRIEF_URL, label: 'Physical Exam - Pediatric Brief', ...soapQuestionnaires.questionnaires.get(PHYSICAL_EXAM_PEDIATRIC_BRIEF_URL) },
                  { url: PHYSICAL_EXAM_PEDIATRIC_EXTENDED_URL, label: 'Physical Exam - Pediatric Extended', ...soapQuestionnaires.questionnaires.get(PHYSICAL_EXAM_PEDIATRIC_EXTENDED_URL) },
                ]}
                disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                onChange={soapQuestionnaires.saveResponse}
                onRemove={soapQuestionnaires.removeResponse}
              />
              {(['Assessment', 'Plan'] as const).map((title) => {
                const questionnaireUrl = title === 'Assessment' ? SOAP_ASSESSMENT_URL : SOAP_PLAN_URL;
                const state = soapQuestionnaires.questionnaires.get(questionnaireUrl);
                return (
                  <Fragment key={questionnaireUrl}>
                    <SoapSectionCard
                      title={title}
                      questionnaire={state?.questionnaire}
                      questionnaireResponse={state?.response}
                      loading={state?.loading}
                      error={state?.error}
                      disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                      onChange={(response) => soapQuestionnaires.saveResponse(questionnaireUrl, response)}
                    />
                    {adtmcA01Result.clinicalImpression && adtmcA01Result.questionnaireResponse && (
                      <AdtmcA01DecisionSupport
                        section={title.toLowerCase() as 'assessment' | 'plan'}
                        clinicalImpression={adtmcA01Result.clinicalImpression}
                        questionnaireResponse={adtmcA01Result.questionnaireResponse}
                        soapResponse={state?.response}
                        disabled={chartNoteStatus === ChartNoteStatus.SignedAndLocked}
                        onDraft={(response) => soapQuestionnaires.saveResponse(questionnaireUrl, response)}
                      />
                    )}
                  </Fragment>
                );
              })}
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
              onEncounterSaved={onEncounterChange}
              patient={patientResource}
              practitioner={practitioner}
              setPractitioner={setPractitioner}
              chartNoteStatus={chartNoteStatus}
            />
          )}
        </Box>
      </Stack>
      {taskProp && (
        <TaskDetailsModal key={getReferenceString(taskProp)} task={taskProp} onUpdateTask={updateTaskList} />
      )}
    </>
  );
};
