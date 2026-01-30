import { Hono } from 'hono';
import type { Bindings } from '../types';

/**
 * D1 数据库使用示例路由
 * 展示各种常见的数据库操作模式
 */
const app = new Hono<{ Bindings: Bindings }>();

/**
 * 示例 1: 基本查询
 * GET /examples/basic-query
 */
app.get('/basic-query', async (c) => {
  // 查询单个用户
  const user = await c.env.DB.prepare(
    'SELECT id, username, email, created_at FROM Users WHERE id = ?'
  ).bind('user-123').first();

  if (!user) {
    return c.json({ error: '用户不存在' }, 404);
  }

  return c.json({ user });
});

/**
 * 示例 2: 列表查询（带分页）
 * GET /examples/list-query?page=1&limit=20
 */
app.get('/list-query', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100); // 最大100条
  const offset = (page - 1) * limit;

  // 查询数据
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, avatar, created_at FROM Users ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all();

  // 查询总数
  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM Users'
  ).first<{ total: number }>();

  return c.json({
    data: results,
    pagination: {
      page,
      limit,
      total: countResult?.total || 0,
      totalPages: Math.ceil((countResult?.total || 0) / limit)
    }
  });
});

/**
 * 示例 3: 关联查询（JOIN）
 * GET /examples/join-query
 */
app.get('/join-query', async (c) => {
  // 查询帖子及其作者信息
  const { results } = await c.env.DB.prepare(`
    SELECT 
      t.id,
      t.title,
      t.body,
      t.created_at,
      t.view_count,
      t.reply_count,
      u.id as author_id,
      u.username as author_username,
      u.avatar as author_avatar,
      n.name as node_name
    FROM Threads t
    JOIN Users u ON t.author_id = u.id
    JOIN Nodes n ON t.node_id = n.id
    WHERE t.is_pinned = 0 AND t.is_locked = 0
    ORDER BY t.last_reply_at DESC
    LIMIT 10
  `).all();

  return c.json({ threads: results });
});

/**
 * 示例 4: 插入数据
 * POST /examples/insert
 */
app.post('/insert', async (c) => {
  const body = await c.req.json();
  const { username, email } = body;

  const userId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO Users (id, username, email, created_at, level, role) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(userId, username, email, now, 1, 'user').run();

    if (!result.success) {
      return c.json({ error: '插入失败' }, 500);
    }

    return c.json({
      success: true,
      userId,
      message: '用户创建成功'
    }, 201);
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: '用户名或邮箱已存在' }, 409);
    }
    throw error;
  }
});

/**
 * 示例 5: 更新数据
 * PUT /examples/update/:id
 */
