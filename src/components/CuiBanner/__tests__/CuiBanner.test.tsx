// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen } from '@testing-library/react';
import { CuiBanner } from '../CuiBanner';
import classes from '../CuiBanner.module.css';

describe('CuiBanner', () => {
  test('renders only CUI in the named complementary landmark', () => {
    const { container } = render(<CuiBanner />);
    const banner = screen.getByRole('complementary', { name: 'CUI' });

    expect(container.textContent).toBe('CUI');
    expect(banner).toHaveTextContent(/^CUI$/);
  });

  test('applies the approved banner class and tokens', () => {
    render(<CuiBanner />);
    const banner = screen.getByRole('complementary', { name: 'CUI' });
    const style = getComputedStyle(banner);

    expect(banner).toHaveClass(classes.banner);
    expect(style.getPropertyValue('--cui-background')).toBe('#006400');
    expect(style.getPropertyValue('--cui-foreground')).toBe('#ffffff');
    expect(style.getPropertyValue('--cui-height')).toBe('32px');
  });

  test('has no interactive dismissal control or dismissal state', () => {
    const { container } = render(<CuiBanner />);
    const banner = screen.getByRole('complementary', { name: 'CUI' });

    expect(container.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0);

    fireEvent.click(banner);
    fireEvent.keyDown(banner, { key: 'Escape' });

    expect(screen.getByRole('complementary', { name: 'CUI' })).toBeVisible();
  });
});
