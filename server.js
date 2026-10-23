/**
 * AimFlow AI — Secure Local Backend Server & Real AI Intelligence Proxy
 * Tagline: "Plan That Bend. Dream That Don't."
 * Track: Alexa+ (Amazon Developer Hackathon)
 *
 * Supports two AI providers (switch via AI_PROVIDER in .env):
 *   - openai   → OpenAI Chat Completions API (gpt-4o-mini, etc.)
 *   - gemini   → Google Gemini API via @google/genai SDK (free tier, gemini-2.0-flash)
 *
 * All API routes, tool-calling schemas, and response shapes are shared between providers.
 * API keys are never exposed in browser responses, logs, or Git commits.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Google Gemini SDK (installed via npm install @google/genai)
let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch (e) {
  console.warn('[Gemini] @google/genai package not found. Run: npm install @google/genai');
}

// ============================================================================
// 1. ENVIRONMENT CONFIGURATION LOADER
// ============================================================================

function loadEnvFile(envFilePath) {
  const env = {};
  if (!fs.existsSync(envFilePath)) return env;

  try {
    const content = fs.readFileSync(envFilePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      // Skip empty lines and comments
      if (!line || line.startsWith('#')) continue;

      const equalsIndex = line.indexOf('=');
      if (equalsIndex === -1) continue;

      const key = line.slice(0, equalsIndex).trim();
      let value = line.slice(equalsIndex + 1).trim();

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key) {
        env[key] = value;
        // Keep process.env updated with file values
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn('[Env] Notice reading .env file:', err.message);
  }
  return env;
}

// Load .env relative to workspace root
const ROOT_DIR = __dirname;
loadEnvFile(path.join(ROOT_DIR, '.env'));

function getAiConfig() {
  const fileEnv = loadEnvFile(path.join(ROOT_DIR, '.env'));

  const provider = (fileEnv.AI_PROVIDER || process.env.AI_PROVIDER || 'openai').toLowerCase().trim();

  // Resolve OpenAI key (skip placeholders)
  const rawOpenaiKey = fileEnv.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  const openaiKey = (rawOpenaiKey !== 'your_openai_api_key_here' && !rawOpenaiKey.startsWith('sk-placeholder'))
    ? rawOpenaiKey
    : '';

  // Resolve Gemini key (skip placeholder)
  const rawGeminiKey = fileEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  const geminiKey = (rawGeminiKey !== 'your_gemini_api_key_here')
    ? rawGeminiKey
    : '';

  return {
    PORT: parseInt(fileEnv.PORT || process.env.PORT, 10) || 3000,
    AI_PROVIDER: provider,
    OPENAI_API_KEY: openaiKey,
    OPENAI_MODEL: fileEnv.OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    OPENAI_BASE_URL: (fileEnv.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    GEMINI_API_KEY: geminiKey,
    GEMINI_MODEL: fileEnv.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash'
  };
}

// Proxied CONFIG for backwards compatibility with tests and callers
const CONFIG = new Proxy({}, {
  get(target, prop) {
    const cfg = getAiConfig();
    return cfg[prop];
  }
});

/**
 * Validates whether an API key is a genuine configured key vs a placeholder or empty string.
 * Works for both OpenAI and Gemini keys.
 *
 * Gemini keys always start with 'AIza' (39 chars total).
 * OpenAI keys start with 'sk-'.
 * Anything else (e.g. Amazon 'AQ.' keys) is treated as invalid for the given provider.
 */
function isApiKeyConfigured(key, provider) {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (trimmed.length < 15) return false;
  if (trimmed === 'your_openai_api_key_here') return false;
  if (trimmed === 'your_gemini_api_key_here') return false;
  if (trimmed.startsWith('sk-placeholder')) return false;
  return true;
}

/** Validate whether a key uses Gemini's documented API key prefix. */
function isGeminiKeyConfigured(key) {
  return typeof key === 'string' &&
    key.trim().startsWith('AIza') &&
    isApiKeyConfigured(key, 'gemini');
}

