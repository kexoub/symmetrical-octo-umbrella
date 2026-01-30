import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { Bindings } from './types';
import auth from './routes/auth';
import nodes from './routes/nodes';
import threads from './routes/threads';
import comments from './routes/comments';
import users from './routes/users';
import messages from './routes/messages';
import reminders from './routes/reminders';
import search from './routes/search';
import rankings from './routes/rankings';
import images from './routes/images';
import attachments from './routes/attachments';
import config from './routes/config';
import admin from './routes/admin';
import adminNodes from './routes/adminNodes';
import adminUserGroups from './routes/adminUserGroups';
import adminSettings from './routes/adminSettings';
import { tryAuthMiddleware } from './auth/tryAuthMiddleware';
import { createS3Client } from './lib/s3';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', logger());
app.use('/api/*', cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:8787', 'https://serverless-bbs.pages.dev', 'https://*.serverless-bbs.pages.dev', 'https://serverless-bbs.anquanssl.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 31560000,
}));

const api = new Hono();

app.use('*', tryAuthMiddleware);

api.route('/auth', auth);
api.route('/nodes', nodes);
api.route('/threads', threads);
api.route('/comments', comments);
api.route('/users', users);
api.route('/messages', messages);
api.route('/reminders', reminders);
api.route('/search', search);
api.route('/rankings', rankings);
api.route('/images', images);
api.route('/attachments', attachments);
api.route('/config', config);
api.route('/admin', admin);
api.route('/admin/nodes', adminNodes);
api.route('/admin/groups', adminUserGroups);
api.route('/admin/settings', adminSettings);

app.route('/api', api);

// S3 文件访问路由 - 通过服务器代理访问S3文件
app.get('/s3/:key{.+$}', async (c) => {
  const key = c.req.param('key');
  
  try {
    const s3 = createS3Client(c.env);
    const object = await s3.get(key);
    
    if (!object || !object.body) {
      return c.notFound();
    }
    
    // 设置响应头
    const headers = new Headers();
    headers.set('Content-Type', object.contentType);
    headers.set('Content-Length', String(object.size));
    headers.set('Cache-Control', 'public, max-age=31536000'); // 缓存1年
    
    return new Response(object.body, { headers });
  } catch (error) {
    console.error('S3 fetch error:', error);
    return c.json({ error: 'Failed to fetch file' }, 500);
  }
});

app.all('*', async (c) => {
  return c.env.ASSETS.fetch(<any> c.req);
});

app.onError((err, c) => {
  console.error(`${err}`);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
