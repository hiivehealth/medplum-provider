// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { Consent, Practitioner, Reference } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useState } from 'react';
import { usePatientConsent } from '../../hooks/usePatientConsent';
import { createBreakGlassAudit } from '../../utils/audit';
import classes from './ConsentBanner.module.css';

type ConsentStatus = 'opt-in' | 'opt-out' | 'not-declared' | 'loading' | 'error';

export interface ConsentBannerProps {
  patientId: string;
  onBreakGlassRecorded?: () => void;
}

const STATUS_CONFIG: Record<Exclude<ConsentStatus, 'loading' | 'error'>, { color: string; title: string; message: string }> = {
  'opt-in': {
    color: 'green',
    title: 'Consent on file',
    message: 'This patient has opted in to data sharing.',
  },
  'opt-out': {
    color: 'red',
    title: 'Opted out',
    message: 'Access permitted by Medicaid override policy.',
  },
  'not-declared': {
    color: 'yellow',
    title: 'Consent not declared',
    message: 'This patient has not made a consent choice. Click Break the glass to document access.',
  },
};

const PRODUCTION_BREAK_GLASS_ENABLED = import.meta.env.VITE_ENABLE_PRODUCTION_BREAK_GLASS === 'true';

function useBreakGlass(
  patientId: string,
  consentStatus: ConsentStatus,
  onAuditCreated?: () => void,
  onBreakGlassRecorded?: () => void
): {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  reason: string;
  setReason: (reason: string) => void;
  submitting: boolean;
  submit: () => Promise<void>;
} {
  const medplum = useMedplum();
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    if (!reason.trim()) {
      showNotification({ title: 'Reason required', message: 'Enter a reason to break the glass.', color: 'red' });
      return;
    }

    if (consentStatus !== 'not-declared') {
      showNotification({
        title: 'Break the glass unavailable',
        message: 'Break the glass is only available when consent is not declared.',
        color: 'red',
      });
      return;
    }

    setSubmitting(true);
    try {
      const profile = medplum.getProfile();
      const profileRef = profile ? createReference(profile) : undefined;
      if (!profileRef?.reference?.startsWith('Practitioner/')) {
        throw new Error('An authenticated practitioner profile is required to break the glass.');
      }
      const audit = createBreakGlassAudit(patientId, reason.trim(), profileRef, {
        consentStatus: 'not-declared',
        correlationId: globalThis.crypto.randomUUID(),
      });
      await medplum.createResource(audit);
      showNotification({
        title: PRODUCTION_BREAK_GLASS_ENABLED ? 'Break the glass requested' : 'Break the glass recorded',
        message: PRODUCTION_BREAK_GLASS_ENABLED
          ? 'Your request was recorded and is being processed by the secure access workflow.'
          : 'Your access has been audited.',
        color: 'green',
      });
      setModalOpen(false);
      setReason('');
      onAuditCreated?.();
      onBreakGlassRecorded?.();
    } catch (err) {
      showNotification({
        title: 'Failed to record break the glass',
        message: normalizeErrorString(err),
        color: 'red',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return { modalOpen, setModalOpen, reason, setReason, submitting, submit };
}

function canUpdateConsent(status: ConsentStatus): boolean {
  return status !== 'loading' && status !== 'error';
}

export function ConsentBanner({ patientId, onBreakGlassRecorded }: ConsentBannerProps): JSX.Element {
  const { status, consent, error, refresh } = usePatientConsent(patientId);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateReason, setUpdateReason] = useState('');
  const [updating, setUpdating] = useState(false);
  const medplum = useMedplum();
  const breakGlass = useBreakGlass(patientId, status, refresh, onBreakGlassRecorded);

  if (status === 'loading') {
    return (
      <Alert color="gray" className={classes.banner} radius={0}>
        Loading consent status...
      </Alert>
    );
  }

  if (status === 'error') {
    return (
      <Alert color="red" className={classes.banner} radius={0}>
        Unable to load consent status: {normalizeErrorString(error)}
      </Alert>
    );
  }

  const config = STATUS_CONFIG[status];

  const handleUpdateConsent = async (newStatus: 'opt-in' | 'opt-out'): Promise<void> => {
    if (!updateReason.trim()) {
      showNotification({ title: 'Reason required', message: 'Enter a reason for the consent update.', color: 'red' });
      return;
    }
    setUpdating(true);
    try {
      const updated = buildUpdatedConsent(consent, patientId, newStatus, updateReason.trim());
      await medplum.createResource(updated);
      showNotification({ title: 'Consent updated', message: 'The consent status has been changed.', color: 'green' });
      setUpdateModalOpen(false);
      setUpdateReason('');
      refresh();
    } catch (err) {
      showNotification({ title: 'Consent update failed', message: normalizeErrorString(err), color: 'red' });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <>
      <Alert color={config.color} className={classes.banner} radius={0}>
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text fw={700}>{config.title}</Text>
            <Text size="sm">{config.message}</Text>
          </div>
          <Group gap="xs">
            {status === 'not-declared' && (
              <Button size="xs" onClick={() => breakGlass.setModalOpen(true)}>
                Break the glass
              </Button>
            )}
            {canUpdateConsent(status) && (
              <Button size="xs" variant="outline" onClick={() => setUpdateModalOpen(true)}>
                Update consent
              </Button>
            )}
          </Group>
        </Group>
      </Alert>

      <Modal
        opened={breakGlass.modalOpen}
        onClose={() => breakGlass.setModalOpen(false)}
        title="Break the glass"
        centered
      >
        <Stack>
          <Text size="sm">
            This patient has not declared a consent preference. Enter a clinical reason to document your access
            to the record.
          </Text>
          <Textarea
            label="Reason for access"
            placeholder="e.g. Emergency treatment required"
            value={breakGlass.reason}
            onChange={(e) => breakGlass.setReason(e.currentTarget.value)}
            minRows={3}
            required
            data-testid="break-glass-reason"
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => breakGlass.setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => breakGlass.submit()} loading={breakGlass.submitting}>
              Record access
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={updateModalOpen} onClose={() => setUpdateModalOpen(false)} title="Update consent" centered>
        <Stack>
          <Text size="sm">Create a new consent record for this patient.</Text>
          <Textarea
            label="Reason for update"
            placeholder="e.g. Patient signed consent form"
            value={updateReason}
            onChange={(e) => setUpdateReason(e.currentTarget.value)}
            minRows={3}
            required
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setUpdateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleUpdateConsent('opt-out')} loading={updating}>
              Opt out
            </Button>
            <Button onClick={() => handleUpdateConsent('opt-in')} loading={updating}>
              Opt in
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function buildUpdatedConsent(
  existing: Consent | undefined,
  patientId: string,
  newStatus: 'opt-in' | 'opt-out',
  reason: string
): Consent {
  return {
    resourceType: 'Consent',
    status: 'active',
    scope: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/consentscope',
          code: 'patient-privacy',
          display: 'Privacy Consent',
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: 'http://loinc.org',
            code: '59284-0',
            display: 'Consent status',
          },
        ],
        text: newStatus,
      },
    ],
    patient: { reference: `Patient/${patientId}` },
    dateTime: new Date().toISOString(),
    policy: [
      {
        authority: 'https://hiivehealth.com/nevada-consent',
        uri: `https://hiivehealth.com/nevada-consent/${newStatus}`,
      },
    ],
    provision: {
      type: newStatus === 'opt-in' ? 'permit' : 'deny',
    },
    text: {
      status: 'generated',
      div: `<div xmlns="http://www.w3.org/1999/xhtml">Consent updated to ${newStatus}. Reason: ${reason}</div>`,
    },
  };
}
