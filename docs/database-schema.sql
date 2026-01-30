-- D1 数据库完整 Schema
-- 这是 Serverless-BBS 的完整数据库结构定义

-- ============================================
-- 核心用户相关表
-- ============================================

-- 用户表
CREATE TABLE Users (
    id TEXT PRIMARY KEY,                    -- 用户唯一ID (UUID)
    username TEXT NOT NULL UNIQUE,          -- 用户名
    email TEXT NOT NULL UNIQUE,             -- 邮箱
    created_at INTEGER NOT NULL,            -- 注册时间 (Unix时间戳)
    profile_bio TEXT,                       -- 个人简介
    avatar TEXT,                            -- 头像URL
    level INTEGER DEFAULT 1,                -- 用户等级
    role TEXT DEFAULT 'user'                -- 角色: user/admin
);

-- 用户积分表
CREATE TABLE Credits (
    user_id TEXT PRIMARY KEY,
    balance INTEGER DEFAULT 0,              -- 当前积分
    total_earned INTEGER DEFAULT 0,         -- 累计获得
    total_spent INTEGER DEFAULT 0,          -- 累计消费
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- 用户组表
CREATE TABLE UserGroups (
    level INTEGER PRIMARY KEY,              -- 等级作为ID
    name TEXT NOT NULL,                     -- 组名称
    color TEXT,                             -- 显示颜色
    min_credits INTEGER DEFAULT 0,          -- 最小积分要求
    max_credits INTEGER,                    -- 最大积分限制
    permissions TEXT                        -- 权限JSON
);

-- 用户认证表 (WebAuthn/Passkey)
CREATE TABLE Passkeys (
    id TEXT PRIMARY KEY,                    -- Passkey ID
    user_id TEXT NOT NULL,
    pubkey_blob BLOB NOT NULL,              -- 公钥
    sign_counter INTEGER DEFAULT 0,         -- 签名计数器
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- ============================================
-- 论坛版块相关表
-- ============================================

-- 版块表
CREATE TABLE Nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                     -- 版块名称
    description TEXT,                       -- 版块描述
    parent_node_id INTEGER,                 -- 父版块ID (支持层级)
    sort_order INTEGER DEFAULT 0,           -- 排序权重
    thread_count INTEGER DEFAULT 0,         -- 帖子数量
    reply_count INTEGER DEFAULT 0,          -- 回复数量
    icon TEXT,                              -- 图标URL
    is_locked BOOLEAN DEFAULT 0,            -- 是否锁定
    FOREIGN KEY (parent_node_id) REFERENCES Nodes(id) ON DELETE SET NULL
);

-- ============================================
-- 帖子内容相关表
-- ============================================

-- 帖子表
CREATE TABLE Threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,               -- 所属版块
    author_id TEXT NOT NULL,                -- 作者ID
    title TEXT NOT NULL,                    -- 标题
    body TEXT NOT NULL,                     -- 内容 (HTML)
    created_at INTEGER NOT NULL,            -- 创建时间
    last_reply_at INTEGER,                  -- 最后回复时间
    last_reply_user_id TEXT,                -- 最后回复用户
    view_count INTEGER DEFAULT 0,           -- 浏览次数
    reply_count INTEGER DEFAULT 0,          -- 回复数量
    is_pinned BOOLEAN DEFAULT 0,            -- 是否置顶
    is_locked BOOLEAN DEFAULT 0,            -- 是否锁定
    is_author_only BOOLEAN DEFAULT 0,       -- 仅作者可见
    type TEXT DEFAULT 'discussion',         -- 类型: discussion/poll/raffle
    read_permission INTEGER DEFAULT 0,      -- 阅读权限等级
    FOREIGN KEY (node_id) REFERENCES Nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (last_reply_user_id) REFERENCES Users(id) ON DELETE SET NULL
);

-- 回复表
CREATE TABLE Replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,             -- 所属帖子
    author_id TEXT NOT NULL,                -- 作者ID
    body TEXT NOT NULL,                     -- 内容
    created_at INTEGER NOT NULL,            -- 创建时间
    is_author_only BOOLEAN DEFAULT 0,       -- 仅作者可见
    reply_to_id INTEGER,                    -- 回复给某条回复 (嵌套回复)
    FOREIGN KEY (thread_id) REFERENCES Threads(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (reply_to_id) REFERENCES Replies(id) ON DELETE SET NULL
);

-- 评论表 (对帖子和回复的评论)
CREATE TABLE Comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_type TEXT NOT NULL,              -- 'thread' 或 'reply'
    parent_id INTEGER NOT NULL,             -- 父级ID
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (author_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- ============================================
-- 投票相关表
-- ============================================

-- 投票选项表
CREATE TABLE PollOptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,             -- 所属帖子
    option_text TEXT NOT NULL,              -- 选项文本
    vote_count INTEGER DEFAULT 0,           -- 票数
    sort_order INTEGER DEFAULT 0,           -- 排序
    FOREIGN KEY (thread_id) REFERENCES Threads(id) ON DELETE CASCADE
);

-- 用户投票记录表
CREATE TABLE UserVotes (
    user_id TEXT NOT NULL,
    poll_option_id INTEGER NOT NULL,
    voted_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, poll_option_id),
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (poll_option_id) REFERENCES PollOptions(id) ON DELETE CASCADE
);

-- ============================================
-- 私信相关表
-- ============================================

