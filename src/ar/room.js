import * as THREE from 'three'
import { makeWall } from './walls.js'

export function createRoom(scene) {
  const group = new THREE.Group()
  scene.add(group)
  scene.background = new THREE.Color('#e6e7e3')
  const plaster = new THREE.MeshStandardMaterial({
    color: '#e0dfd8',
    roughness: 1,
  })
  const side = new THREE.MeshStandardMaterial({
    color: '#d6d8d0',
    roughness: 1,
  })
  const wood = new THREE.MeshStandardMaterial({
    color: '#ad967b',
    roughness: 0.9,
  })
  function box(w, h, d, x, y, z, material) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    m.position.set(x, y, z)
    m.receiveShadow = true
    m.castShadow = true
    group.add(m)
    return m
  }
  box(5.4, 3.2, 0.08, 0, 1.6, -0.05, plaster)
  box(0.08, 3.2, 5, -2.75, 1.6, 2.45, side)
  box(
    8,
    0.08,
    9,
    0,
    -0.055,
    2,
    new THREE.MeshStandardMaterial({ color: '#bcb5a7', roughness: 1 }),
  )
  const trim = new THREE.MeshStandardMaterial({
    color: '#e9e8e1',
    roughness: 0.8,
  })
  box(5.4, 0.065, 0.02, 0, 0.033, 0.005, trim)
  box(0.02, 0.065, 5, -2.7, 0.033, 2.45, trim)
  for (let i = -5; i < 8; i++)
    box(
      0.006,
      0.002,
      8,
      i * 0.48,
      -0.013,
      2,
      new THREE.MeshBasicMaterial({ color: '#aaa395' }),
    )
  // A 140 × 40 cm bench gives a familiar physical size reference.
  box(1.4, 0.055, 0.36, -0.78, 0.43, 0.53, wood)
  for (const x of [-1.36, -0.2]) box(0.042, 0.4, 0.24, x, 0.2, 0.53, wood)
  const potMat = new THREE.MeshStandardMaterial({
    color: '#9b9e8d',
    roughness: 1,
  })
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.14, 0.34, 32),
    potMat,
  )
  pot.position.set(1.95, 0.17, 0.55)
  pot.castShadow = true
  group.add(pot)
  const stem = new THREE.MeshStandardMaterial({
    color: '#626f4d',
    roughness: 1,
  })
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.399,
      height = 0.65 + (i % 3) * 0.15
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.009, height, 7),
      stem,
    )
    stalk.position.set(1.95, 0.34 + height / 2, 0.55)
    stalk.rotation.z = Math.sin(angle) * 0.18
    group.add(stalk)
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? '#677c54' : '#84916a',
        roughness: 1,
      }),
    )
    leaf.scale.set(0.12, 0.31, 0.018)
    leaf.rotation.set(0.2, angle, Math.sin(angle) * 0.7)
    leaf.position.set(
      1.95 + Math.sin(angle) * 0.15,
      0.38 + height,
      0.55 + Math.cos(angle) * 0.13,
    )
    leaf.castShadow = true
    group.add(leaf)
  }
  const walls = [
    makeWall({
      id: 'room-main',
      origin: new THREE.Vector3(0, 0, 0),
      normal: new THREE.Vector3(0, 0, 1),
      polygon: [
        { x: -2.65, y: 0.07 },
        { x: 2.65, y: 0.07 },
        { x: 2.65, y: 3.15 },
        { x: -2.65, y: 3.15 },
      ],
      source: 'room',
    }),
    makeWall({
      id: 'room-left',
      origin: new THREE.Vector3(-2.7, 0, 1.3),
      normal: new THREE.Vector3(1, 0, 0),
      polygon: [
        { x: -1.2, y: 0.07 },
        { x: 1.3, y: 0.07 },
        { x: 1.3, y: 3.15 },
        { x: -1.2, y: 3.15 },
      ],
      source: 'room',
    }),
  ]
  return {
    group,
    walls,
    setTone(color) {
      plaster.color.set(color)
      side.color.set(color).multiplyScalar(0.94)
    },
  }
}
