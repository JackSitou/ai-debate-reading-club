# AI 杠精读书会 - 后端服务

大模型对话 + 知识库管理 API。

## 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/JackSitou/ai-debate-reading-club.git
cd ai-debate-reading-club/backend

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 API Key

# 3. 启动服务
node server.js
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEFAULT_PROVIDER` | 默认大模型提供商 | `openrouter` |
| `HF_API_KEY` | HuggingFace Token | - |
| `OPENROUTER_KEY` | OpenRouter Key | - |
| `OPENAI_KEY` | OpenAI Key | - |
| `PORT` | 服务端口号 | `3000` |

## 免费获取 API Key

- **OpenRouter**（推荐）: https://openrouter.ai/keys → 注册免费账号即可获取
- **HuggingFace**: https://huggingface.co/settings/tokens → 免费注册获取

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/debate/opening` | 生成辩论开场白 |
| POST | `/api/debate/reply` | 生成辩论回复 |
| POST | `/api/debate/close` | 生成辩论结束语 |
| POST | `/api/knowledge/parse` | 解析文章（提取主题、标签、观点） |

## 部署

### Railway（推荐，免费）

1. Fork 本仓库到 GitHub
2. 打开 [Railway](https://railway.app) 注册账号
3. 新建项目 → Deploy from GitHub repo
4. 选择你的 fork
5. 添加环境变量（Settings → Variables）
6. 自动生成域名，前端填入该域名即可

### Render（免费）

1. 打开 [Render](https://render.com)
2. New Web Service → 连接 GitHub 仓库
3. 设置：
   - Build Command: `echo "No build needed"`
   - Start Command: `node backend/server.js`
4. 添加环境变量
5. 部署完成

### Docker

```bash
docker build -t ai-debate-backend ./backend
docker run -p 3000:3000 -e OPENROUTER_KEY=your_key ai-debate-backend
```