/** Check if the active provider's key is configured. */
function isActiveProviderConfigured() {
  const cfg = getAiConfig();
  if (cfg.AI_PROVIDER === 'gemini') return isGeminiKeyConfigured(cfg.GEMINI_API_KEY);
  return isApiKeyConfigured(cfg.OPENAI_API_KEY);
}

// ============================================================================
// 2. RATE LIMITING & SECURITY GUARDS
// ============================================================================

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 40;     // 40 requests per minute per IP

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitMap.set(ip, record);
    return false;
  }

  record.count++;
  rateLimitMap.set(ip, record);
  return record.count > MAX_REQUESTS_PER_WINDOW;
}

// Periodic cleanup of rate limit map (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

// ============================================================================
// 3. AI TOOLS SCHEMA (OpenAI / MCP Compatible Tool Calling)
// ============================================================================

const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'propose_schedule_change',
      description: 'Propose an adaptive schedule revision when study time changes (e.g. time lost, only 1 hour left) or task deadlines shift or unexpected commitments occur. Generates a diff proposal for user confirmation before applying.',
      parameters: {
        type: 'object',
        properties: {
          availableMinutes: {
            type: 'number',
            description: 'New total available study minutes for today (e.g., 60 for 1 hour, 120 for 2 hours).'
          },
          deadlineChanges: {
            type: 'array',
            description: 'List of task deadline modifications',
            items: {
              type: 'object',
              properties: {
                taskTitleOrId: { type: 'string', description: 'Task title or ID' },
                newDeadline: { type: 'string', description: 'New ISO date string or relative deadline descriptor (e.g. "tomorrow", "in 2 days")' }
              },
              required: ['taskTitleOrId', 'newDeadline']
            }
          },
          commitmentAdded: {
            type: 'object',
            description: 'New unexpected commitment details',
            properties: {
              title: { type: 'string', description: 'Title of commitment (e.g. "Dentist", "Doctor", "Emergency meeting")' },
              durationMinutes: { type: 'number', description: 'Duration in minutes' }
            },
            required: ['title', 'durationMinutes']
          },
          reason: {
            type: 'string',
            description: 'Brief, clear explanation of why this adaptation is proposed.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_task',
      description: 'Add a new task to the user\'s ledger. Requires title, category, estimated duration, deadline, and priority.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Clear title of the task' },
          category: {
            type: 'string',
            enum: ['Project', 'Exam Prep', 'Assignment', 'Revision', 'Personal'],
            description: 'Category of the task'
          },
          estimatedDuration: {
            type: 'number',
            description: 'Estimated minutes to complete (e.g. 60, 90, 180)'
          },
          deadline: {
            type: 'string',
            description: 'ISO deadline string or relative timing (e.g. "tomorrow at 20:00", "in 3 days")'
          },
          priority: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'Task priority level'
          },
          notes: {
            type: 'string',
            description: 'Optional notes, deliverables, or context'
          }
        },
        required: ['title', 'estimatedDuration', 'priority']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Toggle completion status of a task by its title or ID.',
      parameters: {
        type: 'object',
        properties: {
          taskTitleOrId: {
            type: 'string',
            description: 'Title or ID of the task to mark completed or reopen'
          },
          completed: {
            type: 'boolean',
            description: 'True to mark completed, false to reopen. Defaults to true.'
          }
        },
        required: ['taskTitleOrId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replan_day',
      description: 'Re-evaluate and re-optimize the day\'s study schedule based on all current deadlines and constraints.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Optional reason for replanning'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'undo_last_change',
      description: 'Undo the last applied schedule revision or action.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'explain_task_placement',
      description: 'Explain why a specific task was prioritized, placed into a focus block, or postponed.',
      parameters: {
        type: 'object',
        properties: {
          taskTitleOrId: {
            type: 'string',
            description: 'Title or ID of the task to explain'
          }
        },
        required: ['taskTitleOrId']
      }
    }
  }
];

