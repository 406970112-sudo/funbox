// 与后端类型保持一致
export interface PostBody {
    name: string
    age?: number
  }
  
  export interface ApiResponse {
    success: boolean
    message: string
    data?: {
      received: {
        name: string
        age: number | string
      }
      timestamp: string
    }
  }