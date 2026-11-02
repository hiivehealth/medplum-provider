// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { isAdtmcDocumentRequest, removeAdtmcDocumentAssets } from './adtmc-assets';

test.each([
  '/documents/adtmc/a01/Policy%20Guide.pdf',
  '/documents/adtmc/a01/files/guide.pdf',
  '/documents/adtmc/a01/scope-of-practice.html?document=policy-guide',
  '/documents%2fadtmc/a01/guide.pdf',
  '/documents%5cadtmc/a01/guide.pdf',
  '/DOCUMENTS/ADTMC/a01/guide.pdf',
  '/@fs/workspace/public/documents/adtmc/a01/guide.pdf',
])('blocks a direct public ADTMC document path: %s', (url) => {
  expect(isAdtmcDocumentRequest(url)).toBe(true);
});

test('preserves unrelated assets and removes only ADTMC documents from a built site', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'adtmc-assets-'));
  try {
    await mkdir(path.join(outDir, 'documents', 'adtmc', 'a01'), { recursive: true });
    await writeFile(path.join(outDir, 'documents', 'adtmc', 'a01', 'guide.pdf'), 'synthetic');
    await writeFile(path.join(outDir, 'documents', 'general.pdf'), 'general');

    await removeAdtmcDocumentAssets(outDir);

    await expect(readFile(path.join(outDir, 'documents', 'adtmc', 'a01', 'guide.pdf'))).rejects.toThrow();
    expect(await readFile(path.join(outDir, 'documents', 'general.pdf'), 'utf8')).toBe('general');
    expect(isAdtmcDocumentRequest('/documents/general.pdf')).toBe(false);
    expect(isAdtmcDocumentRequest('/Patient/patient-1')).toBe(false);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});