import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { defaults, validateCatalog } from './data/storage.js'

async function boot() {
  let deployed = defaults(),
    loadError = ''
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}catalog.json`, {
      cache: 'no-cache',
    })
    if (!response.ok) throw new Error('catalog')
    deployed = validateCatalog(await response.json())
  } catch {
    // A guest URL must never fall back to unrelated public artwork.
    if (new URLSearchParams(location.search).has('collection'))
      deployed = { version: 1, artworks: [], collections: [] }
    loadError =
      '公開コレクションを読み込めませんでした。通信を確認してページを再読み込みしてください。'
  }
  createApp(App, { deployed, loadError }).mount('#app')
}
void boot()
