/**
 * MiGPT-Next 主程序
 * 重构版本 - 使用 YAML 配置,模块化设计
 * 修复: 使用全局 engine 引用,与原版保持一致
 */

import { MiGPT } from '@mi-gpt/next';
import { APIServer } from './lib/api-server.js';
import { loadConfig } from './lib/config-loader.js';
import { MessageHandler } from './lib/message-handler.js';
import { ContextProviders, PromptContext } from './lib/prompt-context.js';
import { TTSService } from './lib/tts-service.js';

const AUTHOR_URL_FROM_DEP = 'https://del.wang';
const AUTHOR_URL = 'https://github.com/huhengbo/migpt-next';

// 统一替换依赖内置启动 Banner 里的作者地址
const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
  const patched = args.map((arg) =>
    typeof arg === 'string' ? arg.replaceAll(AUTHOR_URL_FROM_DEP, AUTHOR_URL) : arg,
  );
  originalConsoleLog(...patched);
};

// ⚡ 全局变量: engine 引用（启动时先绑定 MiGPT 单例，onMessage 中再同步最新引用）
let globalEngine = null;

/**
 * 主函数
 */
async function main() {
  console.log(`
/ $$      /$$ /$$   /$$$$$$  /$$$$$$$ /$$$$$$$$$
| $$$    /$$$|__/ /$$__  $$| $$__  $$|__  $$__/
| $$$$  /$$$$ /$$| $$  \\__/| $$  \\ $$   | $$   
| $$ $$/$$ $$| $$| $$ /$$$$| $$$$$$$/   | $$   
| $$  $$$| $$| $$| $$|_  $$| $$____/    | $$   
| $$\\  $ | $$| $$| $$  \\ $$| $$         | $$   
| $$ \\/  | $$| $$|  $$$$$$/| $$         | $$   
|__/     |__/|__/ \\______/ |__/         |__/                         
                                                                                                                 
    MiGPT-Next (重构版)  by: https://github.com/huhengbo/migpt-next
  `);

  try {
    // 1. 加载配置
    console.log('📦 加载配置文件...');
    const config = loadConfig('./config.yaml');
    console.log('✅ 配置加载成功');

    // 2. 创建 TTS 服务
    const ttsService = new TTSService(config);
    const ttsProvider = ttsService.getProvider();
    if (ttsService.canSynthesize()) {
      console.log(`✅ TTS 服务已初始化: ${ttsProvider}`);
    } else {
      console.log('✅ TTS 使用小米默认播报');
    }

    // 3. 创建 Prompt 上下文管理器
    let promptContext = null;
    if (config.promptContext?.enabled) {
      promptContext = new PromptContext(config.promptContext);

      // 注册内置上下文提供器
      promptContext.set('greeting', ContextProviders.greeting());
      promptContext.set('hour', ContextProviders.currentHour());

      console.log('✅ Prompt 模板引擎已初始化');
    }

    // 4. 渲染系统 Prompt (应用模板变量)
    let systemPrompt = config.ai.systemPrompt;
    if (promptContext) {
      systemPrompt = await promptContext.render(config.ai.systemPrompt);
      console.log('✅ 系统 Prompt 已渲染');
    }

    // 5. 创建 engine 访问器
    // 使用 getter 动态获取全局 engine,避免传递 null
    const getEngine = () => globalEngine;

    // 6. 启动前先绑定 MiGPT 引用，避免 API 在首次消息前返回 Engine not ready
    globalEngine = MiGPT;

    // 7. 提前创建 API 服务器和消息处理器
    // 使用工厂函数,延迟访问 engine
    const apiServer = new APIServer(config, { get: getEngine }, ttsService);
    const messageHandler = new MessageHandler(config, { get: getEngine }, apiServer);
    apiServer.start();

    // 8. 构建 MiGPT 配置
    const migptConfig = {
      speaker: {
        userId: config.speaker.userId,
        password: config.speaker.password,
        did: config.speaker.did,
        passToken: config.speaker.passToken,
      },
      openai: {
        baseURL: config.ai.baseURL,
        apiKey: config.ai.apiKey,
        model: config.ai.model,
        extra: {
          createParams: {
            temperature: config.ai.temperature,
            max_tokens: config.ai.maxTokens,
          },
        },
      },
      prompt: {
        system: systemPrompt,
      },
      // 消息处理回调
      async onMessage(engine, msg) {
        // 同步最新 engine 引用
        if (globalEngine !== engine) {
          globalEngine = engine;
          console.log('✅ Engine 引用已同步');
        }

        try {
          return await messageHandler.handle(msg);
        } catch (error) {
          console.error('❌ 消息处理失败:', error);
          return { handled: true };
        }
      },
    };

    // 9. 启动 MiGPT 引擎
    console.log('🚀 启动 MiGPT 引擎...');
    console.log('⏳ 等待 Mi 服务初始化完成...');
    console.log('✅ 系统准备就绪,启动中...');
    console.log('');

    // MiGPT.start() 会持续运行,不会返回
    await MiGPT.start(migptConfig);
  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

// 优雅退出
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    console.log(`\n📴 收到 ${signal} 信号,正在关闭...`);
    try {
      if (globalEngine?.stop) {
        await globalEngine.stop();
      }
      console.log('✅ 已安全退出');
      process.exit(0);
    } catch (error) {
      console.error('❌ 退出时出错:', error);
      process.exit(1);
    }
  });
}

// 启动程序
main();
