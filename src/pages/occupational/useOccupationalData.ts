// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import type { OccupationalData } from './occupational-data';
import { fetchOccupationalData } from './occupational-data';

export type OccupationalDataState = {
  data?: OccupationalData;
  error?: string;
  loading: boolean;
};

export function useOccupationalData(): OccupationalDataState {
  const medplum = useMedplum();
  const [state, setState] = useState<OccupationalDataState>({ loading: true });

  useEffect(() => {
    let active = true;
    setState({ loading: true });
    fetchOccupationalData(medplum)
      .then((data) => {
        if (active) {
          setState({ data, loading: false });
        }
      })
      .catch((error) => {
        if (active) {
          setState({ error: error instanceof Error ? error.message : String(error), loading: false });
        }
      });

    return () => {
      active = false;
    };
  }, [medplum]);

  return state;
}
