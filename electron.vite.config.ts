import { resolve } from 'node:path'

import react from '@vitejs/plugin-react-swc'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const aliases = {
  '@features': resolve('src/features'),
  '@lib': resolve('src/lib'),
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: aliases
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: aliases
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: aliases
    }
  }
})
