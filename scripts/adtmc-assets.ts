// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

export function isAdtmcDocumentRequest(url: string): boolean {
  try {
    const pathname = path.posix.normalize(decodeURIComponent(new URL(url, 'http://localhost').pathname).replaceAll('\\', '/'));
    return /\/documents\/adtmc(?:\/|$)/i.test(pathname);
  } catch {
    return true;
  }
}

export async function removeAdtmcDocumentAssets(outDir: string): Promise<void> {
  await rm(path.join(outDir, 'documents', 'adtmc'), { recursive: true, force: true });
}

export function privateAdtmcDocuments(): Plugin {
  let outDir: string;
  const denyDocuments: Connect.NextHandleFunction = (request, response, next) => {
    if (isAdtmcDocumentRequest(request.url ?? '/')) {
      response.statusCode = 404;
      response.setHeader('Cache-Control', 'no-store');
      response.end();
    } else {
      next();
    }
  };

  return {
    name: 'private-adtmc-documents',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(denyDocuments);
    },
    configurePreviewServer(server) {
      server.middlewares.use(denyDocuments);
    },
    async closeBundle() {
      await removeAdtmcDocumentAssets(outDir);
    },
  };
}