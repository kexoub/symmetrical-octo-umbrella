# D1 数据库快速参考

## 常用命令速查表

### 数据库管理

```bash
# 查看数据库列表
wrangler d1 list

# 创建新数据库
wrangler d1 create <database-name>

# 删除数据库
wrangler d1 delete <database-name>

# 查看数据库信息
wrangler d1 info <database-name>
```

### 迁移管理

```bash
# 创建新迁移文件
wrangler d1 migrations create DB <migration-name>

# 列出所有迁移
wrangler d1 migrations list DB --local
wrangler d1 migrations list DB --remote

# 应用迁移（本地）
wrangler d1 migrations apply DB --local
yarn db:migrate  # 使用 npm 脚本

# 应用迁移（线上）
wrangler d1 migrations apply DB --remote
yarn db:migrations:apply  # 使用 npm 脚本
```

### SQL 查询

```bash
# 执行单行 SQL
wrangler d1 execute DB --local --command="SELECT * FROM Users LIMIT 5"

# 执行 SQL 文件
wrangler d1 execute DB --local --file=./query.sql

# 导出数据库
wrangler d1 export DB --remote --output=./backup.sql
```

## 代码中的常用操作

### 1. 查询单个记录

```typescript
const user = await c.env.DB.prepare(
  'SELECT * FROM Users WHERE id = ?'
).bind(userId).first();
```

### 2. 查询列表

```typescript
const { results } = await c.env.DB.prepare(
  'SELECT * FROM Users LIMIT ? OFFSET ?'
).bind(limit, offset).all();
```

### 3. 插入数据

```typescript
const result = await c.env.DB.prepare(
  'INSERT INTO Users (id, username, email) VALUES (?, ?, ?)'
).bind(id, username, email).run();

// 获取插入的ID
const insertedId = result.meta.last_row_id;
```

### 4. 更新数据

```typescript
await c.env.DB.prepare(
  'UPDATE Users SET username = ? WHERE id = ?'
).bind(newUsername, userId).run();
```

### 5. 删除数据

```typescript
await c.env.DB.prepare(
  'DELETE FROM Users WHERE id = ?'
).bind(userId).run();
```

### 6. 批量操作

```typescript
const stmts = [
  c.env.DB.prepare('INSERT INTO Users (id, username) VALUES (?, ?)').bind('1', 'user1'),
  c.env.DB.prepare('INSERT INTO Users (id, username) VALUES (?, ?)').bind('2', 'user2'),
];
const results = await c.env.DB.batch(stmts);
```

### 7. 事务处理

```typescript
try {
  await c.env.DB.prepare('BEGIN TRANSACTION').run();
  
  // 执行多个操作
  await c.env.DB.prepare('INSERT INTO ...').bind(...).run();
  await c.env.DB.prepare('UPDATE ...').bind(...).run();
  
  await c.env.DB.prepare('COMMIT').run();
} catch (error) {
  await c.env.DB.prepare('ROLLBACK').run();
  throw error;
}
```

### 8. 关联查询

```typescript
const { results } = await c.env.DB.prepare(`
  SELECT 
    t.id, t.title, t.created_at,
    u.username as author_username
  FROM Threads t
  JOIN Users u ON t.author_id = u.id
  WHERE t.node_id = ?
  ORDER BY t.created_at DESC
  LIMIT 20
`).bind(nodeId).all();
```

### 9. 聚合查询

```typescript
const stats = await c.env.DB.prepare(`
  SELECT 
    COUNT(*) as total_users,
    AVG(level) as avg_level
  FROM Users
`).first();
```

### 10. 搜索查询

```typescript
const searchTerm = `%${keyword}%`;
const { results } = await c.env.DB.prepare(`
  SELECT * FROM Threads 
  WHERE title LIKE ? OR body LIKE ?
`).bind(searchTerm, searchTerm).all();
```

## 常见错误处理

```typescript
try {
  await c.env.DB.prepare('INSERT INTO Users ...').bind(...).run();
} catch (error: any) {
  // 唯一约束冲突
  if (error.message.includes('UNIQUE constraint failed')) {
    return c.json({ error: '记录已存在' }, 409);
  }
  
  // 外键约束失败
  if (error.message.includes('FOREIGN KEY constraint failed')) {
    return c.json({ error: '关联记录不存在' }, 400);
  }
  
  // 其他错误
  console.error('Database error:', error);
  return c.json({ error: '数据库错误' }, 500);
}
```

