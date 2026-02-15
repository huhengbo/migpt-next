/**
 * HTTP API 服务器模块
 * 提供外部控制接口: speak, chat, play, audio/info
 */

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat as statPromise } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, normalize, resolve } from 'node:path';

/**
 * API 服务器类
 */
export class APIServer {
  constructor(config, engine, ttsService) {
    this.config = config.api;
    this.engine = engine;
    this.ttsService = ttsService;
    this.storyConfig = config.story;

    // 任务队列,确保音箱操作顺序执行
    this.taskQueue = Promise.resolve();
    this.queueDepth = 0;

    this.lastTaskType = null;
    this.lastTaskError = null;
    this.lastTaskFinishedAt = null;

    this.lastSpeakMode = null;
    this.lastSpeakAt = null;

    // AI 持续对话模式标志
    this.aiConversationMode = false;
  }

  /**
   * 启动 HTTP 服务器
   */
  start() {
    if (!this.config.enabled) {
      console.log('⚠️  HTTP API 未启用');
      return;
    }

    const server = createServer((req, res) => this.handleRequest(req, res));

    server.listen(this.config.port, this.config.host, () => {
      const paths = Object.values(this.config.paths).join(', ');
      console.log(`✅ API 服务已启动: http://${this.config.host}:${this.config.port}`);
      console.log(`   接口路径: ${paths}`);
    });

    return server;
  }

  /**
   * 处理 HTTP 请求
   */
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // 健康检查接口 (无需鉴权)
    if (pathname === this.config.paths.health) {
      const engine = this.engine?.get?.();
      return this.writeJson(res, 200, {
        ok: true,
        status: 'running',
        aiMode: this.aiConversationMode,
        engineReady: Boolean(engine?.MiNA && engine.MiOT),
        ttsProvider: this.ttsService?.getProvider?.() || 'xiaomi',
        queueDepth: this.queueDepth,
        lastTaskType: this.lastTaskType,
        lastTaskFinishedAt: this.lastTaskFinishedAt,
        lastTaskError: this.lastTaskError,
        lastSpeakMode: this.lastSpeakMode,
        lastSpeakAt: this.lastSpeakAt,
        timestamp: Date.now(),
      });
    }

    // 音频文件接口 (GET 请求,无需鉴权)
    if (req.method === 'GET' && pathname.startsWith(this.config.paths.audioInfo)) {
      return this.handleAudioStream(req, res, pathname);
    }

    // 其他接口需要 POST 方法
    if (req.method !== 'POST') {
      return this.writeJson(res, 404, { ok: false, error: 'Not Found' });
    }

    // 验证鉴权 token
    if (!this.validateAuth(req)) {
      return this.writeJson(res, 401, { ok: false, error: 'Unauthorized' });
    }

    // 读取请求体
    let body;
    try {
      body = await this.readBody(req);
    } catch (error) {
      return this.writeJson(res, 400, {
        ok: false,
        error: `Invalid request body: ${error.message}`,
      });
    }

