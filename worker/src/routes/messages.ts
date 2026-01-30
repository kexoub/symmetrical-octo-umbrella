import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware';
import { createS3Client } from '../lib/s3';
import { 
  successResponse, 
  errors, 
  createLogger,
  HTTP_STATUS 
} from '../lib/api-utils';
import type { Bindings, User } from '../types';

const app = new Hono<{ Bindings: Bindings, Variables: { user: User } }>();
const logger = createLogger('MessagesRoute');

// 常量定义
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// 验证 Schema
const listConversationsSchema = z.object({
  page: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 ? 1 : num;
  }).default('1'),
  pageSize: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 || num > MAX_PAGE_SIZE ? DEFAULT_PAGE_SIZE : num;
  }).default(String(DEFAULT_PAGE_SIZE)),
});

const listMessagesSchema = z.object({
  page: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 ? 1 : num;
  }).default('1'),
  pageSize: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 || num > MAX_PAGE_SIZE ? DEFAULT_PAGE_SIZE : num;
  }).default(String(DEFAULT_PAGE_SIZE)),
});

const sendMessageSchema = z.object({
  recipientUsername: z.string().min(1, '收件人不能为空'),
  body: z.string().min(1, '消息内容不能为空').max(10000, '消息内容不能超过10000字符'),
});

// 所有私信相关操作都需要用户认证
app.use('*', authMiddleware);

