import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [react(), mkcert()],
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  server: {
    port: 5173, // 显式指定端口
    // host: true, // 允许外部访问
    open: true, // 自动打开浏览器
    https: true,
    host: '0.0.0.0', // 监听所有网络接口
    hmr: {
      clientPort: 443 // 解决HMR在HTTPS下的问题
    },
    proxy: {
      // 代理所有以 /api 开头的请求
      '/api': {
        target: 'http://localhost:1234/api', // 后端服务地址
        changeOrigin: true, // 修改请求头中的host为目标URL
        rewrite: (path) => path.replace(/^\/api/, '') // 重写路径，移除/api前缀
      },
      // 代理WebSocket请求（如果需要）
      '/socket.io': {
        target: 'ws://localhost:1234',
        ws: true
      }
    }
  }
})