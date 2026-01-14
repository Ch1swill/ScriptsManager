import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
        // 混淆属性名（谨慎使用）
        properties: {
          regex: /^_/,  // 只混淆下划线开头的私有属性
        },
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