// 获取当前用户的会话列表
app.get('/', zValidator('query', listConversationsSchema), async (c) => {
  const user = c.get('user');
  const { page, pageSize } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    logger.info('Fetching conversations', { userId: user.id, page, pageSize });

    // 查询会话列表
    const { results: conversations } = await c.env.DB.prepare(`
      SELECT 
        c.id, 
        c.last_message_at, 
        c.last_message_excerpt,
        CASE WHEN c.user1_id = ?1 THEN u2.username ELSE u1.username END as partner_username,
        CASE WHEN c.user1_id = ?1 THEN u2.avatar ELSE u1.avatar END as partner_avatar,
        CASE WHEN c.user1_id = ?1 THEN c.user1_unread_count ELSE c.user2_unread_count END as unread_count
      FROM Conversations c
      JOIN Users u1 ON c.user1_id = u1.id
      JOIN Users u2 ON c.user2_id = u2.id
      WHERE c.user1_id = ?1 OR c.user2_id = ?1
      ORDER BY c.last_message_at DESC
      LIMIT ?2 OFFSET ?3
    `).bind(user.id, pageSize, offset).all();

    // 查询总会话数
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM Conversations 
      WHERE user1_id = ? OR user2_id = ?
    `).bind(user.id, user.id).first<{ total: number }>();

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / pageSize);

    logger.info('Conversations fetched', { userId: user.id, count: conversations?.length, total });

    return successResponse(c, {
      data: conversations || [],
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch conversations', error, { userId: user.id });
    return errors.internal(c, '获取会话列表失败');
  }
});

// 获取指定会话的所有消息
app.get('/:conversationId', zValidator('query', listMessagesSchema), async (c) => {
  const user = c.get('user');
  const conversationId = c.req.param('conversationId');
  const { page, pageSize } = c.req.valid('query');
  const offset = (page - 1) * pageSize;
  
  try {
    logger.info('Fetching messages', { userId: user.id, conversationId, page, pageSize });

    // 安全性检查：确保当前用户是此会话的参与者
    const convCheck = await c.env.DB.prepare(
      "SELECT user1_id, user2_id FROM Conversations WHERE id = ?"
    ).bind(conversationId).first<{user1_id: string, user2_id: string}>();
    
    if (!convCheck || (convCheck.user1_id !== user.id && convCheck.user2_id !== user.id)) {
      return errors.forbidden(c, '您无权查看此会话');
    }

    // 获取消息列表（分页）
    const { results: messages } = await c.env.DB.prepare(`
      SELECT pm.id, pm.body, pm.created_at, u.username as author_username
      FROM PrivateMessages pm
      JOIN Users u ON pm.author_id = u.id
      WHERE pm.conversation_id = ?
      ORDER BY pm.created_at ASC
      LIMIT ? OFFSET ?
    `).bind(conversationId, pageSize, offset).all();

    // 获取总消息数
    const countResult = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM PrivateMessages WHERE conversation_id = ?"
    ).bind(conversationId).first<{ total: number }>();

    const total = countResult?.total || 0;

    // 从 S3 获取消息内容
    const s3 = createS3Client(c.env);
    const messagesWithBody = await Promise.all(
      (messages || []).map(async (msg: any) => {
        try {
          // 检查 body 是否是 S3 key（长度小于 100 且包含 /）
          const isS3Key = msg.body.length < 100 && msg.body.includes('/');
          
          if (isS3Key) {
            const obj = await s3.get(msg.body);
            if (obj && obj.body) {
              const reader = obj.body.getReader();
              const chunks: Uint8Array[] = [];
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
              }
              const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
              const result = new Uint8Array(totalLength);
              let offset = 0;
              for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
              }
              const body = new TextDecoder().decode(result);
              return { ...msg, body };
            }
          }
          
          // 如果不是 S3 key，直接返回 body（兼容旧数据）
          return { ...msg, body: msg.body };
        } catch (error) {
          logger.error('Failed to fetch message from S3', error, { messageId: msg.id, s3Key: msg.body });
          return { ...msg, body: '[消息加载失败]' };
        }
      })
    );
    
    // 将该会话中当前用户的未读消息数清零
    const unreadFieldToClear = convCheck.user1_id === user.id ? 'user1_unread_count' : 'user2_unread_count';
    await c.env.DB.prepare(`UPDATE Conversations SET ${unreadFieldToClear} = 0 WHERE id = ?`)
      .bind(conversationId)
      .run();

    logger.info('Messages fetched', { 
      userId: user.id, 
      conversationId, 
      count: messagesWithBody.length,
      total 
    });

    return successResponse(c, {
      data: messagesWithBody,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    logger.error('Failed to fetch messages', error, { userId: user.id, conversationId });
    return errors.internal(c, '获取消息失败');
  }
});

// 发送新消息
app.post('/', zValidator('json', sendMessageSchema), async (c) => {
  const user = c.get('user');
  const { recipientUsername, body } = c.req.valid('json');
  const db = c.env.DB;

  try {
    logger.info('Sending message', { userId: user.id, recipientUsername });

    // 查找收件人
    const recipient = await db.prepare(
      "SELECT id FROM Users WHERE username = ?"
    ).bind(recipientUsername).first<{id: string}>();
    
    if (!recipient) {
      return errors.notFound(c, '收件人用户');
    }
    
    if (recipient.id === user.id) {
      return errors.validation(c, { recipient: '不能给自己发送消息' });
    }

    const [user1_id, user2_id] = [user.id, recipient.id].sort();
    const now = Math.floor(Date.now() / 1000);
    let conversationId: number;

    // 查找或创建会话
    let conversation = await db.prepare(
      "SELECT id FROM Conversations WHERE user1_id = ? AND user2_id = ?"
    ).bind(user1_id, user2_id).first<{id: number}>();
    
    if (conversation) {
      conversationId = conversation.id;
    } else {
      const { meta } = await db.prepare(
        "INSERT INTO Conversations (user1_id, user2_id, created_at, last_message_at) VALUES (?, ?, ?, ?)"
      ).bind(user1_id, user2_id, now, now).run();
      conversationId = meta.last_row_id!;
    }

    // 生成 S3 key 并上传消息内容
    const bodyS3Key = `pm-body/${crypto.randomUUID()}`;
    const s3 = createS3Client(c.env);
    await s3.put(bodyS3Key, new TextEncoder().encode(body), 'text/plain');
    
    // 保存消息记录
    await db.prepare(
      "INSERT INTO PrivateMessages (conversation_id, author_id, body, created_at) VALUES (?, ?, ?, ?)"
    ).bind(conversationId, user.id, bodyS3Key, now).run();
    
    // 更新会话信息
    const excerpt = body.replace(/<[^>]*>?/gm, '').substring(0, 50);
    const unreadFieldToIncrement = user1_id === user.id ? 'user2_unread_count' : 'user1_unread_count';
    
    await db.prepare(`
      UPDATE Conversations 
      SET last_message_at = ?, last_message_excerpt = ?, ${unreadFieldToIncrement} = ${unreadFieldToIncrement} + 1
      WHERE id = ?
    `).bind(now, excerpt, conversationId).run();

    logger.info('Message sent successfully', { 
      userId: user.id, 
      recipientId: recipient.id,
      conversationId 
    });

    return successResponse(c, { 
      message: "消息已发送", 
      conversationId 
    }, undefined, HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to send message', error, { userId: user.id, recipientUsername });
    return errors.internal(c, '发送消息失败');
  }
});

export default app;
