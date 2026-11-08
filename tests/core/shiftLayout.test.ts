import { describe, expect, test } from 'vitest';
import { ORIGIN, V2_WORLD } from '../../src/core/bounds';
import type { Rect } from '../../src/core/houses';
import type { Cell } from '../../src/core/pathfind';
import { shiftLayout } from '../../src/core/shifted';
import { buildVillage } from '../../src/core/village';
import { generateMeadowStage } from '../../src/core/worldgen';

const base = { sizeX: 192, sizeZ: 192 };
const { world, spawn } = generateMeadowStage(2026);
const layout = buildVillage(world, spawn);
const before = structuredClone(layout);
const shifted = shiftLayout(layout, base);

function checkRect(actual: Rect, old: Rect, times = 1): void {
  expect(actual).toEqual({
    x0: old.x0 + times * ORIGIN.x, x1: old.x1 + times * ORIGIN.x,
    z0: old.z0 + times * ORIGIN.z, z1: old.z1 + times * ORIGIN.z,
  });
}

function checkCell(actual: Cell, old: Cell, times = 1): void {
  expect(actual).toEqual([
    old[0] + times * ORIGIN.x, old[1] + times * ORIGIN.y, old[2] + times * ORIGIN.z,
  ]);
}

function checkCells(actual: Cell[], old: Cell[]): void {
  expect(actual).toHaveLength(old.length);
  old.forEach((cell, i) => checkCell(actual[i], cell));
}

function decode(k: number, sizeX: number, sizeZ: number): Cell {
  return [k % sizeX, Math.floor(k / (sizeX * sizeZ)), Math.floor(k / sizeX) % sizeZ];
}

// Collect every object, including arrays and Sets, to catch sharing at any depth.
function objects(value: unknown): object[] {
  if (value === null || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(objects)];
}

describe('shiftLayout', () => {
  test('moves every rectangle, cell, door and ground height by ORIGIN', () => {
    expect(shifted.square).toEqual({ x0: 116, z0: 70, x1: 128, z1: 78 });
    expect(shifted.houses[0].doorFront).toEqual([69, layout.houses[0].groundY + 49, 65]);
    expect(shifted.gate).toEqual([115, 54, 74]);
    expect(shifted.houses).toHaveLength(layout.houses.length);
    layout.houses.forEach((house, i) => {
      const actual = shifted.houses[i];
      expect(actual.id).toBe(house.id);
      expect(actual.groundY).toBe(house.groundY + ORIGIN.y);
      for (const key of ['rect', 'interior', 'greetRect'] as const) checkRect(actual[key], house[key]);
      for (const key of ['doorFront', 'doorInside', 'npcSpot'] as const) checkCell(actual[key], house[key]);
      for (const key of ['doorCells', 'floor', 'lampCells', 'windowCells'] as const) {
        checkCells(actual[key], house[key]);
      }
    });
    checkCells(shifted.route, layout.route);
    checkCell(shifted.gate, layout.gate);
    for (const key of ['square', 'farmPlot', 'quarry', 'pad'] as const) checkRect(shifted[key], layout[key]);
    expect(shifted.stampedRects).toHaveLength(layout.stampedRects.length);
    layout.stampedRects.forEach((rect, i) => checkRect(shifted.stampedRects[i], rect));
    expect(shifted.farm.beds).toHaveLength(layout.farm.beds.length);
    layout.farm.beds.forEach((rect, i) => checkRect(shifted.farm.beds[i], rect));
    for (const key of ['pool', 'irrigation', 'pasture', 'path'] as const) {
      checkRect(shifted.farm[key], layout.farm[key]);
    }
    for (const key of ['gate', 'fence', 'herdSpawns'] as const) checkCells(shifted.farm[key], layout.farm[key]);
  });

  test('re-indexes route cells using the new world dimensions', () => {
    expect(shifted.routeCells.size).toBe(layout.routeCells.size);
    const oldCells = [...layout.routeCells].map(k => decode(k, V2_WORLD.x, V2_WORLD.z));
    const newCells = [...shifted.routeCells].map(k => decode(k, 192, 192));
    checkCells(newCells, oldCells);
  });

  test('leaves the input unchanged and shares no objects with it', () => {
    expect(layout).toEqual(before);
    const inputObjects = new Set(objects(layout));
    for (const object of objects(shifted)) expect(inputObjects.has(object)).toBe(false);
  });

  test('accounts for every layout, farm and house field', () => {
    expect(Object.keys(layout).sort()).toEqual([
      'farm', 'farmPlot', 'gate', 'houses', 'pad', 'quarry', 'route', 'routeCells', 'square', 'stampedRects',
    ]);
    expect(Object.keys(layout.farm).sort()).toEqual([
      'beds', 'fence', 'gate', 'herdSpawns', 'irrigation', 'pasture', 'path', 'pool',
    ]);
    expect(Object.keys(layout.houses[0]).sort()).toEqual([
      'doorCells', 'doorFront', 'doorInside', 'floor', 'greetRect', 'groundY', 'id', 'interior',
      'lampCells', 'npcSpot', 'rect', 'windowCells',
    ]);
    expect(Object.keys(shifted).sort()).toEqual(Object.keys(layout).sort());
    expect(Object.keys(shifted.farm).sort()).toEqual(Object.keys(layout.farm).sort());
    expect(Object.keys(shifted.houses[0]).sort()).toEqual(Object.keys(layout.houses[0]).sort());
  });

  test('applying twice moves rectangles and cells by twice ORIGIN in total', () => {
    const twice = shiftLayout(shifted, base, ORIGIN, { x: 192, y: 68, z: 192 });
    checkRect(twice.square, layout.square, 2);
    checkCell(twice.houses[0].doorFront, layout.houses[0].doorFront, 2);
    checkRect(twice.square, shifted.square);
    checkCell(twice.houses[0].doorFront, shifted.houses[0].doorFront);
    checkCells(
      [...twice.routeCells].map(k => decode(k, 192, 192)),
      [...shifted.routeCells].map(k => decode(k, 192, 192)),
    );
  });
});