-- 会话表 (存储两个用户间的对话元数据)
CREATE TABLE Conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_id TEXT NOT NULL,                 -- 用户ID较小的
    user2_id TEXT NOT NULL,                 -- 用户ID较大的
    created_at INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL,       -- 最后消息时间
    last_message_excerpt TEXT,              -- 最后消息摘要
    user1_unread_count INTEGER DEFAULT 0,   -- user1的未读数
    user2_unread_count INTEGER DEFAULT 0,   -- user2的未读数
    UNIQUE (user1_id, user2_id),
    FOREIGN KEY (user1_id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (user2_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- 私信表
CREATE TABLE PrivateMessages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,       -- 所属会话
    author_id TEXT NOT NULL,                -- 发送者
    body TEXT NOT NULL,                     -- S3 key 或内容
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES Conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- ============================================
-- 通知和提醒表
-- ============================================

-- 提醒表
CREATE TABLE Reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,                  -- 接收者
    type TEXT NOT NULL,                     -- 类型: reply/like/system
    title TEXT NOT NULL,
    content TEXT,
    related_id INTEGER,                     -- 相关帖子/回复ID
    is_read BOOLEAN DEFAULT 0,              -- 是否已读
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- ============================================
-- 站点设置表
-- ============================================

-- 站点设置表 (键值对存储)
CREATE TABLE Settings (
    key TEXT PRIMARY KEY,                   -- 设置项名称
    value TEXT NOT NULL,                    -- 设置值 (JSON或字符串)
    updated_at INTEGER NOT NULL
);

-- ============================================
-- 索引优化
-- ============================================

-- 用户表索引
CREATE INDEX idx_users_username ON Users(username);
CREATE INDEX idx_users_created_at ON Users(created_at);
CREATE INDEX idx_users_level ON Users(level);

-- 版块表索引
CREATE INDEX idx_nodes_parent ON Nodes(parent_node_id);
CREATE INDEX idx_nodes_sort ON Nodes(sort_order);

-- 帖子表索引
CREATE INDEX idx_threads_node ON Threads(node_id);
CREATE INDEX idx_threads_author ON Threads(author_id);
CREATE INDEX idx_threads_created ON Threads(created_at);
CREATE INDEX idx_threads_last_reply ON Threads(last_reply_at);
CREATE INDEX idx_threads_pinned ON Threads(is_pinned, node_id);
CREATE INDEX idx_threads_type ON Threads(type);

-- 回复表索引
CREATE INDEX idx_replies_thread ON Replies(thread_id);
CREATE INDEX idx_replies_author ON Replies(author_id);
CREATE INDEX idx_replies_created ON Replies(created_at);
CREATE INDEX idx_replies_reply_to ON Replies(reply_to_id);

-- 评论表索引
CREATE INDEX idx_comments_parent ON Comments(parent_type, parent_id);
CREATE INDEX idx_comments_author ON Comments(author_id);

-- 投票表索引
CREATE INDEX idx_poll_options_thread ON PollOptions(thread_id);
CREATE INDEX idx_user_votes_option ON UserVotes(poll_option_id);

-- 私信表索引
CREATE INDEX idx_conversations_user1 ON Conversations(user1_id);
CREATE INDEX idx_conversations_user2 ON Conversations(user2_id);
CREATE INDEX idx_conversations_last_message ON Conversations(last_message_at);
CREATE INDEX idx_private_messages_conversation ON PrivateMessages(conversation_id);
CREATE INDEX idx_private_messages_created ON PrivateMessages(created_at);

-- 提醒表索引
CREATE INDEX idx_reminders_user ON Reminders(user_id);
CREATE INDEX idx_reminders_unread ON Reminders(user_id, is_read);
CREATE INDEX idx_reminders_created ON Reminders(created_at);

-- ============================================
-- 初始数据
-- ============================================

-- 插入默认用户组
INSERT INTO UserGroups (level, name, color, min_credits, max_credits, permissions) VALUES
(1, '新手会员', '#999999', 0, 100, '{"can_post": true, "can_reply": true}'),
(2, '注册会员', '#2B7ACD', 100, 500, '{"can_post": true, "can_reply": true, "can_upload": true}'),
(3, '中级会员', '#FF9900', 500, 2000, '{"can_post": true, "can_reply": true, "can_upload": true, "can_vote": true}'),
(4, '高级会员', '#FF6600', 2000, 5000, '{"can_post": true, "can_reply": true, "can_upload": true, "can_vote": true, "can_create_poll": true}'),
(5, '金牌会员', '#FF0000', 5000, 10000, '{"can_post": true, "can_reply": true, "can_upload": true, "can_vote": true, "can_create_poll": true, "can_announce": true}'),
(6, '论坛元老', '#9933CC', 10000, NULL, '{"can_post": true, "can_reply": true, "can_upload": true, "can_vote": true, "can_create_poll": true, "can_announce": true, "can_moderate": true}');

-- 插入默认版块
INSERT INTO Nodes (name, description, sort_order) VALUES
('综合讨论', '论坛综合讨论区', 1),
('技术交流', '技术分享与讨论', 2),
('闲聊灌水', '轻松闲聊区', 3),
('站务公告', '论坛公告和规则', 0);

-- 插入默认站点设置
INSERT INTO Settings (key, value, updated_at) VALUES
('site_name', 'Serverless BBS', strftime('%s', 'now')),
('site_description', '基于 Cloudflare 的无服务器论坛', strftime('%s', 'now')),
('registration_enabled', 'true', strftime('%s', 'now')),
('max_avatar_size', '2097152', strftime('%s', 'now')),  -- 2MB
('max_attachment_size', '20971520', strftime('%s', 'now')),  -- 20MB
('threads_per_page', '20', strftime('%s', 'now')),
('replies_per_page', '20', strftime('%s', 'now'));
