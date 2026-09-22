import { seedArtworks, seedCollections } from './catalog.js'
const KEY = 'artar.catalog.v1'
export function validateArtwork(art) {
  if (!art || typeof art !== 'object')
    throw new Error('作品データが正しくありません。')
  for (const key of ['id', 'title', 'artist', 'image'])
    if (typeof art[key] !== 'string' || !art[key].trim())
      throw new Error('作品名・作家名・画像は必須です。')
  if (!/^[\w-]{1,80}$/.test(art.id))
    throw new Error('作品IDの形式が正しくありません。')
  if (
    art.title.length > 120 ||
    art.artist.length > 120 ||
    art.image.length > 1600000
  )
    throw new Error('作品データが大きすぎます。')
  if (
    !/^(data:image\/(png|jpeg|webp);base64,|(?:\.\/)?art\/|\/[^/])/.test(
      art.image,
    )
  )
    throw new Error('同梱画像かアップロードした画像を使用してください。')
  for (const key of ['widthCm', 'heightCm'])
    if (!Number.isFinite(art[key]) || art[key] < 5 || art[key] > 300)
      throw new Error('作品の幅・高さは5〜300cmで指定してください。')
  for (const key of ['frameCm', 'matCm'])
    if (!Number.isFinite(art[key]) || art[key] < 0 || art[key] > 20)
      throw new Error('額縁・マットの幅は0〜20cmで指定してください。')
  if (!Number.isFinite(art.depthCm) || art.depthCm < 0.5 || art.depthCm > 20)
    throw new Error('厚みは0.5〜20cmで指定してください。')
  if (!['oak', 'black', 'white'].includes(art.frame))
    throw new Error('額縁の種類が正しくありません。')
  return { ...art }
}
export function validateCatalog(data) {
  if (
    data?.version !== 1 ||
    !Array.isArray(data.artworks) ||
    !Array.isArray(data.collections) ||
    data.artworks.length > 50 ||
    data.artworks.length < 1
  )
    throw new Error('対応する作品データではありません。')
  const artworks = data.artworks.map(validateArtwork)
  if (new Set(artworks.map((a) => a.id)).size !== artworks.length)
    throw new Error('作品IDが重複しています。')
  const collections = data.collections.map((c) => {
    if (
      !/^[\w-]{1,80}$/.test(c.id) ||
      typeof c.name !== 'string' ||
      !c.name.trim() ||
      !Array.isArray(c.artworkIds)
    )
      throw new Error('コレクションの形式が正しくありません。')
    if (c.artworkIds.some((id) => !artworks.some((a) => a.id === id)))
      throw new Error('コレクションに存在しない作品が含まれています。')
    return {
      id: c.id,
      name: c.name.slice(0, 120),
      artworkIds: [...new Set(c.artworkIds)],
    }
  })
  if (new Set(collections.map((c) => c.id)).size !== collections.length)
    throw new Error('コレクションIDが重複しています。')
  return { version: 1, artworks, collections }
}
export function loadCatalog(deployed = defaults()) {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { data: validateCatalog(JSON.parse(raw)), error: null }
  } catch {
    return {
      data: deployed,
      error:
        '保存データを読み込めなかったため、公開コレクションを表示しています。',
    }
  }
  return { data: deployed, error: null }
}
export function defaults() {
  return {
    version: 1,
    artworks: structuredClone(seedArtworks),
    collections: structuredClone(seedCollections),
  }
}
export function saveCatalog(data) {
  const valid = validateCatalog(data)
  try {
    localStorage.setItem(KEY, JSON.stringify(valid))
  } catch {
    throw new Error(
      '端末に保存できません。画像を減らすか、JSONを書き出して保存してください。',
    )
  }
  return valid
}
export function resolveCollection(data, search) {
  const params = new URLSearchParams(search)
  const id = params.get('collection')
  if (id === null)
    return { guest: false, collection: null, artworks: data.artworks }
  const collection = data.collections.find((c) => c.id === id)
  return {
    guest: true,
    collection: collection || null,
    artworks: collection
      ? data.artworks.filter((a) => collection.artworkIds.includes(a.id))
      : [],
  }
}
export function collectionUrl(id, href) {
  const url = new URL(href)
  url.hash = ''
  url.search = ''
  url.searchParams.set('collection', id)
  return url.href
}
export async function readImage(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('JPEG・PNG・WebP画像を選んでください。')
  if (file.size > 12 * 1024 * 1024)
    throw new Error('12MB以下の画像を選んでください。')
  const source = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = source
    await image.decode()
    const ratio = Math.min(1, 1400 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * ratio)
    canvas.height = Math.round(image.height * ratio)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
  } finally {
    URL.revokeObjectURL(source)
  }
}
