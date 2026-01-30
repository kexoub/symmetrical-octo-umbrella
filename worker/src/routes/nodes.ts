import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { 
  successResponse, 
  errors, 
  createLogger,
  HTTP_STATUS 
} from '../lib/api-utils';
import type { Bindings, NodeWithLastPost } from '../types';

const app = new Hono<{ Bindings: Bindings }>();
const logger = createLogger('NodesRoute');

// 验证 Schema
const nodeIdSchema = z.object({
  id: z.string().transform((val) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) throw new Error('Invalid node ID');
    return num;
  }),
});

// ============ 路由定义 ============

// 获取所有节点（版块）列表
app.get('/', async (c) => {
  try {
    logger.info('Fetching all nodes');

    // 优化后的 SQL 查询：使用窗口函数获取每个节点的最新帖子
    const query = `
      SELECT
        n.id,
        n.name,
        n.description,
        n.parent_node_id,
        n.sort_order,
        n.thread_count,
        n.reply_count,
        t.title as last_post_title,
        t.id as last_post_thread_id,
        t.last_reply_at as last_post_time,
        t.last_reply_id
      FROM Nodes n
      LEFT JOIN (
        SELECT 
          node_id,
          id,
          title,
          last_reply_at,
          last_reply_id,
          ROW_NUMBER() OVER (PARTITION BY node_id ORDER BY last_reply_at DESC) as rn
        FROM Threads
      ) t ON n.id = t.node_id AND t.rn = 1
      ORDER BY n.sort_order ASC
    `;

    const { results } = await c.env.DB.prepare(query).all<NodeWithLastPost>();
    
    logger.info('Nodes fetched successfully', { count: results?.length || 0 });
    return successResponse(c, results || []);
  } catch (error) {
    logger.error('Failed to fetch nodes', error);
    return errors.internal(c, '获取版块列表失败');
  }
});

// 获取单个节点信息
app.get('/:id', zValidator('param', nodeIdSchema), async (c) => {
  const { id } = c.req.valid('param');

  try {
    logger.info('Fetching node details', { nodeId: id });

    const node = await c.env.DB.prepare(`
      SELECT 
        id, 
        name, 
        description, 
        parent_node_id, 
        thread_count, 
        reply_count,
        sort_order
      FROM Nodes 
      WHERE id = ?
    `).bind(id).first<NodeWithLastPost>();

    if (!node) {
      return errors.notFound(c, '版块');
    }

    // 获取该节点的最新帖子信息
    const lastPost = await c.env.DB.prepare(`
      SELECT 
        id as last_post_thread_id,
        title as last_post_title,
        last_reply_at as last_post_time,
        last_reply_id
      FROM Threads
      WHERE node_id = ?
      ORDER BY last_reply_at DESC
      LIMIT 1
    `).bind(id).first<{
      last_post_thread_id: number;
      last_post_title: string;
      last_post_time: number;
      last_reply_id: number;
    }>();

    const nodeWithLastPost: NodeWithLastPost = {
      ...node,
      ...lastPost,
    };

    logger.info('Node details fetched successfully', { nodeId: id });
    return successResponse(c, nodeWithLastPost);
  } catch (error) {
    logger.error('Failed to fetch node', error, { nodeId: id });
    return errors.internal(c, '获取版块信息失败');
  }
});

export default app;
