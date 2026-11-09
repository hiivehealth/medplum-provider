// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { DocumentReference, Project } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { A01_DOCUMENT_IDENTIFIER_SYSTEM } from '../../utils/adtmc';
import { AdtmcDocumentPage } from './AdtmcDocumentPage';

const armyFeatures = ['army'] as unknown as Project['features'];

const document: DocumentReference = {
  resourceType: 'DocumentReference', id: 'guide', status: 'current', meta: { project: 'army-project' },
  content: [{ attachment: { contentType: 'application/pdf', url: 'https://example.test/guide.pdf?Signature=synthetic', title: 'Policy Guide' } }],
};

afterEach(() => { vi.unstubAllGlobals(); });

function setup(
  army = true,
  documents: DocumentReference[] | Error | Promise<DocumentReference[]> = [document],
  configure?: (medplum: MockClient) => void
): { medplum: MockClient; search: ReturnType<typeof vi.spyOn>; unmount: () => void } {
  const medplum = new MockClient();
  vi.spyOn(medplum, 'getProject').mockReturnValue({ resourceType: 'Project', id: 'army-project', features: army ? armyFeatures : [] });
  vi.spyOn(medplum, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'provider-1' });
  vi.spyOn(medplum, 'getProjectMembership').mockReturnValue({
    resourceType: 'ProjectMembership', id: 'membership-1', active: true, admin: false,
    project: { reference: 'Project/army-project' }, user: { reference: 'User/user-1' },
    profile: { reference: 'Practitioner/provider-1' },
  });
  const search = vi.spyOn(medplum, 'searchResources');
  if (documents instanceof Error) {
    search.mockRejectedValue(documents);
  } else {
    search.mockImplementation(() => Promise.resolve(documents) as never);
  }
  configure?.(medplum);
  const view = render(
    <MedplumProvider medplum={medplum}>
      <MantineProvider>
        <MemoryRouter initialEntries={['/adtmc/a01/documents/policy-guide']}>
          <Routes><Route path="/adtmc/a01/documents/:documentKey" element={<AdtmcDocumentPage />} /></Routes>
        </MemoryRouter>
      </MantineProvider>
    </MedplumProvider>
  );
  return { medplum, search, unmount: view.unmount };
}

test('opens a server-provided PDF for an ordinary Army member', async () => {
  const { search } = setup();
  await waitFor(() => expect(screen.getByTitle('Attachment')).toBeInTheDocument());
  expect(search).toHaveBeenCalledWith('DocumentReference', {
    identifier: `${A01_DOCUMENT_IDENTIFIER_SYSTEM}|policy-guide`, status: 'current', _count: '2',
  });
});

test('denies a direct document route outside Army without searching for documents', async () => {
  const { search } = setup(false);
  await waitFor(() => expect(screen.getByText('Access denied')).toBeInTheDocument());
  expect(search).not.toHaveBeenCalled();
  expect(screen.queryByTitle('Attachment')).not.toBeInTheDocument();
});

test.each(['allowed', 'denied', 'wrong-content-type'])('handles an authenticated Binary PDF: %s', async (scenario) => {
  const createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/guide');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  const blob = new Blob(['synthetic'], { type: scenario === 'wrong-content-type' ? 'application/json' : 'application/pdf' });
  const { medplum, unmount } = setup(true, [{
    ...document, content: [{ attachment: { contentType: 'application/pdf', url: 'Binary/guide', title: 'Policy Guide' } }],
  }], (client) => {
    const download = vi.spyOn(client, 'download');
    if (scenario === 'denied') {
      download.mockRejectedValue(new Error('Forbidden'));
    } else {
      download.mockResolvedValue(blob);
    }
  });

  if (scenario === 'allowed') {
    await waitFor(() => expect(screen.getByTitle('Attachment')).toHaveAttribute('src', 'blob:http://localhost/guide#navpanes=0'));
    expect(medplum.download).toHaveBeenCalledWith('Binary/guide');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/guide');
  } else {
    await waitFor(() => expect(screen.getByText('Document unavailable')).toBeInTheDocument());
    expect(screen.queryByTitle('Attachment')).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  }
});

test.each(['missing', 'denied', 'duplicate', 'foreign-project', 'public-file'])(
  'does not fall back to a public PDF for %s documents', async (scenario) => {
    let documents: DocumentReference[] | Error = [document];
    if (scenario === 'denied') {
      documents = new Error('Forbidden');
    } else if (scenario === 'missing') {
      documents = [];
    } else if (scenario === 'duplicate') {
      documents = [document, document];
    } else {
      documents = [{
        ...document,
        meta: { project: scenario === 'foreign-project' ? 'other-project' : 'army-project' },
        content: scenario === 'public-file' ? [{ attachment: {
          contentType: 'application/pdf', url: '/documents/adtmc/a01/Policy%20Guide.pdf',
        } }] : document.content,
      }];
    }
    setup(true, documents);
    await waitFor(() => expect(screen.getByText('Document unavailable')).toBeInTheDocument());
    expect(screen.queryByTitle('Attachment')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  }
);

test('discards a document returned after the current project changes', async () => {
  let resolveDocuments: (value: DocumentReference[]) => void = () => undefined;
  const documents = new Promise<DocumentReference[]>((resolve) => { resolveDocuments = resolve; });
  const { medplum } = setup(true, documents);
  vi.mocked(medplum.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project', features: armyFeatures });
  await act(async () => { resolveDocuments([document]); });
  expect(screen.queryByTitle('Attachment')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('discards Binary bytes returned after switching to another eligible Army project', async () => {
  const createObjectURL = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = vi.fn();
  });
  let resolveBlob: (value: Blob) => void = () => undefined;
  const pending = new Promise<Blob>((resolve) => { resolveBlob = resolve; });
  const { medplum } = setup(true, [{
    ...document, content: [{ attachment: { contentType: 'application/pdf', url: 'Binary/guide' } }],
  }], (client) => { vi.spyOn(client, 'download').mockReturnValue(pending); });

  await waitFor(() => expect(medplum.download).toHaveBeenCalledWith('Binary/guide'));
  vi.mocked(medplum.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project', features: armyFeatures });
  const membership = medplum.getProjectMembership();
  if (!membership) {
    throw new Error('Expected the original project membership');
  }
  vi.mocked(medplum.getProjectMembership).mockReturnValue({
    ...membership, project: { reference: 'Project/other-project' },
  });
  await act(async () => { resolveBlob(new Blob(['synthetic'], { type: 'application/pdf' })); });

  expect(createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByTitle('Attachment')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});