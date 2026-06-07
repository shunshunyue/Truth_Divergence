# Truth Divergence

## 这是什么

Truth Divergence 是一个 AI 驱动的沉浸式推理调查游戏：玩家像在和一名工作 AI 聊天一样输入自然语言指令，系统会实时生成线索、证据、嫌疑人回应、地点信息、时间线和关系网络，让每一局案件都沿着玩家的提问逐步展开。

简单说，它不是固定剧本的解谜游戏，而是一个“真相固定、调查路径动态生成”的互动案件工作台。

## 怎么跑

1. clone 仓库

   ```bash
   git clone <你的仓库地址>
   cd truth-divergence
   ```

2. 安装依赖

   ```bash
   npm install
   ```

3. 配置 Unity2.ai API key

   复制环境变量模板：

   ```bash
   cp .env.example .env.local
   ```

   在 `.env.local` 中填写：

   ```env
   UNITY2_AI_BASE_URL=https://unity2.ai/
   UNITY2_AI_API_KEY=你的_API_Key
   UNITY2_AI_MODEL=你的模型名
   ```

   如果需要生成案件视觉图，也可以继续填写：

   ```env
   OPENAI_IMAGE_API_KEY=你的图片生成_API_Key
   OPENAI_IMAGE_MODEL=gpt-image-2
   ```

   如果需要使用本地案件缓存，请确保 MySQL 可用，并按需修改：

   ```env
   DATABASE_URL=mysql://root:123456@localhost:3306/truth_divergence
   ```

4. 运行项目

   ```bash
   npm run dev
   ```

   启动后访问：

   ```txt
   http://localhost:3000
   ```

5. 可选：预生成案件缓存

   ```bash
   npm run cache:worker
   ```

   这个脚本会提前生成案件，减少玩家进入调查时的等待时间。

## 用了什么

- 主要功能：AI 动态案件生成、自然语言调查、实时聊天式推理、嫌疑人审问、证据/线索/地点/时间线/关系图动态更新。
- 前端框架：Next.js、React、TypeScript、Tailwind CSS。
- 实时通信：自定义 Node.js Server + WebSocket，调查过程通过 `/ws/agent` 实时推送。
- AI 能力：Unity2.ai 兼容 OpenAI Chat Completions 接口，用于案件生成、调查发现、嫌疑人回复和推理反馈。
- 视觉生成：OpenAI-compatible Images API，可为案件封面、地点、物证、证据等生成视觉资产；未配置图片 API 时会自动使用本地 fallback 资源。
- 数据存储：MySQL，用于缓存预生成案件、案件状态和视觉资源 manifest。
- 数据校验：Zod，用于约束 AI 输出结构，降低动态生成内容跑偏的概率。
- 动效与图标：Framer Motion、Lucide React。

## 项目亮点

- 真相固定，路径自由：案件的凶手、动机、手法等核心真相在开局时确定，玩家可以自由选择调查路径，但 AI 不能随意改写最终答案。
- 像工作台一样破案：首页进入后是三栏调查界面，左侧沉淀证据和现场信息，中间是 AI 聊天，右侧追踪嫌疑人、时间线、关系和建议。
- 自然语言驱动：玩家可以直接输入“查看门禁记录”“审问张三”“对比案发前后的时间线”等指令，不需要死板点击固定选项。
- 实时生成与实时反馈：聊天内容先流式返回，随后补充结构化状态更新，调查体验更接近真正的在线协作。
- 有降级策略：没有完整 AI 或图片配置时，项目仍保留本地 fallback，方便开发、演示和调试。

## 常用命令

```bash
npm run dev              # 启动开发服务，自定义 server + WebSocket
npm run dev:next         # 只启动 Next.js 开发服务
npm run build            # 构建生产版本
npm run start            # 以生产模式启动自定义 server
npm run typecheck        # TypeScript 类型检查
npm run cache:worker     # 预生成案件缓存
npm run cache:visuals    # 为缓存案件补生成视觉资源
npm run image:smoke      # 测试图片生成配置
```

## 目录结构

```txt
src/app/                         # Next.js 页面与 API 路由
src/components/investigation/    # 调查工作台 UI
src/game/agent/                  # WebSocket Agent、聊天运行时和事件推送
src/game/engine/                 # 案件状态、动作解析与执行
src/game/cache/                  # MySQL 案件缓存
src/ai/                          # AI 文本/JSON/图片生成客户端
scripts/                         # 缓存、视觉资源和图片测试脚本
docs/                            # 项目设计与架构文档
```

## 环境变量说明

```env
UNITY2_AI_BASE_URL=              # Unity2.ai 或其他 OpenAI-compatible 服务地址
UNITY2_AI_API_KEY=               # 服务端使用的聊天/推理 API Key
UNITY2_AI_MODEL=                 # 聊天和案件生成模型名

OPENAI_IMAGE_BASE_URL=           # 图片生成服务地址
OPENAI_IMAGE_API_KEY=            # 图片生成 API Key
OPENAI_IMAGE_MODEL=              # 图片生成模型名

DATABASE_URL=                    # MySQL 连接地址
CASE_CACHE_TARGET=               # 希望保持的可用缓存案件数量
CASE_CACHE_INTERVAL_MS=          # 缓存 worker 检查间隔
```

注意：不要把 API Key 写进 `NEXT_PUBLIC_*` 变量，项目中的 AI Key 只应该在服务端读取。

### MinIO 图片存储

默认情况下，案件生成图会写入本地 `public/generated/cases`。如果不想让生成图进入项目目录和部署包，可以把视觉资源切到 MinIO：

```env
VISUAL_STORAGE_DRIVER=minio              # 使用 MinIO 保存生成图片；local 表示继续写本地 public 目录
MINIO_ENDPOINT=localhost                 # MinIO 服务地址，只写主机名或 IP，不要带 http://
MINIO_PORT=9000                          # MinIO API 端口
MINIO_USE_SSL=false                      # 本地开发通常为 false；HTTPS 部署时改为 true
MINIO_ACCESS_KEY=你的账号                 # MinIO access key
MINIO_SECRET_KEY=你的密码                 # MinIO secret key
MINIO_BUCKET=truth-divergence            # 存放生成图片的 bucket
MINIO_PUBLIC_URL=http://localhost:9000/truth-divergence  # 浏览器访问图片的公开基础地址
MINIO_PREFIX=generated/cases             # 对象名前缀
MINIO_CREATE_BUCKET=true                 # bucket 不存在时自动创建，开发环境推荐开启
```

`MINIO_PUBLIC_URL` 必须是浏览器可以直接访问图片的地址。也就是说，bucket 需要配置公开读取，或者这个地址要指向你自己的公开代理/CDN。切换到 MinIO 后，只影响新生成的图片；数据库里已有的旧图片 URL 不会自动迁移。

## 玩法示例

进入调查页后，可以尝试输入：

```txt
查看案发现场
调取门禁记录
询问保安昨晚看到了什么
审问嫌疑人张某
对比目前证据和时间线
总结目前最关键的矛盾
```

系统会根据当前案件状态返回聊天内容，并逐步更新证据、地点、嫌疑人、时间线和关系信息。