## 性能优化技巧

### 1. 使用索引字段查询

```typescript
// ✅ 好的做法 - 使用索引字段
await c.env.DB.prepare('SELECT * FROM Users WHERE id = ?').bind(id).first();

// ❌ 避免 - 非索引字段查询大量数据
await c.env.DB.prepare('SELECT * FROM Users WHERE profile_bio LIKE ?').bind('%test%').all();
```

### 2. 限制返回字段

```typescript
// ✅ 只返回需要的字段
await c.env.DB.prepare('SELECT id, username, avatar FROM Users').all();

// ❌ 避免 SELECT *
await c.env.DB.prepare('SELECT * FROM Users').all();
```

### 3. 使用批量操作

```typescript
// ✅ 批量插入
const stmts = items.map(item => 
  c.env.DB.prepare('INSERT INTO ...').bind(...)
);
await c.env.DB.batch(stmts);

// ❌ 避免循环中逐个执行
for (const item of items) {
  await c.env.DB.prepare('INSERT INTO ...').bind(...).run();
}
```

### 4. 添加 LIMIT

```typescript
// ✅ 始终添加 LIMIT
await c.env.DB.prepare('SELECT * FROM Threads LIMIT 20').all();

// ❌ 避免无限制查询
await c.env.DB.prepare('SELECT * FROM Threads').all();
```

## 数据类型对照表

| JavaScript/TypeScript | SQLite/D1 | 说明 |
|----------------------|-----------|------|
| `string` | `TEXT` | 文本数据 |
| `number` (整数) | `INTEGER` | 整数值 |
| `number` (小数) | `REAL` | 浮点数值 |
| `boolean` | `INTEGER` (0/1) | 布尔值 |
| `Date` | `INTEGER` (Unix时间戳) | 存储为秒级时间戳 |
| `JSON` | `TEXT` | JSON字符串 |
| `Buffer/ArrayBuffer` | `BLOB` | 二进制数据 |

## 时间处理

```typescript
// 获取当前时间戳（秒）
const now = Math.floor(Date.now() / 1000);

// 日期转时间戳
const timestamp = Math.floor(new Date('2024-01-01').getTime() / 1000);

// 时间戳转日期
const date = new Date(timestamp * 1000);

// SQL 中使用时间戳
await c.env.DB.prepare(
  'SELECT * FROM Threads WHERE created_at > ?'
).bind(now - 86400).all(); // 最近24小时
```

## 分页查询模板

```typescript
async function getPaginatedThreads(
  db: D1Database,
  nodeId: number,
  page: number = 1,
  limit: number = 20
) {
  const offset = (page - 1) * limit;
  
  // 查询数据
  const { results } = await db.prepare(`
    SELECT t.*, u.username as author_username
    FROM Threads t
    JOIN Users u ON t.author_id = u.id
    WHERE t.node_id = ?
    ORDER BY t.is_pinned DESC, t.last_reply_at DESC
    LIMIT ? OFFSET ?
  `).bind(nodeId, limit, offset).all();
  
  // 查询总数
  const countResult = await db.prepare(
    'SELECT COUNT(*) as total FROM Threads WHERE node_id = ?'
  ).bind(nodeId).first<{ total: number }>();
  
  const total = countResult?.total || 0;
  
  return {
    data: results,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  };
}
```

## 调试技巧

```typescript
// 1. 打印 SQL 执行时间
const start = Date.now();
const result = await c.env.DB.prepare('SELECT ...').all();
console.log(`Query took ${Date.now() - start}ms`);

// 2. 查看执行的 SQL
console.log('Executing SQL:', 'SELECT * FROM Users WHERE id = ?');
console.log('With params:', [userId]);

// 3. 本地查看数据库文件
// 位置: .wrangler/state/d1/DB.sqlite3
// 使用: sqlite3 .wrangler/state/d1/DB.sqlite3 "SELECT * FROM Users"
```
