import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware';
import { 
  successResponse, 
  errors, 
  createLogger,
  HTTP_STATUS,
  getCurrentTimestamp 
} from '../lib/api-utils';
import { executeTransaction } from '../lib/db-utils';
import type { Bindings, User } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>();
const logger = createLogger('CommentsRoute');

// 常量定义
const MAX_COMMENT_LENGTH = 1000;
const COMMENT_REWARD_CREDITS = 1;

// ============ 验证 Schema ============

const createCommentSchema = z.object({
  parentId: z.number().int().positive('父级ID必须为正整数'),
  parentType: z.enum(['thread', 'reply'], {
    errorMap: () => ({ message: '父级类型必须是 thread 或 reply' }),
  }),
  body: z.string()
    .min(1, '评论内容不能为空')
    .max(MAX_COMMENT_LENGTH, `评论内容不能超过${MAX_COMMENT_LENGTH}个字符`),
});

const listCommentsSchema = z.object({
  parentId: z.string().transform((val) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) throw new Error('Invalid parentId');
    return num;
  }),
  parentType: z.enum(['thread', 'reply']),
  page: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 ? 1 : num;
  }).default('1'),
  limit: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 || num > 50 ? 20 : num;
  }).default('20'),
});

// ============ 辅助函数 ============

// 验证父级资源是否存在
async function validateParent(
  db: D1Database,
  parentId: number,
  parentType: 'thread' | 'reply'
): Promise<{ exists: boolean; authorId?: string }> {
  let result: { id: number; author_id: string } | null;

  if (parentType === 'thread') {
    result = await db
      .prepare('SELECT id, author_id FROM Threads WHERE id = ?')
      .bind(parentId)
      .first<{ id: number; author_id: string }>();
  } else {
    result = await db
      .prepare('SELECT id, author_id FROM Replies WHERE id = ?')
      .bind(parentId)
      .first<{ id: number; author_id: string }>();
  }

  return { exists: !!result, authorId: result?.author_id };
}

// ============ 路由定义 ============

// 创建新评论
app.post('/', authMiddleware, zValidator('json', createCommentSchema), async (c) => {
  const { parentId, parentType, body } = c.req.valid('json');
  const user = c.get('user');
  const now = getCurrentTimestamp();
  const db = c.env.DB;

  try {
    logger.info('Creating comment', { 
      parentId, 
      parentType, 
      userId: user.id,
      bodyLength: body.length 
    });

    // 验证父级资源是否存在
    const { exists, authorId } = await validateParent(db, parentId, parentType);
    
    if (!exists) {
      return errors.notFound(c, parentType === 'thread' ? '帖子' : '回复');
    }

    // 插入评论并更新用户积分（使用事务）
    const { meta } = await db.prepare(`
      INSERT INTO Comments (parent_id, parent_type, author_id, created_at, body)
      VALUES (?, ?, ?, ?, ?)
    `).bind(parentId, parentType, user.id, now, body).run();

    const newCommentId = meta.last_row_id;

    // 奖励积分
    await db.prepare(`
      UPDATE Credits 
      SET balance = balance + ?, last_updated = ? 
      WHERE user_id = ?
    `).bind(COMMENT_REWARD_CREDITS, now, user.id).run();

    // 创建提醒（如果评论者不是作者）
    if (authorId && authorId !== user.id) {
      await db.prepare(`
        INSERT INTO Reminders (recipient_id, actor_id, thread_id, reply_id, type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        authorId, 
        user.id, 
        parentType === 'thread' ? parentId : null,
        parentType === 'reply' ? parentId : null,
        'comment',
        now
      ).run();
    }

    logger.info('Comment created successfully', { 
      commentId: newCommentId, 
      parentId, 
      userId: user.id 
    });

    return successResponse(
      c, 
      { commentId: newCommentId }, 
      '评论发布成功', 
      HTTP_STATUS.CREATED
    );
  } catch (error) {
    logger.error('Failed to create comment', error, { 
      parentId, 
      parentType, 
      userId: user.id 
    });
    return errors.internal(c, '发布评论失败');
  }
});

// 获取评论列表
app.get('/', zValidator('query', listCommentsSchema), async (c) => {
  const { parentId, parentType, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  try {
    logger.info('Fetching comments', { parentId, parentType, page, limit });

    // 并行获取评论列表和总数
    const [commentsResult, countResult] = await Promise.all([
      c.env.DB.prepare(`
        SELECT 
          c.*,
          u.username as author_username,
          u.avatar as author_avatar
        FROM Comments c
        JOIN Users u ON c.author_id = u.id
        WHERE c.parent_id = ? AND c.parent_type = ?
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?
      `).bind(parentId, parentType, limit, offset).all<{
        id: number;
        parent_type: string;
        parent_id: number;
        author_id: string;
        created_at: number;
        body: string;
        author_username: string;
        author_avatar?: string;
      }>();

    const total = countResult?.count || 0;
    const comments = commentsResult.results || [];

    logger.info('Comments fetched successfully', { 
      count: comments.length, 
      total,
      parentId 
    });

    return successResponse(c, {
      comments,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + comments.length < total,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch comments', error, { 
      parentId, 
      parentType, 
      page 
    });
    return errors.internal(c, '获取评论列表失败');
  }
});

// 删除评论
app.delete('/:id', authMiddleware, async (c) => {
  const commentId = parseInt(c.req.param('id'), 10);
  
  if (isNaN(commentId) || commentId <= 0) {
    return errors.validation(c, { id: '无效的评论ID' });
  }

  const user = c.get('user');
  const db = c.env.DB;

  try {
    logger.info('Deleting comment', { commentId, userId: user.id });

    // 检查评论是否存在及权限
    const comment = await db
      .prepare('SELECT * FROM Comments WHERE id = ?')
      .bind(commentId)
      .first<{ id: number; author_id: string }>();

    if (!comment) {
      return errors.notFound(c, '评论');
    }

    const isAuthor = comment.author_id === user.id;
    const isModerator = ['admin', 'moderator'].includes(user.role);

    if (!isAuthor && !isModerator) {
      return errors.forbidden(c, '您没有权限删除此评论');
    }

    await db.prepare('DELETE FROM Comments WHERE id = ?')
      .bind(commentId)
      .run();

    logger.info('Comment deleted successfully', { commentId, userId: user.id });
    return successResponse(c, null, '评论删除成功');
  } catch (error) {
    logger.error('Failed to delete comment', error, { commentId, userId: user.id });
    return errors.internal(c, '删除评论失败');
  }
});

export default app;