// ============================================================================
// 4. SYSTEM PROMPT BUILDER
// ============================================================================

function buildSystemPrompt(taskContext) {
  let contextSnippet = 'Current Application State:\n';

  if (taskContext && typeof taskContext === 'object') {
    const { tasks, constraints, currentPlan, lastAppliedProposal } = taskContext;

    if (constraints && typeof constraints.availableMinutesToday === 'number') {
      contextSnippet += `- Available Study Time Today: ${constraints.availableMinutesToday} minutes (${(constraints.availableMinutesToday / 60).toFixed(1)} hours)\n`;
    }

    if (Array.isArray(tasks)) {
      contextSnippet += `- Current Tasks in Ledger (${tasks.length} total):\n`;
      tasks.forEach((t, i) => {
        const statusStr = t.completed ? 'COMPLETED' : 'PENDING';
        contextSnippet += `  [${i + 1}] "${t.title}" (ID: ${t.id}) | Category: ${t.category} | Priority: ${t.priority.toUpperCase()} | Duration: ${t.estimatedDuration}m | Deadline: ${t.deadline} | Status: ${statusStr}\n`;
      });
    }

    if (currentPlan && Array.isArray(currentPlan.scheduledItems)) {
      contextSnippet += `- Currently Scheduled Focus Blocks Today:\n`;
      currentPlan.scheduledItems.forEach(item => {
        contextSnippet += `  • "${item.task.title}": ${item.allocatedDuration}m allocated${item.isPartial ? ' (PARTIAL focus block)' : ' (FULL)'}\n`;
      });
      if (Array.isArray(currentPlan.atRiskItems) && currentPlan.atRiskItems.length > 0) {
        contextSnippet += `- At-Risk / Postponed Tasks Due to Capacity Deficit:\n`;
        currentPlan.atRiskItems.forEach(item => {
          contextSnippet += `  • "${item.task.title}": ${item.deficitMinutes}m deficit, Reason: ${item.reason}\n`;
        });
      }
    }

    if (lastAppliedProposal && lastAppliedProposal.explanation) {
      contextSnippet += `- Last Applied Revision: ${lastAppliedProposal.explanation.why || 'None'}\n`;
    }
  }

  return `You are AimFlow AI ("Plan That Bend. Dream That Don't."), an intelligent, empathetic academic and productivity assistant built for the Amazon Alexa+ Hackathon.

Your primary capabilities:
1. Natural Human Conversation:
   - Answer greetings warmly, naturally, and concisely (e.g. "Hello! How can I help you conquer your study goals today?").
   - Answer general knowledge and academic questions accurately and simply (e.g., explaining photosynthesis, calculus concepts, algorithms, writing tips).
   - Understand English, Hinglish ("Mera kal exam hai aur abhi sirf 2 ghante hain, kya karun?"), typos, and natural phrasing.
   - For anxious or overwhelmed students, respond with calm empathy and provide clear, actionable 1-2-3 step advice.

2. Real Task & Schedule Management:
   - You are connected to the user's real task engine via structured tools.
   - NEVER fabricate or pretend to make changes without calling the appropriate tool.
   - When the user asks to replan, report wasted time, adjust study hours, or shift a deadline, call "propose_schedule_change". This generates a transparent proposal with before/after diffs so the user can inspect and confirm.
   - When the user asks "What should I do next?", check the currently scheduled focus blocks and provide clear guidance.
   - When the user asks "Why did you put this task first?" or "Why did you move my programming task?", explain based on deadline urgency, priority score, and finite capacity.
   - When the user says they finished a task (e.g. "I finished my mathematics revision"), call "complete_task".
   - When the user asks to add a task, call "add_task".
   - When the user says "Undo that" or "Revert", call "undo_last_change".

3. Contextual Continuity:
   - Use the ongoing conversation history to understand follow-up questions ("Can you explain your previous answer?", "What about the second option?", "Make it shorter").
   - Maintain a concise, crisp, and helpful tone.

${contextSnippet}
`;
}

