# MiGPT-Next 使用文档

基于 YAML 配置的模块化版本，支持可配置的 TTS 提供商。

## 快速开始

### 1. 配置文件

先复制示例配置，再填写真实信息（`config.yaml` 已加入 git ignore，不会提交）：

```bash
cp config-example.yaml config.yaml
```

编辑 `config.yaml`，填入你的信息：

```yaml
speaker:
  userId: "你的小米ID"
  did: "音箱DID"
  passToken: "你的Token"

ai:
  baseURL: "AI服务地址"
  apiKey: "你的API密钥"
  model: "模型名称"

tts:
  provider: "xiaomi"  # 或 "volcano"/"doubao"
```

### 2. 使用 Docker Compose 部署（推荐）

```bash
# 在 apps/example 目录执行
docker compose up -d --build
```

常用命令：

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f migpt-next

# 重启
docker compose restart

# 停止并删除容器
docker compose down
```

### 3. 验证服务

```bash
curl http://localhost:18082/api/health
```

### 4. 使用 Dockerfile 手动构建镜像（可选）

```bash
# 在 apps/example 目录
docker build -t migpt-next:local .

# 运行容器
docker run -d \
  --name migpt-next \
  --restart unless-stopped \
  -p 18082:18082 \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/tts-cache:/app/tts-cache \
  migpt-next:local
```

### 5. 本地 Node 运行（可选）

```bash
node app.js
```

## Docker Compose 配置说明

项目内置 `docker-compose.yml`（底层使用同目录 `Dockerfile` 构建镜像）：

- 暴露端口：`18082:18082`
- 挂载配置：`./config.yaml:/app/config.yaml:ro`
- 挂载缓存：`./tts-cache:/app/tts-cache`
- 重启策略：`unless-stopped`
- 内置健康检查：`/api/health`

如果你使用 `volcano/doubao`，请确保 `config.yaml` 里的 `tts.publicBaseURL` 指向宿主机可达地址，例如：

```yaml
tts:
  provider: "volcano"
  publicBaseURL: "http://192.168.1.100:18082/api/audio"
```

## TTS 配置说明

### 支持的 TTS 提供商

| Provider | 说明 | 配置要求 |
|----------|------|----------|
| `xiaomi` | 小米默认播报（无需外部 TTS） | 无 |
| `volcano` | 火山引擎/豆包 TTS | 需配置 API 密钥和公网地址 |
| `doubao` | `volcano` 的别名 | 同 `volcano` |

### 使用小米默认播报

最简单的配置，不需要外部 TTS 服务：

```yaml
tts:
  provider: "xiaomi"
```

**特点：**
- ✅ 无需配置 API 密钥
- ✅ 无需公网地址
- ✅ 零成本
- ⚠️ 音质一般，音色单一

### 使用火山/豆包 TTS

需要申请火山引擎 TTS 服务（https://www.volcengine.com/product/tts）：

```yaml
tts:
  provider: "volcano"  # 或 "doubao"
  
  # 火山引擎配置
  volcano:
    endpoint: "https://openspeech.bytedance.com/api/v1/tts"
    authMode: "api_key"
    appId: "你的应用ID"
    apiKey: "你的API密钥"
    cluster: "volcano_tts"
    voiceType: "zh_female_vv_uranus_bigtts"
    encoding: "mp3"
    sampleRate: 24000
    speedRatio: 1.0
    volumeRatio: 1.0
    pitchRatio: 1.0
  
  # 音频缓存目录
  cacheDir: "./tts-cache"
  maxCacheAge: 1800000
  
  # 公网访问地址（必填）
  publicBaseURL: "http://你的公网IP:18082/api/audio"
```

**特点：**
- ✅ 音质好，音色丰富
- ✅ 支持语速/音量/音调调节
- ⚠️ 需要 API 密钥（有免费额度）
- ⚠️ 需要公网地址让音箱访问

### 火山 TTS 认证模式

支持两种认证方式：

#### 1. API Key 模式（推荐）

```yaml
volcano:
  authMode: "api_key"
  apiKey: "你的API密钥"
  appId: "你的应用ID"  # 可选
```

#### 2. Token 模式

```yaml
volcano:
  authMode: "token"
  appId: "你的应用ID"
  token: "你的Token"
