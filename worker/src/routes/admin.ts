import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import type { Bindings, User } from '../types';
import { getPasskeyById } from '../lib/passkeys';
import { 
  successResponse, 
  errors, 
  errorResponse,
  createLogger,
  HTTP_STATUS,
  ERROR_CODES,
  getCurrentTimestamp 
} from '../lib/api-utils';
import { executeTransaction } from '../lib/db-utils';
import { createMiddleware } from 'hono/factory';
import { AuthVariables } from '../auth/middleware';

const logger = createLogger('AdminRoute');

// 常量定义
const ADMIN_SESSION_TTL = 86400; // 24小时
const CHALLENGE_TTL = 300; // 5分钟

// ============ 验证 Schema ============

const pinSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '至少选择一个帖子'),
  isPinned: z.boolean(),
});

const moveSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '至少选择一个帖子'),
  targetNodeId: z.number().int().positive('目标版块ID必须为正整数'),
});

const deleteThreadsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '至少选择一个帖子'),
});

const deleteRepliesSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '至少选择一个回复'),
});

const updateUserSchema = z.object({
  level: z.number().int().min(0, '等级不能为负数'),
  credits: z.number().int().min(0, '积分不能为负数'),
  role: z.enum(['user', 'admin'], {
    errorMap: () => ({ message: '角色必须是 user 或 admin' }),
  }),
});

// ============ 中间件 ============

// 管理员认证中间件
export const adminAuthMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AuthVariables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader) {
      return errors.unauthorized(c, '缺少 Authorization 请求头');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return errors.unauthorized(c, 'Authorization 格式无效，应为 Bearer <token>');
    }

    const token = parts[1];
    if (!token) {
      return errors.unauthorized(c, '缺少认证令牌');
    }

    // 从 KV 获取用户ID
    const userId = await c.env.KV_SESSIONS.get(`session:${token}`);
    if (!userId) {
      logger.warn('Invalid session token', { token: token.substring(0, 8) + '...' });
      return errors.unauthorized(c, '会话已过期或无效');
    }

    // 获取用户信息
    const user = await c.env.DB.prepare('SELECT * FROM Users WHERE id = ?')
      .bind(userId)
      .first<User>();

    if (!user) {
      // 清理无效会话
      await c.env.KV_SESSIONS.delete(`session:${token}`);
      return errors.unauthorized(c, '用户不存在');
    }

    // 检查管理员权限
    if (user.role !== 'admin' && user.username !== 'admin') {
      logger.warn('Non-admin user attempted admin access', { userId: user.id, username: user.username });
      return errors.forbidden(c, '需要管理员权限');
    }

    c.set('user', user);
    await next();
  }
);

const app = new Hono<{ Bindings: Bindings }>();

// ============ 辅助函数 ============

// 获取 RP ID
function getRpID(c: Hono.Context<{ Bindings: Bindings }>): string {
  return c.env.RP_ID || new URL(c.req.url).hostname;
}

// 获取 Origin
function getOrigin(c: Hono.Context<{ Bindings: Bindings }>): string {
  return c.env.ORIGIN || new URL(c.req.url).origin;
}

// 从客户端数据中提取 challenge
function extractChallenge(response: AuthenticationResponseJSON): string | null {
  try {
    const clientDataJSON = response.response.clientDataJSON;
    const clientData = JSON.parse(
      new TextDecoder().decode(
        typeof clientDataJSON === 'string'
          ? Uint8Array.from(atob(clientDataJSON.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
          : new Uint8Array(clientDataJSON)
      )
    );
    return clientData.challenge;
  } catch (error) {
    logger.error('Failed to extract challenge', error);
    return null;
  }
}

// ============ 管理员登录路由 ============

// 生成登录挑战
app.post('/login/challenge', async (c) => {
  const rpID = getRpID(c);

  try {
    logger.info('Generating admin login challenge');

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });

    await c.env.KV_SESSIONS.put(`challenge:${options.challenge}`, 'true', { 
      expirationTtl: CHALLENGE_TTL 
    });

    logger.info('Admin login challenge generated');
    return successResponse(c, options);
  } catch (error) {
    logger.error('Failed to generate admin login challenge', error);
    return errors.internal(c, '生成登录挑战失败');
  }
});

