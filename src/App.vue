<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import QRCode from 'qrcode'
import Studio from './components/Studio.vue'
import Icon from './components/Icon.vue'
import Dialog from './components/Dialog.vue'
import Admin from './components/Admin.vue'
import ARDebug from './components/ARDebug.vue'
import { artDimensions, frameOptions } from './data/catalog.js'
import {
  loadCatalog,
  saveCatalog,
  resolveCollection,
  collectionUrl,
} from './data/storage.js'
import { prepareAR, cameraUnsupportedReason } from './ar/engine.js'
const props = defineProps({ deployed: Object, loadError: String })
const initial = loadCatalog(props.deployed)
const isGuest = new URLSearchParams(location.search).has('collection')
const catalog = ref(isGuest ? props.deployed : initial.data)
const access = computed(() => resolveCollection(catalog.value, location.search))
const artworks = computed(() => access.value.artworks)
const activeId = ref(artworks.value[0]?.id),
  activeFrame = ref(artworks.value[0]?.frame || 'oak')
const active = computed(() => {
  const art = artworks.value.find((a) => a.id === activeId.value)
  return art ? { ...art, frame: activeFrame.value } : null
})
const outer = computed(() =>
  active.value ? artDimensions(active.value) : { width: 0, height: 0 },
)
const filter = ref('すべて'),
  filtered = computed(() =>
    filter.value === 'すべて'
      ? artworks.value
      : artworks.value.filter((a) => a.category === filter.value),
  )
const categories = computed(() => [
  'すべて',
  ...new Set(artworks.value.map((a) => a.category || '登録作品')),
])
const studio = ref(),
  ready = ref(false),
  switching = ref(false),
  state = ref({
    mode: 'preview',
    position: { x: 0, y: 1.65 },
    placed: true,
    wallCount: 2,
    tracking: true,
    dragging: false,
    artHint: null,
    focusedWallId: null,
    placedWallId: null,
    canPlace: false,
    planesVisible: true,
  })
const dialog = ref(null),
  toast = ref(props.loadError || initial.error || ''),
  arReady = ref(false),
  arLoading = ref(false),
  arError = ref(''),
  guides = ref(true),
  front = ref(false),
  tone = ref('#e0dfd8')
const shareCollections = computed(() =>
  isGuest
    ? props.deployed.collections.filter(
        (c) => c.id === access.value.collection?.id,
      )
    : props.deployed.collections,
)
const shareId = ref(shareCollections.value[0]?.id || ''),
  qr = ref(''),
  copied = ref(false),
  mobileCollection = ref(false)
