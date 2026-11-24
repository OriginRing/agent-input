import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  build: {
    target: 'chrome90',
    cssTarget: 'chrome90',
    ...(mode === 'library'
      ? {
          lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index', cssFileName: 'style' },
          rollupOptions: { external: ['vue'] },
        }
      : { outDir: 'dist-demo' }),
  },
}))
