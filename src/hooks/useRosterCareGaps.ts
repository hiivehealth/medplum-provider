// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { normalizeErrorString } from '@medplum/core';
import type { Condition, MedicationRequest, Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';

export interface CareGap {
  patient: Patient;
  type: 'missing-lab' | 'unrefilled-medication';
  title: string;
  description: string;
  dueDate?: string;
  lastEventDate?: string;
}

export interface UseRosterCareGapsResult {
  gaps: CareGap[];
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
}

export interface UseRosterCareGapsOptions {
  groupId: string | undefined;
}

const A1C_LOINC = '4548-4';
const DIABETES_SNOMED = '73211009';
const DIABETES_ICD10 = 'E11.9';

function isDiabetic(condition: Condition): boolean {
  return (
    condition.code?.coding?.some(
      (c) =>
        (c.system === 'http://snomed.info/sct' && c.code === DIABETES_SNOMED) ||
        (c.system === 'http://hl7.org/fhir/sid/icd-10-cm' && c.code === DIABETES_ICD10)
    ) ?? false
  );
}

function isActiveMedication(med: MedicationRequest): boolean {
  return med.status === 'active' || med.status === 'draft';
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

function daysSince(date: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((Date.now() - date.getTime()) / msPerDay);
}

export function useRosterCareGaps(options: UseRosterCareGapsOptions): UseRosterCareGapsResult {
  const medplum = useMedplum();
  const { groupId } = options;
  const [gaps, setGaps] = useState<CareGap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!groupId) {
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    async function load(): Promise<void> {
      try {
        const [patientBundle, conditionBundle, medicationBundle, observationBundle] = await Promise.all([
          medplum.search('Patient', { _compartment: `Group/${groupId}`, _count: '200' }),
          medplum.search('Condition', { _compartment: `Group/${groupId}`, 'clinical-status': 'active', _count: '200' }),
          medplum.search('MedicationRequest', {
            _compartment: `Group/${groupId}`,
            status: 'active',
            _count: '200',
          }),
          medplum.search('Observation', {
            _compartment: `Group/${groupId}`,
            code: A1C_LOINC,
            _sort: '-date',
            _count: '200',
          }),
        ]);

        if (cancelled) {
          return;
        }

        const patients = (patientBundle.entry?.map((e) => e.resource).filter(Boolean) ?? []) as Patient[];
        const conditions = (conditionBundle.entry?.map((e) => e.resource).filter(Boolean) ?? []) as Condition[];
        const medications = (medicationBundle.entry?.map((e) => e.resource).filter(Boolean) ?? []) as MedicationRequest[];
        const observations = (observationBundle.entry?.map((e) => e.resource).filter(Boolean) ?? []) as Observation[];

        const result: CareGap[] = [];

        for (const patient of patients) {
          const patientRef = `Patient/${patient.id}`;
          const patientConditions = conditions.filter(
            (c) => c.subject?.reference === patientRef && isDiabetic(c)
          );

          if (patientConditions.length > 0) {
            const latestA1C = observations
              .filter((o) => o.subject?.reference === patientRef)
              .sort((a, b) => ((b.effectiveDateTime ?? '') as string).localeCompare((a.effectiveDateTime ?? '') as string))[0];

            const latestDate = parseDate(latestA1C?.effectiveDateTime ?? latestA1C?.issued);
            const days = latestDate ? daysSince(latestDate) : Number.POSITIVE_INFINITY;

            if (days > 180) {
              result.push({
                patient,
                type: 'missing-lab',
                title: 'A1C overdue',
                description: `Diabetic patient has not had an A1C in ${days === Number.POSITIVE_INFINITY ? 'over 6 months' : `${days} days`}.`,
                dueDate: latestDate ? new Date(latestDate.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString() : undefined,
                lastEventDate: latestA1C?.effectiveDateTime ?? latestA1C?.issued,
              });
            }
          }

          const activeMeds = medications.filter(
            (m) => m.subject?.reference === patientRef && isActiveMedication(m)
          );

          for (const med of activeMeds) {
            const authored = parseDate(med.authoredOn);
            const dispense = med.dispenseRequest;
            const expectedSupply = dispense?.expectedSupplyDuration?.value ?? 30;
            const numberOfRepeats = dispense?.numberOfRepeatsAllowed ?? 0;

            if (authored && numberOfRepeats > 0) {
              const days = daysSince(authored);
              if (days > expectedSupply * 1.5) {
                result.push({
                  patient,
                  type: 'unrefilled-medication',
                  title: 'Medication refill overdue',
                  description: `${med.medicationCodeableConcept?.text ?? 'Active medication'} has not been refilled in ${days} days.`,
                  lastEventDate: med.authoredOn,
                });
              }
            }
          }
        }

        if (!cancelled) {
          setGaps(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(normalizeErrorString(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [medplum, groupId, refreshKey]);

  return {
    gaps,
    loading,
    error,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}