    // 路由分发
    try {
      const queuedAt = Date.now();

      if (pathname === this.config.paths.speak) {
        const result = await this.handleSpeak(body);
        return this.writeJson(res, 200, { ...result, waitedMs: Date.now() - queuedAt });
      }

      if (pathname === this.config.paths.chat) {
        const result = await this.handleChat(body);
        return this.writeJson(res, 200, { ...result, waitedMs: Date.now() - queuedAt });
      }

      if (pathname === this.config.paths.play) {
        const result = await this.handlePlay(body);
        return this.writeJson(res, 200, { ...result, waitedMs: Date.now() - queuedAt });
      }

      return this.writeJson(res, 404, { ok: false, error: 'Not Found' });
    } catch (error) {
      console.error('API 请求处理失败:', error);
      return this.writeJson(res, 500, { ok: false, error: error.message });
    }
  }

  /**
   * 处理 /api/speak - 让音箱说话
   * Body: { text: string, interrupt?: boolean, storyMode?: boolean }
   */
  async handleSpeak(body) {
    const text = String(body?.text || '').trim();
    if (!text) {
      throw new Error('text is required');
    }

    const interrupt = body?.interrupt !== false;
    const storyMode = body?.storyMode === true;

    const mode = await this.enqueueTask(() => this.speakByText(text, { interrupt, storyMode }), {
      type: 'api:speak',
    });

    return {
      ok: true,
      type: 'speak',
      mode,
      text,
    };
  }

  /**
   * 处理 /api/chat - 与 AI 对话并播报
   * Body: { text: string, interrupt?: boolean, storyMode?: boolean }
   */
  async handleChat(body) {
    const text = String(body?.text || '').trim();
    if (!text) {
      throw new Error('text is required');
    }

    const interrupt = body?.interrupt !== false;
    const storyMode = body?.storyMode === true;

    const result = await this.enqueueTask(() => this.askAndSpeak(text, { interrupt, storyMode }), {
      type: 'api:chat',
    });

    return {
      ok: true,
      type: 'chat',
      mode: result.mode,
      replyText: result.replyText,
    };
  }

  /**
   * 处理 /api/play - 播放指定音频
   * Body: { url: string, interrupt?: boolean, blocking?: boolean }
   */
  async handlePlay(body) {
    const url = String(body?.url || '').trim();
    if (!url) {
      throw new Error('url is required');
    }

    const interrupt = body?.interrupt !== false;
    const blocking = body?.blocking === true;

    const mode = await this.enqueueTask(() => this.playByUrl(url, { interrupt, blocking }), {
      type: 'api:play',
    });

    return {
      ok: true,
      type: 'play',
      mode,
      url,
    };
  }

  /**
   * 处理音频文件流 (GET /api/audio/:filename)
   * 直接返回文件流,类似 nginx 静态服务
   */
  async handleAudioStream(_req, res, pathname) {
    try {
      const prefix = `${this.config.paths.audioInfo}/`;
      if (!pathname.startsWith(prefix)) {
        return this.writeJson(res, 400, { ok: false, error: 'Invalid audio path' });
      }

      const rawName = pathname.slice(prefix.length);
      const filename = decodeURIComponent(rawName);
      if (!filename) {
        return this.writeJson(res, 400, { ok: false, error: 'Filename required' });
      }

      const cacheDir = resolve(this.ttsService?.config?.cacheDir || './tts-cache');
      const safeName = normalize(filename).replace(/^([.][.][/\\])+/, '');
      const filePath = resolve(cacheDir, safeName);
      if (!filePath.startsWith(`${cacheDir}/`)) {
        return this.writeJson(res, 400, { ok: false, error: 'Invalid filename' });
      }

      // 检查文件是否存在
      const fileStat = await statPromise(filePath);

      if (!fileStat.isFile()) {
        return this.writeJson(res, 404, { ok: false, error: 'File not found' });
      }

      // 根据扩展名设置 MIME 类型
      const ext = extname(filename).toLowerCase();
      const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.flac': 'audio/flac',
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      // 设置响应头
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': fileStat.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      });

      // 创建文件流并管道到响应
      const fileStream = createReadStream(filePath);
      fileStream.pipe(res);

      // 错误处理
      fileStream.on('error', (error) => {
        console.error('音频文件流错误:', error);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    } catch (error) {
      console.error('读取音频文件失败:', error.message);
      if (!res.headersSent) {
        return this.writeJson(res, 404, { ok: false, error: `File not found: ${error.message}` });
      }
    }
  }

  getEngineOrThrow() {
    const engine = this.engine?.get?.();
    if (!engine || !engine.MiNA || !engine.MiOT) {
      throw new Error('Engine not ready');
    }
    return engine;
  }

  /**
   * 让音箱说话 (TTS)
   */
  async speakByText(text, options = {}) {
    const { interrupt = false, storyMode = false } = options;
    const engine = this.getEngineOrThrow();

    if (interrupt) {
      await engine.speaker.abortXiaoAI();
    }

    const ttsProvider = this.ttsService?.getProvider?.() || 'xiaomi';

    // 外部 TTS（如豆包/火山）
    if (this.ttsService?.canSynthesize?.()) {
      try {
        if (storyMode) {
          await this.speakStoryMode(text);
          this.lastSpeakMode = `tts:${ttsProvider}:story`;
          this.lastSpeakAt = Date.now();
          return this.lastSpeakMode;
        }

        const audioUrl = await this.ttsService.synthesize(text);
        await engine.speaker.play({ url: audioUrl });
        this.lastSpeakMode = `tts:${ttsProvider}`;
        this.lastSpeakAt = Date.now();
        return this.lastSpeakMode;
      } catch (error) {
        console.warn(`TTS(${ttsProvider}) 合成失败,回退到小爱 TTS:`, error.message);
      }
    }

    // 小米默认播报
    await engine.speaker.play({ text });
    this.lastSpeakMode = 'xiaomi';
    this.lastSpeakAt = Date.now();
    return 'xiaomi';
  }

  /**
   * 故事模式播放 (分段合成和播放)
   */
  async speakStoryMode(text) {
    const engine = this.getEngineOrThrow();

    const firstChunkMaxChars = this.storyConfig.firstChunkMaxChars;
    const normalChunkMaxChars = this.storyConfig.normalChunkMaxChars || firstChunkMaxChars;
    const chunks = this.splitTextForStory(text, firstChunkMaxChars, normalChunkMaxChars);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const audioUrl = await this.ttsService.synthesize(chunk);

      // 第一段立即播放,后续等待播放完成
      if (i === 0) {
        await engine.speaker.play({ url: audioUrl });
      } else {
        await this.waitForAudioComplete();
        await engine.speaker.play({ url: audioUrl });
      }
    }

    return 'story';
  }

  /**
   * 分割文本用于故事模式
   */
  splitTextForStory(text, firstChunkMaxChars, normalChunkMaxChars) {
    const sentences = text.split(/[。！？]/);
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
      const cleanSentence = sentence.trim();
      if (!cleanSentence) continue;

      const limit = chunks.length === 0 ? firstChunkMaxChars : normalChunkMaxChars;
      const candidate = `${current}${cleanSentence}。`;

      if (current && candidate.length > limit) {
        chunks.push(current);
        current = `${cleanSentence}。`;
      } else {
        current = candidate;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  /**
   * 等待音频播放完成
   */
  async waitForAudioComplete() {
    const engine = this.getEngineOrThrow();

    const interval = this.storyConfig.pollIntervalMs;
    const timeout = this.storyConfig.waitTimeoutMs;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await engine.speaker.getPlayingStatus();
      if (!status.is_playing) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error('等待音频播放超时');
  }

  /**
   * 询问 AI 并播报回答
   */
  async askAndSpeak(text, options = {}) {
    const engine = this.getEngineOrThrow();

    const { interrupt = false, storyMode = false } = options;

    if (interrupt) {
      await engine.speaker.abortXiaoAI();
    }

    // 调用 AI（@mi-gpt/chat 需要完整消息结构，至少包含 sender）
    const aiResponse = await engine.askAI({
      id: randomUUID(),
      sender: 'user',
      text,
      timestamp: Date.now(),
    });
    const replyText = aiResponse.text || '';

    if (!replyText) {
      return { mode: null, replyText: '' };
    }

    // 播报回答
    const mode = await this.speakByText(replyText, { interrupt: false, storyMode });

    return { mode, replyText };
  }

  /**
   * 播放指定 URL 的音频
   */
  async playByUrl(url, options = {}) {
    const engine = this.getEngineOrThrow();

    const { interrupt = false, blocking = false } = options;

    if (interrupt) {
      await engine.speaker.abortXiaoAI();
    }

    await engine.speaker.play({ url, blocking });
    return 'url';
  }

  /**
   * 将任务加入队列顺序执行
   */
  async enqueueTask(task, meta = {}) {
    const taskType = typeof meta === 'string' ? meta : meta.type || 'task';

    this.queueDepth += 1;

    const wrappedTask = async () => {
      try {
        const result = await task();
        this.lastTaskError = null;
        return result;
      } catch (error) {
        this.lastTaskError = {
          type: taskType,
          message: error?.message || String(error),
          at: Date.now(),
        };
        throw error;
      } finally {
        this.queueDepth = Math.max(0, this.queueDepth - 1);
        this.lastTaskType = taskType;
        this.lastTaskFinishedAt = Date.now();
      }
    };

    this.taskQueue = this.taskQueue.then(wrappedTask, wrappedTask);
    return this.taskQueue;
  }

  /**
   * 验证 API 鉴权
   */
  validateAuth(req) {
    if (!this.config.token) {
      return true; // 未配置 token 则不验证
    }

    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    return token === this.config.token;
  }

  /**
   * 读取请求体
   */
  async readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;

      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > this.config.maxBodyBytes) {
          reject(new Error('Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });

      req.on('error', reject);
    });
  }

  /**
   * 写入 JSON 响应
   */
  writeJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
