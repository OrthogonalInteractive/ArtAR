import * as THREE from 'three'
import { artDimensions, frameOptions } from '../data/catalog.js'

const loader = new THREE.TextureLoader()
export async function createArtwork(art) {
  const group = new THREE.Group()
  const size = artDimensions(art),
    fw = art.frameCm / 100,
    mat = art.matCm / 100
  const color = frameOptions.find((f) => f.id === art.frame)?.color || '#b79368'
  const frameMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: art.frame === 'black' ? 0.25 : 0.05,
  })
  const box = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }
  const matte = new THREE.MeshStandardMaterial({
    color: '#f5f3ec',
    roughness: 1,
  })
  box(
    size.width - fw * 2,
    size.height - fw * 2,
    0.004,
    0,
    0,
    size.depth - 0.008,
    matte,
  )
  box(
    size.width,
    fw,
    size.depth,
    0,
    (size.height - fw) / 2,
    size.depth / 2,
    frameMaterial,
  )
  box(
    size.width,
    fw,
    size.depth,
    0,
    -(size.height - fw) / 2,
    size.depth / 2,
    frameMaterial,
  )
  box(
    fw,
    size.height - 2 * fw,
    size.depth,
    (size.width - fw) / 2,
    0,
    size.depth / 2,
    frameMaterial,
  )
  box(
    fw,
    size.height - 2 * fw,
    size.depth,
    -(size.width - fw) / 2,
    0,
    size.depth / 2,
    frameMaterial,
  )
  try {
    const texture = await loader.loadAsync(art.image)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const painting = new THREE.Mesh(
      new THREE.PlaneGeometry(art.widthCm / 100, art.heightCm / 100),
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 1,
        metalness: 0,
      }),
    )
    painting.position.z = size.depth - 0.005
    group.add(painting)
  } catch (e) {
    disposeObject(group)
    throw new Error(
      '作品画像を読み込めませんでした。別の画像でお試しください。',
    )
  }
  group.userData.dimensions = size
  return group
}
export function disposeObject(object) {
  const materials = new Set(),
    textures = new Set()
  object.traverse((child) => {
    child.geometry?.dispose()
    for (const material of Array.isArray(child.material)
      ? child.material
      : [child.material]) {
      if (!material || materials.has(material)) continue
      materials.add(material)
      if (material.map) textures.add(material.map)
      material.dispose()
    }
  })
  textures.forEach((t) => t.dispose())
  object.removeFromParent()
}
