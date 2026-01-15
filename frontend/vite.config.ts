import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ScriptsManager',
        short_name: 'Scripts',
        description: '脚本管理器 - 管理和调度你的脚本',
        theme_color: '#007AFF',
        background_color: '#fbfbfd',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/favicon.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 // 1 hour
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    // 使用 terser 进行代码混淆
    minify: 'terser',
    terserOptions: {
      compress: {
        // 删除 console.log
        drop_console: true,
        // 删除 debugger
        drop_debugger: true,
        // 纯函数调用优化
        pure_funcs: ['console.info', 'console.debug', 'console.warn'],
      },
      mangle: {
        // 混淆变量名
        toplevel: true,
        // 禁用属性混淆（容易与第三方库冲突）
        // properties: {
        //   regex: /^_/,
        // },
      },
      format: {
        // 删除注释
        comments: false,
      },
    },
    // 拆分代码块
    rollupOptions: {
      output: {
        // 混淆文件名
        entryFileNames: 'assets/[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash].[ext]',
        // 代码分割
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'editor': ['@monaco-editor/react'],
        },
      },
    },
    // 启用源码映射（生产环境建议关闭）
    sourcemap: false,
  },
})
