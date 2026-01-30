import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware';
import { 
  successResponse, 
  errors, 
  createLogger, 
  HTTP_STATUS,
  ERROR_CODES,
  getCurrentTimestamp 
} from '../lib/api-utils';
import { executeTransaction } from '../lib/db-utils';
import type { 
  Bindings, 
  Thread, 
  ThreadWithAuthor, 
  ReplyWithAuthor, 
  Reply, 
  User, 
  PollOption, 
  UserVote, 
  ThreadWithDetails 
} from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>();
const logger = createLogger('ThreadsRoute');

// 常量定义
const DEFAULT_PAGE_SIZE = 20;
const MIN_TITLE_LENGTH = 2;
const MIN_BODY_LENGTH = 10;

// ============ 验证 Schema ============

const listThreadsSchema = z.object({
  nodeId: z.string().transform((val) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) throw new Error('Invalid nodeId');
    return num;
  }),
  page: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 ? 1 : num;
  }).default('1'),
});

const createThreadSchema = z.object({
  nodeId: z.number().int().positive('版块ID必须为正整数'),
  title: z.string().min(MIN_TITLE_LENGTH, `标题至少需要${MIN_TITLE_LENGTH}个字符`),
  body: z.string().min(MIN_BODY_LENGTH, `内容至少需要${MIN_BODY_LENGTH}个字符`),
  type: z.enum(['discussion', 'poll']),
  readPermission: z.number().int().min(0, '阅读权限不能为负数'),
  pollOptions: z.array(z.string().min(1, '选项不能为空')).optional(),
  isAuthorOnly: z.boolean().optional(),
});

const updateThreadSchema = z.object({
  title: z.string().min(5, '标题至少需要5个字符'),
  body: z.string().min(10, '内容至少需要10个字符'),
});

const voteSchema = z.object({
  optionId: z.number().int().positive('选项ID必须为正整数'),
});

const createReplySchema = z.object({
  body: z.string().min(1, '回复内容不能为空'),
  replyToId: z.number().int().positive().nullable(),
});

const updateReplySchema = z.object({
  body: z.string().min(1, '回复内容不能为空'),
});

// ============ 辅助函数 ============

// 检查用户是否有权限编辑帖子
async function checkThreadEditPermission(
  db: D1Database,
  threadId: number,
  user: User
): Promise<{ allowed: boolean; thread?: { author_id: string } }> {
  const thread = await db
    .prepare('SELECT author_id FROM Threads WHERE id = ?')
    .bind(threadId)
    .first<{ author_id: string }>();

  if (!thread) {
    return { allowed: false };
  }

  const isAuthor = thread.author_id === user.id;
  const isAdmin = user.role === 'admin';

  return { allowed: isAuthor || isAdmin, thread };
}

// 检查用户是否有权限编辑回复
async function checkReplyEditPermission(
  db: D1Database,
  replyId: number,
  user: User
): Promise<{ allowed: boolean; reply?: Reply }> {
  const reply = await db
    .prepare('SELECT * FROM Replies WHERE id = ?')
    .bind(replyId)
    .first<Reply>();

  if (!reply) {
    return { allowed: false };
  }

  const isAuthor = reply.author_id === user.id;
  const isModerator = ['admin', 'moderator'].includes(user.role);

  return { allowed: isAuthor || isModerator, reply };
}

// 检查用户是否有权限查看帖子内容
function canViewThreadContent(thread: ThreadWithAuthor, user?: User): boolean {
  if (!thread.read_permission) return true;
  if (!user) return false;
  return user.level >= thread.read_permission;
}

// 过滤作者专属回复
function filterAuthorOnlyReplies(
  replies: ReplyWithAuthor[],
  thread: ThreadWithAuthor,
  user?: User
): ReplyWithAuthor[] {
  if (!thread.is_author_only) return replies;
  if (user && user.id === thread.author_id) return replies;

  return replies.map((reply) => {
    if (!user || reply.author_id !== user.id) {
      return { ...reply, body: '[作者设置了仅作者可见]' };
    }
    return reply;
  });
}

// ============ 路由定义 ============