```

### 公网地址配置

`publicBaseURL` 是音箱访问 TTS 音频的地址，必须满足：

1. **音箱能访问**：必须是音箱所在网络可达的地址
2. **格式正确**：`http://IP:端口/api/audio`
3. **端口开放**：确保防火墙允许访问

**示例：**

```yaml
# 局域网地址（推荐）
publicBaseURL: "http://192.168.1.100:18082/api/audio"

# 公网地址（需要端口映射）
publicBaseURL: "http://你的域名:18082/api/audio"
```

## HTTP API 接口

所有接口（除 `/api/health`）需要在请求头中携带 Token：

```
Authorization: Bearer <your-token>
```

### 1. 健康检查（无需鉴权）

```bash
GET /api/health
```

**响应：**
```json
{
  "ok": true,
  "status": "running",
  "aiMode": false,
  "engineReady": true,
  "ttsProvider": "volcano",
  "queueDepth": 0,
  "lastTaskType": "api:speak",
  "lastTaskFinishedAt": 1771070000000,
  "lastTaskError": null,
  "lastSpeakMode": "tts:volcano",
  "lastSpeakAt": 1771070000000,
  "timestamp": 1234567890
}
```

### 2. 让音箱说话

```bash
POST /api/speak
Content-Type: application/json

{
  "text": "你好，这是一个测试",
  "interrupt": true,
  "storyMode": false
}
```

**参数：**
- `text`（必需）：要播报的文本
- `interrupt`（可选，默认 true）：是否打断当前播放
- `storyMode`（可选，默认 false）：是否使用故事模式（分段播放）

**响应：**
```json
{
  "ok": true,
  "type": "speak",
  "mode": "tts:volcano",
  "text": "你好，这是一个测试",
  "waitedMs": 123
}
```

**mode 说明：**
- `xiaomi`：小米默认播报
- `tts:volcano`：火山 TTS 单段播放
- `tts:volcano:story`：火山 TTS 故事模式

### 3. 与 AI 对话并播报

```bash
POST /api/chat
Content-Type: application/json

{
  "text": "天空为什么是蓝色的？",
  "interrupt": true,
  "storyMode": false
}
```

**响应：**
```json
{
  "ok": true,
  "type": "chat",
  "mode": "tts:volcano",
  "replyText": "天空是蓝色的是因为...",
  "waitedMs": 456
}
```

### 4. 播放指定音频

```bash
POST /api/play
Content-Type: application/json

{
  "url": "http://example.com/audio.mp3",
  "interrupt": true,
  "blocking": false
}
```

**参数：**
- `url`（必需）：音频文件 URL
- `interrupt`（可选，默认 true）：是否打断当前播放
- `blocking`（可选，默认 false）：是否阻塞等待播放完成

## 配置参数详解

### speaker - 音箱配置

```yaml
speaker:
  userId: "your_xiaomi_user_id"     # 小米账号 ID（必填）
  password: ""                       # 密码（可选，有 passToken 时可留空）
  did: "your_speaker_did"           # 设备 DID（必填）
  passToken: "your_xiaomi_pass_token" # 免密登录 Token（必填）
```

### ai - AI 模型配置

```yaml
ai:
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  apiKey: "sk-..."
  model: "deepseek-v3"
  temperature: 0.7             # 温度参数（0-2）
  maxTokens: 1800              # 最大生成 token 数
  systemPrompt: "你是一个智能助手..."
```

### promptContext - Prompt 模板配置

```yaml
promptContext:
  enabled: true
  location: "中国江苏徐州云龙区"
  userName: "主人"
  assistantName: "小爱助手"
```

**可用模板变量：**
- `{{date}}`：当前日期
- `{{time}}`：当前时间
- `{{datetime}}`：日期时间
- `{{dayOfWeek}}`：星期几
- `{{location}}`：位置
- `{{userName}}`：用户名
- `{{assistantName}}`：助手名称
- `{{greeting}}`：时段问候语
- `{{hour}}`：当前小时

### wakeup - 唤醒词配置

```yaml
wakeup:
  keywords:                    # AI 对话唤醒关键词
    - "请"
    - "帮我"
    - "告诉我"
  enterAIMode:                 # 进入持续对话模式
    - "我要玩豆包"
    - "进入豆包模式"
  exitAIMode:                  # 退出持续对话模式
    - "退出豆包"
    - "关闭豆包模式"
  stopKeywords:                # 停止播放
    - "闭嘴"
    - "别说了"
    - "停下"
  enterMessage: "好的，已经进入豆包模式..."
  exitMessage: "好的，已退出豆包模式。"
```

