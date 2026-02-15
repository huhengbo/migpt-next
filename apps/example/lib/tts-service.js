/**
 * TTS 语音合成模块
 * 支持可配置、可扩展的 TTS Provider
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_PROVIDER = 'xiaomi';
const PROVIDER_ALIASES = {
  doubao: 'volcano',
};

/**
 * @typedef {{
 *   synthesize?: (text: string) => Promise<string>
 * }} TTSSynthProvider
 */

/**
 * TTS 服务类
 */
export class TTSService {
  constructor(config) {
    this.config = config.tts || {};
    this.volcConfig = this.config.volcano || {};

    this.providers = new Map();
    this.aliases = new Map(Object.entries(PROVIDER_ALIASES));

    this.registerBuiltins();
  }

  registerBuiltins() {
    // 小米默认播报: 不需要外部音频 URL
    this.registerProvider('xiaomi', {});

    // 豆包/火山: 走外部 TTS 合成
    this.registerProvider('volcano', {
      synthesize: async (text) => this.synthesizeByVolcano(text),
    });
  }

  /**
   * 注册 Provider，便于后续扩展新 TTS 服务
   * @param {string} name
   * @param {TTSSynthProvider} provider
   */
  registerProvider(name, provider) {
    const key = String(name || '')
      .trim()
      .toLowerCase();
    if (!key) {
      throw new Error('TTS provider name is required');
    }
    this.providers.set(key, provider || {});
  }

  /**
   * 注册别名，比如 doubao -> volcano
   * @param {string} alias
   * @param {string} target
   */
  registerAlias(alias, target) {
    const aliasKey = String(alias || '')
      .trim()
      .toLowerCase();
    const targetKey = String(target || '')
      .trim()
      .toLowerCase();
    if (!aliasKey || !targetKey) {
      throw new Error('TTS alias and target are required');
    }
    this.aliases.set(aliasKey, targetKey);
  }

  normalizeProvider(provider) {
    const raw = String(provider || DEFAULT_PROVIDER)
      .trim()
      .toLowerCase();
    return this.aliases.get(raw) || raw;
  }

  getProvider() {
    return this.normalizeProvider(this.config.provider || DEFAULT_PROVIDER);
  }

  getProviderImpl() {
    const provider = this.getProvider();
    const impl = this.providers.get(provider);
    if (!impl) {
      throw new Error(`不支持的 TTS 提供商: ${provider}`);
    }
    return impl;
  }

  listProviders() {
    return Array.from(this.providers.keys());
  }

  canSynthesize() {
    const impl = this.getProviderImpl();
    return typeof impl.synthesize === 'function';
  }

  /**
   * 合成语音
   * @param {string} text - 要合成的文本
   * @returns {Promise<string>} 音频文件 URL
   */
  async synthesize(text) {
    const provider = this.getProvider();
    const impl = this.getProviderImpl();

    if (typeof impl.synthesize !== 'function') {
      throw new Error(`当前 provider 为 ${provider}，不走外部 TTS 合成`);
    }

    return impl.synthesize(text);
  }

  validateVolcanoConfig() {
    if (!this.config.publicBaseURL) {
      throw new Error('缺少 tts.publicBaseURL，无法让音箱访问合成音频');
    }
    if (!this.volcConfig.endpoint) {
      throw new Error('缺少 tts.volcano.endpoint');
    }

    const authMode = String(this.volcConfig.authMode || 'api_key').toLowerCase();
    if (authMode === 'api_key' && !this.volcConfig.apiKey) {
      throw new Error('authMode=api_key 时缺少 tts.volcano.apiKey');
    }
    if (authMode === 'token' && (!this.volcConfig.appId || !this.volcConfig.token)) {
      throw new Error('authMode=token 时缺少 tts.volcano.appId 或 tts.volcano.token');
    }
  }

  /**
   * 使用火山引擎合成语音
   * @param {string} text - 文本内容
   * @returns {Promise<string>} 音频 URL
   */
  async synthesizeByVolcano(text) {
    this.validateVolcanoConfig();

    const reqid = randomUUID();
    const headers = { 'Content-Type': 'application/json' };
    const appPayload = { cluster: this.volcConfig.cluster };

    if (String(this.volcConfig.authMode || 'api_key').toLowerCase() === 'api_key') {
      headers['X-Api-Key'] = this.volcConfig.apiKey;
      if (this.volcConfig.appId) {
        headers['X-Api-App-Key'] = this.volcConfig.appId;
        appPayload.appid = this.volcConfig.appId;
      }
    } else {
      headers.Authorization = `Bearer;${this.volcConfig.token}`;
      appPayload.appid = this.volcConfig.appId;
      appPayload.token = this.volcConfig.token;
    }

    const requestBody = {
      app: appPayload,
      user: { uid: 'migpt-next' },
      audio: {
        voice_type: this.volcConfig.voiceType,
        encoding: this.volcConfig.encoding,
        rate: this.volcConfig.sampleRate,
        speed_ratio: this.volcConfig.speedRatio,
        volume_ratio: this.volcConfig.volumeRatio,
        pitch_ratio: this.volcConfig.pitchRatio,
      },
      request: {
        reqid,
        text,
        text_type: 'plain',
        operation: 'query',
      },
    };

    const response = await fetch(this.volcConfig.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`TTS HTTP 请求失败: ${response.status}`);
    }

    const result = await response.json();
    if (result.code !== 3000 || !result.data) {
      throw new Error(`TTS 服务错误: code=${result.code}, message=${result.message || 'unknown'}`);
    }

    const filename = await this.saveAudioFile(result.data, reqid);
    const baseURL = String(this.config.publicBaseURL || '').replace(/\/$/, '');
    return `${baseURL}/${filename}`;
  }

  /**
   * 保存音频文件到缓存目录
   * @param {string} base64Data - Base64 编码的音频数据
   * @param {string} reqid - 请求 ID
   * @returns {Promise<string>} 文件名
   */
  async saveAudioFile(base64Data, reqid) {
    mkdirSync(this.config.cacheDir, { recursive: true });
    this.cleanupOldFiles();

    const filename = `tts-${Date.now()}-${reqid}.mp3`;
    const filePath = join(this.config.cacheDir, filename);
    writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    return filename;
  }

  /**
   * 清理过期的音频文件
   */
  cleanupOldFiles() {
    const now = Date.now();
    const maxAge = this.config.maxCacheAge || 30 * 60 * 1000;

    try {
      const files = readdirSync(this.config.cacheDir);
      for (const name of files) {
        const filePath = join(this.config.cacheDir, name);
        const stat = statSync(filePath);
        if (stat.isFile() && now - stat.mtimeMs > maxAge) {
          unlinkSync(filePath);
        }
      }
    } catch (error) {
      console.warn('清理缓存文件失败:', error.message);
    }
  }
}