// 获取节点下的帖子列表
app.get('/', zValidator('query', listThreadsSchema), async (c) => {
  const { nodeId, page } = c.req.valid('query');
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;

  try {
    logger.info('Fetching threads', { nodeId, page, limit });

    const query = c.env.DB.prepare(`
      SELECT 
        t.*, 
        u.username as author_username, 
        u.avatar as author_avatar,
        last_reply_user.username as last_reply_username,
        t.reply_count, 
        t.view_count, 
        t.last_reply_at, 
        t.last_reply_id, 
        t.is_pinned
      FROM Threads t
      JOIN Users u ON t.author_id = u.id
      LEFT JOIN Users last_reply_user ON t.last_reply_user_id = last_reply_user.id
      WHERE t.node_id = ?
      ORDER BY t.is_pinned DESC, t.last_reply_at DESC, t.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(nodeId, limit, offset);

    const { results } = await query.all<ThreadWithAuthor>();
    
    logger.info('Threads fetched successfully', { count: results?.length || 0, nodeId });
    return successResponse(c, results || []);
  } catch (error) {
    logger.error('Failed to fetch threads', error, { nodeId, page });
    return errors.internal(c, '获取帖子列表失败');
  }
});

// 创建新帖子
app.post('/', authMiddleware, zValidator('json', createThreadSchema), async (c) => {
  const { nodeId, title, body, type, readPermission, isAuthorOnly, pollOptions } = c.req.valid('json');
  
  // 验证投票选项
  if (type === 'poll' && (!pollOptions || pollOptions.length < 2)) {
    return errorResponse(
      c,
      '投票至少需要2个选项',
      ERROR_CODES.INVALID_INPUT,
      HTTP_STATUS.BAD_REQUEST
    );
  }

  const user = c.get('user');
  const now = getCurrentTimestamp();
  const db = c.env.DB;

  try {
    logger.info('Creating thread', { 
      nodeId, 
      userId: user.id, 
      type, 
      hasPollOptions: !!pollOptions?.length 
    });

    // 使用事务创建帖子
    const results = await db.batch([
      db.prepare(`
        INSERT INTO Threads (
          node_id, author_id, title, body, type, read_permission, 
          is_author_only, created_at, last_reply_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(nodeId, user.id, title, body, type, readPermission, isAuthorOnly || false, now, now),
    ]);

    const newThreadId = results[0].meta.last_row_id;

    // 如果有投票选项，批量插入
    if (type === 'poll' && pollOptions && pollOptions.length > 0) {
      const pollStatements = pollOptions.map((option) =>
        db.prepare('INSERT INTO PollOptions (thread_id, option_text) VALUES (?, ?)').bind(newThreadId, option)
      );
      await db.batch(pollStatements);
    }

    logger.info('Thread created successfully', { threadId: newThreadId, userId: user.id });
    return successResponse(c, { threadId: newThreadId }, '帖子创建成功', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create thread', error, { nodeId, userId: user.id });
    return errors.internal(c, '创建帖子失败');
  }
});

// 获取单个帖子详情
app.get('/:id', async (c) => {
  const threadId = parseInt(c.req.param('id'), 10);
  
  if (isNaN(threadId) || threadId <= 0) {
    return errors.validation(c, { id: '无效的帖子ID' });
  }

  const db = c.env.DB;
  const user = c.get('user');

  try {
    logger.info('Fetching thread details', { threadId, userId: user?.id });

    // 并行查询帖子信息和权限检查
    const [threadResult] = await Promise.all([
      db.prepare(`
        SELECT t.*, u.username as author_username, u.avatar as author_avatar, u.level as author_level 
        FROM Threads t 
        JOIN Users u ON t.author_id = u.id 
        WHERE t.id = ?
      `).bind(threadId).first<ThreadWithAuthor>(),
    ]);

    if (!threadResult) {
      return errors.notFound(c, '帖子');
    }

    // 权限检查
    if (!canViewThreadContent(threadResult, user)) {
      return errors.permission(c, threadResult.read_permission);
    }

    // 并行查询投票选项、用户投票和回复
    const [pollData, repliesResult] = await Promise.all([
      // 投票数据查询
      threadResult.type === 'poll'
        ? (async () => {
            const { results: options } = await db
              .prepare('SELECT * FROM PollOptions WHERE thread_id = ?')
              .bind(threadId)
              .all<PollOption>();
            
            let userVote: UserVote | undefined;
            if (user) {
              const vote = await db
                .prepare('SELECT poll_option_id FROM PollVotes WHERE thread_id = ? AND user_id = ?')
                .bind(threadId, user.id)
                .first<UserVote>();
              userVote = vote || undefined;
            }
            
            return { options, userVote };
          })()
        : Promise.resolve({ options: undefined, userVote: undefined }),

      // 回复查询
      db.prepare(`
        SELECT 
          r.*, 
          u.username as author_username, 
          u.avatar as author_avatar,
          qr.body as quoted_body, 
          qu.username as quoted_author, 
          qr.created_at as quoted_created_at
        FROM Replies r
        JOIN Users u ON r.author_id = u.id
        LEFT JOIN Replies qr ON r.reply_to_id = qr.id
        LEFT JOIN Users qu ON qr.author_id = qu.id
        WHERE r.thread_id = ? 
        ORDER BY r.created_at ASC
      `).bind(threadId).all<ReplyWithAuthor>(),
    ]);

    // 更新浏览计数（异步，不阻塞响应）
    db.prepare('UPDATE Threads SET view_count = view_count + 1 WHERE id = ?')
      .bind(threadId)
      .run()
      .catch((err) => logger.error('Failed to update view count', err, { threadId }));

    // 过滤作者专属回复
    const filteredReplies = filterAuthorOnlyReplies(
      repliesResult.results || [],
      threadResult,
      user
    );

    const response: ThreadWithDetails = {
      ...threadResult,
      replies: filteredReplies,
      poll_options: pollData.options,
      user_vote: pollData.userVote,
    };

    logger.info('Thread details fetched successfully', { threadId, replyCount: filteredReplies.length });
    return successResponse(c, response);
  } catch (error) {
    logger.error('Failed to fetch thread details', error, { threadId });
    return errors.internal(c, '获取帖子详情失败');
  }
});

// 更新帖子
app.put('/:threadId', authMiddleware, zValidator('json', updateThreadSchema), async (c) => {
  const threadId = parseInt(c.req.param('threadId'), 10);
  
  if (isNaN(threadId) || threadId <= 0) {
    return errors.validation(c, { threadId: '无效的帖子ID' });
  }

  const { title, body } = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;

  try {
    logger.info('Updating thread', { threadId, userId: user.id });

    const { allowed } = await checkThreadEditPermission(db, threadId, user);
    
    if (!allowed) {
      return errors.forbidden(c, '您没有权限编辑此帖子');
    }

    await db.prepare('UPDATE Threads SET title = ?, body = ? WHERE id = ?')
      .bind(title, body, threadId)
      .run();

    logger.info('Thread updated successfully', { threadId });
    return successResponse(c, null, '帖子更新成功');
  } catch (error) {
    logger.error('Failed to update thread', error, { threadId, userId: user.id });
    return errors.internal(c, '更新帖子失败');
  }
});

// 投票
app.post('/:threadId/vote', authMiddleware, zValidator('json', voteSchema), async (c) => {
  const threadId = parseInt(c.req.param('threadId'), 10);
  
  if (isNaN(threadId) || threadId <= 0) {
    return errors.validation(c, { threadId: '无效的帖子ID' });
  }

  const { optionId } = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;

  try {
    logger.info('Processing vote', { threadId, optionId, userId: user.id });

    // 检查是否已投票
    const existingVote = await db
      .prepare('SELECT * FROM PollVotes WHERE thread_id = ? AND user_id = ?')
      .bind(threadId, user.id)
      .first();

    if (existingVote) {
      return errors.conflict(c, '您已经投过票了');
    }

    // 使用事务插入投票并更新计数
    await executeTransaction(db, [
      db.prepare('INSERT INTO PollVotes (thread_id, user_id, poll_option_id) VALUES (?, ?, ?)')
        .bind(threadId, user.id, optionId),
      db.prepare('UPDATE PollOptions SET vote_count = vote_count + 1 WHERE id = ?')
        .bind(optionId),
    ]);

    logger.info('Vote recorded successfully', { threadId, optionId, userId: user.id });
    return successResponse(c, null, '投票成功');
  } catch (error) {
    logger.error('Failed to process vote', error, { threadId, optionId, userId: user.id });
    return errors.internal(c, '投票失败');
  }
});

// 发布回复
app.post('/:threadId/replies', authMiddleware, zValidator('json', createReplySchema), async (c) => {
  const threadId = parseInt(c.req.param('threadId'), 10);
  
  if (isNaN(threadId) || threadId <= 0) {
    return errors.validation(c, { threadId: '无效的帖子ID' });
  }

  const { body, replyToId } = c.req.valid('json');
  const user = c.get('user');
  const now = getCurrentTimestamp();
  const db = c.env.DB;

  try {
    logger.info('Creating reply', { threadId, userId: user.id, replyToId });

    // 获取原帖作者ID
    const originalThread = await db
      .prepare('SELECT author_id, node_id FROM Threads WHERE id = ?')
      .bind(threadId)
      .first<{ author_id: string; node_id: number }>();

    if (!originalThread) {
      return errors.notFound(c, '帖子');
    }

    // 插入回复
    const { meta } = await db.prepare(`
      INSERT INTO Replies (thread_id, author_id, created_at, body, reply_to_id) 
      VALUES (?, ?, ?, ?, ?)
    `).bind(threadId, user.id, now, body, replyToId || null).run();

    const newReplyId = meta.last_row_id;

    // 更新帖子、版块统计和用户积分（使用事务）
    await executeTransaction(db, [
      db.prepare(`
        UPDATE Threads 
        SET reply_count = reply_count + 1, last_reply_at = ?, last_reply_user_id = ?, last_reply_id = ?
        WHERE id = ?
      `).bind(now, user.id, newReplyId, threadId),
      db.prepare(`
        UPDATE Nodes 
        SET reply_count = reply_count + 1 
        WHERE id = ?
      `).bind(originalThread.node_id),
      db.prepare('UPDATE Credits SET balance = balance + 1, last_updated = ? WHERE user_id = ?')
        .bind(now, user.id),
    ]);

    // 创建提醒（如果回复者不是原帖作者）
    if (originalThread.author_id !== user.id) {
      await db.prepare(`
        INSERT INTO Reminders (recipient_id, actor_id, thread_id, reply_id, type, created_at)
        VALUES (?, ?, ?, ?, 'reply_to_thread', ?)
      `).bind(originalThread.author_id, user.id, threadId, newReplyId, now).run();
    }

    logger.info('Reply created successfully', { replyId: newReplyId, threadId, userId: user.id });
    return successResponse(c, { replyId: newReplyId }, '回复发布成功', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create reply', error, { threadId, userId: user.id });
    return errors.internal(c, '发布回复失败');
  }
});

// 获取单个回复
app.get('/:threadId/replies/:replyId', authMiddleware, async (c) => {
  const replyId = parseInt(c.req.param('replyId'), 10);
  
  if (isNaN(replyId) || replyId <= 0) {
    return errors.validation(c, { replyId: '无效的回复ID' });
  }

  const user = c.get('user');
  const db = c.env.DB;

  try {
    const { allowed, reply } = await checkReplyEditPermission(db, replyId, user);

    if (!reply) {
      return errors.notFound(c, '回复');
    }

    if (!allowed) {
      return errors.forbidden(c, '您没有权限查看此回复');
    }

    return successResponse(c, reply);
  } catch (error) {
    logger.error('Failed to fetch reply', error, { replyId, userId: user.id });
    return errors.internal(c, '获取回复失败');
  }
});

// 更新回复
app.put('/:threadId/replies/:replyId', authMiddleware, zValidator('json', updateReplySchema), async (c) => {
  const replyId = parseInt(c.req.param('replyId'), 10);
  
  if (isNaN(replyId) || replyId <= 0) {
    return errors.validation(c, { replyId: '无效的回复ID' });
  }

  const { body } = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;

  try {
    logger.info('Updating reply', { replyId, userId: user.id });

    const { allowed } = await checkReplyEditPermission(db, replyId, user);

    if (!allowed) {
      return errors.forbidden(c, '您没有权限编辑此回复');
    }

    await db.prepare('UPDATE Replies SET body = ? WHERE id = ?')
      .bind(body, replyId)
      .run();

    logger.info('Reply updated successfully', { replyId });
    return successResponse(c, null, '回复更新成功');
  } catch (error) {
    logger.error('Failed to update reply', error, { replyId, userId: user.id });
    return errors.internal(c, '更新回复失败');
  }
});

export default app;
