// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import react from '@vitejs/plugin-react';
import dns from 'dns';
import { copyFileSync, existsSync } from 'fs';
import path from 'path';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vitest/config';

dns.setDefaultResultOrder('verbatim');

if (!existsSync(path.join(import.meta.dirname, '.env'))) {
  copyFileSync(path.join(import.meta.dirname, '.env.defaults'), path.join(import.meta.dirname, '.env'));
}

function localPackage(packageName: string): string {
  const candidates = [
    path.resolve(import.meta.dirname, `../medplum/packages/${packageName}/src`),
    path.resolve(import.meta.dirname, `../../packages/${packageName}/src`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? '';
}

// Resolve aliases to local packages when this app is developed beside or inside the Medplum checkout.
const alias: NonNullable<UserConfig['resolve']>['alias'] = Object.fromEntries(
  Object.entries({
    '@medplum/core': localPackage('core'),
    '@medplum/definitions': localPackage('definitions'),
    '@medplum/dosespot-core': localPackage('dosespot-core'),
    '@medplum/dosespot-react': localPackage('dosespot-react'),
    '@medplum/scriptsure-core': localPackage('scriptsure-core'),
    '@medplum/scriptsure-react': localPackage('scriptsure-react'),
    '@medplum/react': localPackage('react'),
    '@medplum/react-scheduling': localPackage('react-scheduling'),
    '@medplum/react-hooks': localPackage('react-hooks'),
    '@medplum/health-gorilla-core': localPackage('health-gorilla-core'),
    '@medplum/health-gorilla-react': localPackage('health-gorilla-react'),
    '@medplum/mock': localPackage('mock'),
  }).filter(([, packagePath]) => packagePath)
);

// https://vitejs.dev/config/
export default defineConfig({
  envPrefix: ['MEDPLUM_', 'GOOGLE_', 'RECAPTCHA_'],
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 3001,
  },
  preview: {
    host: 'localhost',
    port: 3001,
  },
  resolve: {
    alias,
    dedupe: [
      'react',
      'react-dom',
      '@mantine/core',
      '@mantine/hooks',
      '@mantine/notifications',
      '@mantine/spotlight',
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test.setup.ts',
    server: {
      deps: {
        // react-router v8 is ESM-only, so Vitest externalizes it and its export
        // namespace is frozen. Inlining routes it through Vite's transform,
        // which restores `vi.spyOn(reactRouter, ...)` in tests.
        inline: ['react-router'],
      },
    },
  },
});
