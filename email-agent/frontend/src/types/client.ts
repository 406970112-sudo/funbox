import axios from 'axios'
import type { PostBody, ApiResponse } from '@/types/api'

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: 'http://localhost:1234', // 你的 Koa 后端地址
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 测试 POST 接口
export const testPostRequest = async (data: PostBody) => {
  try {
    const response = await apiClient.post<ApiResponse>('/test', data)
    return response.data
  } catch (error) {
    console.error('API request failed:', error)
    throw error
  }
}