import { Alert, Anchor, Box, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import { useSearchParams } from 'react-router';

interface ScopeOfPracticeDocument {
  readonly title: string;
  readonly fileName: string;
}

const DOCUMENTS: Readonly<Record<string, ScopeOfPracticeDocument>> = {
  'a01-sore-throat-hoarseness': {
    title: 'Sore Throat/Hoarseness, A-1',
    fileName: 'SORE THROAT HOARSENESS, A-1.pdf',
  },
  'policy-guide': {
    title: 'Policy Guide',
    fileName: 'Policy Guide.pdf',
  },
  'obtain-a-throat-culture': {
    title: 'How to Obtain a Throat Culture',
    fileName: 'How to Obtain a Throat Culture.pdf',
  },
  'perform-an-heent-exam': {
    title: 'How to Perform an HEENT Exam',
    fileName: 'How to Perform an HEENT Exam.pdf',
  },
  'care-for-common-throat-infections': {
    title: 'How to Provide Care for Common Throat Infections',
    fileName: 'How to Provide Care for Common Throat Infections.pdf',
  },
};

export function A01ScopeOfPracticePage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const document = DOCUMENTS[searchParams.get('document') ?? ''];

  if (!document) {
    return (
      <Stack gap="md" maw={960} mx="auto" p="md">
        <Title order={1}>Scope of Practice</Title>
        <Alert color="red" title="Document unavailable">
          Select a document from the A-01 Scope of Practice list.
        </Alert>
      </Stack>
    );
  }

  const documentUrl = `/documents/adtmc/a01/files/${encodeURI(document.fileName)}`;

  return (
    <Stack gap="md" maw={1200} mx="auto" p="md">
      <div>
        <Title order={1}>{document.title}</Title>
        <Text c="dimmed" size="sm">
          ADTMC A-01 scope of practice reference
        </Text>
      </div>
      <Box h="calc(100vh - 190px)" miw={320}>
        <iframe title={document.title} src={documentUrl} style={{ border: 0, height: '100%', width: '100%' }} />
      </Box>
      <Anchor href={documentUrl} target="_blank" rel="noreferrer">
        Open document in a new tab
      </Anchor>
    </Stack>
  );
}