// ============================================================================
// 5. CHAT COMPLETIONS API DISPATCHER
// ============================================================================

// ---------------------------------------------------------------------------
// 5a. Gemini Dispatcher
// ---------------------------------------------------------------------------

/**
 * Convert AimFlow AI_TOOLS (OpenAI function-calling schema) → Gemini Tool declaration.
 * Gemini expects { functionDeclarations: [ { name, description, parameters } ] }
 */
function buildGeminiTools() {
  return [{
    functionDeclarations: AI_TOOLS.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters
    }))
  }];
}

function isTransientGeminiError(err) {
  const status = err && (err.status || err.statusCode || (err.response && err.response.status));
  if (status === 429 || status === 503) return true;
  if (status) return false;

  const message = String((err && err.message) || '');
  return /\b(?:RESOURCE_EXHAUSTED|UNAVAILABLE)\b/.test(message);
}

async function withGeminiRetries(operation, {
  maxRetries = 2,
  baseDelayMs = 500,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= maxRetries || !isTransientGeminiError(err)) throw err;
      await sleep(baseDelayMs * (2 ** attempt));
    }
  }
}

function formatGeminiError(err) {
  const status = err.status || err.statusCode || (err.response && err.response.status);
  const msg = String(err.message || '');

  if (msg.includes('API_KEY_INVALID') || status === 401 || status === 403) {
    return {
      status: 'error',
      provider: 'gemini',
      errorType: 'INVALID_CREDENTIALS',
      message: 'Gemini API key is invalid. Please verify your GEMINI_API_KEY in .env at https://aistudio.google.com/app/apikey'
    };
  }
  if (status === 400) {
    return {
      status: 'error',
      provider: 'gemini',
      errorType: 'INVALID_REQUEST',
      message: 'Gemini rejected the request. Check the configured model and request settings, then try again.'
    };
  }
  if (status === 503 || msg.includes('UNAVAILABLE')) {
    return {
      status: 'error',
      provider: 'gemini',
      errorType: 'SERVICE_UNAVAILABLE',
      message: 'Gemini is temporarily unavailable after several attempts. Please try again shortly.'
    };
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.toLowerCase().includes('quota') || status === 429) {
    return {
      status: 'error',
      provider: 'gemini',
      errorType: 'RATE_LIMIT_EXCEEDED',
      message: 'Gemini API rate limit or quota exceeded after several attempts. Please wait a moment before trying again.'
    };
  }
  if (status === 404) {
    return {
      status: 'error',
      provider: 'gemini',
      errorType: 'MODEL_NOT_FOUND',
      message: 'The configured Gemini model or API endpoint was not found. Check GEMINI_MODEL in .env.'
    };
  }
  if (err.name === 'TimeoutError' || msg.includes('ETIMEDOUT') || msg.toLowerCase().includes('timed out')) {
    return {
      status: 'error',
      provider: 'gemini',
      errorType: 'TIMEOUT',
      message: 'Gemini AI request timed out. Please check your internet connection and try again.'
    };
  }
  return {
    status: 'error',
    provider: 'gemini',
    errorType: 'GEMINI_ERROR',
    message: 'Gemini could not complete this request. Please try again shortly.'
  };
}

/**
 * Dispatch a chat message to Google Gemini via @google/genai SDK.
 * Returns the same shape as callChatModel() / OpenAI path:
 *   { status: 'success', reply, toolCalls, model, provider }
 *   { status: 'unconfigured', message, setupInstructions, fallbackAvailable }
 *   { status: 'error', errorType, message }
 */
