import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'app-icon.svg', 'app-icon-maskable.svg'],
      manifest: {
        name: '文字接龍 Word Solitaire',
        short_name: '文字接龍',
        description: '結合文字分類與 Solitaire 整理牌局的療癒解謎遊戲',
        lang: 'zh-TW',
        start_url: '/',
        display: 'standalone',
        background_color: '#f7f1e3',
        theme_color: '#8a5a3b',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell so it opens offline after a first visit
        // (spec section 53: "basic offline cache"). Game content is all bundled
        // JS/CSS/data, not separate network fetches, so this alone covers it.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // The Firebase SDK is split into lazy chunks (see src/firebase/config.ts)
        // specifically so a build with no Firebase project configured never
        // downloads it — these all happen to keep firebase's own "index.esm-*"
        // naming. Precaching them here would silently undo that optimization by
        // fetching the whole SDK for every visitor on first load regardless of
        // whether Firebase is even enabled.
        globIgnores: ['**/index.esm-*.js'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
  },
})
