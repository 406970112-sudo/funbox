import * as Koa from 'koa'

// POST 请求体类型
export interface PostBody {
  name: string;
  age?: number;
}

// 响应格式类型
export interface ApiResponse {
  success: boolean;
  message: string;
  data?: any;
}

// declare module 'koa' {
//   interface Context extends Koa.Context {
//     body: any,
//     request: any
//   }
// }
