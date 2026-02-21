# MiGPT-Next

`MiGPT-Next` 是基于 [MiGPT](https://github.com/idootop/mi-gpt) 的升级版本，支持**自定义消息回复**、**可插拔 TTS**（小米/火山/豆包）、**HTTP API** 和**故事模式**。

让人人都可以轻松定制自己的小爱音箱回复，让小爱音箱「听你的」。

## 主要特性

- 🎯 **YAML 配置驱动** — 一个 `config.yaml` 搞定所有参数，无需改代码
- 🗣️ **可插拔 TTS** — 支持小米默认播报 / 火山引擎（豆包）TTS，自由切换
- 🌐 **HTTP API** — 内置 REST API（speak / chat / play），可与智能家居/自动化联动
- 📖 **故事模式** — 自动分段播放长文本，适合睡前故事场景
- 🤖 **持续对话模式** — 进入/退出 AI 模式，连续多轮对话
- 🔧 **自定义消息回复** — 通过 `onMessage` 拦截并自定义任意回复逻辑

## Docker 运行（推荐）

首先，克隆仓库代码到本地：

```shell
# 克隆代码
git clone https://github.com/huhengbo/migpt-next.git

# 进入配置文件所在目录
cd migpt-next/apps/example
```

复制示例配置（`config.yaml` 已加入 git ignore，避免误提交密钥）：

```shell
cp config-example.yaml config.yaml
```

编辑 `config.yaml`，填入你的信息：

```yaml
speaker:
  userId: "你的小米ID"
  did: "音箱DID"
  passToken: "你的Token"

ai:
  model: "deepseek-v3"
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  apiKey: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"

tts:
  # 可选: xiaomi | volcano | doubao
  provider: "xiaomi"
```

> [!TIP]
> 完整配置参数（TTS、唤醒词、故事模式、HTTP API 等）请看 [apps/example/README.md](apps/example/README.md)。
> 底层 `@mi-gpt/next` SDK 参数说明请看 [apps/next/README.md](apps/next/README.md)。

使用 Docker Compose 部署：

```shell
# 在 apps/example 目录
docker compose up -d --build
```

常用命令：

```shell
docker compose ps
docker compose logs -f migpt-next
docker compose restart
docker compose down
```

验证服务是否正常：

```shell
curl http://localhost:18082/api/health
```

## Node.js SDK 运行

[![npm version](https://badge.fury.io/js/@mi-gpt%2Fnext.svg)](https://www.npmjs.com/package/@mi-gpt/next)

如果你希望用代码集成，可以直接安装 `@mi-gpt/next`：

```shell
pnpm install @mi-gpt/next
```

```typescript
import { MiGPT } from "@mi-gpt/next";

async function main() {
  await MiGPT.start({
    speaker: {
      userId: "123456",
      password: "xxxxxxxx",
      did: "Xiaomi 智能音箱 Pro",
    },
    openai: {
      model: "gpt-4o-mini",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
    prompt: {
      system: "你是一个智能助手，请根据用户的问题给出回答。",
    },
    async onMessage(engine, { text }) {
      if (text === "测试") {
        return { text: "你好，很高兴认识你！" };
      }
    },
  });
  process.exit(0);
}

main();
```

## HTTP API

部署后内置以下 REST 接口（详见 [apps/example/README.md](apps/example/README.md#http-api-接口)）：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查（无需鉴权） |
| `/api/speak` | POST | 让音箱说话 |
| `/api/chat` | POST | AI 对话并播报 |
| `/api/play` | POST | 播放指定音频 |

示例：

```shell
# 让音箱说一句话
curl -X POST http://localhost:18082/api/speak \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好，这是一个测试"}'
```

## 常见问题

### Q：一直提示登录失败，无法正常运行？

一般是因为登录小米账号时触发了安全验证，可以参考此处解决：https://github.com/huhengbo/migpt-next/issues/4

### Q：小爱同学总是抢话，能不能在 AI 回答的时候让小爱同学闭嘴？

> [!TIP]
> 如果你想要让小爱同学立即闭嘴，必须要刷机才能解决。相关教程请移步 👉 [Open-XiaoAI](https://github.com/idootop/open-xiaoai)

`MiGPT-Next` 的实现方式和 `MiGPT` 相同，都是走 API 请求：

- 响应延迟较大，难以打断小爱原有回复
- TTS 偶发失效，设备状态获取失败可能导致回复中断

基于上述原因，在新版 `MiGPT-Next` 中移除了对**连续对话**/流式响应功能的支持。

### Q：控制台能看到 AI 的回答文字，但是播放的还是小爱自己的回答？

`MiGPT-Next` 移除了 `ttsCommand` 参数，如果你是小爱音箱 Play（增强版）等机型，升级之后可能会出现 TTS 异常（听不到大模型的回复），你可以在 `apps/example/app.js` 里的 `onMessage` 函数中改成 MiOT 直出文本来规避：

```js
async onMessage(engine, msg) {
  if (engine.config.callAIKeywords.some((e) => msg.text.startsWith(e))) {
    await engine.speaker.abortXiaoAI();
    const { text } = await engine.askAI(msg);
    console.log(`🔊 ${text}`);
    await engine.MiOT.doAction(5, 1, text); // 把 5,1 换成你的设备 ttsCommand
    return { handled: true };
  }
}
```

## TODO

- 用户画像 + 场景模板（儿童模式/老人模式/夜间模式）
- 按时段自动切换 Prompt 与播报策略

## 免责声明

1. **适用范围**
   本项目为开源非营利项目，仅供学术研究或个人测试用途。严禁用于商业服务、网络攻击、数据窃取、系统破坏等违反《网络安全法》及使用者所在地司法管辖区的法律规定的场景。
2. **非官方声明**
   本项目由第三方开发者独立开发，与小米集团及其关联方（下称"权利方"）无任何隶属/合作关系，亦未获其官方授权/认可或技术支持。项目中涉及的商标、固件、云服务的所有权利归属小米集团。若权利方主张权益，使用者应立即主动停止使用并删除本项目。

继续下载或运行本项目，即表示您已完整阅读并同意[用户协议](agreement.md)，否则请立即终止使用并彻底删除本项目。

## License

MIT License © 2024-PRESENT [Del Wang](https://del.wang)

Fork maintained by [huhengbo](https://github.com/huhengbo/migpt-next)