// 验证登录响应
app.post('/login/verify', async (c) => {
  let response: AuthenticationResponseJSON;
  
  try {
    response = await c.req.json<AuthenticationResponseJSON>();
    
    if (!response) {
      return errors.validation(c, { response: '缺少响应数据' });
    }
  } catch (error) {
    return errors.validation(c, { body: '无效的请求体' });
  }

  const challenge = extractChallenge(response);
  
  if (!challenge) {
    return errors.validation(c, { challenge: '无法提取 challenge' });
  }

  // 验证 challenge
  const expectedChallenge = await c.env.KV_SESSIONS.get(`challenge:${challenge}`);
  if (!expectedChallenge) {
    return errorResponse(
      c,
      '挑战已过期或不存在',
      ERROR_CODES.AUTH_SESSION_EXPIRED,
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // 获取 passkey
  const passkey = await getPasskeyById(c.env.DB, response.id);
  if (!passkey) {
    return errors.notFound(c, '凭证');
  }

  const expectedRPID = getRpID(c);
  const expectedOrigin = getOrigin(c);

  try {
    logger.info('Verifying admin login', { passkeyId: passkey.id });

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID,
      authenticator: {
        credentialID: passkey.id,
        credentialPublicKey: new Uint8Array(passkey.pubkey_blob),
        counter: passkey.sign_counter,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return errorResponse(
        c,
        '验证失败',
        ERROR_CODES.AUTH_UNAUTHORIZED,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // 检查用户是否为管理员
    const user = await c.env.DB.prepare('SELECT * FROM Users WHERE id = ?')
      .bind(passkey.user_id)
      .first<User>();

    if (!user || (user.role !== 'admin' && user.username !== 'admin')) {
      logger.warn('Non-admin user attempted admin login', { userId: passkey.user_id });
      return errors.forbidden(c, '需要管理员权限');
    }

    // 更新签名计数器
    await c.env.DB.prepare('UPDATE Passkeys SET sign_counter = ? WHERE id = ?')
      .bind(verification.authenticationInfo.newCounter, passkey.id)
      .run();

    // 删除 challenge
    await c.env.KV_SESSIONS.delete(`challenge:${challenge}`);

    // 创建管理员会话
    const token = crypto.randomUUID();
    await c.env.KV_SESSIONS.put(`session:${token}`, user.id, { 
      expirationTtl: ADMIN_SESSION_TTL 
    });

    logger.info('Admin login successful', { userId: user.id });
    return successResponse(c, { verified: true, token });
  } catch (error) {
    logger.error('Failed to verify admin login', error, { passkeyId: passkey.id });
    return errorResponse(
      c,
      error instanceof Error ? error.message : '验证失败',
      ERROR_CODES.AUTH_UNAUTHORIZED,
      HTTP_STATUS.BAD_REQUEST
    );
  }
});

// ============ 受保护的管理员路由 ============

// 应用管理员认证中间件
app.use('/stats/*', adminAuthMiddleware);
app.use('/users/*', adminAuthMiddleware);
app.use('/threads/*', adminAuthMiddleware);
app.use('/replies/*', adminAuthMiddleware);

// 获取统计信息
app.get('/stats', async (c) => {
  try {
    logger.info('Fetching admin statistics');

    const db = c.env.DB;
    
    const [userCount, threadCount, replyCount, commentCount] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM Users').first<{ count: number }>(),
      db.prepare('SELECT COUNT(*) as count FROM Threads').first<{ count: number }>(),
      db.prepare('SELECT COUNT(*) as count FROM Replies').first<{ count: number }>(),
      db.prepare('SELECT COUNT(*) as count FROM Comments').first<{ count: number }>(),
    ]);

    const stats = {
      userCount: userCount?.count || 0,
      threadCount: threadCount?.count || 0,
      replyCount: replyCount?.count || 0,
      commentCount: commentCount?.count || 0,
    };

    logger.info('Admin statistics fetched', stats);
    return successResponse(c, stats);
  } catch (error) {
    logger.error('Failed to fetch admin statistics', error);
    return errors.internal(c, '获取统计信息失败');
  }
});

// 获取/搜索用户列表
app.get('/users', async (c) => {
  const { username, email, uid, page = '1', limit = '20' } = c.req.query();
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  try {
    logger.info('Fetching users', { username, email, uid, page: pageNum, limit: limitNum });

    let query = 'SELECT id, username, email, created_at, role, level FROM Users';
    let countQuery = 'SELECT COUNT(*) as count FROM Users';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (username) {
      conditions.push('username LIKE ?');
      params.push(`%${username}%`);
    }
    if (email) {
      conditions.push('email LIKE ?');
      params.push(`%${email}%`);
    }
    if (uid) {
      conditions.push('id = ?');
      params.push(uid);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    query += whereClause + ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    countQuery += whereClause;

    const [usersResult, countResult] = await Promise.all([
      c.env.DB.prepare(query).bind(...params, limitNum, offset).all<{
        id: string;
        username: string;
        email: string;
        created_at: number;
        role: string;
        level: number;
      }>(),
      c.env.DB.prepare(countQuery).bind(...params).first<{ count: number }>(),
    ]);

    const total = countResult?.count || 0;
    const users = usersResult.results || [];

    logger.info('Users fetched successfully', { count: users.length, total });
    return successResponse(c, {
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        hasMore: offset + users.length < total,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch users', error, { username, email, uid });
    return errors.internal(c, '获取用户列表失败');
  }
});

// 获取单个用户详情
app.get('/users/:id', async (c) => {
  const { id } = c.req.param();

  try {
    logger.info('Fetching user details', { userId: id });

    const user = await c.env.DB.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.email, 
        u.created_at, 
        u.role, 
        u.level, 
        c.balance as credits
      FROM Users u
      LEFT JOIN Credits c ON u.id = c.user_id
      WHERE u.id = ?
    `).bind(id).first<{
      id: string;
      username: string;
      email: string;
      created_at: number;
      role: string;
      level: number;
      credits: number;
    }>();

    if (!user) {
      return errors.notFound(c, '用户');
    }

    logger.info('User details fetched', { userId: id });
    return successResponse(c, user);
  } catch (error) {
    logger.error('Failed to fetch user details', error, { userId: id });
    return errors.internal(c, '获取用户详情失败');
  }
});

// 更新用户信息
app.put('/users/:id', zValidator('json', updateUserSchema), async (c) => {
  const { id } = c.req.param();
  const { level, credits, role } = c.req.valid('json');

  try {
    logger.info('Updating user', { userId: id, level, credits, role });

    await executeTransaction(c.env.DB, [
      c.env.DB.prepare('UPDATE Users SET level = ?, role = ? WHERE id = ?')
        .bind(level, role, id),
      c.env.DB.prepare(`
        INSERT OR REPLACE INTO Credits (user_id, balance, last_updated) 
        VALUES (?, ?, ?)
      `).bind(id, credits, getCurrentTimestamp()),
    ]);

    logger.info('User updated successfully', { userId: id });
    return successResponse(c, null, '用户更新成功');
  } catch (error) {
    logger.error('Failed to update user', error, { userId: id });
    return errors.internal(c, '更新用户失败');
  }
});

// 获取/搜索帖子列表
app.get('/threads', async (c) => {
  const { keyword, author, nodeId, page = '1', limit = '20' } = c.req.query();
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  try {
    logger.info('Fetching threads for admin', { keyword, author, nodeId, page: pageNum });

    let query = `
      SELECT 
        t.id, 
        t.title, 
        u.id as author_id, 
        u.username as author, 
        t.created_at, 
        t.reply_count, 
        t.view_count, 
        t.is_pinned, 
        t.node_id, 
        n.name as node_name
      FROM Threads t 
      JOIN Users u ON t.author_id = u.id 
      JOIN Nodes n ON n.id = t.node_id
    `;
    
    let countQuery = 'SELECT COUNT(*) as count FROM Threads t JOIN Users u ON t.author_id = u.id';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (keyword) {
      conditions.push('(t.title LIKE ? OR t.body LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (author) {
      conditions.push('t.author_id = ?');
      params.push(author);
    }
    if (nodeId) {
      conditions.push('t.node_id = ?');
      params.push(parseInt(nodeId, 10));
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    query += whereClause + ' ORDER BY t.is_pinned DESC, t.created_at DESC LIMIT ? OFFSET ?';
    countQuery += whereClause;

    const [threadsResult, countResult] = await Promise.all([
      c.env.DB.prepare(query).bind(...params, limitNum, offset).all(),
      c.env.DB.prepare(countQuery).bind(...params).first<{ count: number }>(),
    ]);

    const total = countResult?.count || 0;
    const threads = threadsResult.results || [];

    logger.info('Threads fetched for admin', { count: threads.length, total });
    return successResponse(c, {
      threads,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        hasMore: offset + threads.length < total,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch threads for admin', error, { keyword, author });
    return errors.internal(c, '获取帖子列表失败');
  }
});

// 置顶/取消置顶帖子
app.put('/threads/pin', zValidator('json', pinSchema), async (c) => {
  const { ids, isPinned } = c.req.valid('json');

  try {
    logger.info('Updating thread pin status', { count: ids.length, isPinned });

    const placeholders = ids.map(() => '?').join(',');
    await c.env.DB.prepare(`UPDATE Threads SET is_pinned = ? WHERE id IN (${placeholders})`)
      .bind(isPinned, ...ids)
      .run();

    const action = isPinned ? '置顶' : '取消置顶';
    logger.info('Thread pin status updated', { count: ids.length, action });
    return successResponse(c, null, `成功${action} ${ids.length} 个帖子`);
  } catch (error) {
    logger.error('Failed to update thread pin status', error, { count: ids.length });
    return errors.internal(c, '更新帖子置顶状态失败');
  }
});

// 移动帖子
app.put('/threads/move', zValidator('json', moveSchema), async (c) => {
  const { ids, targetNodeId } = c.req.valid('json');
  const db = c.env.DB;

  try {
    logger.info('Moving threads', { count: ids.length, targetNodeId });

    // 获取所有待移动帖子的信息
    const placeholders = ids.map(() => '?').join(',');
    const { results: threadsToMove } = await db.prepare(`
      SELECT id, node_id, reply_count 
      FROM Threads 
      WHERE id IN (${placeholders})
    `).bind(...ids).all<{ id: number; node_id: number; reply_count: number }>();

    if (!threadsToMove || threadsToMove.length === 0) {
      return errors.notFound(c, '帖子');
    }

    // 计算需要更新的统计数据
    const sourceNodeUpdates = new Map<number, { thread_decrement: number; reply_decrement: number }>();
    let targetThreadIncrement = 0;
    let targetReplyIncrement = 0;

    for (const thread of threadsToMove) {
      if (thread.node_id !== targetNodeId) {
        const sourceStats = sourceNodeUpdates.get(thread.node_id) || { thread_decrement: 0, reply_decrement: 0 };
        sourceStats.thread_decrement += 1;
        sourceStats.reply_decrement += thread.reply_count;
        sourceNodeUpdates.set(thread.node_id, sourceStats);

        targetThreadIncrement += 1;
        targetReplyIncrement += thread.reply_count;
      }
    }

    // 构建批量更新语句
    const batchStatements = [];

    // 源版块计数减少
    for (const [nodeId, stats] of sourceNodeUpdates.entries()) {
      batchStatements.push(
        db.prepare(`
          UPDATE Nodes 
          SET thread_count = thread_count - ?, reply_count = reply_count - ? 
          WHERE id = ?
        `).bind(stats.thread_decrement, stats.reply_decrement, nodeId)
      );
    }

    // 目标版块计数增加
    if (targetThreadIncrement > 0) {
      batchStatements.push(
        db.prepare(`
          UPDATE Nodes 
          SET thread_count = thread_count + ?, reply_count = reply_count + ? 
          WHERE id = ?
        `).bind(targetThreadIncrement, targetReplyIncrement, targetNodeId)
      );
    }

    // 移动帖子
    batchStatements.push(
      db.prepare(`UPDATE Threads SET node_id = ? WHERE id IN (${placeholders})`)
        .bind(targetNodeId, ...ids)
    );

    await executeTransaction(db, batchStatements);

    logger.info('Threads moved successfully', { count: ids.length, targetNodeId });
    return successResponse(c, null, `成功移动 ${ids.length} 个帖子`);
  } catch (error) {
    logger.error('Failed to move threads', error, { count: ids.length, targetNodeId });
    return errors.internal(c, '移动帖子失败');
  }
});

// 删除帖子
app.delete('/threads', zValidator('json', deleteThreadsSchema), async (c) => {
  const { ids } = c.req.valid('json');
  const db = c.env.DB;

  try {
    logger.info('Deleting threads', { count: ids.length });

    // 获取帖子信息用于更新统计
    const placeholders = ids.map(() => '?').join(',');
    const { results: threadsToDelete } = await db.prepare(`
      SELECT node_id, reply_count 
      FROM Threads 
      WHERE id IN (${placeholders})
    `).bind(...ids).all<{ node_id: number; reply_count: number }>();

    if (!threadsToDelete || threadsToDelete.length === 0) {
      return errors.notFound(c, '帖子');
    }

    // 按版块聚合统计
    const nodeStatUpdates = new Map<number, { thread_decrement: number; reply_decrement: number }>();
    for (const thread of threadsToDelete) {
      const stats = nodeStatUpdates.get(thread.node_id) || { thread_decrement: 0, reply_decrement: 0 };
      stats.thread_decrement += 1;
      stats.reply_decrement += thread.reply_count;
      nodeStatUpdates.set(thread.node_id, stats);
    }

    // 构建批量更新语句
    const batchStatements = [];

    for (const [nodeId, stats] of nodeStatUpdates.entries()) {
      batchStatements.push(
        db.prepare(`
          UPDATE Nodes 
          SET thread_count = thread_count - ?, reply_count = reply_count - ? 
          WHERE id = ?
        `).bind(stats.thread_decrement, stats.reply_decrement, nodeId)
      );
    }

    // 删除帖子（依赖 ON DELETE CASCADE 删除相关回复）
    batchStatements.push(
      db.prepare(`DELETE FROM Threads WHERE id IN (${placeholders})`).bind(...ids)
    );

    await executeTransaction(db, batchStatements);

    logger.info('Threads deleted successfully', { count: ids.length });
    return successResponse(c, null, `成功删除 ${ids.length} 个帖子及其所有回复`);
  } catch (error) {
    logger.error('Failed to delete threads', error, { count: ids.length });
    return errors.internal(c, '删除帖子失败');
  }
});

// 获取回复列表
app.get('/replies', async (c) => {
  const { keyword, author, threadId, page = '1', limit = '20' } = c.req.query();
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  try {
    logger.info('Fetching replies for admin', { keyword, author, threadId, page: pageNum });

    let query = `
      SELECT 
        r.id, 
        r.body, 
        r.created_at,
        u.id as author_id, 
        u.username as author,
        t.id as thread_id, 
        t.title as thread_title,
        t.node_id as node_id,
        n.name as node_name
      FROM Replies r
      JOIN Users u ON r.author_id = u.id
      JOIN Threads t ON r.thread_id = t.id
      JOIN Nodes n ON t.node_id = n.id
    `;
    
    let countQuery = `
      SELECT COUNT(*) as count 
      FROM Replies r
      JOIN Users u ON r.author_id = u.id
      JOIN Threads t ON r.thread_id = t.id
    `;
    
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (keyword) {
      conditions.push('r.body LIKE ?');
      params.push(`%${keyword}%`);
    }
    if (author) {
      conditions.push('r.author_id = ?');
      params.push(author);
    }
    if (threadId) {
      conditions.push('r.thread_id = ?');
      params.push(parseInt(threadId, 10));
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    query += whereClause + ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    countQuery += whereClause;

    const [repliesResult, countResult] = await Promise.all([
      c.env.DB.prepare(query).bind(...params, limitNum, offset).all(),
      c.env.DB.prepare(countQuery).bind(...params).first<{ count: number }>(),
    ]);

    const total = countResult?.count || 0;
    const replies = repliesResult.results || [];

    logger.info('Replies fetched for admin', { count: replies.length, total });
    return successResponse(c, {
      replies,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        hasMore: offset + replies.length < total,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch replies for admin', error, { keyword, author });
    return errors.internal(c, '获取回复列表失败');
  }
});

// 删除回复
app.delete('/replies', zValidator('json', deleteRepliesSchema), async (c) => {
  const { ids } = c.req.valid('json');

  try {
    logger.info('Deleting replies', { count: ids.length });

    const placeholders = ids.map(() => '?').join(',');
    await c.env.DB.prepare(`DELETE FROM Replies WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run();

    logger.info('Replies deleted successfully', { count: ids.length });
    return successResponse(c, null, `成功删除 ${ids.length} 个回复`);
  } catch (error) {
    logger.error('Failed to delete replies', error, { count: ids.length });
    return errors.internal(c, '删除回复失败');
  }
});

export default app;
