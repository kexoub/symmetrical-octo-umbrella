import { Hono } from 'hono';
import { authMiddleware } from '../auth/middleware';
import { createS3Client } from '../lib/s3';
import type { Bindings, User } from '../types';

const app = new Hono<{ Bindings: Bindings, Variables: { user: User } }>();

// 图片上传需要用户认证
app.use('*', authMiddleware);

// 处理图片上传
app.post('/', async (c) => {
    const user = c.get('user');
    const formData = await c.req.formData();
    const imageFile = formData.get('image');

    // 验证文件是否存在且为文件类型
    if (!imageFile || !(imageFile instanceof File)) {
        return c.json({ error: '没有上传图片文件或格式不正确' }, 400);
    }
    
    // 验证文件类型
    if (!imageFile.type.startsWith('image/')) {
        return c.json({ error: '只允许上传图片文件' }, 400);
    }

    // 验证文件大小 (最大 5MB)
    if (imageFile.size > 5 * 1024 * 1024) {
        return c.json({ error: '图片文件大小不能超过5MB' }, 400);
    }

    // 生成一个唯一的 S3 对象 Key
    const ext = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
    const imageKey = `thread-images/${user.id}/${crypto.randomUUID()}.${ext}`;

    try {
        // 读取文件内容
        const arrayBuffer = await imageFile.arrayBuffer();
        
        // 创建 S3 客户端
        const s3 = createS3Client(c.env);
        
        // 上传文件到 S3
        await s3.put(imageKey, new Uint8Array(arrayBuffer), imageFile.type);
        
        // 生成公开访问 URL
        const url = `${c.env.S3_PUBLIC_URL}/${imageKey}`;

        // 返回可公开访问的 URL
        return c.json({ url });

    } catch (error) {
        console.error("Image upload failed:", error);
        return c.json({ error: '图片上传失败' }, 500);
    }
});

export default app;
