// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Badge, Button, Group, Loader, Text } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { createReference, isResource, normalizeErrorString } from '@medplum/core';
import type { Practitioner, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { usePatient } from '../../hooks/usePatient';
import classes from './OccupationalPages.module.css';
import {
  EXPOSURE_INCIDENT_QUESTIONNAIRE_NAME,
  loadExposureIncidentQuestionnaire,
  submitExposureIncidentIntake,
} from './exposure-incident-intake';

export function ExposureIncidentIntakePage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const patient = usePatient();
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    loadExposureIncidentQuestionnaire(medplum)
      .then((loadedQuestionnaire) => {
        if (active) {
          setQuestionnaire(loadedQuestionnaire);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(normalizeErrorString(err));
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [medplum]);

  const handleSubmit = useCallback(
    async (response: QuestionnaireResponse): Promise<void> => {
      if (!patient || !questionnaire) {
        return;
      }

      const profile = medplum.getProfile();
      const practitioner = isResource<Practitioner>(profile, 'Practitioner') ? profile : undefined;
      setSubmitting(true);

      try {
        await submitExposureIncidentIntake(medplum, patient, questionnaire, response, practitioner);
        showNotification({
          icon: <IconCircleCheck />,
          title: 'Exposure incident documented',
          message: 'The occupational case, RTW status, and follow-up task were created.',
        });
        navigate(`/Patient/${patient.id}/occupational`)?.catch(console.error);
      } catch (err) {
        showNotification({
          color: 'red',
          icon: <IconCircleOff />,
          title: 'Unable to document incident',
          message: normalizeErrorString(err),
        });
      } finally {
        setSubmitting(false);
      }
    },
    [medplum, navigate, patient, questionnaire]
  );

  if (!patient || loading) {
    return <Loader />;
  }

  if (error || !questionnaire) {
    return (
      <div className={classes.page}>
        <Alert color="red" title="Incident intake unavailable">
          {error || 'Questionnaire not available'}
        </Alert>
      </div>
    );
  }

  const profile = medplum.getProfile();
  const practitioner = isResource<Practitioner>(profile, 'Practitioner') ? profile : undefined;

  return (
    <div className={`${classes.page} ${classes.intakePage}`}>
      <div className={classes.header}>
        <div>
          <div className={classes.title}>Report Exposure Incident</div>
          <div className={classes.subtitle}>{patient.name?.[0]?.text || patient.name?.[0]?.family || patient.id}</div>
        </div>
        <Group gap="xs">
          <Badge variant="light" color="blue">
            {questionnaire.name || EXPOSURE_INCIDENT_QUESTIONNAIRE_NAME}
          </Badge>
          <Button component={Link} to={`/Patient/${patient.id}/occupational`} variant="light">
            Occupational Summary
          </Button>
        </Group>
      </div>

      <section className={`${classes.panel} ${classes.intakePanel}`}>
        <div className={classes.panelHeader}>
          <div>
            <div className={classes.panelTitle}>Incident Intake</div>
            <Text c="dimmed" size="sm">
              Submit creates the intake response, case, encounter, RTW observation, and follow-up task.
            </Text>
          </div>
        </div>
        <div className={`${classes.panelBody} ${classes.intakePanelBody}`}>
          <div className={classes.intakeQuestionnaire}>
            <QuestionnaireForm
              questionnaire={questionnaire}
              subject={createReference(patient)}
              source={practitioner ? createReference(practitioner) : undefined}
              disablePagination={true}
              submitButtonText={submitting ? 'Documenting...' : 'Document exposure incident'}
              onSubmit={handleSubmit}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
