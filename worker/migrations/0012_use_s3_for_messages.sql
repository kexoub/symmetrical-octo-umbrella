-- D1 数据库迁移文件
-- 版本: 0012
-- 描述: 修改私信表，将body字段改为存储S3 key

-- 由于之前将body改为直接存储文本，现在需要改回存储S3 key
-- 注意：这会丢失现有的私信内容，因为之前的body是文本内容而不是S3 key

-- 创建新表，body字段存储S3 key
CREATE TABLE PrivateMessagesNew (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL, -- 存储S3 key
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES Conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- 将旧表数据迁移到新表（注意：旧数据会丢失，因为无法从文本内容生成S3 key）
-- 这里将body设为空字符串作为标记
INSERT INTO PrivateMessagesNew (id, conversation_id, author_id, body, created_at)
SELECT id, conversation_id, author_id, '', created_at FROM PrivateMessages;

-- 删除旧表
DROP TABLE PrivateMessages;

-- 重命名新表
ALTER TABLE PrivateMessagesNew RENAME TO PrivateMessages;
