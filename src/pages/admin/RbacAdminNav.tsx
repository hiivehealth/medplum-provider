// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Group } from '@mantine/core';
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router';

const RBAC_LINKS = [
  { label: 'Roles', href: '/admin/rbac/roles' },
  { label: 'Access Models', href: '/admin/rbac/access-models' },
  { label: 'Memberships', href: '/admin/rbac/members' },
  { label: 'Visibility Test', href: '/admin/rbac/test' },
  { label: 'Bulk Assign', href: '/admin/rbac/bulk-assign' },
  { label: 'Audit', href: '/admin/rbac/audit' },
  { label: 'Templates', href: '/admin/rbac/templates' },
  { label: 'Runbooks', href: '/admin/rbac/runbooks' },
] as const;

export function RbacAdminNav(): JSX.Element {
  const location = useLocation();

  return (
    <Group>
      {RBAC_LINKS.map((link) => (
        <Button
          key={link.href}
          component={Link}
          to={link.href}
          variant={location.pathname === link.href ? 'filled' : 'light'}
          size="xs"
        >
          {link.label}
        </Button>
      ))}
    </Group>
  );
}