### story - 故事模式配置

```yaml
story:
  triggerPattern: "(西游记|故事|睡前|童话|寓言|神话|讲个|讲一个|讲一段|讲点)"
  systemPrompt: "【讲故事模式要求】..."
  firstChunkMaxChars: 160      # 第一段最大字符数
  normalChunkMaxChars: 280     # 后续段落最大字符数
  pollIntervalMs: 700          # 播放状态轮询间隔
  waitTimeoutMs: 180000        # 等待播放超时时间
```

### api - HTTP API 配置

```yaml
api:
  enabled: true
  host: "0.0.0.0"
  port: 18082
  token: "replace_with_a_strong_random_token"
  maxBodyBytes: 16384
  paths:
    health: "/api/health"
    speak: "/api/speak"
    chat: "/api/chat"
    play: "/api/play"
    audioInfo: "/api/audio"
```

## 故障排查

### 问题 1：API 返回 "Engine not ready"

**原因：**真实 Engine 还未激活

**解决：**对小爱音箱说任何话，比如"小爱同学，今天天气怎么样"

### 问题 2：TTS 合成失败

**检查：**
1. `config.yaml` 中 `tts.provider` 是否正确
2. 如果是 `volcano`，检查 `publicBaseURL` 是否配置
3. 音箱能否访问 `publicBaseURL` 地址
4. 火山引擎 API 密钥是否有效

**调试：**
```bash
# 查看日志
tail -f /tmp/migpt-next.log

# 测试音频访问
curl http://你的publicBaseURL/文件名.mp3
```

### 问题 3：配置验证失败

**常见错误：**

```
不支持的 tts.provider: xxx
```
→ 只支持 `xiaomi`、`volcano`、`doubao`

```
tts.provider=volcano 时必须配置 tts.publicBaseURL
```
→ 使用火山 TTS 时必须配置公网地址

```
authMode=api_key 时必须配置 tts.volcano.apiKey
```
→ 检查 API 密钥是否填写

### 问题 4：音箱无声音

**排查步骤：**

1. **检查 TTS provider**
   ```bash
   curl http://localhost:18082/api/health
   # 查看 ttsProvider 字段
   ```

2. **如果是 volcano，检查音频文件**
   ```bash
   ls -lh apps/example/tts-cache
   # 应该能看到 tts-*.mp3 文件
   ```

3. **测试音频访问**
   ```bash
   # 从音箱所在网络访问
   curl -I http://你的publicBaseURL/tts-xxx.mp3
   # 应该返回 200 OK
   ```

4. **检查防火墙**
   ```bash
   # 确保端口开放
   sudo ufw allow 18082
   ```

## 使用场景

### 场景 1：智能家居通知

```bash
# 门铃通知
curl -X POST http://localhost:18082/api/speak \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"有人按门铃"}'

# 定时提醒
curl -X POST http://localhost:18082/api/speak \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"该吃药了"}'
```

### 场景 2：AI 对话

```bash
# 问答
curl -X POST http://localhost:18082/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"今天天气怎么样"}'

# 讲故事
curl -X POST http://localhost:18082/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"讲个西游记的故事","storyMode":true}'
```

### 场景 3：播放音频

```bash
# 播放音乐
curl -X POST http://localhost:18082/api/play \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://music.example.com/song.mp3"}'
```

## 项目结构

```
apps/example/
├── app.js                   # 主程序入口
├── config-example.yaml      # 示例配置（可提交）
├── config.yaml              # 本地配置（含密钥，git ignore）
├── docker-compose.yml       # Docker Compose 部署文件
├── lib/
│   ├── config-loader.js    # 配置加载器
│   ├── tts-service.js      # TTS 语音合成服务
│   ├── api-server.js       # HTTP API 服务器
│   ├── message-handler.js  # 消息处理器
│   └── prompt-context.js   # Prompt 模板引擎
├── tts-cache/              # TTS 音频缓存目录
└── README.md               # 本文件
```

## TODO

- 用户画像 + 场景模板（儿童模式/老人模式/夜间模式）
- 按时段自动切换 Prompt 与播报策略

## 许可证

MIT License © 2024-PRESENT [Del Wang](https://del.wang)
