// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Select, Stack } from '@mantine/core';
import { getReferenceString } from '@medplum/core';
import type { WithId } from '@medplum/core';
import type { Encounter, Location, Reference } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface LocationSelectorProps {
  encounter: WithId<Encounter>;
  onChange: (updatedEncounter: WithId<Encounter>) => void;
  disabled?: boolean;
}

interface LocationOption {
  value: string;
  label: string;
  location: WithId<Location>;
}

interface LocationLevel {
  label: string;
  physicalType?: string;
}

const LEVELS: LocationLevel[] = [
  { label: 'Building', physicalType: 'si' },
  { label: 'Floor', physicalType: 'lvl' },
  { label: 'Room', physicalType: 'ro' },
  { label: 'Station' },
];

export const LocationSelector = (props: LocationSelectorProps): JSX.Element => {
  const { encounter, onChange, disabled } = props;
  const medplum = useMedplum();

  const [selections, setSelections] = useState<(string | null)[]>(Array(LEVELS.length).fill(null));
  const [options, setOptions] = useState<LocationOption[][]>(Array(LEVELS.length).fill([]));
  const [loading, setLoading] = useState<boolean[]>(Array(LEVELS.length).fill(false));

  const currentLocationRef = useMemo(
    () => encounter.location?.find((l) => l.status === 'active')?.location,
    [encounter.location]
  );

  const fetchChildren = useCallback(async (parentId: string | null, levelIndex: number): Promise<WithId<Location>[]> => {
    const level = LEVELS[levelIndex];
    if (levelIndex === 0) {
      const result = await medplum.searchResources(
        'Location',
        'partof:missing=true&status=active&_count=100&_sort=name',
        { cache: 'no-cache' }
      );
      // Only show Locations from the HiiveCare sample hierarchy in the Room and Station selector.
      return result.filter((loc) =>
        loc.identifier?.some((id) => id.system === 'https://hiivehealth.com/location-ids')
      );
    }

    if (!parentId) {
      return [];
    }

    const filters = [`partof=${parentId}`, 'status=active', '_count=100', '_sort=name'];
    if (level.physicalType) {
      filters.push(`physical-type=${level.physicalType}`);
    }
    const result = await medplum.searchResources('Location', filters.join('&'), { cache: 'no-cache' });
    return result;
  }, [medplum]);

  const buildOptions = useCallback((locations: WithId<Location>[]): LocationOption[] => {
    return locations.map((location) => ({
      value: location.id,
      label: location.name || 'Unnamed Location',
      location,
    }));
  }, []);

  // Load initial path from encounter.location
  useEffect(() => {
    if (!currentLocationRef?.reference) {
      fetchChildren(null, 0)
        .then(buildOptions)
        .then((opts) => {
          setOptions((prev) => [opts, ...prev.slice(1)]);
        })
        .catch(() => {
          // ignore
        });
      return;
    }

    async function loadPath(): Promise<void> {
      const path: WithId<Location>[] = [];
      let current: WithId<Location> | undefined = await medplum.readReference(currentLocationRef as Reference<Location>);
      while (current) {
        path.unshift(current);
        if (!current.partOf?.reference) {
          break;
        }
        current = await medplum.readReference(current.partOf);
      }

      const newSelections = Array<string | null>(LEVELS.length).fill(null);
      const newOptions: LocationOption[][] = Array.from({ length: LEVELS.length }, () => []);

      for (let i = 0; i < path.length; i++) {
        const location = path[i];
        newSelections[i] = location.id;
        const children = await fetchChildren(i === 0 ? null : path[i - 1].id, i);
        newOptions[i] = buildOptions(children);
      }

      setSelections(newSelections);
      setOptions(newOptions);
    }

    loadPath().catch(() => {
      // ignore
    });
  }, [currentLocationRef, fetchChildren, buildOptions, medplum]);

  const handleSelect = useCallback(
    async (levelIndex: number, locationId: string | null): Promise<void> => {
      const newSelections = [...selections];
      const newOptions = [...options];

      // Reset all levels after this one
      for (let i = levelIndex + 1; i < LEVELS.length; i++) {
        newSelections[i] = null;
        newOptions[i] = [];
      }
      newSelections[levelIndex] = locationId;
      setSelections(newSelections);
      setOptions(newOptions);

      if (levelIndex < LEVELS.length - 1 && locationId) {
        setLoading((prev) => {
          const next = [...prev];
          next[levelIndex + 1] = true;
          return next;
        });
        try {
          const children = await fetchChildren(locationId, levelIndex + 1);
          newOptions[levelIndex + 1] = buildOptions(children);
          setOptions([...newOptions]);
        } finally {
          setLoading((prev) => {
            const next = [...prev];
            next[levelIndex + 1] = false;
            return next;
          });
        }
      }

      // If the last level was selected, update the encounter
      if (levelIndex === LEVELS.length - 1 && locationId) {
        const selectedOption = options[levelIndex].find((o) => o.value === locationId);
        const location = selectedOption?.location;
        if (!location) {
          return;
        }

        const now = new Date().toISOString();
        const updatedEncounter: Encounter = {
          ...encounter,
          location: [
            {
              location: { reference: getReferenceString(location), display: location.name },
              status: 'active',
              period: { start: now },
            },
          ],
        };
        const saved = await medplum.updateResource(updatedEncounter);
        onChange(saved);
      }
    },
    [selections, options, fetchChildren, buildOptions, encounter, medplum, onChange]
  );

  return (
    <Stack gap="sm">
      {LEVELS.map((level, index) => (
        <Select
          key={level.label}
          label={level.label}
          placeholder={`Select ${level.label.toLowerCase()}`}
          data={options[index]}
          value={selections[index]}
          onChange={(value) => handleSelect(index, value)}
          disabled={disabled || (index > 0 && !selections[index - 1]) || loading[index]}
          searchable
          clearable={index === LEVELS.length - 1}
        />
      ))}
    </Stack>
  );
};
