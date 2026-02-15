/**
 * Prompt 模板引擎
 * 支持变量替换和动态上下文注入
 */

/**
 * Prompt 上下文类
 * 管理所有可用的模板变量
 */
export class PromptContext {
  constructor(config) {
    this.config = config;
    this.customVars = new Map();
  }

  /**
   * 设置自定义变量
   * @param {string} key - 变量名
   * @param {any} value - 变量值 (可以是函数)
   */
  set(key, value) {
    this.customVars.set(key, value);
  }

  /**
   * 获取所有可用的上下文变量
   * @returns {Promise<object>} 变量对象
   */
  async getVariables() {
    const vars = {
      date: new Date().toLocaleDateString('zh-CN'),
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      datetime: new Date().toLocaleString('zh-CN'),
      timestamp: Date.now(),
      dayOfWeek: ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()],
      location: this.config.location || '未设置',
      userName: this.config.userName || '用户',
      assistantName: this.config.assistantName || '助手',
    };

    for (const [key, value] of this.customVars.entries()) {
      vars[key] = typeof value === 'function' ? await value() : value;
    }

    return vars;
  }

  /**
   * 渲染模板
   * @param {string} template - 包含变量的模板字符串
   * @returns {Promise<string>} 渲染后的字符串
   */
  async render(template) {
    if (!template || typeof template !== 'string') {
      return template;
    }

    const vars = await this.getVariables();

    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      if (varName in vars) {
        return String(vars[varName]);
      }
      return match;
    });
  }
}

/**
 * 上下文变量提供器
 */
export const ContextProviders = {
  /**
   * 天气信息提供器 (示例)
   * @param {string} location - 位置
   */
  weather(location) {
    return async () => `${location}今天晴天,20-28℃`;
  },

  /**
   * 对话历史提供器
   * @param {Function} getHistory - 获取历史的函数
   * @param {number} limit - 限制条数
   */
  conversationHistory(getHistory, limit = 5) {
    return async () => {
      const history = await getHistory(limit);
      if (!history || history.length === 0) {
        return '无历史对话';
      }
      return history.map((h) => `${h.role}: ${h.content}`).join('\n');
    };
  },

  currentHour() {
    return () => new Date().getHours();
  },

  greeting() {
    return () => {
      const hour = new Date().getHours();
      if (hour < 6) return '深夜好';
      if (hour < 9) return '早上好';
      if (hour < 12) return '上午好';
      if (hour < 14) return '中午好';
      if (hour < 18) return '下午好';
      if (hour < 22) return '晚上好';
      return '夜深了';
    };
  },

  /**
   * 自定义计算函数
   * @param {Function} fn - 计算函数
   */
  custom(fn) {
    return async () => {
      try {
        return await fn();
      } catch (error) {
        console.error('自定义上下文提供器错误:', error);
        return '';
      }
    };
  },
};
