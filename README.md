# Serverless-BBS / CFWorker BBS

纯基于 Cloudflare Worker + D1 数据库 + S3 存储的类似 Discuz!3.5 论坛程序.

**演示:** [https://serverless-bbs.anquanssl.com](https://serverless-bbs.anquanssl.com)

## 技术栈

- **前端**: React 18 + TypeScript + Vite + Tailwind CSS + Radix UI
- **后端**: Cloudflare Worker + Hono 框架
- **数据库**: Cloudflare D1 (SQLite)
- **对象存储**: S3 兼容服务 (AWS S3/腾讯云COS/阿里云OSS/R2等)
- **编辑器**: Tiptap 富文本编辑器
- **认证**: WebAuthn + Zod 验证

## 本地调试

### 前置要求

- Node.js 18+
- Wrangler CLI
- Cloudflare 账号

### 安装步骤

```bash
# 克隆代码
git clone https://github.com/serverless-bbs/serverless-bbs.git
cd serverless-bbs

# 全局安装 wrangler
sudo npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 安装依赖
yarn

# 创建 D1 数据库（首次需要）
wrangler d1 create community-db

# 更新 wrangler.jsonc 中的 database_id

# 运行数据库迁移
yarn db:migrate

# 配置 S3 存储（复制并编辑 .env 文件）
cp .env.example .env
# 编辑 .env 填入 S3 配置信息

# 启动开发服务器
yarn dev
```

### D1 数据库操作

```bash
# 查看数据库列表
wrangler d1 list

# 查看数据库信息
wrangler d1 info community-db

# 执行 SQL 查询
wrangler d1 execute DB --local --command="SELECT * FROM Users LIMIT 5"

# 创建新迁移
wrangler d1 migrations create DB add_new_feature

# 运行迁移（本地）
yarn db:migrate

# 运行迁移（线上）
yarn db:migrations:apply
```

更多 D1 使用指南请查看 [docs/D1-guide.md](docs/D1-guide.md)

### 线上部署

[![Deploy with Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://deploy.workers.cloudflare.com/?url=https://github.com/kexoub/symmetrical-octo-umbrella)


## 截图

<details>
<summary>前台截图</summary>

![首页 - 未登录](docs/7.png)
![首页](docs/1.png)
![版块页](docs/2.png)
![帖子页](docs/3.png)
![他人资料页](docs/4.png)
![他人发帖页](docs/5.png)
![上传头像](docs/6.png)
</details>

<details>
<summary>后台截图</summary>

![](docs/后台/1.png)
![](docs/后台/2.png)
![](docs/后台/3.png)
![](docs/后台/4.png)
![](docs/后台/5.png)
![](docs/后台/6.png)
![](docs/后台/7.png)
![](docs/后台/8.png)
</details>


## 版本
版权不所有 (Copyleft) 授权。随意使用，但风险、后果与责任自担。
