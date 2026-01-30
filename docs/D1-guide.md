# D1 数据库使用指南

本项目使用 **Cloudflare D1** 作为数据库。D1 是一个基于 SQLite 的 serverless 数据库，专为 Cloudflare Workers 设计。

## 目录

- [D1 简介](#d1-简介)
- [配置说明](#配置说明)
- [数据库架构](#数据库架构)
- [常用操作](#常用操作)
- [数据表结构](#数据表结构)
- [最佳实践](#最佳实践)
- [故障排除](#故障排除)

## D1 简介

### 特点

- **Serverless**: 无需管理服务器，自动扩展
- **SQLite 兼容**: 使用标准 SQL 语法
- **全球分布**: 数据自动复制到全球边缘节点
- **零延迟**: 与 Cloudflare Workers 深度集成
- **开发友好**: 支持本地开发和测试

### 限制

- 单个数据库最大 500MB
- 单个查询最大 100MB 结果集
- 不支持某些 SQLite 扩展（如 FTS5）
- 事务支持有限（不支持嵌套事务）

## 配置说明

### 1. wrangler.jsonc 配置

```json
{
  "d1_databases": [
    {
      "binding": "DB",                    // 在代码中使用的变量名
      "database_name": "community-db",    // 数据库名称
      "database_id": "your-database-id",  // 数据库ID（创建后获得）
      "migrations_dir": "worker/migrations"  // 迁移文件目录
    }
  ]
}
```

### 2. 类型定义 (worker/src/types.ts)

```typescript
export type Bindings = {
  DB: D1Database;  // D1 数据库绑定
  // ... 其他绑定
};
```

### 3. 在代码中使用

```typescript
// 查询示例
const user = await c.env.DB.prepare(
  "SELECT * FROM Users WHERE id = ?"
).bind(userId).first();

// 插入示例
await c.env.DB.prepare(
  "INSERT INTO Users (id, username, email) VALUES (?, ?, ?)"
).bind(id, username, email).run();

// 批量操作
const stmts = [
  c.env.DB.prepare("INSERT INTO Users (id, username) VALUES (?, ?)").bind('1', 'user1'),
  c.env.DB.prepare("INSERT INTO Users (id, username) VALUES (?, ?)").bind('2', 'user2'),
];
await c.env.DB.batch(stmts);
```

## 数据库架构

### 当前数据库版本

数据库使用迁移系统管理，当前有以下迁移：

| 版本 | 文件名 | 描述 |
|------|--------|------|
| 0000 | 0000_initial.sql | 初始表结构（用户、版块、帖子、回复等） |
| 0001 | 0001_add_messages.sql | 添加私信功能 |
| 0002 | 0002_add_reminders.sql | 添加提醒功能 |
| 0003 | 0003_store_body_in_d1.sql | 帖子内容存储到D1 |
| 0004 | 0004_add_last_reply_id.sql | 添加最后回复ID |
| 0005 | 0005_add_thread_types_and_user_levels.sql | 帖子类型和用户等级 |
| 0006 | 0006_add_self_visible_posts.sql | 仅作者可见帖子 |
| 0007 | 0007_add_admin_role.sql | 管理员角色 |
| 0008 | 0008_add_user_groups.sql | 用户组 |
| 0009 | 0009_add_group_permissions.sql | 用户组权限 |
| 0010 | 0010_add_settings.sql | 站点设置 |
| 0011 | 0011_remove_r2_from_messages.sql | 修改私信表结构 |
| 0012 | 0012_use_s3_for_messages.sql | 私信使用S3存储 |

### 核心数据表

#### Users（用户表）
```sql
CREATE TABLE Users (
    id TEXT PRIMARY KEY,              -- 用户ID
    username TEXT NOT NULL UNIQUE,    -- 用户名
    email TEXT NOT NULL UNIQUE,       -- 邮箱
    created_at INTEGER NOT NULL,      -- 创建时间
    profile_bio TEXT,                 -- 个人简介
    avatar TEXT,                      -- 头像URL
    level INTEGER DEFAULT 1,          -- 等级
    role TEXT DEFAULT 'user'          -- 角色（user/admin）
);
```

#### Nodes（版块表）
```sql
CREATE TABLE Nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,               -- 版块名称
    description TEXT,                 -- 版块描述
    parent_node_id INTEGER,           -- 父版块ID
    sort_order INTEGER DEFAULT 0,     -- 排序
    thread_count INTEGER DEFAULT 0,   -- 帖子数
    reply_count INTEGER DEFAULT 0     -- 回复数
);
```

#### Threads（帖子表）
```sql
CREATE TABLE Threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,         -- 所属版块
    author_id TEXT NOT NULL,          -- 作者ID
    title TEXT NOT NULL,              -- 标题
    body TEXT NOT NULL,               -- 内容
    created_at INTEGER NOT NULL,      -- 创建时间
    last_reply_at INTEGER,            -- 最后回复时间
    view_count INTEGER DEFAULT 0,     -- 浏览数
    reply_count INTEGER DEFAULT 0,    -- 回复数
    is_pinned BOOLEAN DEFAULT 0,      -- 是否置顶
    is_locked BOOLEAN DEFAULT 0,      -- 是否锁定
    is_author_only BOOLEAN DEFAULT 0, -- 仅作者可见
    type TEXT DEFAULT 'discussion',   -- 类型
    read_permission INTEGER DEFAULT 0 -- 阅读权限
);
```

#### Replies（回复表）
```sql
CREATE TABLE Replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,       -- 所属帖子
    author_id TEXT NOT NULL,          -- 作者ID
    body TEXT NOT NULL,               -- 内容
    created_at INTEGER NOT NULL,      -- 创建时间
    is_author_only BOOLEAN DEFAULT 0, -- 仅作者可见
    reply_to_id INTEGER               -- 回复给某条回复
);
```

## 常用操作

### 创建新数据库

```bash
# 创建数据库
wrangler d1 create community-db

# 查看数据库列表
wrangler d1 list

# 查看数据库信息
wrangler d1 info community-db
```

### 运行迁移

```bash
# 本地开发环境
wrangler d1 migrations apply DB --local

# 或者使用 npm 脚本
npm run db:migrate

# 线上环境
wrangler d1 migrations apply DB --remote

# 或者使用 npm 脚本
npm run db:migrations:apply
```

### 创建新迁移

```bash
# 创建新的迁移文件
wrangler d1 migrations create DB add_new_feature

# 这会在 worker/migrations/ 目录下创建新的 SQL 文件
```

### 数据库查询

```bash
# 本地数据库查询
wrangler d1 execute DB --local --command="SELECT * FROM Users LIMIT 5"

# 线上数据库查询
wrangler d1 execute DB --remote --command="SELECT * FROM Users LIMIT 5"

# 从文件执行 SQL
wrangler d1 execute DB --local --file=./query.sql
```

### 备份和导出

```bash
# 导出数据库
wrangler d1 export DB --remote --output=./backup.sql

# 导入数据库（谨慎使用）
wrangler d1 execute DB --remote --file=./backup.sql
```

## 最佳实践

### 1. 查询优化

```typescript
// ✅ 好的做法：使用索引字段查询
const user = await c.env.DB.prepare(
  "SELECT * FROM Users WHERE id = ?"
).bind(userId).first();

// ✅ 好的做法：限制返回字段
const users = await c.env.DB.prepare(
  "SELECT id, username, avatar FROM Users LIMIT 20"
).all();

// ❌ 避免：SELECT *
const users = await c.env.DB.prepare(
  "SELECT * FROM Users"  // 数据量大时会出问题
).all();
```

### 2. 批量操作

```typescript
// ✅ 使用 batch 进行批量插入
const stmts = users.map(user => 
  c.env.DB.prepare("INSERT INTO Users (id, username) VALUES (?, ?)")
    .bind(user.id, user.username)
);
await c.env.DB.batch(stmts);

// ❌ 避免：循环中逐个执行
for (const user of users) {
  await c.env.DB.prepare("INSERT INTO Users (id, username) VALUES (?, ?)")
    .bind(user.id, user.username).run();  // 性能差
}
```

### 3. 事务处理

```typescript
// D1 支持简单的事务
try {
  await c.env.DB.prepare("BEGIN TRANSACTION").run();
  
  await c.env.DB.prepare("INSERT INTO Threads ...").bind(...).run();
  await c.env.DB.prepare("UPDATE Nodes SET thread_count = thread_count + 1 ...").bind(...).run();
  
  await c.env.DB.prepare("COMMIT").run();
} catch (error) {
  await c.env.DB.prepare("ROLLBACK").run();
  throw error;
}
```

### 4. 错误处理

```typescript
try {
  const result = await c.env.DB.prepare("INSERT INTO Users ...").bind(...).run();
  
  if (!result.success) {
    throw new Error('Insert failed');
  }
  
  return c.json({ id: result.meta.last_row_id });
} catch (error) {
  if (error.message.includes('UNIQUE constraint failed')) {
    return c.json({ error: '用户已存在' }, 409);
  }
  console.error('Database error:', error);
  return c.json({ error: '数据库错误' }, 500);
}
```

### 5. 迁移文件编写

```sql
-- 好的迁移文件示例
-- 版本: 0013
-- 描述: 添加用户积分表

-- 创建新表
CREATE TABLE IF NOT EXISTS UserCredits (
    user_id TEXT PRIMARY KEY,
    balance INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_credits_balance ON UserCredits(balance);

-- 初始化数据（如果需要）
INSERT INTO UserCredits (user_id, balance, updated_at)
SELECT id, 0, strftime('%s', 'now') FROM Users;
```

## 故障排除

### 1. 迁移失败

```bash
# 查看迁移状态
wrangler d1 migrations list DB --local

# 如果迁移失败，可以手动执行 SQL 修复
wrangler d1 execute DB --local --command="ALTER TABLE ..."
```

### 2. 查询超时

- 检查是否返回了过多数据
- 添加 LIMIT 限制
- 使用索引字段进行查询
- 考虑分页查询

### 3. 唯一约束冲突

```typescript
// 处理重复插入
try {
  await c.env.DB.prepare("INSERT INTO Users ...").bind(...).run();
} catch (error) {
  if (error.message.includes('UNIQUE constraint failed')) {
    // 更新现有记录或返回错误
    await c.env.DB.prepare("UPDATE Users SET ... WHERE id = ?").bind(...).run();
  }
}
```

### 4. 数据库锁定

- 避免长时间运行的事务
- 不要在事务中进行网络请求
- 批量操作分批执行

## 开发技巧

### 本地开发使用本地数据库

```bash
# 启动开发服务器时使用本地 D1
wrangler dev --local

# 这会使用 .wrangler/state/d1/ 下的本地 SQLite 文件
```

### 查看本地数据库

```bash
# 本地数据库文件位置
ls .wrangler/state/d1/

# 使用 SQLite 工具查看
sqlite3 .wrangler/state/d1/DB.sqlite3 "SELECT * FROM Users"
```

### 性能监控

```typescript
// 添加查询时间日志
const start = Date.now();
const result = await c.env.DB.prepare("SELECT * FROM Users").all();
console.log(`Query took ${Date.now() - start}ms`);
```

## 相关资源

- [Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [SQLite 语法](https://www.sqlite.org/lang.html)
- [D1 限制和注意事项](https://developers.cloudflare.com/d1/platform/limits/)