app.put('/update/:id', async (c) => {
  const userId = c.req.param('id');
  const body = await c.req.json();
  const { username, profile_bio } = body;

  // 检查用户是否存在
  const existing = await c.env.DB.prepare(
    'SELECT id FROM Users WHERE id = ?'
  ).bind(userId).first();

  if (!existing) {
    return c.json({ error: '用户不存在' }, 404);
  }

  // 构建动态更新语句
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (username !== undefined) {
    updates.push('username = ?');
    values.push(username);
  }
  if (profile_bio !== undefined) {
    updates.push('profile_bio = ?');
    values.push(profile_bio);
  }

  if (updates.length === 0) {
    return c.json({ error: '没有要更新的字段' }, 400);
  }

  values.push(userId);

  const result = await c.env.DB.prepare(
    `UPDATE Users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return c.json({
    success: true,
    updated: result.meta.changes > 0
  });
});

/**
 * 示例 6: 删除数据
 * DELETE /examples/delete/:id
 */
app.delete('/delete/:id', async (c) => {
  const userId = c.req.param('id');

  // 软删除：更新状态而不是真正删除
  const result = await c.env.DB.prepare(
    'UPDATE Users SET role = ? WHERE id = ?'
  ).bind('deleted', userId).run();

  if (result.meta.changes === 0) {
    return c.json({ error: '用户不存在' }, 404);
  }

  return c.json({
    success: true,
    message: '用户已删除'
  });
});

/**
 * 示例 7: 批量插入
 * POST /examples/batch-insert
 */
app.post('/batch-insert', async (c) => {
  const body = await c.req.json();
  const { users } = body; // 用户数组

  if (!Array.isArray(users) || users.length === 0) {
    return c.json({ error: '请提供用户数组' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  // 构建批量插入语句
  const stmts = users.map(user =>
    c.env.DB.prepare(
      'INSERT INTO Users (id, username, email, created_at, level, role) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      user.username,
      user.email,
      now,
      1,
      'user'
    )
  );

  try {
    const results = await c.env.DB.batch(stmts);

    return c.json({
      success: true,
      inserted: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (error: any) {
    return c.json({ error: '批量插入失败', details: error.message }, 500);
  }
});

/**
 * 示例 8: 事务处理
 * POST /examples/transaction
 */
app.post('/transaction', async (c) => {
  const body = await c.req.json();
  const { nodeId, title, body: threadBody, authorId } = body;

  const threadId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  try {
    // 开始事务
    await c.env.DB.prepare('BEGIN TRANSACTION').run();

    // 1. 插入帖子
    await c.env.DB.prepare(
      'INSERT INTO Threads (id, node_id, author_id, title, body, created_at, view_count, reply_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(threadId, nodeId, authorId, title, threadBody, now, 0, 0).run();

    // 2. 更新版块帖子计数
    await c.env.DB.prepare(
      'UPDATE Nodes SET thread_count = thread_count + 1 WHERE id = ?'
    ).bind(nodeId).run();

    // 3. 更新用户发帖数（如果有这个字段）
    // await c.env.DB.prepare('UPDATE Users SET thread_count = thread_count + 1 WHERE id = ?').bind(authorId).run();

    // 提交事务
    await c.env.DB.prepare('COMMIT').run();

    return c.json({
      success: true,
      threadId,
      message: '帖子创建成功'
    }, 201);
  } catch (error) {
    // 回滚事务
    await c.env.DB.prepare('ROLLBACK').run();
    throw error;
  }
});

/**
 * 示例 9: 聚合查询
 * GET /examples/aggregate
 */
app.get('/aggregate', async (c) => {
  // 统计信息
  const stats = await c.env.DB.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM Users) as total_users,
      (SELECT COUNT(*) FROM Threads) as total_threads,
      (SELECT COUNT(*) FROM Replies) as total_replies,
      (SELECT COUNT(*) FROM Nodes) as total_nodes,
      (SELECT COUNT(*) FROM Users WHERE created_at > ?) as new_users_today
  `).bind(Math.floor(Date.now() / 1000) - 86400).first();

  // 热门版块
  const hotNodes = await c.env.DB.prepare(`
    SELECT 
      n.id,
      n.name,
      n.thread_count,
      n.reply_count,
      (n.thread_count + n.reply_count) as total_activity
    FROM Nodes n
    ORDER BY total_activity DESC
    LIMIT 5
  `).all();

  return c.json({
    stats,
    hotNodes: hotNodes.results
  });
});

/**
 * 示例 10: 搜索查询
 * GET /examples/search?q=关键词
 */
app.get('/search', async (c) => {
  const query = c.req.query('q');

  if (!query || query.trim().length < 2) {
    return c.json({ error: '搜索关键词至少需要2个字符' }, 400);
  }

  const searchTerm = `%${query.trim()}%`;

  // 搜索帖子
  const { results: threads } = await c.env.DB.prepare(`
    SELECT 
      t.id,
      t.title,
      t.created_at,
      u.username as author_username
    FROM Threads t
    JOIN Users u ON t.author_id = u.id
    WHERE t.title LIKE ? OR t.body LIKE ?
    ORDER BY t.created_at DESC
    LIMIT 20
  `).bind(searchTerm, searchTerm).all();

  // 搜索用户
  const { results: users } = await c.env.DB.prepare(`
    SELECT id, username, avatar
    FROM Users
    WHERE username LIKE ?
    LIMIT 10
  `).bind(searchTerm).all();

  return c.json({
    query: query.trim(),
    threads,
    users
  });
});

export default app;
