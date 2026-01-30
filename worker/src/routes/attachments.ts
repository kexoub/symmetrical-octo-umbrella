import { Hono } from 'hono';
import { authMiddleware } from '../auth/middleware';
import { createS3Client } from '../lib/s3';
import type { Bindings, User } from '../types';

const app = new Hono<{ Bindings: Bindings, Variables: { user: User } }>();

// 附件上传需要用户认证
app.use('*', authMiddleware);

// 处理附件上传
app.post('/', async (c) => {
    const user = c.get('user');
    const formData = await c.req.formData();
    const attachmentFile = formData.get('attachment');

    if (!attachmentFile || !(attachmentFile instanceof File)) {
        return c.json({ error: '没有上传附件或格式不正确' }, 400);
    }
    
    // 验证文件大小 (最大 20MB)
    if (attachmentFile.size > 20 * 1024 * 1024) {
        return c.json({ error: '附件文件大小不能超过20MB' }, 400);
    }

    // 生成一个唯一的 S3 对象 Key
    const attachmentKey = `attachments/${user.id}/${crypto.randomUUID()}_${attachmentFile.name}`;

    try {
        // 读取文件内容
        const arrayBuffer = await attachmentFile.arrayBuffer();
        
        // 创建 S3 客户端
        const s3 = createS3Client(c.env);
        
        // 上传文件到 S3
        await s3.put(attachmentKey, new Uint8Array(arrayBuffer), attachmentFile.type);

        // 生成公开访问 URL
        const fileUrl = `${c.env.S3_PUBLIC_URL}/${attachmentKey}`;
        
        return c.json({ 
            url: fileUrl,
            fileName: attachmentFile.name,
            fileSize: attachmentFile.size
        });

    } catch (error) {
        console.error("Attachment upload failed:", error);
        return c.json({ error: '附件上传失败' }, 500);
    }
});

export default app;
