import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { A01ScopeOfPracticePage } from './A01ScopeOfPracticePage';

function renderPage(url: string): void {
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[url]}>
        <A01ScopeOfPracticePage />
      </MemoryRouter>
    </MantineProvider>
  );
}

describe('A01ScopeOfPracticePage', () => {
  test('renders the requested A-01 document', () => {
    renderPage('/documents/adtmc/a01/scope-of-practice.html?document=a01-sore-throat-hoarseness');

    expect(screen.getByRole('heading', { name: 'Sore Throat/Hoarseness, A-1' })).toBeInTheDocument();
    expect(screen.getByTitle('Sore Throat/Hoarseness, A-1')).toHaveAttribute(
      'src',
      '/documents/adtmc/a01/files/SORE%20THROAT%20HOARSENESS,%20A-1.pdf'
    );
  });

  test('shows a clear message for an unknown document', () => {
    renderPage('/documents/adtmc/a01/scope-of-practice.html?document=unknown');

    expect(screen.getByText('Document unavailable')).toBeInTheDocument();
  });
});