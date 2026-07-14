// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Basic, Coding } from '@medplum/fhirtypes';

export const HIIVE_TENANT_CONFIG_PROFILE = 'https://hiivehealth.com/fhir/StructureDefinition/tenant-config';

export interface SoapTenantConfig {
  dispositionEnabled: boolean;
  dispositionOptions: Coding[];
}

export const DEFAULT_DISPOSITION_OPTIONS: Coding[] = [
  { system: 'http://terminology.hl7.org/CodeSystem/discharge-disposition', code: 'home', display: 'Discharge to home' },
  { system: 'https://hiivehealth.com/fhir/soap/disposition', code: 'full-duty', display: 'Return to full duty' },
  { system: 'https://hiivehealth.com/fhir/soap/disposition', code: 'limited-duty', display: 'Limited duty profile' },
  { system: 'https://hiivehealth.com/fhir/soap/disposition', code: 'not-cleared', display: 'Not cleared for duty' },
  { system: 'https://hiivehealth.com/fhir/soap/disposition', code: 'referred', display: 'Referred / transfer' },
];

export const DEFAULT_TENANT_CONFIG: SoapTenantConfig = {
  dispositionEnabled: true,
  dispositionOptions: DEFAULT_DISPOSITION_OPTIONS,
};

export function parseTenantConfig(basic: Basic | undefined): SoapTenantConfig {
  if (!basic) {
    return DEFAULT_TENANT_CONFIG;
  }

  const dispositionExtension = basic.extension?.find(
    (ext) => ext.url === `${HIIVE_TENANT_CONFIG_PROFILE}#disposition`
  );

  return {
    dispositionEnabled: dispositionExtension?.valueBoolean ?? DEFAULT_TENANT_CONFIG.dispositionEnabled,
    dispositionOptions: DEFAULT_TENANT_CONFIG.dispositionOptions,
  };
}

export function buildTenantConfig(organizationId: string, config: SoapTenantConfig): Basic {
  return {
    resourceType: 'Basic',
    meta: {
      profile: [HIIVE_TENANT_CONFIG_PROFILE],
    },
    code: {
      coding: [
        {
          system: 'https://hiivehealth.com/fhir/CodeSystem/tenant-config-type',
          code: 'soap-settings',
          display: 'SOAP Note Tenant Settings',
        },
      ],
    },
    subject: { reference: `Organization/${organizationId}` },
    extension: [
      {
        url: `${HIIVE_TENANT_CONFIG_PROFILE}#disposition`,
        valueBoolean: config.dispositionEnabled,
      },
    ],
  };
}
