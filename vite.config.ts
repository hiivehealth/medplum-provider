// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import react from '@vitejs/plugin-react';
import dns from 'dns';
import { copyFileSync, existsSync } from 'fs';
import path from 'path';
import { defineConfig } from 'vitest/config';

dns.setDefaultResultOrder('verbatim');

if (!existsSync(path.join(import.meta.dirname, '.env'))) {
  copyFileSync(path.join(import.meta.dirname, '.env.defaults'), path.join(import.meta.dirname, '.env'));
}

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
