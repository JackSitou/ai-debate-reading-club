/**
 * AI 杠精读书会 - 后端服务
 * 零依赖，使用 Node.js 原生 http 模块
 * 支持：HuggingFace / OpenRouter / 自定义 OpenAI 兼容 API
 */

const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;
const HF_API_KEY = process.env.HF_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';
const OPENAI_KEY = process.env.OPENAI_KEY || '';
const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER || 'openrouter'; // huggingface | openrouter | openai

// ===== CORS Headers =====
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8'
};

// ===== Utils =====
function sendJSON(res, status, data) {
  res.writeHead(status, CORS_HEADERS);
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
  });
}

// ===== LLM Service =====
const PROVIDERS = {
  huggingface: {
    url: 'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3',
    headers: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    }),
    buildBody: (messages, temp) => ({
      inputs: buildHFPrompt(messages),
      parameters: {
        max_new_tokens: 300,
        temperature: temp,
        top_p: 0.9,
        return_full_text: false
      }
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      let text = Array.isArray(data) ? (data[0]?.generated_text || '') : (data.generated_text || '');
      return cleanHFResponse(text);
    }
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://jacksitou.github.io/ai-debate-reading-club/',
      'X-Title': 'AI Debate Reading Club'
    }),
    buildBody: (messages, temp) => ({
      model: 'mistralai/mistral-7b-instruct:free',
      messages: messages,
      temperature: temp,
      max_tokens: 300
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    }),
    buildBody: (messages, temp) => ({
      model: 'gpt-3.5-turbo',
      messages: messages,
      temperature: temp,
      max_tokens: 300
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }
  }
};

function buildHFPrompt(messages) {
  // Mistral chat format
  let prompt = '<s>';
  messages.forEach(m => {
    if (m.role === 'system') {
      prompt += `[INST] ${m.content} [/INST]`;
    } else if (m.role === 'assistant') {
      prompt += ` ${m.content}</s>`;
    } else {
      prompt += ` [INST] ${m.content} [/INST]`;
    }
  });
  return prompt + ' ';
}

function cleanHFResponse(text) {
  return text
    .replace(/<\/?s>/g, '')
    .replace(/\[INST\].*?\[\/INST\]/gs, '')
    .replace(/^\s*[\u4e00-\u9fa5]/, '$&') // Keep Chinese start
    .trim();
}

