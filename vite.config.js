import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  test: { environment: 'jsdom', include: ['tests/**/*.spec.js'] },
})
