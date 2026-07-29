import { z } from 'zod'
import Redis from 'ioredis'

// 创建 Redis 客户端连接
const redisClient = new Redis({
  host: '127.0.0.1',
  port: 6379,
  db: 1, // 使用 db1
  retryStrategy: (times) => {
    // 重试策略
    const delay = Math.min(times * 50, 2000)
    return delay
  }
})

// 确保连接关闭时释放资源
process.on('exit', () => {
  redisClient.disconnect()
})

// 监听连接错误
redisClient.on('error', (err) => {
  console.error('Redis 连接错误:', err)
})

export const redisTool = {
  name: 'redis',
  description: '连接本地 Redis 数据库，提供增查改功能，操作 db1 中的所有数据。',
  parameters: z.discriminatedUnion('operation', [
    // 获取数据
    z.object({
      operation: z.literal('get'),
      key: z.string().min(1, { message: '键名不能为空' }).describe('要获取的键名')
    }),
    // 设置数据
    z.object({
      operation: z.literal('set'),
      key: z.string().min(1, { message: '键名不能为空' }).describe('要设置的键名'),
      value: z.string().describe('要设置的值'),
      expiry: z.number().optional().describe('过期时间（秒），可选')
    }),
    // 删除数据
    z.object({
      operation: z.literal('del'),
      key: z.string().min(1, { message: '键名不能为空' }).describe('要删除的键名')
    }),
    // 查询所有匹配的键
    z.object({
      operation: z.literal('keys'),
      pattern: z.string().default('*').describe('匹配模式，默认为所有键')
    }),
    // 检查键是否存在
    z.object({
      operation: z.literal('exists'),
      key: z.string().min(1, { message: '键名不能为空' }).describe('要检查的键名')
    }),
    // 获取哈希表中的字段
    z.object({
      operation: z.literal('hget'),
      key: z.string().min(1, { message: '哈希表键名不能为空' }).describe('哈希表的键名'),
      field: z.string().min(1, { message: '字段名不能为空' }).describe('要获取的字段名')
    }),
    // 设置哈希表中的字段
    z.object({
      operation: z.literal('hset'),
      key: z.string().min(1, { message: '哈希表键名不能为空' }).describe('哈希表的键名'),
      field: z.string().min(1, { message: '字段名不能为空' }).describe('要设置的字段名'),
      value: z.string().describe('要设置的值')
    }),
    // 获取哈希表中的所有字段
    z.object({
      operation: z.literal('hgetall'),
      key: z.string().min(1, { message: '哈希表键名不能为空' }).describe('哈希表的键名')
    })
  ]),
  
  execute: async (params) => {
    try {
      // 根据操作类型执行不同的 Redis 命令
      switch (params.operation) {
        case 'get': {
          const value = await redisClient.get(params.key)
          return {
            success: true,
            data: value,
            message: value ? `成功获取键 ${params.key} 的值` : `键 ${params.key} 不存在或值为 null`
          }
        }
        
        case 'set': {
          let result
          if (params.expiry) {
            // 设置带过期时间的键值
            result = await redisClient.set(params.key, params.value, 'EX', params.expiry)
          } else {
            // 设置不带过期时间的键值
            result = await redisClient.set(params.key, params.value)
          }
          return {
            success: result === 'OK',
            message: result === 'OK' 
              ? `成功设置键 ${params.key} 的值${params.expiry ? `，过期时间为 ${params.expiry} 秒` : ''}` 
              : `设置键 ${params.key} 失败`
          }
        }
        
        case 'del': {
          const count = await redisClient.del(params.key)
          return {
            success: true,
            data: count,
            message: count > 0 ? `成功删除键 ${params.key}` : `键 ${params.key} 不存在或删除失败`
          }
        }
        
        case 'keys': {
          const keys = await redisClient.keys(params.pattern)
          return {
            success: true,
            data: keys,
            message: `找到 ${keys.length} 个匹配的键`
          }
        }
        
        case 'exists': {
          const exists = await redisClient.exists(params.key)
          return {
            success: true,
            data: exists === 1,
            message: exists === 1 ? `键 ${params.key} 存在` : `键 ${params.key} 不存在`
          }
        }
        
        case 'hget': {
          const value = await redisClient.hget(params.key, params.field)
          return {
            success: true,
            data: value,
            message: value ? `成功获取哈希表 ${params.key} 中字段 ${params.field} 的值` : `字段不存在或值为 null`
          }
        }
        
        case 'hset': {
          const result = await redisClient.hset(params.key, params.field, params.value)
          return {
            success: true,
            data: result,
            message: `成功设置哈希表 ${params.key} 中字段 ${params.field} 的值`
          }
        }
        
        case 'hgetall': {
          const values = await redisClient.hgetall(params.key)
          return {
            success: true,
            data: values,
            message: Object.keys(values).length > 0 
              ? `成功获取哈希表 ${params.key} 中的所有字段` 
              : `哈希表 ${params.key} 不存在或为空`
          }
        }
        
        default: {
          return {
            success: false,
            message: `不支持的操作: ${(params as any).operation}`
          }
        }
      }
    } catch (error) {
      // 处理错误情况
      let errorMessage = '操作 Redis 失败。'
      if (error instanceof Error) {
        errorMessage = `操作 Redis 失败: ${error.message}`
      }
      
      return { 
        success: false, 
        message: errorMessage, 
        error: error instanceof Error ? error.toString() : String(error)
      }
    }
  }
}

// 使用示例：
// redisTool.execute({
//   operation: 'set',
//   key: 'test-key',
//   value: 'test-value'
// })
//
// redisTool.execute({
//   operation: 'get',
//   key: 'test-key'
// })