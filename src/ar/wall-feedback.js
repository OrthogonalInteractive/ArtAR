import * as THREE from 'three'
import { worldPoint, clipPolygon } from './walls.js'
import { disposeObject } from './artwork.js'
import { wallColors } from './wall-colors.js'

// Product feedback is independent of the optional diagnostic overlay.
// Strong fill/grid marks measured support; faint fill/dashes mark finite inference.
export function createWallFeedback(scene) {
  const root = new THREE.Group()
  root.name = 'artar-wall-surfaces'
  scene.add(root)
  const entries = new Map()
  let tracking = false,
    enabled = true

  function create(wall) {
    const colors = wallColors(wall)
    const group = new THREE.Group()
    group.name = `surface-${wall.id}`
    let observedPolygon = wall.polygon
    let extensionFill, extensionRim
    if (wall.surfacePolygon) {
      const extendedVertices = wall.surfacePolygon.map((p) =>
        worldPoint(wall, p, 0.001),
      )
      const extendedGeometry = new THREE.BufferGeometry().setFromPoints(
        extendedVertices,
      )
      const extendedIndices = []
      for (let i = 1; i < extendedVertices.length - 1; i++)
        extendedIndices.push(0, i, i + 1)
      extendedGeometry.setIndex(extendedIndices)
      extensionFill = new THREE.Mesh(
        extendedGeometry,
        new THREE.MeshBasicMaterial({
          color: colors.fill,
          transparent: true,
          opacity: 0.07,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      extensionFill.name = 'wall-extension-fill'
      const border = new THREE.BufferGeometry().setFromPoints([
        ...extendedVertices,
        extendedVertices[0],
      ])
      extensionRim = new THREE.Line(
        border,
        new THREE.LineDashedMaterial({
          color: colors.rim,
          transparent: true,
          opacity: 0.5,
          dashSize: 0.1,
          gapSize: 0.07,
          depthWrite: false,
        }),
      )
      extensionRim.computeLineDistances()
      extensionRim.name = 'wall-extension-rim'
      group.add(extensionFill, extensionRim)
      for (let i = 0; i < wall.surfacePolygon.length; i++) {
        const p = wall.surfacePolygon[i],
          q = wall.surfacePolygon[(i + 1) % wall.surfacePolygon.length]
        const a = p.y - q.y,
          b = q.x - p.x
        observedPolygon = clipPolygon(observedPolygon, a, b, a * p.x + b * p.y)
      }
    }
    const vertices = observedPolygon.map((p) => worldPoint(wall, p, 0.003))
    const indices = []
    for (let i = 1; i < vertices.length - 1; i++) indices.push(0, i, i + 1)
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices)
    geometry.setIndex(indices)
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: colors.fill,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    fill.name = 'wall-fill'
    fill.renderOrder = 1
    group.add(fill)

    // A mesh rim remains legible on mobile, where WebGL lineWidth is usually 1px.
    const rimVertices = []
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i],
        b = vertices[(i + 1) % vertices.length]
      const inset = new THREE.Vector3()
        .subVectors(b, a)
        .cross(wall.normal)
        .normalize()
        .multiplyScalar(0.007)
      const c = b.clone().sub(inset),
        d = a.clone().sub(inset)
      rimVertices.push(a, b, c, a, c, d)
    }
    const rim = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints(rimVertices),
      new THREE.MeshBasicMaterial({
        color: colors.rim,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    rim.name = 'wall-rim'
    rim.renderOrder = 2
    group.add(rim)

    // Grid segments are clipped to the convex observed polygon.
    const gridVertices = [],
      polygon = observedPolygon
    for (const axis of ['x', 'y']) {
      const other = axis === 'x' ? 'y' : 'x'
      const min = Math.min(...polygon.map((p) => p[axis]))
      const max = Math.max(...polygon.map((p) => p[axis]))
      for (let v = Math.ceil(min / 0.2) * 0.2; v < max; v += 0.2) {
        const crossings = []
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i],
            b = polygon[(i + 1) % polygon.length]
          if ((a[axis] <= v && b[axis] > v) || (b[axis] <= v && a[axis] > v)) {
            const t = (v - a[axis]) / (b[axis] - a[axis])
            crossings.push(a[other] + t * (b[other] - a[other]))
          }
        }
        if (crossings.length >= 2) {
          for (const value of [Math.min(...crossings), Math.max(...crossings)])
            gridVertices.push(
              worldPoint(wall, { [axis]: v, [other]: value }, 0.004),
            )
        }
      }
    }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gridVertices),
      new THREE.LineBasicMaterial({
        color: colors.grid,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    )
    grid.name = 'wall-grid'
    grid.renderOrder = 3
    group.add(grid)
    root.add(group)
    return { wall, group, fill, rim, grid, extensionFill, extensionRim }
  }

  return {
    setEnabled(value) {
      enabled = !!value
      root.visible = tracking && enabled
    },
    setTracking(value) {
      tracking = !!value
      root.visible = tracking && enabled
    },
    update(walls, { selectedId, candidateId, dragging = false } = {}) {
      const ids = new Set(walls.map((wall) => wall.id))
      for (const [id, entry] of entries) {
        if (!ids.has(id)) {
          disposeObject(entry.group)
          entries.delete(id)
        }
      }
      for (const wall of walls) {
        if (wall.polygon.length < 3) continue
        let entry = entries.get(wall.id)
        if (entry?.wall !== wall) {
          if (entry) disposeObject(entry.group)
          entry = create(wall)
          entries.set(wall.id, entry)
        }
        const selected = wall.id === selectedId
        const focused = wall.id === candidateId
        const active = selected || (!selectedId && focused)
        entry.fill.material.opacity = dragging
          ? selected
            ? 0.34
            : 0.2
          : selectedId
            ? selected
              ? 0.09
              : focused
                ? 0.22
                : 0.06
            : active
              ? 0.26
              : 0.2
        entry.grid.material.opacity = dragging
          ? 0.75
          : selectedId && (!focused || selected)
            ? 0.2
            : 0.5
        entry.rim.material.opacity =
          dragging || !selectedId || (focused && !selected)
            ? 0.95
            : selected
              ? 0.6
              : 0.3
        if (entry.extensionFill) {
          entry.extensionFill.material.opacity =
            entry.fill.material.opacity * 0.32
          entry.extensionRim.material.opacity =
            entry.rim.material.opacity * 0.55
        }
      }
      root.visible = tracking && enabled
    },
    dispose() {
      entries.clear()
      disposeObject(root)
    },
  }
}

/** Frame-corner handles make the actual artwork the obvious drag target. */
export function createDragOutline(model, { width, height, depth }) {
  const root = new THREE.Group()
  root.name = 'artar-drag-outline'
  const material = new THREE.MeshBasicMaterial({
    color: 0xc5ffeb,
    depthTest: true,
  })
  const corner = Math.min(width, height) * 0.16
  const gap = 0.012,
    thickness = 0.008
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      const horizontal = new THREE.Mesh(
        new THREE.PlaneGeometry(corner, thickness),
        material,
      )
      horizontal.position.set(
        x * (width / 2 + gap - corner / 2),
        y * (height / 2 + gap),
        depth + 0.004,
      )
      const vertical = new THREE.Mesh(
        new THREE.PlaneGeometry(thickness, corner),
        material,
      )
      vertical.position.set(
        x * (width / 2 + gap),
        y * (height / 2 + gap - corner / 2),
        depth + 0.004,
      )
      root.add(horizontal, vertical)
    }
  model.add(root)
  return root
}
