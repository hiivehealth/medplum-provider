// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Card, Group, LoadingOverlay, Select, SimpleGrid, Stack, Textarea, TextInput, Title } from '@mantine/core';
import { createReference } from '@medplum/core';
import type { Encounter, Patient, Practitioner, QuestionnaireResponse, QuestionnaireResponseItem } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LOINC_CODES, UCUM_UNITS } from '../../utils/loinc-codes';
import { showErrorNotification } from '../../utils/notifications';
import { createVitalObservation } from '../../utils/vitals';
import { EncounterVitalsHistory } from './EncounterVitalsHistory';

interface ObjectiveValues {
  systolicBp: string;
  diastolicBp: string;
  heartRate: string;
  temperature: string;
  temperatureUnit: string;
  respiratoryRate: string;
  height: string;
  heightUnit: string;
  weight: string;
  weightUnit: string;
  oxygenSaturation: string;
  bloodGlucose: string;
  physicalExam: string;
}

export interface SoapObjectiveCardProps {
  patient: Patient;
  encounter: Encounter;
  practitioner?: Practitioner;
  questionnaireResponse: QuestionnaireResponse | undefined;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onChange: (response: QuestionnaireResponse) => void;
}

const SAVE_DEBOUNCE_MS = 750;
const UCUM_SYSTEM = 'http://unitsofmeasure.org';

const DEFAULT_VALUES: ObjectiveValues = {
  systolicBp: '',
  diastolicBp: '',
  heartRate: '',
  temperature: '',
  temperatureUnit: '[degF]',
  respiratoryRate: '',
  height: '',
  heightUnit: '[in_i]',
  weight: '',
  weightUnit: '[lb_av]',
  oxygenSaturation: '',
  bloodGlucose: '',
  physicalExam: '',
};

