import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import {
  createBoundaryTracker,
  detectHorizontalBoundaries,
  horizontalKind,
} from '../src/ar/room-boundaries.js'
import { horizontalPlaneCandidates } from '../src/ar/webxr-geometry.js'

const camera = new Vector3(0, 1.5, 2)
const cloud = (height) =>
  Array.from({ length: 100 }, (_, i) => ({
    x: (i % 10) * 0.12,
    y: height + Math.sin(i) * 0.003,
    z: Math.floor(i / 10) * 0.12,
  }))

describe('room boundary observations', () => {
  it('detects broad floor/ceiling patches without accepting a desk or vertical edge', () => {
    expect(
      detectHorizontalBoundaries(
        [...cloud(0), ...cloud(3), ...cloud(0.8)],
        camera,
      )
        .map((b) => b.kind)
        .sort(),
    ).toEqual(['ceiling', 'floor'])
    expect(detectHorizontalBoundaries(cloud(0.8), camera)).toEqual([])
    expect(
      detectHorizontalBoundaries(
        cloud(3).map((p) => ({ ...p, z: 0 })),
        camera,
      ),
    ).toEqual([])
    expect(horizontalKind(3, camera, 'table')).toBeNull()
  })

  it('requires repeated height agreement and feature-point viewpoint change, then retains boundaries', () => {
    const tracker = createBoundaryTracker()
    const [ceiling] = detectHorizontalBoundaries(cloud(3), camera)
    for (let i = 0; i < 4; i++)
      expect(
        tracker.update([ceiling], i * 700, { cameraPosition: camera }),
      ).toEqual([])
    const found = tracker.update([ceiling], 2800, {
      cameraPosition: camera.clone().add(new Vector3(0.1, 0, 0)),
    })
    expect(found).toHaveLength(1)
    expect(tracker.update([], 60000)).toEqual(found)
    const jitter = {
      ...ceiling,
      origin: ceiling.origin.clone().add(new Vector3(0, 0.2, 0)),
    }
    expect(tracker.update([jitter], 60700)).toEqual(found)
    tracker.reset()
    expect(tracker.update([], 61400)).toEqual([])
  })

  it('does not confirm sporadic or slowly drifting heights', () => {
    const [ceiling] = detectHorizontalBoundaries(cloud(3), camera)
    for (const sporadic of [false, true]) {
      const tracker = createBoundaryTracker()
      for (let i = 0; i < 8; i++) {
        const observed = {
          ...ceiling,
          source: 'webxr-depth',
          origin: ceiling.origin
            .clone()
            .add(new Vector3(0, sporadic ? 0 : i * 0.02, 0)),
        }
        expect(
          tracker.update(sporadic && i % 2 ? [] : [observed], i * 700),
        ).toEqual([])
      }
    }
  })

  it('extracts native horizontal geometry in world coordinates and rejects semantic furniture', () => {
    const plane = {
      orientation: 'horizontal',
      semanticLabel: 'ceiling',
      planeSpace: {},
      polygon: [
        { x: -1, y: 0, z: -1 },
        { x: 1, y: 0, z: -1 },
        { x: 1, y: 0, z: 1 },
        { x: -1, y: 0, z: 1 },
      ],
    }
    const frame = {
      detectedPlanes: new Set([plane]),
      getPose: () => ({
        transform: {
          matrix: new Matrix4().makeRotationZ(Math.PI).setPosition(1, 3, 1)
            .elements,
        },
      }),
    }
    const candidates = horizontalPlaneCandidates(frame, {}, camera)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      kind: 'ceiling',
      source: 'webxr-plane',
    })
    expect(Math.min(...candidates[0].polygon.map((p) => p.x))).toBeCloseTo(0)
    plane.semanticLabel = 'shelf'
    expect(horizontalPlaneCandidates(frame, {}, camera)).toEqual([])
    plane.semanticLabel = ''
    expect(horizontalPlaneCandidates(frame, {}, camera)).toHaveLength(1)
  })
})
