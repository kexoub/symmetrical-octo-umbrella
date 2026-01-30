import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { 
  successResponse, 
  errors, 
  createLogger 
} from '../lib/api-utils';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();
const logger = createLogger('SearchRoute');

// 常量定义
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MIN_SEARCH_LENGTH = 2;
const MAX_SEARCH_LENGTH = 100;

// 验证 Schema
const searchSchema = z.object({
  q: z.string()
    .min(MIN_SEARCH_LENGTH, `搜索关键词至少需要${MIN_SEARCH_LENGTH}个字符`)
    .max(MAX_SEARCH_LENGTH, `搜索关键词不能超过${MAX_SEARCH_LENGTH}个字符`),
  type: z.enum(['threads', 'users']).default('threads'),
  page: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 ? 1 : num;
  }).default('1'),
  pageSize: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 || num > MAX_PAGE_SIZE ? DEFAULT_PAGE_SIZE : num;
  }).default(String(DEFAULT_PAGE_SIZE)),
  nodeId: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num <= 0 ? undefined : num;
  }).optional(),
});

// 搜索功能
app.get('/', zValidator('query', searchSchema), async (c) => {
  const { q, type, page, pageSize, nodeId } = c.req.valid('query');
  const offset = (page - 1) * pageSize;
  const searchTerm = `%${q}%`;

  try {
    logger.info('Performing search', { query: q, type, page, pageSize, nodeId });

    if (type === 'threads') {
      // 构建查询条件
      let whereClause = '(t.title LIKE ?1 OR t.body LIKE ?1)';
      const queryParams: (string | number)[] = [searchTerm];
      
      if (nodeId) {
        whereClause += ' AND t.node_id = ?2';
        queryParams.push(nodeId);
      }

      // 查询帖子列表
      const { results: threads } = await c.env.DB.prepare(`
        SELECT 
          t.id,
          t.title,
          t.body,
          t.created_at,
          t.reply_count,
          t.view_count,
          u.username as author_username,
          u.id as author_id,
          n.name as node_name,
          n.id as node_id
        FROM Threads t
        JOIN Users u ON t.author_id = u.id
        JOIN Nodes n ON t.node_id = n.id
        WHERE ${whereClause}
        ORDER BY 
          CASE 
            WHEN t.title LIKE ?1 THEN 1
            ELSE 2
          END,
          t.created_at DESC
        LIMIT ?${queryParams.length + 1} OFFSET ?${queryParams.length + 2}
      `).bind(...queryParams, pageSize, offset).all();

      // 查询总结果数
      const countResult = await c.env.DB.prepare(`
        SELECT COUNT(*) as total 
        FROM Threads t
        WHERE ${whereClause}
      `).bind(...queryParams.slice(0, nodeId ? 2 : 1)).first<{ total: number }>();

      const total = countResult?.total || 0;

      // 截断内容用于预览
      const threadsWithSnippet = (threads || []).map((thread: any) => ({
        ...thread,
        body: truncateText(stripHtml(thread.body), 200),
      }));

      logger.info('Search completed', { 
        query: q, 
        type, 
        resultsCount: threadsWithSnippet.length,
        total 
      });

      return successResponse(c, {
        data: threadsWithSnippet,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
        query: q,
      });
    } else {
      // 搜索用户
      const { results: users } = await c.env.DB.prepare(`
        SELECT 
          id,
          username,
          avatar,
          level,
          created_at,
          (SELECT COUNT(*) FROM Threads WHERE author_id = u.id) as thread_count
        FROM Users u
        WHERE username LIKE ?1
        ORDER BY 
          CASE 
            WHEN username = ?2 THEN 1
            WHEN username LIKE ?3 THEN 2
            ELSE 3
          END,
          level DESC,
          created_at DESC
        LIMIT ?4 OFFSET ?5
      `).bind(searchTerm, q, `${q}%`, pageSize, offset).all();

      // 查询总用户数
      const countResult = await c.env.DB.prepare(`
        SELECT COUNT(*) as total 
        FROM Users 
        WHERE username LIKE ?1
      `).bind(searchTerm).first<{ total: number }>();

      const total = countResult?.total || 0;

      logger.info('User search completed', { 
        query: q, 
        resultsCount: users?.length,
        total 
      });

      return successResponse(c, {
        data: users || [],
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
        query: q,
      });
    }
  } catch (error) {
    logger.error('Search failed', error, { query: q, type });
    return errors.internal(c, '搜索失败');
  }
});

// 辅助函数：去除 HTML 标签
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, '');
}

// 辅助函数：截断文本
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

export default app;
