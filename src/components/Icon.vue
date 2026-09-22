<script setup>
defineProps({ name: String, size: { type: Number, default: 20 } })
const paths = {
  camera:
    'M14 4h-4L8 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  close: 'm6 6 12 12M6 18 18 6',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  move: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4',
  reset: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
  check: 'm5 12 4 4L19 6',
  chevron: 'm9 5 7 7-7 7',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  ruler: 'm3 16 13-13 5 5-13 13zM13 6l3 3m-6 0 3 3m-6 0 3 3',
  info: 'M12 11v6m0-10v.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
  share: 'M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
  image: 'M3 3h18v18H3zM3 16l6-6 4 4 3-3 5 6M15 7h.01',
  wall: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v6m6 0v6m-6 0v6',
  help: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 4v.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
  lock: 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
}
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.image" />
  </svg>
</template>
