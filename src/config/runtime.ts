// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

export interface HiiveRuntimeConfig {
  readonly medplumBaseUrl?: string;
  readonly medplumClientId?: string;
}

declare global {
  interface Window {
    __HIIVE_RUNTIME_CONFIG__?: HiiveRuntimeConfig;
  }
}

/** Host-specific deployment configuration loaded before the application bundle. */
export function getRuntimeConfig(): HiiveRuntimeConfig {
  return window.__HIIVE_RUNTIME_CONFIG__ ?? {};
}
