import { validateResource } from '@medplum/core';
import type { StructureDefinition } from '@medplum/fhirtypes';
import profiles from '../../config/cui/profiles.json';

test('deployable CUI profiles satisfy FHIR StructureDefinition invariants', () => {
  for (const { resource } of profiles.entry) {
    expect(
      validateResource(resource as unknown as StructureDefinition).filter((issue) =>
        ['error', 'fatal'].includes(issue.severity)
      )
    ).toEqual([]);
  }
});
