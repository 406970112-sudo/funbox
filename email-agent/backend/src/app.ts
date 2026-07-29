import Koa from 'koa';
import * as bodyParser from 'koa-bodyparser';
import router from './routes';
import './types'; // 加载类型扩展
import 'dotenv/config'

const app = new Koa();

// 中间件
app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());

// 启动服务器
const PORT = process.env.PORT || 1234;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(Number(PORT), HOST, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