function findItem(items: QuestionnaireResponseItem[] | undefined, linkId: string): QuestionnaireResponseItem | undefined {
  for (const item of items ?? []) {
    if (item.linkId === linkId) {
      return item;
    }
    const nested = findItem(item.item, linkId);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function decimalValue(response: QuestionnaireResponse | undefined, linkId: string): string {
  const value = findItem(response?.item, linkId)?.answer?.[0]?.valueDecimal;
  return value === undefined ? '' : String(value);
}

function stringValue(response: QuestionnaireResponse | undefined, linkId: string): string {
  return findItem(response?.item, linkId)?.answer?.[0]?.valueString ?? '';
}

function codingValue(response: QuestionnaireResponse | undefined, linkId: string, fallback: string): string {
  return findItem(response?.item, linkId)?.answer?.[0]?.valueCoding?.code ?? fallback;
}

function getValues(response: QuestionnaireResponse | undefined): ObjectiveValues {
  const temperatureUnit = codingValue(response, 'temperature-unit', DEFAULT_VALUES.temperatureUnit);
  const weightUnit = codingValue(response, 'weight-unit', DEFAULT_VALUES.weightUnit);
  const heightUnit = codingValue(response, 'height-unit', DEFAULT_VALUES.heightUnit);

  return {
    systolicBp: decimalValue(response, 'systolic-bp'),
    diastolicBp: decimalValue(response, 'diastolic-bp'),
    heartRate: decimalValue(response, 'heart-rate'),
    temperature: decimalValue(response, temperatureUnit === 'Cel' ? 'temperature-c' : 'temperature-f'),
    temperatureUnit,
    respiratoryRate: decimalValue(response, 'respiratory-rate'),
    height: decimalValue(response, heightUnit === 'cm' ? 'height-cm' : 'height-in'),
    heightUnit,
    weight: decimalValue(response, weightUnit === 'kg' ? 'weight-kg' : 'weight-lb'),
    weightUnit,
    oxygenSaturation: decimalValue(response, 'spO2'),
    bloodGlucose: decimalValue(response, 'blood-glucose'),
    physicalExam: stringValue(response, 'physical-exam'),
  };
}

function decimalItem(linkId: string, value: string): QuestionnaireResponseItem {
  return { linkId, answer: value === '' ? [] : [{ valueDecimal: Number(value) }] };
}

function codingItem(linkId: string, code: string): QuestionnaireResponseItem {
  return { linkId, answer: [{ valueCoding: { system: UCUM_SYSTEM, code } }] };
}

function buildResponse(values: ObjectiveValues, previous: QuestionnaireResponse | undefined): QuestionnaireResponse {
  return {
    ...previous,
    resourceType: 'QuestionnaireResponse',
    status: previous?.status ?? 'in-progress',
    item: [
      {
        linkId: 'vitals',
        item: [
          codingItem('temperature-unit', values.temperatureUnit),
          decimalItem(values.temperatureUnit === 'Cel' ? 'temperature-c' : 'temperature-f', values.temperature),
          decimalItem('heart-rate', values.heartRate),
          codingItem('weight-unit', values.weightUnit),
          decimalItem(values.weightUnit === 'kg' ? 'weight-kg' : 'weight-lb', values.weight),
          codingItem('height-unit', values.heightUnit),
          decimalItem(values.heightUnit === 'cm' ? 'height-cm' : 'height-in', values.height),
          decimalItem('spO2', values.oxygenSaturation),
          decimalItem('respiratory-rate', values.respiratoryRate),
          decimalItem('systolic-bp', values.systolicBp),
          decimalItem('diastolic-bp', values.diastolicBp),
          decimalItem('blood-glucose', values.bloodGlucose),
        ],
      },
      { linkId: 'physical-exam', answer: values.physicalExam === '' ? [] : [{ valueString: values.physicalExam }] },
    ],
  };
}

export function SoapObjectiveCard(props: SoapObjectiveCardProps): JSX.Element {
  const { patient, encounter, practitioner, questionnaireResponse, loading, error, disabled, onChange } = props;
  const medplum = useMedplum();
  const [values, setValues] = useState<ObjectiveValues>(() => getValues(questionnaireResponse));
  const [recordingVitals, setRecordingVitals] = useState(false);
  const [vitalsRefreshKey, setVitalsRefreshKey] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setValues(getValues(questionnaireResponse));
  }, [questionnaireResponse]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const updateValues = useCallback(
    (updates: Partial<ObjectiveValues>): void => {
      if (disabled) {
        return;
      }
      const nextValues = { ...values, ...updates };
      setValues(nextValues);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => onChange(buildResponse(nextValues, questionnaireResponse)), SAVE_DEBOUNCE_MS);
    },
    [disabled, onChange, questionnaireResponse, values]
  );

  const unitLabel = (unit: string): string => {
    return unit === 'Cel' ? 'Cel' : unit === 'kg' ? 'kg' : unit === 'cm' ? 'cm' : unit === '[degF]' ? '[degF]' : unit === '[lb_av]' ? 'lb' : 'in';
  };

  const recordVitals = async (): Promise<void> => {
    if (disabled || recordingVitals) {
      return;
    }

    const readings = [
      { value: values.temperature, coding: LOINC_CODES.bodyTemperature, unit: values.temperatureUnit },
      { value: values.heartRate, coding: LOINC_CODES.heartRate, unit: UCUM_UNITS.bpm },
      { value: values.respiratoryRate, coding: LOINC_CODES.respiratoryRate, unit: UCUM_UNITS.breathsPerMin },
      { value: values.oxygenSaturation, coding: LOINC_CODES.oxygenSaturation, unit: UCUM_UNITS.percent },
      { value: values.systolicBp, coding: LOINC_CODES.systolicBloodPressure, unit: UCUM_UNITS.mmHg },
      { value: values.diastolicBp, coding: LOINC_CODES.diastolicBloodPressure, unit: UCUM_UNITS.mmHg },
      { value: values.weight, coding: LOINC_CODES.bodyWeight, unit: values.weightUnit },
      { value: values.height, coding: LOINC_CODES.bodyHeight, unit: values.heightUnit },
      { value: values.bloodGlucose, coding: LOINC_CODES.bloodGlucose, unit: UCUM_UNITS.milligramsPerDeciliter },
    ].filter((reading) => reading.value !== '');

    if (readings.length === 0) {
      showErrorNotification(new Error('Enter at least one vital before recording.'));
      return;
    }

    const invalidReading = readings.find((reading) => !Number.isFinite(Number(reading.value)));
    if (invalidReading) {
      showErrorNotification(new Error('Vitals must be valid numbers before recording.'));
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setRecordingVitals(true);
    try {
      await Promise.all(
        readings.map((reading) =>
          medplum.createResource(
            createVitalObservation({
              patient,
              encounter,
              coding: reading.coding,
              value: Number(reading.value),
              unit: reading.unit,
              performer: practitioner ? createReference(practitioner) : undefined,
            })
          )
        )
      );
      const nextValues = {
        ...values,
        systolicBp: '',
        diastolicBp: '',
        heartRate: '',
        temperature: '',
        respiratoryRate: '',
        height: '',
        weight: '',
        oxygenSaturation: '',
        bloodGlucose: '',
      };
      setValues(nextValues);
      onChange(buildResponse(nextValues, questionnaireResponse));
      setVitalsRefreshKey((key) => key + 1);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setRecordingVitals(false);
    }
  };

  return (
    <Card withBorder shadow="sm" mt="md" pos="relative">
      <LoadingOverlay visible={loading ?? false} overlayProps={{ radius: 'sm', blur: 2 }} />
      <Stack gap="sm">
        <Title order={3}>Objective</Title>
        {error && <Alert color="red" title="Unable to load section">{error}</Alert>}
        {!error && (
          <>
            <Title order={4}>Vitals</Title>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="sm">
              <TextInput label="BP Sys" description="Blood Pressure (mm[Hg])" value={values.systolicBp} onChange={(event) => updateValues({ systolicBp: event.currentTarget.value })} inputMode="decimal" disabled={disabled} />
              <TextInput label="BP Dias" description="Blood Pressure (mm[Hg])" value={values.diastolicBp} onChange={(event) => updateValues({ diastolicBp: event.currentTarget.value })} inputMode="decimal" disabled={disabled} />
              <TextInput label="HR" description="Heart Rate (/min)" value={values.heartRate} onChange={(event) => updateValues({ heartRate: event.currentTarget.value })} inputMode="decimal" disabled={disabled} />
              <TextInput label="Temp" description={`Body Temperature (${unitLabel(values.temperatureUnit)})`} value={values.temperature} onChange={(event) => updateValues({ temperature: event.currentTarget.value })} inputMode="decimal" disabled={disabled} />
              <TextInput label="RR" description="Respiratory Rate (/min)" value={values.respiratoryRate} onChange={(event) => updateValues({ respiratoryRate: event.currentTarget.value })} inputMode="decimal" disabled={disabled} />
              <TextInput label="Ht" description={`Height (${unitLabel(values.heightUnit)})`} value={values.height} onChange={(event) => updateValues({ height: event.currentTarget.value })} inputMode="decimal" disabled={disabled} />
              <TextInput label="Wt" description={`Weight (${unitLabel(values.weightUnit)})`} value={values.weight} onChange={(event) => updateValues({ weight: event.currentTarget.value })} inputMode="decimal" disabled={disabled} />
              <TextInput label="O2" description="Oxygen (%)" value={values.oxygenSaturation} onChange={(event) => updateValues({ oxygenSaturation: event.currentTarget.value })} inputMode="decimal" disabled={disabled} />
              <TextInput label="Glucose" description="Blood Glucose (mg/dL)" value={values.bloodGlucose} onChange={(event) => updateValues({ bloodGlucose: event.currentTarget.value })} inputMode="decimal" disabled={disabled} />
            </SimpleGrid>
            <Group grow align="end">
              <Select label="Temperature unit" data={[{ value: '[degF]', label: 'Fahrenheit (°F)' }, { value: 'Cel', label: 'Celsius (°C)' }]} value={values.temperatureUnit} onChange={(value) => updateValues({ temperatureUnit: value ?? '[degF]', temperature: '' })} disabled={disabled} />
              <Select label="Height unit" data={[{ value: '[in_i]', label: 'Inches (in)' }, { value: 'cm', label: 'Centimeters (cm)' }]} value={values.heightUnit} onChange={(value) => updateValues({ heightUnit: value ?? '[in_i]', height: '' })} disabled={disabled} />
              <Select label="Weight unit" data={[{ value: '[lb_av]', label: 'Pounds (lb)' }, { value: 'kg', label: 'Kilograms (kg)' }]} value={values.weightUnit} onChange={(value) => updateValues({ weightUnit: value ?? '[lb_av]', weight: '' })} disabled={disabled} />
            </Group>
            <Group justify="flex-end">
              <Button onClick={() => void recordVitals()} loading={recordingVitals} disabled={disabled}>Record vitals</Button>
            </Group>
            <EncounterVitalsHistory encounter={encounter} disabled={disabled} refreshKey={vitalsRefreshKey} />
            <Textarea label="Physical Examination" value={values.physicalExam} onChange={(event) => updateValues({ physicalExam: event.currentTarget.value })} autosize minRows={4} disabled={disabled} />
          </>
        )}
      </Stack>
    </Card>
  );
}
