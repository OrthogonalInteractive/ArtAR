<script setup>
import { ref, computed } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import { validateArtwork, validateCatalog, readImage } from '../data/storage.js'
const props = defineProps({ catalog: Object })
const emit = defineEmits(['close', 'save'])
const tab = ref('art'),
  draft = ref(JSON.parse(JSON.stringify(props.catalog))),
  editing = ref(null),
  error = ref(''),
  notice = ref(''),
  busy = ref(false)
const collection = ref(draft.value.collections[0]?.id || '')
const selectedCollection = computed(() =>
  draft.value.collections.find((c) => c.id === collection.value),
)
const tabs = [
  { id: 'art', label: '作品・実寸' },
  { id: 'collections', label: '配布コレクション' },
  { id: 'accounts', label: 'アカウント設計' },
]
function selectTab(id) {
  tab.value = id
  editing.value = null
}
function edit(art) {
  editing.value = { ...art }
  error.value = ''
}
function add() {
  edit({
    id: `art-${crypto.randomUUID().slice(0, 8)}`,
    title: '',
    artist: '',
    image: '',
    widthCm: 50,
    heightCm: 70,
    frameCm: 2,
    matCm: 4,
    depthCm: 3,
    frame: 'oak',
    category: '登録作品',
    year: String(new Date().getFullYear()),
    subtitle: '',
    edition: 'MY COLLECTION',
  })
}
async function upload(e) {
  busy.value = true
  error.value = ''
  try {
    editing.value.image = await readImage(e.target.files[0])
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
function submit() {
  try {
    const art = validateArtwork(editing.value)
    const index = draft.value.artworks.findIndex((a) => a.id === art.id)
    if (index < 0) draft.value.artworks.push(art)
    else draft.value.artworks[index] = art
    editing.value = null
    notice.value = '編集内容を反映しました。「端末に保存」で保存できます。'
  } catch (e) {
    error.value = e.message
  }
}
function remove(id) {
  if (draft.value.artworks.length === 1) {
    error.value = '作品を1点以上残してください。'
    return
  }
  draft.value.artworks = draft.value.artworks.filter((a) => a.id !== id)
  draft.value.collections.forEach(
    (c) => (c.artworkIds = c.artworkIds.filter((a) => a !== id)),
  )
  editing.value = null
}
function addCollection() {
  const c = {
    id: `collection-${crypto.randomUUID().slice(0, 8)}`,
    name: '新しいコレクション',
    artworkIds: [],
  }
  draft.value.collections.push(c)
  collection.value = c.id
}
function exportData() {
  try {
    const data = validateCatalog(draft.value)
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'catalog.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    error.value = e.message
  }
}
async function importData(e) {
  try {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024)
      throw new Error('JSONは8MB以下にしてください。')
    draft.value = validateCatalog(JSON.parse(await file.text()))
    collection.value = draft.value.collections[0]?.id || ''
    notice.value = '読み込みました。「端末に保存」で反映できます。'
  } catch (e) {
    error.value = e.message
  }
}
function save() {
  try {
    emit('save', validateCatalog(draft.value))
  } catch (e) {
    error.value = e.message
  }
}
</script>
<template>
  <Dialog title="コレクション管理" wide @close="emit('close')">
    <p class="callout">
      <Icon
        name="info"
      />管理デモです。編集内容はこの端末に保存されます。公開するにはJSONを書き出し、同梱のcatalog.jsonを更新して再デプロイします。
    </p>
    <div class="tabs admin-tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        :class="{ active: tab === t.id }"
        @click="selectTab(t.id)"
      >
        {{ t.label }}
      </button>
    </div>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <template v-if="tab === 'art'">
      <form v-if="editing" class="art-form" @submit.prevent="submit">
        <div class="upload-box">
          <img
            v-if="editing.image"
            :src="editing.image"
            alt="アップロードした作品"
          /><Icon v-else name="image" :size="42" /><label
            class="button secondary"
            >画像を選ぶ<input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              @change="upload"
              hidden /></label
          ><small>JPEG / PNG / WebP · 12MB以下</small>
        </div>
        <div class="form-fields">
          <label
            >作品名<input
              v-model="editing.title"
              required
              maxlength="120"
              placeholder="例：青の余白" /></label
          ><label
            >作家名<input v-model="editing.artist" required maxlength="120"
          /></label>
          <div class="field-row">
            <label
              >作品の幅 / cm<input
                v-model.number="editing.widthCm"
                type="number"
                min="5"
                max="300"
                step=".1"
                required /></label
            ><label
              >作品の高さ / cm<input
                v-model.number="editing.heightCm"
                type="number"
                min="5"
                max="300"
                step=".1"
                required
            /></label>
          </div>
          <div class="field-row">
            <label
              >額縁幅 / cm<input
                v-model.number="editing.frameCm"
                type="number"
                min="0"
                max="20"
                step=".1"
                required /></label
            ><label
              >マット幅 / cm<input
                v-model.number="editing.matCm"
                type="number"
                min="0"
                max="20"
                step=".1"
                required /></label
            ><label
              >厚み / cm<input
                v-model.number="editing.depthCm"
                type="number"
                min=".5"
                max="20"
                step=".1"
                required
            /></label>
          </div>
          <label
            >額縁<select v-model="editing.frame">
              <option value="oak">ナチュラル</option>
              <option value="black">ブラック</option>
              <option value="white">ホワイト</option>
            </select></label
          >
          <div class="button-row">
            <button
              type="button"
              class="button secondary"
              @click="editing = null"
            >
              キャンセル</button
            ><button class="button primary" :disabled="busy">編集に反映</button>
          </div>
        </div>
      </form>
      <template v-else
        ><div class="section-line">
          <p>{{ draft.artworks.length }}点の作品</p>
          <button class="button secondary small" @click="add">
            <Icon name="plus" :size="16" />作品を追加
          </button>
        </div>
        <div class="admin-art-list">
          <div
            v-for="art in draft.artworks"
            :key="art.id"
            class="admin-art-row"
          >
            <img :src="art.image" :alt="art.title" />
            <div>
              <strong>{{ art.title }}</strong
              ><small
                >{{ art.artist }} · {{ art.widthCm }} ×
                {{ art.heightCm }} cm</small
              >
            </div>
            <button class="text-button" @click="edit(art)">編集</button
            ><button
              class="icon-button"
              :aria-label="`${art.title}を削除`"
              @click="remove(art.id)"
            >
              <Icon name="trash" :size="18" />
            </button>
          </div></div
      ></template>
    </template>
    <template v-else-if="tab === 'collections'"
      ><div class="section-line">
        <select v-model="collection" aria-label="編集するコレクション">
          <option v-for="c in draft.collections" :key="c.id" :value="c.id">
            {{ c.name }}
          </option></select
        ><button class="button secondary small" @click="addCollection">
          <Icon name="plus" :size="16" />追加
        </button>
      </div>
      <div v-if="selectedCollection" class="collection-editor">
        <label
          >コレクション名<input
            v-model="selectedCollection.name"
            maxlength="120"
        /></label>
        <p class="muted">
          QRから表示する作品を選択してください。公開後、ゲストはこの作品だけを閲覧できます。
        </p>
        <label v-for="art in draft.artworks" :key="art.id" class="check-row"
          ><input
            v-model="selectedCollection.artworkIds"
            type="checkbox"
            :value="art.id"
          /><img :src="art.image" alt="" /><span>{{ art.title }}</span
          ><small>{{ art.widthCm }} × {{ art.heightCm }} cm</small></label
        >
        <p class="fine-print">
          配布ID：{{ selectedCollection.id
          }}<br />表示の絞り込み用です。非公開作品を保護するアクセス制御は、本番の認証基盤で実装します。
        </p>
      </div></template
    >
    <template v-else
      ><p class="muted">
        本番で接続する権限モデル。デモにはログイン・招待・実際のアカウント作成はありません。
      </p>
      <div class="role-card">
        <Icon name="settings" />
        <div>
          <h3>管理者</h3>
          <p>アカウント・全作品・配布先を管理</p>
        </div>
        <span class="badge">設計</span>
      </div>
      <div class="role-card">
        <Icon name="image" />
        <div>
          <h3>作品登録ユーザー</h3>
          <p>自分の作品・画像・実寸を登録し、コレクションを作成</p>
        </div>
        <span class="badge">設計</span>
      </div>
      <div class="role-card">
        <Icon name="camera" />
        <div>
          <h3>ゲスト</h3>
          <p>配布されたコレクションから作品を選び、ARで体験</p>
        </div>
        <span class="badge">デモ対応</span>
      </div></template
    >
    <div class="admin-footer">
      <div class="button-row">
        <button class="text-button" @click="exportData">
          <Icon name="download" :size="16" />JSON書き出し</button
        ><label class="text-button"
          >読み込み<input
            type="file"
            accept=".json,application/json"
            hidden
            @change="importData"
        /></label>
      </div>
      <button class="button primary" :disabled="!!editing" @click="save">
        端末に保存
      </button>
    </div>
  </Dialog>
</template>
