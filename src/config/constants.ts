// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
export const SAVE_TIMEOUT_MS = 1500;

const UBIX_DATA_PROJECT_ID = '7e472dfd-3ab9-4b75-adac-38e0c5c5d6c8';
const HIIVE_PROVIDER_CLIENT_ID = 'ec23c2e3-f4e6-4aaf-9938-77506a367d4c';

function optionalEnv(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function defaultMedplumBaseUrl(): string {
	if (import.meta.env.DEV && typeof window !== 'undefined') {
		return `${window.location.origin}/`;
	}
	return 'https://api.ehr.hiivehealth.net/';
}

export const MEDPLUM_BASE_URL = optionalEnv(import.meta.env.VITE_MEDPLUM_BASE_URL) ?? defaultMedplumBaseUrl();
export const MEDPLUM_PROJECT_ID = optionalEnv(import.meta.env.VITE_MEDPLUM_PROJECT_ID) ?? UBIX_DATA_PROJECT_ID;
export const MEDPLUM_CLIENT_ID = optionalEnv(import.meta.env.VITE_MEDPLUM_CLIENT_ID) ?? HIIVE_PROVIDER_CLIENT_ID;
export const MEDPLUM_GOOGLE_CLIENT_ID = optionalEnv(import.meta.env.VITE_MEDPLUM_GOOGLE_CLIENT_ID);
export const MEDPLUM_LOGIN_SCOPE = 'openid profile email fhirUser user/*.cruds offline_access';
