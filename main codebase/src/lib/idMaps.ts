/**
 * idMaps.ts — Memoized ID → name/code lookup maps.
 *
 * WHY THIS EXISTS:
 *   RecordsPage was calling departments.find((d) => d.id === filterDept)
 *   on every render. With 100 departments and 1000 records that's
 *   100,000 iterations per keystroke in the filter inputs.
 *
 *   Instead, we build O(n) Maps once when the store data changes,
 *   then every lookup is O(1).
 *
 * USAGE:
 *   const maps = useIdMaps();
 *   maps.deptName('dept-workshop')     // → 'WORKSHOP DEPARTMENT'
 *   maps.sectionName('sec-electrical') // → 'Electrical'
 *   maps.equipCode('eq-rs')            // → 'RS'
 *
 * The hook re-computes only when the relevant store slice changes,
 * not on every render.
 */

import { useMemo } from 'react';
import { useStore, Department, Section, EquipmentType } from '../store';

export interface IdMaps {
  /** Get department name by ID. Returns '' if not found. */
  deptName:    (id: string) => string;
  /** Get section name by ID. Returns '' if not found. */
  sectionName: (id: string) => string;
  /** Get equipment type code by ID. Returns '' if not found. */
  equipCode:   (id: string) => string;
  /** Get equipment type name by ID. Returns '' if not found. */
  equipName:   (id: string) => string;
}

export function useIdMaps(): IdMaps {
  const departments    = useStore((s) => s.departments);
  const sections       = useStore((s) => s.sections);
  const equipmentTypes = useStore((s) => s.equipmentTypes);

  // Each map is recomputed only when its source array reference changes.
  // Because Zustand returns the same reference when data hasn't changed,
  // these useMemo calls are no-ops on re-renders that don't touch structure.

  const deptMap = useMemo(() => {
    const m = new Map<string, string>();
    departments.forEach((d: Department) => m.set(d.id, d.name));
    return m;
  }, [departments]);

  const sectionMap = useMemo(() => {
    const m = new Map<string, string>();
    sections.forEach((s: Section) => m.set(s.id, s.name));
    return m;
  }, [sections]);

  const equipCodeMap = useMemo(() => {
    const m = new Map<string, string>();
    equipmentTypes.forEach((eq: EquipmentType) => m.set(eq.id, eq.code));
    return m;
  }, [equipmentTypes]);

  const equipNameMap = useMemo(() => {
    const m = new Map<string, string>();
    equipmentTypes.forEach((eq: EquipmentType) => m.set(eq.id, eq.name));
    return m;
  }, [equipmentTypes]);

  return useMemo(() => ({
    deptName:    (id: string) => deptMap.get(id)    ?? '',
    sectionName: (id: string) => sectionMap.get(id) ?? '',
    equipCode:   (id: string) => equipCodeMap.get(id) ?? '',
    equipName:   (id: string) => equipNameMap.get(id) ?? '',
  }), [deptMap, sectionMap, equipCodeMap, equipNameMap]);
}

/**
 * Pure (non-hook) version — for use in callbacks and utility functions
 * where hooks can't be called. Pass the raw arrays directly.
 */
export function buildIdMaps(
  departments:    Department[],
  sections:       Section[],
  equipmentTypes: EquipmentType[],
): IdMaps {
  const deptMap     = new Map(departments.map((d) => [d.id, d.name]));
  const sectionMap  = new Map(sections.map((s) => [s.id, s.name]));
  const equipCode   = new Map(equipmentTypes.map((eq) => [eq.id, eq.code]));
  const equipName   = new Map(equipmentTypes.map((eq) => [eq.id, eq.name]));
  return {
    deptName:    (id) => deptMap.get(id)    ?? '',
    sectionName: (id) => sectionMap.get(id) ?? '',
    equipCode:   (id) => equipCode.get(id)  ?? '',
    equipName:   (id) => equipName.get(id)  ?? '',
  };
}