async function callLLM(messages, temperature = 0.7, provider = null, customKey = null) {
  const prov = provider || DEFAULT_PROVIDER;
  const config = PROVIDERS[prov];
  if (!config) throw new Error(`Unknown provider: ${prov}`);

  const key = customKey || (prov === 'huggingface' ? HF_API_KEY : prov === 'openrouter' ? OPENROUTER_KEY : OPENAI_KEY);
  if (!key) throw new Error(`No API key for provider: ${prov}`);

  const response = await fetch(config.url, {
    method: 'POST',
    headers: config.headers(key),
    body: JSON.stringify(config.buildBody(messages, temperature))
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${err}`);
  }

  const text = await config.parseResponse(response);
  if (!text || text.length < 3) throw new Error('Empty response');
  return text;
}

// ===== System Prompts =====
function getSystemPrompt(article, aggressiveness) {
  const toneGuide = {
    low: '语气温和、理性探讨、像是在和朋友轻松聊天。用"你觉得呢""也许可以换个角度"等表达。',
    medium: '语气有力但礼貌、带质疑感、像是在学术讨论中挑战对方。用"但你考虑过吗""我不太同意"等表达。',
    high: '语气尖锐、充满挑衅、像是在激烈辩论中针锋相对。用"你认真的吗""这太天真了""呵呵"等表达。'
  };
  const tone = toneGuide[aggressiveness] || toneGuide.medium;
  const kp = article?.keyPoint || '';
  const cp = article?.counterPoint || '';

  return `你是一个AI读书辩论助手，正在与用户辩论收藏文章。要求：
1. 身份："杠精"书友，喜欢挑战收藏文章，逼用户深度思考
2. 风格：${tone}
3. 每次回复50-150字，口语化，像真人聊天
4. 你是辩论对手，不要替用户回答，不要主动结束对话
5. 根据用户发言（同意/反对/中立），给出有针对性的反驳或追问
6. 自然引用文章观点「${kp}」和反驳「${cp}」来展开
7. 不用Markdown格式，不加星号列表，纯文本`;
}

// ===== Debate Logic =====
async function generateOpening(article, aggressiveness, provider, apiKey) {
  const messages = [
    { role: 'system', content: getSystemPrompt(article, aggressiveness) },
    { role: 'user', content: `请生成一段开场白，自然引用文章《${article.title}》的核心观点「${article.keyPoint}」和反驳观点「${article.counterPoint}」，邀请用户参与辩论。直接输出开场白，不要解释。` }
  ];
  const temp = aggressiveness === 'high' ? 0.9 : aggressiveness === 'medium' ? 0.7 : 0.5;
  return await callLLM(messages, temp, provider, apiKey);
}

async function generateReply(messages, aggressiveness, article, userContent, provider, apiKey) {
  const systemPrompt = getSystemPrompt(article, aggressiveness);
  const chatMessages = [{ role: 'system', content: systemPrompt }];

  messages.forEach(m => {
    chatMessages.push({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.content
    });
  });

  // Add user content if not in messages
  const hasUserContent = messages.some(m => m.role === 'user' && m.content === userContent);
  if (!hasUserContent) {
    chatMessages.push({ role: 'user', content: userContent });
  }

  const temp = aggressiveness === 'high' ? 0.9 : aggressiveness === 'medium' ? 0.7 : 0.5;
  return await callLLM(chatMessages, temp, provider, apiKey);
}

async function generateClosing(articleTitle, aggressiveness, masteryGain, provider, apiKey) {
  const toneGuide = {
    low: '温和收束，鼓励用户继续探索',
    medium: '中性收束，肯定用户观点',
    high: '傲娇收束，"算你有点东西"的感觉'
  };
  const messages = [
    { role: 'system', content: `你是一个AI读书辩论助手。辩论已结束，请用${toneGuide[aggressiveness] || toneGuide.medium}的风格，告诉用户这场辩论让他吸收了《${articleTitle}》约${masteryGain}%的精髓，观点已存入「个人观点库」。50-100字，纯文本。` },
    { role: 'user', content: '生成辩论结束语。' }
  ];
  return await callLLM(messages, 0.6, provider, apiKey);
}

// ===== Knowledge Service =====
async function parseArticle(title, content, provider, apiKey) {
  const messages = [
    { role: 'system', content: '你是一个文章分析助手。请分析给定的文章标题和内容，提取以下信息并以JSON格式返回（不要有任何其他文字）：{"topic":"主题分类（如：自我管理、职场沟通、心理学等）","tags":["标签1","标签2","标签3"],"keyPoint":"文章核心观点（一句话）","counterPoint":"对这个观点的合理反驳（一句话）"}' },
    { role: 'user', content: `标题：${title}\n\n内容：${content.slice(0, 2000)}` }
  ];

  try {
    const text = await callLLM(messages, 0.3, provider, apiKey);
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON in response');
  } catch (e) {
    // Fallback to default
    return {
      topic: '未分类',
      tags: ['通用'],
      keyPoint: `${title}中提出了一些值得思考的观点`,
      counterPoint: '但这个观点也有其局限性和反例'
    };
  }
}

// ===== Router =====
const routes = {
  'GET /api/health': async (req, res) => {
    sendJSON(res, 200, {
      status: 'ok',
      provider: DEFAULT_PROVIDER,
      hasKey: !!(HF_API_KEY || OPENROUTER_KEY || OPENAI_KEY)
    });
  },

  'POST /api/debate/opening': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { article, aggressiveness, provider, apiKey } = body;
      const opening = await generateOpening(article, aggressiveness, provider, apiKey);
      sendJSON(res, 200, { success: true, content: opening });
    } catch (e) {
      sendJSON(res, 500, { success: false, error: e.message });
    }
  },

  'POST /api/debate/reply': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { messages, aggressiveness, article, userContent, provider, apiKey } = body;
      const reply = await generateReply(messages, aggressiveness, article, userContent, provider, apiKey);
      sendJSON(res, 200, { success: true, content: reply });
    } catch (e) {
      sendJSON(res, 500, { success: false, error: e.message });
    }
  },

  'POST /api/debate/close': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { articleTitle, aggressiveness, masteryGain, provider, apiKey } = body;
      const closing = await generateClosing(articleTitle, aggressiveness, masteryGain, provider, apiKey);
      sendJSON(res, 200, { success: true, content: closing });
    } catch (e) {
      sendJSON(res, 500, { success: false, error: e.message });
    }
  },

  'POST /api/knowledge/parse': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { title, content, provider, apiKey } = body;
      const result = await parseArticle(title, content, provider, apiKey);
      sendJSON(res, 200, { success: true, ...result });
    } catch (e) {
      sendJSON(res, 500, { success: false, error: e.message });
    }
  }
};

// ===== Server =====
const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const routeKey = `${req.method} ${parsedUrl.pathname}`;
  const handler = routes[routeKey];

  if (handler) {
    await handler(req, res);
  } else {
    sendJSON(res, 404, { error: 'Not found', route: routeKey });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 AI Debate Backend running on http://localhost:${PORT}`);
  console.log(`📡 Provider: ${DEFAULT_PROVIDER}`);
  console.log(`🔑 Has API Key: ${!!(HF_API_KEY || OPENROUTER_KEY || OPENAI_KEY)}`);
});