const shareLink = computed(() => collectionUrl(shareId.value, location.href))
const isAR = computed(() => state.value.mode === 'ar')
const anotherWallFocused = computed(
  () =>
    !!(
      state.value.placed &&
      state.value.planesVisible &&
      state.value.focusedWallId &&
      state.value.focusedWallId !== state.value.placedWallId
    ),
)
const showPlacement = computed(
  () =>
    isAR.value &&
    state.value.planesVisible &&
    !mobileCollection.value &&
    !state.value.dragging &&
    (!state.value.placed || (state.value.tracking && anotherWallFocused.value)),
)
const showRemoval = computed(
  () =>
    isAR.value &&
    state.value.planesVisible &&
    !mobileCollection.value &&
    state.value.tracking &&
    !state.value.dragging &&
    !!state.value.focusedWallId,
)
const debugEnabled = ref(
  new URLSearchParams(location.search).get('debug') === '1',
)
const debugVisible = computed(
  () => debugEnabled.value && state.value.planesVisible,
)
let toastTimer, webmcpLifecycle
const showToast = (message) => {
  toast.value = message
  clearTimeout(toastTimer)
  if (message) toastTimer = setTimeout(() => (toast.value = ''), 6500)
}
function onState(update) {
  state.value = { ...state.value, ...update }
  if (update.message) showToast(update.message)
}
async function selectArt(art) {
  if (switching.value) return false
  switching.value = true
  const ok = await studio.value?.setArt(art)
  if (ok) {
    activeId.value = art.id
    activeFrame.value = art.frame
    mobileCollection.value = false
  }
  switching.value = false
  return !!ok
}
async function changeFrame(id) {
  if (!active.value || switching.value) return
  await selectArt({ ...active.value, frame: id })
}
async function studioReady() {
  ready.value = true
  studio.value.setDebug(debugEnabled.value)
  if (active.value) await selectArt(active.value)
}
function toggleDebug() {
  debugEnabled.value = !debugVisible.value
  if (debugEnabled.value) studio.value.setPlanesVisible(true)
  studio.value.setDebug(debugEnabled.value)
}
function togglePlanes() {
  studio.value.setPlanesVisible(!state.value.planesVisible)
}
async function openAR() {
  dialog.value = 'ar'
  arReady.value = false
  arError.value = cameraUnsupportedReason() || ''
  if (arError.value) return
  arLoading.value = true
  try {
    await prepareAR()
    arReady.value = true
  } catch (e) {
    arError.value = e.message
  } finally {
    arLoading.value = false
  }
}
async function startAR() {
  if (arLoading.value) return
  arLoading.value = true
  try {
    const starting = studio.value.startAR()
    dialog.value = null
    mobileCollection.value = false
    await starting
  } catch (e) {
    arError.value = e.message
    dialog.value = 'ar'
  } finally {
    arLoading.value = false
  }
}
function stopAR() {
  studio.value?.stopAR()
  mobileCollection.value = false
}
function toggleGuide() {
  guides.value = !guides.value
  studio.value.guides(guides.value)
}
function toggleView() {
  front.value = !front.value
  studio.value.view(front.value)
}
function chooseTone(color) {
  tone.value = color
  studio.value.tone(color)
}
async function makeQR() {
  try {
    qr.value = await QRCode.toDataURL(shareLink.value, {
      width: 480,
      margin: 2,
      color: { dark: '#252c27', light: '#ffffff' },
    })
  } catch {
    showToast('QRコードを生成できませんでした。')
  }
}
function openShare() {
  dialog.value = 'share'
  void makeQR()
}
async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareLink.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    showToast(
      'コピーできませんでした。表示されているURLを選択してコピーしてください。',
    )
  }
}
function downloadSnapshot() {
  try {
    const url = studio.value.snapshot()
    if (!url) throw new Error()
    const a = document.createElement('a')
    a.href = url
    a.download = `ArtAR-${activeId.value}.png`
    a.click()
    showToast('プレビュー画像を保存しました。')
  } catch {
    showToast('画像を保存できませんでした。')
  }
}
async function save(data) {
  try {
    const saved = saveCatalog(data)
    catalog.value = saved
    dialog.value = null
    const next =
      artworks.value.find((a) => a.id === activeId.value) || artworks.value[0]
    if (next && !(await selectArt(next))) {
      studio.value.clearPlacement()
      await selectArt(next)
      showToast('保存しました。現在の壁に収まらないため、配置を解除しました。')
    } else showToast('この端末に保存しました。')
  } catch (e) {
    showToast(e.message)
  }
}
const fmt = (n) => Number(n.toFixed(1))
const keyboard = (e) => {
  if (
    !ready.value ||
    dialog.value ||
    /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
  )
    return
  const directions = {
    ArrowLeft: [-0.01, 0],
    ArrowRight: [0.01, 0],
    ArrowUp: [0, 0.01],
    ArrowDown: [0, -0.01],
  }
  if (directions[e.key]) {
    e.preventDefault()
    studio.value.nudge(...directions[e.key])
  }
}
onMounted(() => {
  window.addEventListener('keydown', keyboard)
  const context = document.modelContext
  if (context?.registerTool) {
    webmcpLifecycle = new AbortController()
    for (const tool of [
      {
        name: 'list_artworks',
        description: 'List artwork available in the current guest collection.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: () => ({
          artworks: artworks.value.map((a) => ({
            id: a.id,
            title: a.title,
            widthCm: a.widthCm,
            heightCm: a.heightCm,
          })),
          selected: activeId.value,
        }),
      },
      {
        name: 'select_artwork',
        description:
          'Select a displayed artwork and fit its actual framed size to the current wall. Does not start the camera.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        async execute(input) {
          const art = artworks.value.find((a) => a.id === input?.id)
          if (!art) throw new Error('このコレクションに存在しない作品です。')
          if (!(await selectArt(art)))
            throw new Error('現在の壁に配置できません。')
          await nextTick()
          return { selected: activeId.value, title: active.value.title }
        },
      },
    ]) {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: webmcpLifecycle.signal }),
        ).catch(() => {})
      } catch {}
    }
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keyboard)
  webmcpLifecycle?.abort()
  clearTimeout(toastTimer)
})
</script>
<template>
  <div
    :class="[
      'app-shell',
      {
        'ar-active': isAR,
        'webxr-active': isAR && state.backend === 'webxr',
        'debug-active': isAR && debugVisible,
        'dragging-art': isAR && state.dragging,
      },
    ]"
  >
    <header class="app-header">
      <a class="brand" :href="'./'" aria-label="ArtAR ホーム"
        ><span class="brand-symbol"><span></span></span>Art<span
          class="brand-ar"
          >AR</span
        ><span class="demo-tag">DEMO</span></a
      >
      <nav class="header-nav" aria-label="メイン">
        <span class="nav-current">アートを飾る</span
        ><button v-if="!isGuest" @click="dialog = 'admin'">
          コレクション管理<Icon name="settings" :size="16" />
        </button>
      </nav>
      <div class="header-actions">
        <button class="help-button" @click="dialog = 'help'">
          <Icon name="help" :size="18" /><span>使い方</span></button
        ><button class="button secondary small" @click="openShare">
          <Icon name="share" :size="16" /><span>QRで共有</span>
        </button>
      </div>
    </header>
    <main v-if="artworks.length" class="workspace">
      <aside :class="['collection-panel', { 'mobile-open': mobileCollection }]">
        <div class="panel-intro">
          <div class="eyebrow">THE COLLECTION</div>
          <div class="section-line">
            <h1>{{ access.collection?.name || 'お気に入りの一枚を。' }}</h1>
            <span class="count">{{
              artworks.length.toString().padStart(2, '0')
            }}</span>
          </div>
          <p>選んで、飾って、空間と出会う。</p>
          <button
            v-if="mobileCollection"
            class="icon-button mobile-close"
            aria-label="作品一覧を閉じる"
            @click="mobileCollection = false"
          >
            <Icon name="close" />
          </button>
        </div>
        <div class="filter-tabs" aria-label="作品の種類">
          <button
            v-for="c in categories"
            :key="c"
            :class="{ active: filter === c }"
            @click="filter = c"
          >
            {{ c }}
          </button>
        </div>
        <div class="art-grid">
          <button
            v-for="(art, index) in filtered"
            :key="art.id"
            :class="['art-card', { selected: activeId === art.id }]"
            :aria-pressed="activeId === art.id"
            :disabled="switching"
            @click="selectArt(art)"
          >
            <div class="art-thumb" :class="`frame-${art.frame}`">
              <img :src="art.image" :alt="art.title" /><span
                v-if="activeId === art.id"
                class="selected-check"
                ><Icon name="check" :size="13"
              /></span>
            </div>
            <div class="art-card-title">{{ art.title }}</div>
            <div class="art-card-meta">
              {{ art.widthCm }} × {{ art.heightCm }} cm
            </div>
          </button>
        </div>
        <div class="collection-footer">
          <span class="tiny-index"
            >01 — {{ artworks.length.toString().padStart(2, '0') }}</span
          >
          <p>あなたの壁が、<br /><span>小さなギャラリーになる。</span></p>
          <small>すべてオリジナルのデモ作品です。</small>
        </div>
      </aside>
      <section class="preview-panel" aria-label="作品の配置プレビュー">
        <div class="stage-header">
          <div>
            <span class="eyebrow">YOUR SPACE, YOUR ART</span>
            <h2>
              {{
                isAR
                  ? 'あなたの壁に、飾ってみる。'
                  : '飾った、その先を想像する。'
              }}
            </h2>
          </div>
          <span class="mode-label"
            ><span class="status-square"></span
            >{{ isAR ? 'LIVE AR' : 'ROOM PREVIEW' }}</span
          >
        </div>
        <div class="stage">
          <Studio
            ref="studio"
            @state="onState"
            @error="showToast"
            @ready="studioReady"
          />
          <div class="stage-top">
            <button
              v-if="isAR"
              class="stage-chip plane-visibility-toggle"
              :aria-pressed="state.planesVisible"
              :aria-label="state.planesVisible ? '平面を非表示' : '平面を表示'"
              @click="togglePlanes"
              :class="{
                'wall-legend':
                  state.planesVisible && state.wallCount > 0 && state.tracking,
              }"
            >
              <Icon
                :name="state.planesVisible ? 'eye' : 'eye-off'"
                :size="15"
              />
              {{ state.wallCount }}面 ·
              {{ state.planesVisible ? '平面を非表示' : '平面を表示' }}
            </button>
            <span v-else class="stage-chip"
              ><Icon name="grid" :size="15" />バーチャルルーム</span
            >
            <div v-if="isAR" class="ar-top-actions">
              <button
                class="stage-chip debug-toggle"
                :aria-pressed="debugVisible"
                @click="toggleDebug"
              >
                <Icon name="grid" :size="15" />デバッグ
              </button>
              <button class="stage-chip" @click="stopAR">
                <Icon name="close" :size="15" />終了
              </button>
            </div>
            <span v-else class="scale-chip">1:1<span>実寸比率</span></span>
          </div>
          <ARDebug v-if="isAR && debugVisible" :data="state.debug" />
          <span
            v-if="showPlacement || showRemoval"
            class="scan-reticle"
            aria-hidden="true"
          ></span>
          <div v-if="showPlacement || showRemoval" class="scan-center">
            <p v-if="showPlacement">
              {{
                state.canPlace
                  ? state.placed
                    ? 'この壁へ作品を移せます'
                    : '色のついた壁に飾れます'
                  : state.focusedWallId
                    ? 'この壁には作品が収まりません'
                    : state.backend === 'webxr'
                      ? '壁を上下・左右にゆっくり映してください'
                      : '壁を映しながら端末を左右に少し移動してください'
              }}
            </p>
            <div class="plane-actions">
              <button
                v-if="showPlacement"
                class="button primary"
                :disabled="!state.canPlace || !state.tracking || switching"
                @click="studio.place()"
              >
                ここに飾る
              </button>
              <button
                v-if="showRemoval"
                class="button remove-plane"
                :disabled="switching"
                aria-label="画面中央の平面を削除"
                @click="studio.removeWall(state.focusedWallId)"
              >
                <Icon name="trash" :size="17" />平面を削除
              </button>
            </div>
          </div>
          <div v-if="!isAR" class="stage-caption">
            <span>THE QUIET ROOM</span><span>ベンチ幅 140 cm / 参考寸法</span>
          </div>
          <div v-if="!isAR" class="stage-toolbox">
            <button
              :class="{ active: guides }"
              @click="toggleGuide"
              aria-label="壁のガイド表示"
              :aria-pressed="guides"
            >
              <Icon name="wall" /></button
            ><button
              :class="{ active: front }"
              @click="toggleView"
              aria-label="正面・斜めの視点を切り替え"
              :aria-pressed="front"
            >
              <Icon name="expand" /></button
            ><button @click="studio.reset()" aria-label="配置をリセット">
              <Icon name="reset" /></button
            ><span class="tool-divider"></span
            ><button
              @click="downloadSnapshot"
              aria-label="プレビュー画像を保存"
            >
              <Icon name="download" />
            </button>
          </div>
          <div
            v-if="
              isAR &&
              state.placed &&
              state.planesVisible &&
              state.tracking &&
              state.artHint &&
              !mobileCollection
            "
            class="art-drag-hint"
            :class="{ dragging: state.dragging }"
            :style="{ left: `${state.artHint.x}%`, top: `${state.artHint.y}%` }"
          >
            <Icon name="move" :size="17" />{{
              state.dragging ? '移動中' : 'つかんで移動'
            }}
          </div>
          <div
            v-if="isAR && !mobileCollection"
            class="ar-move-instruction"
            role="status"
          >
            <Icon :name="state.placed ? 'move' : 'wall'" :size="20" />
            <div>
              <strong>{{
                !state.tracking
                  ? '壁を再認識しています'
                  : state.dragging
                    ? '移動中 · 指を離して配置'
                    : anotherWallFocused && state.canPlace
                      ? '別の壁へ移せます'
                      : state.placed
                        ? '作品をドラッグして移動'
                        : !state.planesVisible
                          ? '平面を表示して配置できます'
                          : state.wallCount
                            ? '色のついた壁をタップして配置'
                            : '壁をゆっくり映してください'
              }}</strong>
              <span>{{
                !state.tracking
                  ? '端末をゆっくり動かしてください'
                  : state.dragging
                    ? state.planesVisible
                      ? '色のついた面に沿って動かせます'
                      : '平面は非表示のまま移動できます'
                    : anotherWallFocused && state.canPlace
                      ? '「ここに飾る」でこの壁へ移動'
                      : state.placed
                        ? '作品に触れたまま、上下・左右へ'
                        : !state.planesVisible
                          ? '左上の「平面を表示」で認識面を確認'
                          : state.wallCount
                            ? '濃い面は観測済み・薄い面は推定範囲'
                            : '端末の位置を左右に少し動かしてください'
              }}</span>
            </div>
          </div>
        </div>
        <div class="preview-bottom">
          <div class="drag-tip">
            <Icon name="move" :size="18" /><span
              >作品をドラッグして、壁に沿って移動</span
            >
          </div>
          <div v-if="!isAR" class="wall-tones">
            <span>壁の色</span
            ><button
              v-for="color in ['#e0dfd8', '#c4c7c3', '#b4b3a1', '#545b5b']"
              :key="color"
              :style="{ background: color }"
              :class="{ chosen: tone === color }"
              :aria-label="`壁色 ${color}`"
              :aria-pressed="tone === color"
              @click="chooseTone(color)"
            ></button>
          </div>
          <button v-else class="text-button" @click="studio.reset()">
            壁の再検出
          </button>
        </div>
        <div class="experience-banner">
          <div class="banner-icon"><Icon name="camera" :size="25" /></div>
          <div>
            <h3>今度は、あなたの部屋で。</h3>
            <p>カメラを使って、実際の壁にアートを配置。</p>
          </div>
          <button class="button primary" :disabled="!ready" @click="openAR">
            ARで飾る<Icon name="arrow" :size="18" />
          </button>
        </div>
      </section>
      <aside v-if="active" class="details-panel">
        <div class="details-top">
          <span class="eyebrow">SELECTED ARTWORK</span
          ><span class="detail-number"
            >{{
              String(
                artworks.findIndex((a) => a.id === active.id) + 1,
              ).padStart(2, '0')
            }}
            / {{ String(artworks.length).padStart(2, '0') }}</span
          >
        </div>
        <h2 class="art-title">{{ active.title }}</h2>
        <p class="art-subtitle">{{ active.subtitle }}</p>
        <div class="artist-line">
          {{ active.artist }}<span>{{ active.year }}</span>
        </div>
        <div class="dimension-card">
          <div class="dimension-heading">
            <Icon name="ruler" :size="17" /><span>作品サイズ</span
            ><span class="badge">cm</span>
          </div>
          <div class="dimension-values">
            <div>
              <strong>{{ active.widthCm }}</strong
              ><small>幅</small>
            </div>
            <span class="multiply">×</span>
            <div>
              <strong>{{ active.heightCm }}</strong
              ><small>高さ</small>
            </div>
          </div>
          <div class="outer-dimensions">
            額装外寸<span
              >{{ fmt(outer.width * 100) }} ×
              {{ fmt(outer.height * 100) }} cm</span
            >
          </div>
        </div>
        <section class="detail-section">
          <div class="section-line">
            <h3>フレーム</h3>
            <span>{{
              frameOptions.find((f) => f.id === active.frame)?.name
            }}</span>
          </div>
          <div class="frame-options">
            <button
              v-for="frame in frameOptions"
              :key="frame.id"
              :aria-label="`${frame.name}の額縁`"
              :aria-pressed="active.frame === frame.id"
              :class="{ active: active.frame === frame.id }"
              :disabled="switching"
              @click="changeFrame(frame.id)"
            >
              <span :style="{ borderColor: frame.color }"></span
              ><Icon v-if="active.frame === frame.id" name="check" :size="12" />
            </button>
          </div>
          <dl class="small-details">
            <div>
              <dt>額縁幅</dt>
              <dd>{{ active.frameCm }} cm</dd>
            </div>
            <div>
              <dt>マット幅</dt>
              <dd>{{ active.matCm }} cm</dd>
            </div>
            <div>
              <dt>厚み</dt>
              <dd>{{ active.depthCm }} cm</dd>
            </div>
          </dl>
        </section>
        <section class="detail-section position-section">
          <div class="section-line">
            <h3>位置の微調整</h3>
            <span>1 cmずつ</span>
          </div>
          <div class="position-controls">
            <div class="dpad">
              <button
                class="up"
                aria-label="1cm上に移動"
                @click="studio.nudge(0, 0.01)"
              >
                ↑</button
              ><button
                class="left"
                aria-label="1cm左に移動"
                @click="studio.nudge(-0.01, 0)"
              >
                ←</button
              ><Icon name="move" :size="16" /><button
                class="right"
                aria-label="1cm右に移動"
                @click="studio.nudge(0.01, 0)"
              >
                →</button
              ><button
                class="down"
                aria-label="1cm下に移動"
                @click="studio.nudge(0, -0.01)"
              >
                ↓
              </button>
            </div>
            <div class="position-description">
              <span class="alignment-icon"
                ><Icon name="check" :size="12" />壁に平行</span
              >
              <p>壁の向きに合わせて<br />角度を自動調整</p>
            </div>
          </div>
        </section>
        <div class="scale-note">
          <Icon name="lock" :size="16" />
          <div>
            <strong>登録した寸法で表示</strong>
            <p>
              {{
                isAR
                  ? '端末や環境によって、表示サイズに誤差が生じます。'
                  : '作品を切り替えても、登録した寸法で表示します。'
              }}
            </p>
          </div>
        </div>
        <button
          class="button mobile-art-button secondary"
          @click="mobileCollection = true"
        >
          <Icon name="grid" :size="17" />作品を切り替え
        </button>
      </aside>
    </main>
    <main v-else class="empty-state">
      <Icon name="image" :size="48" />
      <h1>このコレクションは見つかりません</h1>
      <p>
        配布元にURLをご確認ください。登録作品のないコレクションも表示できません。
      </p>
      <a href="./" class="button primary">デモコレクションを開く</a>
    </main>
    <footer class="app-footer">
      <span>ArtAR <span>— A place for art.</span></span
      ><span>WEB AR EXPERIENCE <b>●</b> DEMO 0.1</span>
    </footer>
    <div v-if="toast" class="toast" role="status">
      <Icon name="info" :size="18" /><span>{{ toast }}</span
      ><button aria-label="通知を閉じる" @click="toast = ''">
        <Icon name="close" :size="16" />
      </button>
    </div>
    <div v-if="isAR" class="ar-mobile-bar">
      <button class="button secondary" @click="mobileCollection = true">
        <Icon name="grid" :size="17" />作品を切り替え
      </button>
      <button class="button secondary" @click="studio.reset()">
        <Icon name="reset" :size="17" />壁の再検出
      </button>
    </div>
    <Admin
      v-if="dialog === 'admin' && !isGuest"
      :catalog="catalog"
      @close="dialog = null"
      @save="save"
    />
    <Dialog
      v-if="dialog === 'ar'"
      title="アートを、あなたの壁に。"
      @close="dialog = null"
      ><div class="ar-dialog-icon"><Icon name="camera" :size="44" /></div>
      <ol class="ar-steps">
        <li>
          <span>01</span>
          <div>
            <strong>カメラを許可</strong>
            <p>明るい場所で、壁から少し離れてください。</p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>ゆっくり動かして壁を認識</strong>
            <p>
              壁の模様を広く映し、スマートフォンの位置を左右に少し動かします。無地の壁では、目印をいくつか貼ると認識しやすくなります。
            </p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>飾って、動かして、比べる</strong>
            <p>
              色のついた壁をタップして配置し、作品をドラッグして移動。額縁は壁の向きに揃い、作品もその場で切り替えられます。
            </p>
          </div>
        </li>
      </ol>
      <p class="fine-print">
        iPhone /
        iPadのSafari、AndroidのChromeを想定。PCではルームプレビューをご利用ください。登録寸法で表示しますが、端末・環境によって誤差があります。
      </p>
      <p v-if="arError" class="error-message" role="alert">{{ arError }}</p>
      <button
        v-if="arError && !cameraUnsupportedReason()"
        class="button secondary full"
        @click="openAR"
      >
        再試行</button
      ><button
        class="button primary full"
        :disabled="!arReady || arLoading || !!arError"
        @click="startAR"
      >
        <Icon name="camera" />{{
          arLoading ? 'ARを準備しています…' : 'カメラを開始'
        }}
      </button>
      <p class="privacy-note">
        <Icon
          name="lock"
          :size="13"
        />カメラ映像をアプリのサーバーへ保存・送信しません
      </p></Dialog
    >
    <Dialog
      v-if="dialog === 'share'"
      title="QRでコレクションを届ける"
      @close="dialog = null"
      ><p class="muted">
        スマートフォンで読み取ると、選んだコレクションを体験できます。
      </p>
      <label class="share-select"
        >公開中のコレクション<select v-model="shareId" @change="makeQR">
          <option v-for="c in shareCollections" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select></label
      >
      <div class="qr-image">
        <img
          v-if="qr"
          :src="qr"
          alt="コレクションを開くQRコード"
          width="224"
          height="224"
        />
      </div>
      <input
        class="share-url"
        :value="shareLink"
        readonly
        aria-label="共有URL"
        @focus="$event.target.select()"
      />
      <div class="button-row">
        <button class="button primary" @click="copyLink">
          {{ copied ? 'コピーしました' : 'リンクをコピー' }}</button
        ><a
          v-if="qr"
          :href="qr"
          download="artar-collection-qr.png"
          class="button secondary"
          ><Icon name="download" :size="17" />QRを保存</a
        >
      </div>
      <p class="fine-print">
        管理画面の変更は、公開データを更新して再デプロイした後に反映されます。localhostのURLは他の端末から開けません。
      </p></Dialog
    >
    <Dialog
      v-if="dialog === 'help'"
      title="アートを飾るには"
      @close="dialog = null"
      ><div class="help-content">
        <h3>まずはルームプレビュー</h3>
        <p>
          作品を選び、壁をタップすると配置できます。ドラッグで壁に沿って移動します。矢印ボタンやキーボードの矢印キーで1cmずつ動かせます。
        </p>
        <h3>自分の部屋でAR体験</h3>
        <p>
          「ARで飾る」からカメラを開始し、壁を認識させてください。検出済みの範囲内で、額縁の外寸が収まるように配置します。作品を切り替えても、位置と向きを引き継ぎます。別の認識済みの壁へ画面中央を向けると「ここに飾る」で移動できます。「平面を削除」は画面中央の平面だけを除外し、そこに作品があれば、収まる最寄りの平面へ移します。移動先がなければ配置を解除します。「壁の再検出」は削除の除外も含め、認識した壁と配置を消してやり直す操作です。
        </p>
        <p>
          左上の「平面を非表示」で、認識した面や操作枠を隠して作品を見られます。配置を保ったまま移動・作品切り替えができ、「平面を表示」で元に戻せます。
        </p>
        <h3>壁と実寸の精度</h3>
        <p>
          色のついた面は認識できた壁で、実際の壁の端とは限りません。ドラッグ中は色が濃くなります。隣接する認識済みの壁にも配慮しますが、窓・家具などの障害物は自動検出しません。
        </p>
        <p>
          作品は登録寸法と端末の距離推定で表示します。表示サイズの精度は端末や環境によって変わります。認識が途切れた場合は作品と壁の色を隠し、追跡の復帰を待ちます。
        </p>
        <h3>作品管理と配布</h3>
        <p>
          作品画像と寸法を編集し、コレクションごとに表示する作品を選べます。デモの編集はこのブラウザ内に保存。公開への反映はJSON書き出しと再デプロイが必要です。
        </p>
      </div></Dialog
    >
  </div>
</template>
