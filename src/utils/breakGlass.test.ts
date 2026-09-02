import type { Patient } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import {
  buildBreakGlassAccessExtension,
  getBreakGlassAccessExtensions,
  removeExpiredBreakGlassAccess,
} from './breakGlass';

describe('Break-Glass access lifecycle', () => {
  const provider = { reference: 'Practitioner/provider-1' };

  test('builds a provider-specific expiration extension', () => {
    const extension = buildBreakGlassAccessExtension(provider, '2026-08-27T12:00:00.000Z');
    expect(extension.extension).toEqual([
      { url: 'provider', valueReference: provider },
      { url: 'expiresAt', valueDateTime: '2026-08-27T12:00:00.000Z' },
    ]);
  });

  test('removes only expired temporary access and its provider relationship', () => {
    const patient: Patient = {
      resourceType: 'Patient',
      generalPractitioner: [
        provider,
        { reference: 'Practitioner/permanent-provider' },
      ],
      extension: [
        buildBreakGlassAccessExtension(provider, '2026-08-27T12:00:00.000Z'),
        buildBreakGlassAccessExtension(
          { reference: 'Practitioner/provider-2' },
          '2026-08-27T14:00:00.000Z'
        ),
      ],
    };

    const cleaned = removeExpiredBreakGlassAccess(patient, new Date('2026-08-27T13:00:00.000Z'));
    expect(cleaned.generalPractitioner).toEqual([{ reference: 'Practitioner/permanent-provider' }]);
    expect(getBreakGlassAccessExtensions(cleaned)).toHaveLength(1);
  });

  test('is idempotent when there are no expired grants', () => {
    const patient: Patient = { resourceType: 'Patient' };
    expect(removeExpiredBreakGlassAccess(patient)).toEqual(patient);
  });
});