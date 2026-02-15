/**
 * 消息处理模块
 * 处理小爱音箱的语音消息,实现唤醒词、AI 对话等功能
 */

export class MessageHandler {
  constructor(config, engine, apiServer) {
    this.config = config;
    this.engine = engine;
    this.apiServer = apiServer;
    this.wakeupConfig = config.wakeup;
    this.storyConfig = config.story;
  }

  /**
   * 处理收到的消息
   * @param {object} msg - 消息对象 { text: string, ... }
   * @returns {Promise<object|undefined>} { handled: boolean } 或 undefined
   */
  async handle(msg) {
    const engine = this.engine.get();
    if (!engine) {
      console.warn('Engine 未就绪,跳过消息处理');
      return;
    }

    const text = msg.text || '';
    const normalizedText = this.normalizeText(text);

    // 检查是否是停止播放指令
    if (this.isStopCommand(normalizedText)) {
      await this.apiServer.enqueueTask(
        async () => {
          try {
            await engine.speaker.abortXiaoAI();
          } catch (error) {
            console.warn('打断播放失败:', error.message);
          }
          try {
            await engine.MiNA.stop();
          } catch (error) {
            console.warn('停止播放失败:', error.message);
          }
        },
        { type: 'voice:stop' },
      );
      return { handled: true };
    }

    // 检查是否是进入 AI 模式指令
    if (this.isEnterAIModeCommand(normalizedText)) {
      this.apiServer.aiConversationMode = true;
      await this.apiServer.enqueueTask(
        () => this.apiServer.speakByText(this.wakeupConfig.enterMessage, { interrupt: true }),
        { type: 'voice:enter-ai-mode' },
      );
      return { handled: true };
    }

    // 检查是否是退出 AI 模式指令
    if (this.isExitAIModeCommand(normalizedText)) {
      this.apiServer.aiConversationMode = false;
      await this.apiServer.enqueueTask(
        () => this.apiServer.speakByText(this.wakeupConfig.exitMessage, { interrupt: true }),
        { type: 'voice:exit-ai-mode' },
      );
      return { handled: true };
    }

    // 检查是否需要触发 AI
    const matchedKeyword = this.findMatchedKeyword(text);
    const shouldHandleAI = this.apiServer.aiConversationMode || matchedKeyword;

    if (!shouldHandleAI) {
      return; // 不处理,让小爱自己回答
    }

    // ⚡⚡⚡ 关键修改:立即返回 handled,完全阻止小爱的默认处理
    // 这样小爱不会说 "我在" 或其他默认回复

    // 提取用户意图文本
    const userText = matchedKeyword ? this.extractUserIntent(text, matchedKeyword) : text;

    if (!userText) {
      return { handled: true };
    }

    // 在后台异步排队处理 AI 请求 (不阻塞返回)
    this.apiServer
      .enqueueTask(
        async () => {
          try {
            // 打断小爱
            await engine.speaker.abortXiaoAI();

            // 判断是否是故事模式
            const storyMode = this.isStoryRequest(userText);

            // 构建 AI 消息
            const aiMessage = { ...msg, text: userText };
            if (storyMode) {
              aiMessage.text = `${userText}\n${this.storyConfig.systemPrompt}`;
            }

            // 调用 AI 并播报
            const aiResponse = await engine.askAI(aiMessage);
            const replyText = aiResponse.text || '';

            if (replyText) {
              await this.apiServer.speakByText(replyText, { storyMode, interrupt: false });
            }
          } catch (error) {
            console.error('后台 AI 处理失败:', error);
          }
        },
        { type: 'voice:chat' },
      )
      .catch((error) => {
        console.error('语音任务入队失败:', error);
      });

    // 立即返回 handled,阻止小爱说话
    return { handled: true };
  }

  /**
   * 规范化文本 (去除空格和标点)
   */
  normalizeText(text) {
    return String(text || '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[，。,.!?！？]/g, '');
  }

  /**
   * 检查是否是停止播放指令
   */
  isStopCommand(normalizedText) {
    return this.wakeupConfig.stopKeywords.some((keyword) =>
      normalizedText.includes(this.normalizeText(keyword)),
    );
  }

  /**
   * 检查是否是进入 AI 模式指令
   */
  isEnterAIModeCommand(normalizedText) {
    return this.wakeupConfig.enterAIMode.some(
      (keyword) => normalizedText === this.normalizeText(keyword),
    );
  }

  /**
   * 检查是否是退出 AI 模式指令
   */
  isExitAIModeCommand(normalizedText) {
    return this.wakeupConfig.exitAIMode.some(
      (keyword) => normalizedText === this.normalizeText(keyword),
    );
  }

  /**
   * 查找匹配的唤醒关键词
   */
  findMatchedKeyword(text) {
    return this.wakeupConfig.keywords.find((keyword) => text.includes(keyword));
  }

  /**
   * 提取用户意图文本 (去除唤醒词)
   */
  extractUserIntent(fullText, keyword) {
    const raw = fullText.slice(fullText.indexOf(keyword) + keyword.length).trim();
    return raw.replace(/^[，。,.!?！？:\s]+/, '');
  }

  /**
   * 判断是否是故事请求
   */
  isStoryRequest(text) {
    const pattern = new RegExp(this.storyConfig.triggerPattern);
    return pattern.test(text);
  }
}
