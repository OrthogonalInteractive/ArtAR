import { describe, it, expect } from 'vitest'
import { Scene, Vector3 } from 'three'
import { makeWall } from '../src/ar/walls.js'
import { wallColors } from '../src/ar/wall-colors.js'
import { createWallFeedback } from '../src/ar/wall-feedback.js'

const wall = (id, angle) =>
  makeWall({
    id,
    origin: new Vector3(),
    normal: new Vector3(Math.sin(angle), 0, Math.cos(angle)),
    polygon: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
      { x: -1, y: 2 },
    ],
  })

describe('wall orientation colors', () => {
  it('gives perpendicular walls different colors at every room orientation', () => {
    for (let degrees = -180; degrees < 180; degrees++) {
      const angle = (degrees * Math.PI) / 180
      expect(wallColors(wall('a', angle)).fill).not.toBe(
        wallColors(wall('b', angle + Math.PI / 2)).fill,
      )
    }
  })
  it('preserves wall colors across dragging, selection changes, reordering and rebuilding', () => {
    const scene = new Scene(),
      feedback = createWallFeedback(scene)
    const a = wall('a', 0),
      b = wall('b', Math.PI / 2)
    feedback.setTracking(true)
    feedback.update([a, b])
    const fill = (id) =>
      scene.getObjectByName(`surface-${id}`).getObjectByName('wall-fill')
    const colors = [
      fill('a').material.color.getHex(),
      fill('b').material.color.getHex(),
    ]
    expect(colors[0]).not.toBe(colors[1])
    feedback.update([b, a], { selectedId: 'a', dragging: true })
    expect([
      fill('a').material.color.getHex(),
      fill('b').material.color.getHex(),
    ]).toEqual(colors)
    expect(fill('a').material.opacity).toBeGreaterThan(
      fill('b').material.opacity,
    )
    feedback.update([a, b], { selectedId: 'b' })
    expect([
      fill('a').material.color.getHex(),
      fill('b').material.color.getHex(),
    ]).toEqual(colors)
    feedback.update([])
    feedback.update([b, a])
    expect([
      fill('a').material.color.getHex(),
      fill('b').material.color.getHex(),
    ]).toEqual(colors)
    feedback.dispose()
    expect(scene.children).toHaveLength(0)
  })
})
