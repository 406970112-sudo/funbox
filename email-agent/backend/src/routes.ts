import * as Router from '@koa/router';
import type { Context } from 'koa';
import type { ApiResponse, PostBody } from './types';
import email from './agent/email'
import { sendEmailTool } from './agent/tools/sendEmail.js'
// import { redisTool } from './agent/tools/db'
import { PassThrough } from 'stream'
import { statSync } from 'fs'
import { join } from 'path'
import * as emailList from './agent/email_address.json'

interface RecipientDirectoryItem {
  bank: string
  name: string
  address: string[]
  cc_address: string[]
}

const recipientDirectory = emailList as unknown as RecipientDirectoryItem[]
const recipientDirectoryUpdatedAt = statSync(
  join(__dirname, 'agent', 'email_address.json')
).mtime.toISOString()

const router = new Router({
  prefix: '/api'
});

// 测试 POST 接口
router.post('/agent',
  async (ctx: Context) => {
    ctx.request.socket.setTimeout(0)
    ctx.request.socket.setNoDelay(true)
    ctx.request.socket.setKeepAlive(true)
    ctx.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      // eslint-disable-next-line quote-props
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })

    const stream = new PassThrough()
    ctx.status = 200
    ctx.body = stream

    try {
      const { messages } = ctx.request.body as any
      await email(messages, stream)
    } catch (error) {
      // eslint-disable-next-line dxnode/no-console
      console.log(error)
    } finally {
      stream.end()
    }
  });

// 根路由测试
router.get('/', (ctx: Context) => {
  ctx.body = 'Koa with TypeScript is running!';
});

router.get('/recipients', (ctx: Context) => {
  ctx.body = {
    data: recipientDirectory,
    updatedAt: recipientDirectoryUpdatedAt
  }
});

export default router;
