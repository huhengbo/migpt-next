/**
 * 配置加载模块
 * 负责从 YAML 文件读取并解析配置
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

/**
 * 加载 YAML 配置文件
 * @param {string} configPath - 配置文件路径
 * @returns {object} 解析后的配置对象
 */
export function loadConfig(configPath = './config.yaml') {
  try {
    const fullPath = resolve(configPath);
    const fileContent = readFileSync(fullPath, 'utf8');
    const config = yaml.load(fileContent);

    // 验证必需的配置项
    validateConfig(config);

    return config;
  } catch (error) {
    console.error('❌ 配置文件加载失败:', error.message);
    process.exit(1);
  }
}

/**
 * 验证配置完整性
 * @param {object} config - 配置对象
 */
function validateConfig(config) {
  const required = ['speaker.userId', 'speaker.did', 'ai.baseURL', 'ai.apiKey', 'ai.model'];

  for (const path of required) {
    const value = getNestedValue(config, path);
    if (!value) {
      throw new Error(`缺少必需的配置项: ${path}`);
    }
  }

  // 验证 speaker 认证信息
  if (!config.speaker.password && !config.speaker.passToken) {
    throw new Error('speaker.password 和 speaker.passToken 至少需要提供一个');
  }

  // 验证 API token
  if (config.api?.enabled && !config.api.token) {
    console.warn('⚠️  API 已启用但未设置 token,接口将无法鉴权');
  }

  validateTTSConfig(config);
}

function normalizeTTSProvider(provider) {
  const raw = String(provider || 'xiaomi')
    .trim()
    .toLowerCase();
  if (raw === 'doubao') return 'volcano';
  return raw;
}

function validateTTSConfig(config) {
  const provider = normalizeTTSProvider(config?.tts?.provider || 'xiaomi');

  // 对内置 provider 做强校验；未知 provider 留给运行期插件注册处理
  if (provider === 'volcano') {
    if (!config?.tts?.publicBaseURL) {
      throw new Error('tts.provider=volcano 时必须配置 tts.publicBaseURL');
    }

    const authMode = String(config?.tts?.volcano?.authMode || 'api_key').toLowerCase();
    if (authMode === 'api_key' && !config?.tts?.volcano?.apiKey) {
      throw new Error('tts.provider=volcano 且 authMode=api_key 时必须配置 tts.volcano.apiKey');
    }
    if (authMode === 'token' && (!config?.tts?.volcano?.appId || !config?.tts?.volcano?.token)) {
      throw new Error(
        'tts.provider=volcano 且 authMode=token 时必须配置 tts.volcano.appId 和 tts.volcano.token',
      );
    }
    return;
  }

  if (provider !== 'xiaomi') {
    console.warn(`⚠️ 检测到自定义 tts.provider=${provider}，请确保已在代码中注册对应插件`);
  }
}

/**
 * 获取嵌套对象的值
 * @param {object} obj - 对象
 * @param {string} path - 路径 (如 'a.b.c')
 * @returns {any} 值
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