async function callGeminiModel({ message, conversationHistory, taskContext }) {
  const cfg = getAiConfig();

  if (!GoogleGenAI) {
    return {
      status: 'error',
      provider: 'gemini',
      errorType: 'SDK_MISSING',
      message: '@google/genai package is not installed. Run: npm install @google/genai in your project folder, then restart the server.'
    };
  }

  if (!isGeminiKeyConfigured(cfg.GEMINI_API_KEY)) {
    return {
      status: 'unconfigured',
      provider: 'gemini',
      message: 'AimFlow AI backend is online, but a valid GEMINI_API_KEY is not configured in your .env file.',
      setupInstructions: 'To enable Google Gemini AI (free tier):\n1. Go to https://aistudio.google.com/app/apikey\n2. Sign in with your Google account\n3. Click "Create API Key" and copy it (it starts with AIza...)\n4. Open .env in your project folder\n5. Set: GEMINI_API_KEY=AIzaSy...your-real-key...\n6. Restart the server with `node server.js`\n\nNote: Do not use your OpenAI or Amazon key here — Gemini keys start with AIza.\n\nIn the meantime, local deterministic schedule commands remain active.',
      fallbackAvailable: true
    };
  }

  try {
    const genai = new GoogleGenAI({ apiKey: cfg.GEMINI_API_KEY });
    const model = cfg.GEMINI_MODEL || 'gemini-3.8-flash';

    // Build conversation history for Gemini's multi-turn format
    const history = [];
    if (Array.isArray(conversationHistory)) {
      const recent = conversationHistory.slice(-10);
      for (const msg of recent) {
        if (!msg || !msg.text) continue;
        history.push({
          role: msg.sender === 'user' ? 'user' : 'model',
          parts: [{ text: String(msg.text).slice(0, 1500) }]
        });
      }
    }

    const systemPrompt = buildSystemPrompt(taskContext);

    const chat = genai.chats.create({
      model,
      config: {
        systemInstruction: systemPrompt,
        tools: buildGeminiTools(),
        temperature: 0.4,
        maxOutputTokens: 800
      },
      history
    });

    const result = await withGeminiRetries(
      () => chat.sendMessage({ message: String(message).slice(0, 3000) })
    );

    // Extract text reply
    const textReply = result.text || '';

    // Extract function calls (tool calls) from Gemini response
    const toolCalls = [];
    const candidates = result.candidates || [];
    for (const candidate of candidates) {
      const parts = (candidate.content && candidate.content.parts) || [];
      for (const part of parts) {
        if (part.functionCall) {
          toolCalls.push({
            // Normalize to OpenAI tool_call shape so existing handler works
            id: `gemini_tc_${Date.now()}_${toolCalls.length}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {})
            }
          });
        }
      }
    }

    return {
      status: 'success',
      reply: textReply,
      toolCalls,
      model,
      provider: 'gemini'
    };

  } catch (err) {
    const status = err.status || err.statusCode || (err.response && err.response.status);
    console.error('[Gemini Dispatcher Error] HTTP status:', status || 'unknown');
    return formatGeminiError(err);
  }
}

// ---------------------------------------------------------------------------
// 5b. Main dispatcher — routes to Gemini or OpenAI based on AI_PROVIDER
// ---------------------------------------------------------------------------

async function callChatModel({ message, conversationHistory, taskContext }) {
  const provider = CONFIG.AI_PROVIDER;

  if (provider === 'gemini') {
    return callGeminiModel({ message, conversationHistory, taskContext });
  }

  // ── OpenAI path (unchanged) ──────────────────────────────────────────────
  if (!isApiKeyConfigured(CONFIG.OPENAI_API_KEY)) {
    return {
      status: 'unconfigured',
      provider: 'openai',
      message: 'AimFlow AI backend is online, but OPENAI_API_KEY is not configured in your .env file.',
      setupInstructions: 'To enable genuine AI intelligence:\n1. Copy .env.example to .env (or edit .env)\n2. Add your OPENAI_API_KEY=sk-...\n3. Restart the server with `npm start`.\n\nIn the meantime, local deterministic schedule commands remain active.',
      fallbackAvailable: true
    };
  }

  const systemPrompt = buildSystemPrompt(taskContext);

  // Filter and format conversation history (last 10 turns max for context window economy)
  const messages = [{ role: 'system', content: systemPrompt }];

  if (Array.isArray(conversationHistory)) {
    const recent = conversationHistory.slice(-10);
    for (const msg of recent) {
      if (!msg || !msg.text) continue;
      const role = msg.sender === 'user' ? 'user' : 'assistant';
      messages.push({ role, content: String(msg.text).slice(0, 1500) });
    }
  }

  // Append latest user message
  messages.push({ role: 'user', content: String(message).slice(0, 3000) });

  const payload = {
    model: CONFIG.OPENAI_MODEL,
    messages,
    tools: AI_TOOLS,
    tool_choice: 'auto',
    temperature: 0.4,
    max_tokens: 800
  };

  const endpoint = `${CONFIG.OPENAI_BASE_URL}/chat/completions`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000) // 25s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorJson = null;
      try { errorJson = JSON.parse(errorText); } catch (e) {}

      console.error(`[AI Provider Error] HTTP ${response.status}:`, errorText.slice(0, 300));

      if (response.status === 401) {
        return {
          status: 'error',
          provider: 'openai',
          errorType: 'INVALID_CREDENTIALS',
          message: 'Authentication failed. Please verify that your OPENAI_API_KEY in .env is valid and active.'
        };
      }
      if (response.status === 429) {
        return {
          status: 'error',
          provider: 'openai',
          errorType: 'RATE_LIMIT_EXCEEDED',
          message: 'OpenAI rate limit or usage quota exceeded. Please check your account balance at platform.openai.com.'
        };
      }
      return {
        status: 'error',
        provider: 'openai',
        errorType: 'API_ERROR',
        message: (errorJson && errorJson.error && errorJson.error.message)
          ? `AI Provider error: ${errorJson.error.message}`
          : `AI Provider returned HTTP ${response.status}. Please try again.`
      };
    }

    const data = await response.json();
    const choice = data.choices && data.choices[0];
    if (!choice || !choice.message) {
      return {
        status: 'error',
        errorType: 'MALFORMED_RESPONSE',
        message: 'Received empty response from AI model.'
      };
    }

    return {
      status: 'success',
      reply: choice.message.content || '',
      toolCalls: choice.message.tool_calls || [],
      model: data.model || CONFIG.OPENAI_MODEL,
      provider: CONFIG.AI_PROVIDER
    };

  } catch (err) {
    console.error('[AI Dispatcher Exception]:', err.message);
    if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT') {
      return {
        status: 'error',
        errorType: 'TIMEOUT',
        message: 'AI request timed out after 25 seconds. Please check your network connection.'
      };
    }
    return {
      status: 'error',
      errorType: 'NETWORK_ERROR',
      message: `Network error connecting to AI provider: ${err.message}`
    };
  }
}

// ============================================================================
// 6. HTTP REQUEST HANDLER & STATIC FILE SERVER
// ============================================================================

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function readBody(req, maxSizeBytes = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSizeBytes) {
        reject(new Error('Request payload too large (max 100KB)'));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      resolve(body);
    });

    req.on('error', err => {
      reject(err);
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function handleStaticFile(req, res, pathname) {
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal attacks
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT_DIR, safePath);

  // Security check: ensure path stays within ROOT_DIR
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  // Never serve server.js, .env, or package.json as public downloads
  const baseName = path.basename(filePath);
  if (baseName.startsWith('.env') || baseName === 'package.json') {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
}

function requestHandler(req, res) {
  const baseUrl = `http://${req.headers.host || '127.0.0.1'}`;
  const parsedUrl = new URL(req.url, baseUrl);
  const pathname = parsedUrl.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // 1. Health & Config status endpoint
  if (req.method === 'GET' && pathname === '/api/health') {
    const cfg = getAiConfig();
    const isGemini = cfg.AI_PROVIDER === 'gemini';
    return sendJson(res, 200, {
      status: 'ok',
      appName: 'AimFlow AI',
      tagline: 'Plan That Bend. Dream That Don\'t.',
      provider: cfg.AI_PROVIDER,
      model: isGemini ? cfg.GEMINI_MODEL : cfg.OPENAI_MODEL,
      hasApiKey: isGemini
        ? isGeminiKeyConfigured(cfg.GEMINI_API_KEY)
        : isApiKeyConfigured(cfg.OPENAI_API_KEY),
      timestamp: new Date().toISOString()
    });
  }

  // 2. Chat completions & tool calling endpoint
  if (req.method === 'POST' && pathname === '/api/chat') {
    const clientIp = req.socket.remoteAddress || '127.0.0.1';
    if (isRateLimited(clientIp)) {
      return sendJson(res, 429, {
        status: 'error',
        errorType: 'CLIENT_RATE_LIMITED',
        message: 'Too many requests. Please pause a moment before asking another question.'
      });
    }

    readBody(req)
      .then(bodyText => {
        let payload = null;
        try {
          payload = JSON.parse(bodyText);
        } catch (e) {
          return sendJson(res, 400, {
            status: 'error',
            errorType: 'BAD_REQUEST',
            message: 'Invalid JSON payload received.'
          });
        }

        if (!payload || typeof payload.message !== 'string' || !payload.message.trim()) {
          return sendJson(res, 400, {
            status: 'error',
            errorType: 'EMPTY_MESSAGE',
            message: 'User message cannot be empty.'
          });
        }

        return callChatModel(payload).then(aiResult => {
          sendJson(res, 200, aiResult);
        });
      })
      .catch(err => {
        console.error('[API Chat Error]:', err.message);
        sendJson(res, 500, {
          status: 'error',
          errorType: 'INTERNAL_ERROR',
          message: 'An internal server error occurred while processing your request.'
        });
      });
    return;
  }

  // 3. Fallback to static file serving
  if (req.method === 'GET') {
    return handleStaticFile(req, res, pathname);
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('405 Method Not Allowed');
}

// ============================================================================
// 7. SERVER INITIALIZATION & EXPORTS
// ============================================================================

function createServer() {
  return http.createServer(requestHandler);
}

if (require.main === module) {
  const server = createServer();
  server.listen(CONFIG.PORT, () => {
    const cfg = getAiConfig();
    const isGemini = cfg.AI_PROVIDER === 'gemini';
    const activeModel = isGemini ? cfg.GEMINI_MODEL : cfg.OPENAI_MODEL;
    const activeKey = isGemini ? cfg.GEMINI_API_KEY : cfg.OPENAI_API_KEY;
    console.log(`\n======================================================`);
    console.log(`🚀 AimFlow AI Backend Server running at http://localhost:${cfg.PORT}`);
    console.log(`🎯 Product: AimFlow AI — "Plan That Bend. Dream That Don't."`);
    console.log(`🤖 AI Provider: ${cfg.AI_PROVIDER.toUpperCase()} | Model: ${activeModel}`);
    const keyOk = isGemini ? isGeminiKeyConfigured(activeKey) : isApiKeyConfigured(activeKey);
    console.log(`🔑 API Key Configured: ${keyOk ? '✅ YES' : '⚠️  NO — Set API key in .env'}`);
    console.log(`======================================================\n`);

  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Error] Port ${CONFIG.PORT} is already in use. Please select another port via PORT=xxxx in .env`);
    } else {
      console.error('[Server Error]:', err);
    }
  });
}

module.exports = {
  CONFIG,
  getAiConfig,
  createServer,
  requestHandler,
  isApiKeyConfigured,
  isGeminiKeyConfigured,
  isActiveProviderConfigured,
  callChatModel,
  callGeminiModel,
  withGeminiRetries,
  isTransientGeminiError,
  formatGeminiError,
  buildSystemPrompt,
  buildGeminiTools,
  AI_TOOLS
};
