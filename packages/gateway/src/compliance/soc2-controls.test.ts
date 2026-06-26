// SOC2 controls lookup functions — B8.3.
import { describe, it, expect } from 'vitest';
import { getAllControlIds, getControlById, SOC2_CONTROLS } from './soc2-controls.js';

describe('SOC2 controls', () => {
  describe('getAllControlIds', () => {
    it('returns non-empty list of ids', () => {
      const ids = getAllControlIds();
      expect(ids.length).toBeGreaterThan(0);
    });

    it('every id matches the expected CC#.# format', () => {
      const ids = getAllControlIds();
      for (const id of ids) {
        expect(id).toMatch(/^CC\d+(\.\d+)?$/);
      }
    });

    it('includes at least one sub control', () => {
      const ids = getAllControlIds();
      const subs = ids.filter((id) => id.includes('.'));
      expect(subs.length).toBeGreaterThanOrEqual(1);
      // Parents (CC1, CC2, ...) are NOT in this list — getAllControlIds
      // returns only requirements. Use Object.keys(SOC2_CONTROLS) to
      // get parent IDs separately.
      const parents = Object.keys(SOC2_CONTROLS);
      expect(parents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getControlById', () => {
    it('returns the matching control for a parent id', () => {
      const firstParent = Object.keys(SOC2_CONTROLS)[0];
      const r = getControlById(firstParent);
      expect(r).not.toBeNull();
      expect(r!.control.id).toBe(firstParent);
      expect(r!.requirement).toBeUndefined();
    });

    it('returns the parent + requirement for a sub-id', () => {
      const allIds = getAllControlIds();
      const sub = allIds.find((id) => id.includes('.'))!;
      const r = getControlById(sub);
      expect(r).not.toBeNull();
      expect(r!.requirement?.id).toBe(sub);
      // Parent must be a known SOC2 control.
      expect(Object.keys(SOC2_CONTROLS)).toContain(r!.control.id);
    });

    it('returns null for unknown id', () => {
      expect(getControlById('CC999')).toBeNull();
      expect(getControlById('ZZ-1')).toBeNull();
    });
  });

  describe('SOC2_CONTROLS shape', () => {
    it('each control has id + title + description + requirements', () => {
      for (const control of Object.values(SOC2_CONTROLS)) {
        expect(control.id).toBeDefined();
        expect(control.title.length).toBeGreaterThan(0);
        expect(control.description.length).toBeGreaterThan(0);
        expect(Array.isArray(control.requirements)).toBe(true);
        expect(control.requirements.length).toBeGreaterThan(0);
      }
    });

    it('each requirement has id + title + description + category', () => {
      for (const control of Object.values(SOC2_CONTROLS)) {
        for (const req of control.requirements) {
          expect(req.id).toBeDefined();
          expect(req.title.length).toBeGreaterThan(0);
          expect(req.description.length).toBeGreaterThan(0);
          expect(req.category.length).toBeGreaterThan(0);
        }
      }
    });
  });
});