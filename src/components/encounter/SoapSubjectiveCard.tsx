import { ActionIcon, Alert, Button, Card, Divider, Group, LoadingOverlay, Radio, Stack, TextInput, Textarea, Title, Tooltip } from '@mantine/core';
import type { QuestionnaireResponse, QuestionnaireResponseItem } from '@medplum/fhirtypes';
import { IconTrash } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ComplaintValue {
  text: string;
  onset: string;
  severity: string;
  isChiefComplaint: boolean;
}

interface SubjectiveValues {
  complaints: ComplaintValue[];
  hpi: string;
}

export interface SoapSubjectiveCardProps {
  questionnaireResponse: QuestionnaireResponse | undefined;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onChange: (response: QuestionnaireResponse) => void;
  onDraftChange?: (response: QuestionnaireResponse) => void;
}

const SAVE_DEBOUNCE_MS = 750;
const SYMPTOM_SEVERITY_SYSTEM = 'https://hiivehealth.com/fhir/soap/symptom-severity';

function answerString(item: QuestionnaireResponseItem | undefined): string {
  return item?.answer?.[0]?.valueString ?? item?.answer?.[0]?.valueText ?? '';
}

function answerDateTime(item: QuestionnaireResponseItem | undefined): string {
  const value = item?.answer?.[0]?.valueDateTime;
  if (!value) {
    return '';
  }
  const date = new Date(value);
  const pad = (number: number): string => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toFhirDateTime(value: string): string {
  return value ? new Date(value).toISOString() : '';
}

function findItem(items: QuestionnaireResponseItem[] | undefined, linkId: string): QuestionnaireResponseItem | undefined {
  return items?.find((item) => item.linkId === linkId);
}

export function getSubjectiveValues(response: QuestionnaireResponse | undefined): SubjectiveValues {
  const complaintGroups = response?.item?.filter((item) => item.linkId === 'complaint') ?? [];
  const complaints = complaintGroups.length > 0
    ? complaintGroups.map((group) => ({
        text: answerString(findItem(group.item, 'complaint-text')),
        onset: answerDateTime(findItem(group.item, 'complaint-onset')),
        severity: findItem(group.item, 'complaint-severity')?.answer?.[0]?.valueCoding?.code ?? '',
        isChiefComplaint: findItem(group.item, 'complaint-is-chief')?.answer?.[0]?.valueBoolean === true,
      }))
    : (findItem(response?.item, 'chief-complaint')?.answer ?? []).map((answer) => ({
        text: answer.valueString ?? answer.valueText ?? '',
        onset: '',
          severity: '',
        isChiefComplaint: false,
      }));

  return {
    complaints: complaints.length > 0 ? complaints : [{ text: '', onset: '', severity: '', isChiefComplaint: true }],
    hpi: answerString(findItem(response?.item, 'hpi')),
  };
}

export function hasNonEmptyComplaint(response: QuestionnaireResponse | undefined): boolean {
  return getSubjectiveValues(response).complaints.some((complaint) => complaint.text.trim().length > 0);
}

export function hasExactlyOneChiefComplaint(response: QuestionnaireResponse | undefined): boolean {
  const nonEmptyComplaints = getSubjectiveValues(response).complaints.filter((complaint) => complaint.text.trim().length > 0);
  return nonEmptyComplaints.length > 0 && nonEmptyComplaints.filter((complaint) => complaint.isChiefComplaint).length === 1;
}

export function buildSubjectiveResponse(
  values: SubjectiveValues,
  previous: QuestionnaireResponse | undefined
): QuestionnaireResponse {
  const chiefComplaintIndex = values.complaints.findIndex((complaint) => complaint.isChiefComplaint);
  return {
    ...previous,
    resourceType: 'QuestionnaireResponse',
    status: previous?.status ?? 'in-progress',
    item: [
      ...values.complaints.map((complaint, index) => ({
        linkId: 'complaint',
        item: [
          { linkId: 'complaint-text', answer: complaint.text ? [{ valueString: complaint.text }] : [] },
          { linkId: 'complaint-onset', answer: complaint.onset ? [{ valueDateTime: toFhirDateTime(complaint.onset) }] : [] },
          {
            linkId: 'complaint-severity',
            answer: complaint.severity
              ? [{ valueCoding: { system: SYMPTOM_SEVERITY_SYSTEM, code: complaint.severity, display: complaint.severity } }]
              : [],
          },
          { linkId: 'complaint-is-chief', answer: [{ valueBoolean: index === chiefComplaintIndex }] },
        ],
      })),
      { linkId: 'hpi', answer: values.hpi ? [{ valueText: values.hpi }] : [] },
    ],
  };
}

export function SoapSubjectiveCard(props: SoapSubjectiveCardProps): JSX.Element {
  const { questionnaireResponse, loading, error, disabled, onChange, onDraftChange } = props;
  const [values, setValues] = useState<SubjectiveValues>(() => getSubjectiveValues(questionnaireResponse));
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setValues(getSubjectiveValues(questionnaireResponse));
  }, [questionnaireResponse]);

  useEffect(() => () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);

  const updateValues = useCallback(
    (nextValues: SubjectiveValues): void => {
      if (disabled) {
        return;
      }
      setValues(nextValues);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      const response = buildSubjectiveResponse(nextValues, questionnaireResponse);
      onDraftChange?.(response);
      timeoutRef.current = setTimeout(() => onChange(response), SAVE_DEBOUNCE_MS);
    },
    [disabled, onChange, onDraftChange, questionnaireResponse]
  );

  const updateComplaint = (index: number, updates: Partial<ComplaintValue>): void => {
    updateValues({
      ...values,
      complaints: values.complaints.map((complaint, complaintIndex) => complaintIndex === index ? { ...complaint, ...updates } : complaint),
    });
  };

  const setChiefComplaint = (index: number): void => {
    updateValues({
      ...values,
      complaints: values.complaints.map((complaint, complaintIndex) => ({
        ...complaint,
        isChiefComplaint: complaintIndex === index,
      })),
    });
  };

  const deleteComplaint = (index: number): void => {
    const complaints = values.complaints.filter((_, complaintIndex) => complaintIndex !== index);
    updateValues({
      ...values,
      complaints: complaints.some((complaint) => complaint.isChiefComplaint)
        ? complaints
        : complaints.map((complaint, complaintIndex) => ({ ...complaint, isChiefComplaint: complaintIndex === 0 })),
    });
  };

  return (
    <Card withBorder shadow="sm" mt="md" pos="relative" aria-label="Subjective">
      <LoadingOverlay visible={loading ?? false} overlayProps={{ radius: 'sm', blur: 2 }} />
      <Stack gap="sm">
        <Title order={3}>Subjective</Title>
        {error && <Alert color="red" title="Unable to load section">{error}</Alert>}
        {!error && (
          <>
            {values.complaints.map((complaint, index) => (
              <Stack key={index} gap="xs">
                <Group align="end" wrap="nowrap">
                  <TextInput
                    label="Complaint"
                    value={complaint.text}
                    onChange={(event) => updateComplaint(index, { text: event.currentTarget.value })}
                    disabled={disabled}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    label="Symptom onset"
                    type="datetime-local"
                    value={complaint.onset}
                    onChange={(event) => updateComplaint(index, { onset: event.currentTarget.value })}
                    disabled={disabled}
                    style={{ flex: 1 }}
                  />
                  <Tooltip label="Delete complaint">
                    <ActionIcon
                      aria-label="Delete complaint"
                      variant="subtle"
                      color="red"
                      onClick={() => deleteComplaint(index)}
                      disabled={disabled}
                    >
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <Radio
                  label="Chief complaint"
                  checked={complaint.isChiefComplaint}
                  onChange={() => setChiefComplaint(index)}
                  disabled={disabled}
                />
                <Radio.Group label="Symptom severity" value={complaint.severity} onChange={(severity) => updateComplaint(index, { severity })} disabled={disabled}>
                  <Group mt="xs">
                    <Radio value="mild" label="Mild" />
                    <Radio value="moderate" label="Moderate" />
                    <Radio value="severe" label="Severe" />
                  </Group>
                </Radio.Group>
                {index < values.complaints.length - 1 && <Divider />}
              </Stack>
            ))}
            <Group>
              <Button variant="light" onClick={() => updateValues({ ...values, complaints: [...values.complaints, { text: '', onset: '', severity: '', isChiefComplaint: values.complaints.length === 0 }] })} disabled={disabled}>
                Add complaint
              </Button>
            </Group>
            <Textarea label="History of Present Illness" value={values.hpi} onChange={(event) => updateValues({ ...values, hpi: event.currentTarget.value })} autosize minRows={3} disabled={disabled} />
          </>
        )}
      </Stack>
    </Card>
  );
}