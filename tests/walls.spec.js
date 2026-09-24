import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  makeWall,
  fitPlacement,
  localPoint,
  worldPoint,
  detectVerticalWalls,
  createWallTracker,
} from '../src/ar/walls.js'
import { artDimensions, seedArtworks } from '../src/data/catalog.js'
const wall = (extra = {}) =>
  makeWall({
    id: 'a',
    origin: new Vector3(),
    normal: new Vector3(0, 0, 1),
    polygon: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
      { x: -1, y: 2 },
    ],
    ...extra,
  })
const rng = () => {
  let s = 42
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
describe('real-size wall placement', () => {
  it('includes the mat and frame in the physical footprint', () => {
    const d = artDimensions(seedArtworks[0])
    expect(d.width).toBeCloseTo(0.62)
    expect(d.height).toBeCloseTo(0.82)
    expect(d.depth).toBeCloseTo(0.03)
  })
  it('clamps the whole rectangle with a 2cm safety margin', () => {
    const result = fitPlacement(wall(), { x: 1, y: 2 }, 0.6, 0.8)
    expect(result).toEqual({
      x: expect.closeTo(0.68),
      y: expect.closeTo(1.58),
      clamped: true,
    })
  })
  it('rejects an oversized painting instead of silently scaling it down', () => {
    expect(fitPlacement(wall(), { x: 0, y: 1 }, 2.1, 1)).toBeNull()
  })
  it('repositions when a replacement grows close to a wall edge', () => {
    const small = fitPlacement(wall(), { x: 0.75, y: 1 }, 0.3, 0.3)
    const bigger = fitPlacement(wall(), small, 1.1, 0.8)
    expect(bigger.x).toBeCloseTo(0.43)
    expect(bigger.y).toBe(1)
  })
  it('fits every corner inside a triangular observed patch', () => {
    const w = wall({
      polygon: [
        { x: -2, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 3 },
      ],
    })
    const p = fitPlacement(w, { x: 1.4, y: 2.5 }, 0.6, 0.8)
    expect(p).not.toBeNull()
    for (const x of [p.x - 0.3, p.x + 0.3])
      for (const y of [p.y - 0.4, p.y + 0.4]) {
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(3 - 1.5 * Math.abs(x))
      }
  })
  it('clips against a neighboring wall even when observed polygons overshoot a corner', () => {
    const other = wall({
      id: 'side',
      origin: new Vector3(0.3, 0, 0),
      normal: new Vector3(-1, 0, 0),
    })
    const p = fitPlacement(wall(), { x: 0.5, y: 1 }, 0.6, 0.8, [other])
    expect(p.x).toBeCloseTo(-0.02)
  })
  it('keeps artwork upright and parallel on a rotated wall', () => {
    const w = wall({ normal: new Vector3(1, 0, 1).normalize() })
    const p = worldPoint(w, { x: 0.4, y: 1.2 }, 0.01)
    expect(localPoint(w, p).x).toBeCloseTo(0.4)
    expect(localPoint(w, p).y).toBeCloseTo(1.2)
    expect(w.plane.distanceToPoint(p)).toBeCloseTo(0.01)
    expect(
      new Vector3(0, 0, 1).applyQuaternion(w.rotation).distanceTo(w.normal),
    ).toBeLessThan(1e-6)
    expect(new Vector3(0, 1, 0).applyQuaternion(w.rotation).y).toBeCloseTo(1)
  })
})
describe('wall estimation from engine point clouds', () => {
  it('finds noisy vertical walls and rejects floor points', () => {
    const random = rng(),
      points = []
    for (let i = 0; i < 200; i++)
      points.push({
        position: {
          x: (random() - 0.5) * 3,
          y: random() * 2.7,
          z: (random() - 0.5) * 0.012,
        },
      })
    for (let i = 0; i < 160; i++)
      points.push({
        position: { x: (random() - 0.5) * 3, y: 0, z: random() * 3 },
      })
    const walls = detectVerticalWalls(points, new Vector3(0, 1.5, 3), {
      random,
    })
    expect(walls.length).toBeGreaterThan(0)
    expect(walls[0].normal.z).toBeGreaterThan(0.99)
    expect(walls[0].pointCount).toBeGreaterThan(190)
  })
  it('never invents a vertical wall from a horizontal floor', () => {
    const random = rng()
    const p = Array.from({ length: 250 }, () => ({
      x: random() * 4,
      y: 0,
      z: random() * 4,
    }))
    expect(detectVerticalWalls(p, new Vector3(1, 1.5, 3), { random })).toEqual(
      [],
    )
  })
  it('does not use a thin vertical edge as a full wall', () => {
    const random = rng()
    const p = Array.from({ length: 100 }, () => ({
      x: random() * 0.02,
      y: random() * 3,
      z: 0,
    }))
    expect(detectVerticalWalls(p, new Vector3(1, 1.5, 3), { random })).toEqual(
      [],
    )
  })
  it('waits for temporal agreement, removes stale candidates and preserves locked planes', () => {
    const tracker = createWallTracker(),
      a = wall()
    expect(tracker.update([a], 0)).toHaveLength(0)
    expect(tracker.update([a], 650)).toHaveLength(0)
    const found = tracker.update([a], 1300)
    expect(found).toHaveLength(1)
    tracker.lock(found[0].id)
    expect(tracker.update([], 10000)).toHaveLength(1)
    tracker.reset()
    expect(tracker.update([], 11000)).toHaveLength(0)
  })
})

describe('wall memory within an AR session', () => {
  function confirm(tracker, candidate) {
    tracker.update([candidate], 0)
    tracker.update([candidate], 700)
    return tracker.update([candidate], 1400)[0]
  }
  it('retains an unplaced wall without new observations and clears it on reset', () => {
    const tracker = createWallTracker()
    const remembered = confirm(tracker, wall())
    expect(tracker.snapshot()[0].locked).toBe(false)
    expect(tracker.update([], 5000)).toEqual([remembered])
    expect(tracker.update([], 60000)[0]).toBe(remembered)
    tracker.reset()
    expect(tracker.update([], 61000)).toEqual([])
  })
  it('does not shrink a confirmed wall or move its pose when only a part returns', () => {
    const tracker = createWallTracker()
    const remembered = confirm(
      tracker,
      wall({ normal: new Vector3(1, 0, 1).normalize() }),
    )
    tracker.update([], 60000)
    const partial = wall({
      origin: worldPoint(remembered, { x: 0.35, y: 0.75 }, 0.025),
      normal: remembered.normal,
      polygon: [
        { x: -0.25, y: 0 },
        { x: 0.25, y: 0 },
        { x: 0.25, y: 0.5 },
        { x: -0.25, y: 0.5 },
      ],
    })
    const found = tracker.update([partial], 61000)
    expect(found).toHaveLength(1)
    expect(found[0]).toBe(remembered)
    expect(fitPlacement(found[0], { x: -0.6, y: 1 }, 0.5, 0.8)).not.toBeNull()
  })
  it('adds newly observed area in the confirmed coordinate system and keeps placed walls fixed', () => {
    const tracker = createWallTracker()
    const remembered = confirm(
      tracker,
      wall({ normal: new Vector3(1, 0, 1).normalize() }),
    )
    const extra = wall({
      origin: worldPoint(remembered, { x: 0.8, y: 0 }, 0.025),
      normal: remembered.normal
        .clone()
        .applyAxisAngle(new Vector3(0, 1, 0), 0.01),
    })
    const [expanded] = tracker.update([extra], 2100)
    expect(expanded.id).toBe(remembered.id)
    expect(expanded.origin).toEqual(remembered.origin)
    expect(expanded.normal).toEqual(remembered.normal)
    expect(Math.min(...expanded.polygon.map((p) => p.x))).toBeCloseTo(-1)
    expect(Math.max(...expanded.polygon.map((p) => p.x))).toBeGreaterThan(1.7)
    tracker.lock(expanded.id)
    const beyond = wall({
      origin: worldPoint(remembered, { x: 1.5, y: 0 }, 0.02),
      normal: remembered.normal,
    })
    expect(tracker.update([beyond], 2800)[0]).toBe(expanded)
    expect(tracker.update([], 60000)).toEqual([expanded])
  })
  it('expires provisional observations before matching and requires distinct updates', () => {
    const tracker = createWallTracker(),
      candidate = wall()
    expect(tracker.update([candidate, candidate, candidate], 0)).toEqual([])
    expect(tracker.snapshot()[0].confirmations).toBe(1)
    tracker.update([candidate], 700)
    expect(tracker.update([candidate], 10000)).toEqual([])
    expect(tracker.snapshot()[0].confirmations).toBe(1)
    expect(tracker.update([], 13000)).toEqual([])
    expect(tracker.snapshot()).toEqual([])
  })
})
