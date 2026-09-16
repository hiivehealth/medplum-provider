import { validateResource } from '@medplum/core';
import type { StructureDefinition } from '@medplum/fhirtypes';
import cuiBannerEnabled from '../../../../fhir/StructureDefinition/cui-banner-enabled.json';
import cuiConfiguration from '../../../../fhir/StructureDefinition/cui-configuration.json';

test('deployable CUI profiles satisfy FHIR StructureDefinition invariants', () => {
  for (const resource of [cuiBannerEnabled, cuiConfiguration]) {
    expect(
      validateResource(resource as unknown as StructureDefinition).filter((issue) =>
        ['error', 'fatal'].includes(issue.severity)
      )
    ).toEqual([]);
  }
});
