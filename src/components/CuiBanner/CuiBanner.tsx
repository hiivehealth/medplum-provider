// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { CSSProperties, JSX } from 'react';
import classes from './CuiBanner.module.css';

const tokens = {
  '--cui-background': '#006400',
  '--cui-foreground': '#ffffff',
  '--cui-height': '32px',
} as CSSProperties;

export function CuiBanner(): JSX.Element {
  return (
    <aside aria-label="CUI" className={classes.banner} style={tokens}>
      CUI
    </aside>
  );
}
