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
const logger = createLogger('UsersRoute');

// 常量定义
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

// 验证 Schema
const listUserThreadsSchema = z.object({
  page: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 ? 1 : num;
  }).default('1'),
  pageSize: z.string().transform((val) => {
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 || num > MAX_PAGE_SIZE ? DEFAULT_PAGE_SIZE : num;
  }).default(String(DEFAULT_PAGE_SIZE)),
});

// 获取指定用户的公开信息
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  // 获取当前用户（如果已登录）
  const currentUser = c.get('user');
  
  if (id === 'me') {
    if (!currentUser) {
      return errors.unauthorized(c);
    }
    return successResponse(c, currentUser);
  }

  try {
    logger.info('Fetching user profile', { userId: id, requesterId: currentUser?.id });

    // 使用单个查询获取用户信息和统计（避免 N+1 问题）
    const query = `
      SELECT
        u.id,
        u.username,
        u.created_at,
        u.avatar,
        u.level,
        u.role,
        u.profile_bio,
        COALESCE(c.balance, 0) as credits,
        (SELECT COUNT(*) FROM Threads WHERE author_id = u.id) as thread_count,
        (SELECT COUNT(*) FROM Replies WHERE author_id = u.id) as reply_count,
        (SELECT COUNT(*) FROM Threads WHERE author_id = u.id AND created_at > ?) as threads_this_month,
        (SELECT MAX(created_at) FROM Threads WHERE author_id = u.id) as last_post_at
      FROM Users u
      LEFT JOIN Credits c ON u.id = c.user_id
      WHERE u.id = ?
    `;
    
    const oneMonthAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
    const profile = await c.env.DB.prepare(query).bind(oneMonthAgo, id).first();
    
    if (!profile) {
      return errors.notFound(c, '用户');
    }

    // 模拟一些其他数据以匹配 UI
    const fullProfile = {
      ...profile,
      last_visit_at: Date.now() / 1000 - 3600,
      last_activity_at: Date.now() / 1000 - 1800,
      online_time: Math.floor(Math.random() * 5000) + 1000,
      user_group: getUserGroupName(profile.level),
      silver_coins: Math.floor((Number(profile.credits) || 0) * 0.8),
      gold_coins: Math.floor((Number(profile.credits) || 0) * 0.2),
    };

    logger.info('User profile fetched', { userId: id });
    return successResponse(c, fullProfile);
  } catch (error) {
    logger.error('Failed to fetch user profile', error, { userId: id });
    return errors.internal(c, '获取用户信息失败');
  }
});

// 获取指定用户的所有主题帖（带分页）
app.get('/:id/threads', zValidator('query', listUserThreadsSchema), async (c) => {
  const id = c.req.param('id');
  const { page, pageSize } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    logger.info('Fetching user threads', { userId: id, page, pageSize });

    // 先检查用户是否存在
    const user = await c.env.DB.prepare(
      "SELECT id, username FROM Users WHERE id = ?"
    ).bind(id).first<{ id: string; username: string }>();

    if (!user) {
      return errors.notFound(c, '用户');
    }

    // 查询帖子列表（分页）
    const { results } = await c.env.DB.prepare(`
      SELECT
        t.id,
        t.title,
        t.created_at,
        t.reply_count,
        t.view_count,
        t.is_pinned,
        n.name as node_name,
        n.id as node_id
      FROM Threads t
      JOIN Nodes n ON t.node_id = n.id
      WHERE t.author_id = ?
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(id, pageSize, offset).all();

    // 查询总帖子数
    const countResult = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM Threads WHERE author_id = ?"
    ).bind(id).first<{ total: number }>();

    const total = countResult?.total || 0;

    logger.info('User threads fetched', { userId: id, count: results?.length, total });

    return successResponse(c, {
      user: {
        id: user.id,
        username: user.username,
      },
      data: results || [],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    logger.error('Failed to fetch user threads', error, { userId: id });
    return errors.internal(c, '获取用户帖子失败');
  }
});

// 所有路由都需要认证
app.use('*', authMiddleware);

// 处理头像上传 - 使用S3存储
app.post('/me/avatar', async (c) => {
  const user = c.get('user');
  
  try {
    const formData = await c.req.formData();
    const avatarFile = formData.get('avatar');

    if (!avatarFile || !(avatarFile instanceof File)) {
      return errors.validation(c, { avatar: '请上传头像文件' });
    }

    // 验证文件类型
    if (!avatarFile.type.startsWith('image/')) {
      return errors.validation(c, { avatar: '只允许上传图片文件' });
    }

    // 验证文件大小
    if (avatarFile.size > MAX_AVATAR_SIZE) {
      return errors.validation(c, { avatar: `头像文件大小不能超过${MAX_AVATAR_SIZE / 1024 / 1024}MB` });
    }

    logger.info('Uploading avatar', { userId: user.id, fileSize: avatarFile.size, fileType: avatarFile.type });

    // 生成唯一的文件名
    const ext = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg';
    const avatarKey = `avatars/${user.id}/${crypto.randomUUID()}.${ext}`;
    
    // 读取文件内容
    const arrayBuffer = await avatarFile.arrayBuffer();
    
    // 创建 S3 客户端
    const s3 = createS3Client(c.env);
    
    // 上传文件到 S3
    await s3.put(avatarKey, new Uint8Array(arrayBuffer), avatarFile.type);

    // 生成公开访问 URL
    const avatarUrl = `${c.env.S3_PUBLIC_URL}/${avatarKey}`;

    // 更新用户在 D1 中的头像 URL
    await c.env.DB.prepare('UPDATE Users SET avatar = ? WHERE id = ?')
      .bind(avatarUrl, user.id)
      .run();

    logger.info('Avatar uploaded successfully', { userId: user.id, avatarUrl });

    return successResponse(c, { 
      message: '头像更新成功', 
      avatarUrl 
    }, undefined, HTTP_STATUS.OK);
  } catch (error) {
    logger.error('Failed to upload avatar', error, { userId: user.id });
    return errors.internal(c, '头像上传失败');
  }
});

// 辅助函数：根据等级获取用户组名称
function getUserGroupName(level: number): string {
  const groups: Record<number, string> = {
    1: '新手会员',
    2: '注册会员',
    3: '中级会员',
    4: '高级会员',
    5: '金牌会员',
    6: '论坛元老',
  };
  return groups[level] || '普通会员';
}

export default app;
