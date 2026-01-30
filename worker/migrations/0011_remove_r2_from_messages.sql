-- D1 数据库迁移文件
-- 版本: 0011
-- 描述: 修改私信表，将body字段改为直接存储文本内容

-- 创建新表，body字段直接存储文本
CREATE TABLE PrivateMessagesNew (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL, -- 直接存储消息内容
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES Conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- 将旧表数据迁移到新表（注意：旧数据中的body是R2 key，会丢失，这里设为空字符串）
INSERT INTO PrivateMessagesNew (id, conversation_id, author_id, body, created_at)
SELECT id, conversation_id, author_id, '', created_at FROM PrivateMessages;

-- 删除旧表
DROP TABLE PrivateMessages;

-- 重命名新表
ALTER TABLE PrivateMessagesNew RENAME TO PrivateMessages;
