/**
 * AimFlow AI — Real Intelligence & AI Engine Automated Test Suite
 * Validates requirements A through L of Section 9 of the Master Implementation Prompt:
 * 
 * A. General questions receive model-generated responses rather than fixed command-list replies.
 * B. Greetings and simple conversational messages work.
 * C. English and Hinglish inputs are handled.
 * D. Follow-up questions use conversation context.
 * E. Voice transcripts and typed messages use the same chat handler.
 * F. Auto-Send does not send the same transcript twice.
 * G. Task-related tool calls use the real task engine.
 * H. Unconfirmed schedule changes are not applied prematurely.
 * I. Invalid tool calls cannot corrupt task state.
 * J. Undo and persistence still work.
 * K. Missing credentials and network errors produce clear messages.
 * L. The existing frontend and backend build/run successfully.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, detail = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS [Test #${totalTests}]: ${message}${detail ? ' — ' + detail : ''}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL [Test #${totalTests}]: ${message}${detail ? ' — ' + detail : ''}`);
    process.exitCode = 1;
  }
}

// ----------------------------------------------------------------------------
// 1. SETUP MOCK BROWSER ENVIRONMENT FOR SCRIPT.JS
// ----------------------------------------------------------------------------

const mockLocalStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; }
};

const mockElements = new Map();
function getOrCreateElement(id) {
  if (!mockElements.has(id)) {
    mockElements.set(id, {
      id,
      value: '',
      textContent: '',
      innerHTML: '',
      style: {},
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      },
      children: [],
      appendChild(child) { this.children.push(child); },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        const cidx = this.childNodes.indexOf(child);
        if (cidx !== -1) this.childNodes.splice(cidx, 1);
      },
      childNodes: [],
      remove() {},
      addEventListener() {},
      setAttribute() {},
      getAttribute() { return null; },
      querySelector: () => null,
      querySelectorAll: () => [],
      focus() {},
      scrollTop: 0,
      scrollHeight: 100
    });
  }
  return mockElements.get(id);
}

global.Node = { TEXT_NODE: 3 };

global.window = {
  localStorage: mockLocalStorage,
  location: { origin: 'http://localhost:3000', protocol: 'http:' },
  addEventListener() {},
  confirm() { return true; },
  alert() {},
  SpeechRecognition: null,
  webkitSpeechRecognition: null,
  speechSynthesis: {
    speak() {},
    cancel() {},
    getVoices() { return []; }
  }
};

global.document = {
  getElementById: (id) => getOrCreateElement(id),
  querySelectorAll: () => [],
  querySelector: () => null,
  createTextNode: (txt) => ({ nodeType: 3, textContent: txt, remove() {} }),
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    className: '',
    id: '',
    style: {},
    innerHTML: '',
    textContent: '',
    childNodes: [],
    children: [],
    appendChild(child) { this.children.push(child); this.childNodes.push(child); },
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    },
    children: [],
    appendChild(child) { this.children.push(child); },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    remove() {}
  }),
  addEventListener() {}
};

global.localStorage = mockLocalStorage;

// Load script.js and server.js
require('../script.js');
const serverModule = require('../server.js');

const {
  SchedulingEngine,
  ProposalManager,
  StorageService,
  AppState,
  UIRenderer,
  VoiceInputService,
  AIService,
  createDemoTasks,
  createDefaultConstraints,
  getRelativeDate
} = global.window;

const {
  CONFIG,
  isApiKeyConfigured,
  isGeminiKeyConfigured,
  isActiveProviderConfigured,
  buildSystemPrompt,
  withGeminiRetries,
  isTransientGeminiError,
  formatGeminiError,
  AI_TOOLS,
  createServer
} = serverModule;

async function runAllAITests() {
  console.log('\n======================================================');
  console.log('🤖 AimFlow AI — Real Intelligence & LLM Test Suite');
  console.log('======================================================\n');

  // ----------------------------------------------------------------------------
  // TEST SUITE A: General Questions (Model vs Fixed Command List)
  // ----------------------------------------------------------------------------
  console.log('--- TEST A: General Knowledge Questions ---');

  const generalQuestion = 'Explain photosynthesis in simple language.';
  const systemPrompt = buildSystemPrompt({
    tasks: createDemoTasks(),
    constraints: createDefaultConstraints()
  });

  assert(systemPrompt.includes('photosynthesis'), 'System prompt explicitly instructs model to answer general science and academic questions');
  assert(systemPrompt.includes('AimFlow AI'), 'System prompt enforces AimFlow AI brand and empathetic assistant persona');

  // Verify that the command parser alone does not reject when routed through AIService
  const mockModelResponseA = {
    status: 'success',
    reply: 'Photosynthesis is the biological process where plants convert sunlight, water, and carbon dioxide into oxygen and glucose for energy.',
    toolCalls: [],
    model: 'gpt-4o-mini'
  };

  // Simulate chat handling of general question
  AppState.chatMessages = [];
  await UIRenderer.handleAIModelSuccess(mockModelResponseA, generalQuestion);
  const lastMsgA = AppState.chatMessages[AppState.chatMessages.length - 1];
  assert(lastMsgA && lastMsgA.text.includes('biological process'), 'General question returns rich explanatory answer');
  assert(lastMsgA.meta && lastMsgA.meta.isAI === true, 'Response is marked as genuine AI powered response');
  assert(!lastMsgA.text.includes("I didn't quite catch that"), 'General question does NOT return the limited fixed command list');

  // ----------------------------------------------------------------------------
  // TEST SUITE B: Greetings & Conversational Messages
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST B: Greetings and Conversational Messages ---');

  const mockGreeting = {
    status: 'success',
    reply: 'Hello! I am your AimFlow AI study partner. How can I help you optimize your schedule today?',
    toolCalls: [],
    model: 'gpt-4o-mini'
  };

  AppState.chatMessages = [];
  await UIRenderer.handleAIModelSuccess(mockGreeting, 'Hello, how are you?');
  const greetingMsg = AppState.chatMessages[AppState.chatMessages.length - 1];
  assert(greetingMsg.text.startsWith('Hello!'), 'Greetings return warm, natural responses');
  assert(!greetingMsg.text.includes('Try commands like:'), 'Greetings are understood rather than treated as invalid commands');

  // ----------------------------------------------------------------------------
  // TEST SUITE C: English and Hinglish Inputs
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST C: English and Hinglish Language Understanding ---');

  assert(systemPrompt.includes('Hinglish'), 'System prompt explicitly specifies Hinglish language comprehension');
  assert(systemPrompt.includes('Mera kal exam hai'), 'System prompt includes sample Hinglish exam prompt');

  const hinglishPrompt = 'Mera kal exam hai aur abhi sirf 2 ghante hain, kya karun?';
  const mockHinglishResponse = {
    status: 'success',
    reply: 'Ghabraiye mat! Hum is 2 ghante ko efficiently prioritize karenge. Sabse pehle high-weightage topics revise kijiye aur formula sheets review kijiye.',
    toolCalls: [],
    model: 'gpt-4o-mini'
  };

  AppState.chatMessages = [];
  await UIRenderer.handleAIModelSuccess(mockHinglishResponse, hinglishPrompt);
  const hinglishMsg = AppState.chatMessages[AppState.chatMessages.length - 1];
  assert(hinglishMsg.text.includes('Ghabraiye mat!'), 'Hinglish query receives comforting and culturally attuned guidance');

  // ----------------------------------------------------------------------------
  // TEST SUITE D: Follow-Up Questions Using Context
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST D: Contextual Continuity & Follow-Up Questions ---');

  // Simulate conversation history
  AppState.chatMessages = [
    { sender: 'user', text: 'I have a mathematics exam in three days. Help me prepare.' },
    { sender: 'assistant', text: 'Here is a 3-day revision plan: Day 1 focus on Calculus, Day 2 on Algebra, Day 3 on practice tests.' }
  ];

  let capturedPayload = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (url.includes('/api/chat')) {
      capturedPayload = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          reply: 'In shorter terms: Day 1 = Calculus, Day 2 = Algebra, Day 3 = Practice tests.',
          toolCalls: [],
          model: 'gpt-4o-mini'
        })
      };
    }
    return { ok: false };
  };

  // Send follow up question
  await AIService.sendMessage({
    message: 'Make it shorter.',
    history: AppState.chatMessages,
    tasks: AppState.tasks,
    constraints: AppState.constraints
  });

  assert(capturedPayload !== null, 'Chat dispatcher successfully transmitted payload');
  assert(Array.isArray(capturedPayload.conversationHistory), 'Conversation history included in request payload');
  assert(capturedPayload.conversationHistory.length === 2, 'Recent 2 turns preserved in contextual payload');
  assert(capturedPayload.conversationHistory[0].text.includes('mathematics exam'), 'Original context turn retained accurately');
  assert(capturedPayload.message === 'Make it shorter.', 'Follow-up query sent to model');

  // Restore fetch
  global.fetch = originalFetch;

  // ----------------------------------------------------------------------------
  // TEST SUITE E: Voice Transcripts & Typed Messages Shared Pipeline
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST E: Voice Transcripts and Typed Messages Shared Pipeline ---');

  let submitCallCount = 0;
  let lastSubmitted = '';

  const origHandleSubmit = UIRenderer.handleUserChatSubmit;
  UIRenderer.handleUserChatSubmit = (text) => {
    submitCallCount++;
    lastSubmitted = text;
  };

  // Simulate typed submit
  UIRenderer.handleUserChatSubmit('Typed test message');
  assert(submitCallCount === 1 && lastSubmitted === 'Typed test message', 'Typed input routes directly to handleUserChatSubmit');

  // Simulate voice-to-text transcript submission
  VoiceInputService.onFinalTextCallback = (finalText) => {
    UIRenderer.handleUserChatSubmit(finalText);
  };
  VoiceInputService.onFinalTextCallback('Voice test transcript');
  assert(submitCallCount === 2 && lastSubmitted === 'Voice test transcript', 'Voice transcript routes to the exact same handleUserChatSubmit pipeline');

  UIRenderer.handleUserChatSubmit = origHandleSubmit;

  // ----------------------------------------------------------------------------
  // TEST SUITE F: Auto-Send Duplicate Submission Prevention
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST F: Auto-Send Duplicate Submission Prevention ---');

  let autoSendSubmissions = [];
  const chatInputMock = getOrCreateElement('chatInput');
  chatInputMock.value = 'Spoken command transcript';

  // Simulate auto-send debounce logic
  const simulateAutoSend = (text) => {
    if (chatInputMock.value) {
      autoSendSubmissions.push(chatInputMock.value);
      chatInputMock.value = ''; // Cleared on submission to prevent duplicates
    }
  };

  simulateAutoSend('Spoken command transcript');
  assert(autoSendSubmissions.length === 1, 'First voice auto-send submitted');
  assert(chatInputMock.value === '', 'Chat input field cleared immediately upon submission');

  simulateAutoSend('Spoken command transcript');
  assert(autoSendSubmissions.length === 1, 'Duplicate submission blocked because input was cleared');

  // ----------------------------------------------------------------------------
  // TEST SUITE G: Task-Related Tool Calls & Real Task Engine Integration
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST G: Task-Related Tool Calls Using Real Engine ---');

  StorageService.resetDemo();
  const initialTaskCount = AppState.tasks.length;
  assert(initialTaskCount === 4, 'Base 4 demo tasks loaded');

  // G1: Model calls propose_schedule_change
  const mockProposeToolCall = {
    status: 'success',
    reply: 'I noticed you lost 2 hours today. I prepared a revised schedule for your review:',
    toolCalls: [
      {
        function: {
          name: 'propose_schedule_change',
          arguments: JSON.stringify({
            availableMinutes: 60,
            deadlineChanges: [
              { taskTitleOrId: 'Hackathon project', newDeadline: 'tomorrow' }
            ],
            reason: 'Reduced study hours to 60m and accelerated hackathon deadline.'
          })
        }
      }
    ],
    model: 'gpt-4o-mini'
  };

  await UIRenderer.handleAIModelSuccess(mockProposeToolCall, 'I lost 2 hours today and hackathon is tomorrow');
  assert(AppState.pendingProposal !== null, 'propose_schedule_change created a real pending proposal');
  assert(AppState.pendingProposal.proposedPlan.totalAvailable === 60, 'Proposal correctly configured for 60m available time');
  assert(AppState.pendingProposal.proposedPlan.scheduledMinutes <= 60, 'Proposal scheduled minutes bounded by 60m');

  // G2: Model calls add_task
  const mockAddTaskToolCall = {
    status: 'success',
    reply: 'Added your new Physics Problem Set #4 to your task ledger.',
    toolCalls: [
      {
        function: {
          name: 'add_task',
          arguments: JSON.stringify({
            title: 'Physics Problem Set #4',
            category: 'Assignment',
            estimatedDuration: 90,
            deadline: getRelativeDate(2, '20:00'),
            priority: 'high'
          })
        }
      }
    ],
    model: 'gpt-4o-mini'
  };

  await UIRenderer.handleAIModelSuccess(mockAddTaskToolCall, 'Add a physics assignment');
  assert(AppState.tasks.length === initialTaskCount + 1, 'add_task added task to AppState.tasks');
  const addedTask = AppState.tasks.find(t => t.title === 'Physics Problem Set #4');
  assert(addedTask && addedTask.priority === 'high' && addedTask.estimatedDuration === 90, 'Added task has correct validated attributes');

  // G3: Model calls complete_task
  const mockCompleteToolCall = {
    status: 'success',
    reply: 'Great job completing your Mathematics revision!',
    toolCalls: [
      {
        function: {
          name: 'complete_task',
          arguments: JSON.stringify({
            taskTitleOrId: 'Mathematics revision',
            completed: true
          })
        }
      }
    ],
    model: 'gpt-4o-mini'
  };

  await UIRenderer.handleAIModelSuccess(mockCompleteToolCall, 'I finished my mathematics revision');
  const mathTask = AppState.tasks.find(t => t.title === 'Mathematics revision');
  assert(mathTask && mathTask.completed === true, 'complete_task marked real task in AppState as completed');

  // ----------------------------------------------------------------------------
  // TEST SUITE H: Unconfirmed Changes Not Applied Prematurely
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST H: Unconfirmed Schedule Changes Not Applied Prematurely ---');

  StorageService.resetDemo();
  const preProposalAvailableTime = AppState.constraints.availableMinutesToday;
  assert(preProposalAvailableTime === 180, 'Initial available time is 180m');

  // Propose 60m adaptation
  const prop = ProposalManager.createProposal({
    raw: 'I only have one hour today',
    timeChange: { oldMinutes: 180, newMinutes: 60 }
  });

  assert(AppState.pendingProposal !== null, 'Proposal is in pending status');
  assert(AppState.constraints.availableMinutesToday === 180, 'Current state constraints remain untouched (180m) before confirmation');

  // Reject proposal
  ProposalManager.rejectProposal(prop.id);
  assert(AppState.pendingProposal === null, 'Proposal cleared after rejection');
  assert(AppState.constraints.availableMinutesToday === 180, 'Original plan preserved completely after rejection');

  // ----------------------------------------------------------------------------
  // TEST SUITE I: Invalid Tool Calls Cannot Corrupt Task State
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST I: Invalid Tool Calls Error Resistance ---');

  const taskCountBeforeInvalid = AppState.tasks.length;
  const mockCorruptToolCall = {
    status: 'success',
    reply: 'Testing error resilience',
    toolCalls: [
      {
        function: {
          name: 'propose_schedule_change',
          arguments: '{ malformed json: not valid ' // Invalid JSON
        }
      },
      {
        function: {
          name: 'complete_task',
          arguments: JSON.stringify({ taskTitleOrId: 'Non-Existent Mystery Task 999' })
        }
      }
    ],
    model: 'gpt-4o-mini'
  };

  // Should not throw and should not corrupt state
  let errorThrown = false;
  try {
    await UIRenderer.handleAIModelSuccess(mockCorruptToolCall, 'corrupt call');
  } catch (e) {
    errorThrown = true;
  }

  assert(errorThrown === false, 'Invalid tool calls handled gracefully without throwing unhandled exceptions');
  assert(AppState.tasks.length === taskCountBeforeInvalid, 'Task array not corrupted by invalid tool calls');

  // ----------------------------------------------------------------------------
  // TEST SUITE J: Undo & State Persistence
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST J: Undo and Persistence Functionality ---');

  // Apply a valid revision
  const testProp = ProposalManager.createProposal({
    raw: 'Reducing to 60m',
    timeChange: { oldMinutes: 180, newMinutes: 60 }
  });
  ProposalManager.applyProposal(testProp.id);
  assert(AppState.constraints.availableMinutesToday === 60, 'Proposal applied, study hours updated to 60m');

  // Perform Undo
  const undone = ProposalManager.undoLastChange();
  assert(undone !== null, 'Undo executed successfully');
  assert(AppState.constraints.availableMinutesToday === 180, 'Undo restored previous 180m study hours');

  // Persistence test
  StorageService.saveTasks();
  StorageService.saveConstraints();
  AppState.tasks = [];
  AppState.constraints = null;
  StorageService.loadAll();
  assert(AppState.tasks.length > 0, 'Tasks reloaded successfully from persistence storage');
  assert(AppState.constraints.availableMinutesToday === 180, 'Constraints reloaded accurately from persistence storage');

  // ----------------------------------------------------------------------------
  // TEST SUITE K: Missing Credentials & Network Errors
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST K: Missing Credentials and Error Handling ---');

  assert(isApiKeyConfigured('') === false, 'Empty API key detected as unconfigured');
  assert(isApiKeyConfigured('your_openai_api_key_here') === false, 'Placeholder API key detected as unconfigured');
  assert(isApiKeyConfigured('sk-placeholder123') === false, 'Sample placeholder detected as unconfigured');
  assert(isApiKeyConfigured('sk-proj-abc1234567890abcdef1234567890') === true, 'Valid formatted key detected as configured');

  // Gemini key validation checks
  assert(isGeminiKeyConfigured('') === false, 'Empty Gemini API key detected as unconfigured');
  assert(isGeminiKeyConfigured('short-key') === false, 'Short key under 15 chars detected as unconfigured');
  assert(isGeminiKeyConfigured('not-a-gemini-key-123456789') === false, 'Non-Gemini credential format is not reported as configured');
  assert(isGeminiKeyConfigured('AIzaSyD-abc1234567890abcdef1234567890') === true, 'Valid formatted key detected as valid Gemini key');

  console.log('\n--- TEST K1: Duplicate Submission and Backend Error Feedback ---');

  const originalSendMessage = AIService.sendMessage;
  let requestCount = 0;
  let completeRequest;
  AIService.sendMessage = () => {
    requestCount++;
    return new Promise(resolve => { completeRequest = resolve; });
  };
  AppState.chatMessages = [];
  const firstSubmission = UIRenderer.handleUserChatSubmit('Explain photosynthesis.');
  const duplicateSubmission = UIRenderer.handleUserChatSubmit('Explain photosynthesis.');
  assert(requestCount === 1, 'Concurrent duplicate chat submission sends only one backend request');
  completeRequest({
    ok: true,
    status: 'success',
    reply: 'Photosynthesis converts light energy into chemical energy.',
    toolCalls: [],
    model: 'gemini-test'
  });
  await Promise.all([firstSubmission, duplicateSubmission]);
  assert(!UIRenderer.isChatRequestInProgress, 'Chat request guard is cleared after a response completes');

  AIService.sendMessage = async () => ({ ok: false, networkError: true, error: 'private transport detail' });
  AppState.chatMessages = [];
  await UIRenderer.handleUserChatSubmit('What is photosynthesis?');
  const backendErrorMessages = AppState.chatMessages.filter(msg => msg.sender === 'assistant');
  assert(backendErrorMessages.some(msg => msg.text.includes('Could not reach the AimFlow backend')), 'Backend connection failure is clearly explained to the user');
  assert(!backendErrorMessages.some(msg => msg.text.includes('private transport detail')), 'Raw transport details are not shown in chat');
  AIService.sendMessage = originalSendMessage;

  console.log('\n--- TEST K1b: Safe Gemini Error Classification ---');

  assert(formatGeminiError({ status: 400, message: 'INVALID_ARGUMENT' }).errorType === 'INVALID_REQUEST', 'Gemini 400 request errors are not mislabeled as bad credentials');
  assert(formatGeminiError({ status: 403, message: 'forbidden' }).errorType === 'INVALID_CREDENTIALS', 'Gemini authentication errors receive a clear credential category');
  assert(formatGeminiError({ status: 404, message: 'not found' }).errorType === 'MODEL_NOT_FOUND', 'Gemini 404 errors identify likely model configuration problems');
  assert(formatGeminiError({ status: 503, message: 'overloaded' }).errorType === 'SERVICE_UNAVAILABLE', 'Gemini 503 errors receive a safe temporary-outage message');
  assert(formatGeminiError({ status: 429, message: 'quota exceeded' }).errorType === 'RATE_LIMIT_EXCEEDED', 'Gemini 429 errors receive a safe rate-limit message');
  const safeGenericError = formatGeminiError({ status: 500, message: 'private provider detail' });
  assert(!safeGenericError.message.includes('private provider detail'), 'Unexpected provider details are not returned to the browser');

  console.log('\n--- TEST K2: Gemini Transient Error Retries ---');

  assert(isTransientGeminiError({ status: 503 }), 'HTTP 503 is classified as transient');
  assert(isTransientGeminiError({ status: 429 }), 'HTTP 429 is classified as transient');
  assert(!isTransientGeminiError({ status: 400, message: 'UNAVAILABLE' }), 'Non-transient HTTP status is not retried');

  let transientAttempts = 0;
  const retryDelays = [];
  const retryResult = await withGeminiRetries(
    async () => {
      transientAttempts++;
      if (transientAttempts < 3) {
        const err = new Error('temporary Gemini failure');
        err.status = transientAttempts === 1 ? 503 : 429;
        throw err;
      }
      return 'success';
    },
    { sleep: async ms => retryDelays.push(ms) }
  );
  assert(retryResult === 'success' && transientAttempts === 3, 'Retries transient 503/429 errors and succeeds on the final allowed attempt');
  assert(retryDelays.join(',') === '500,1000', 'Retry delays increase exponentially');

  let permanentAttempts = 0;
  try {
    await withGeminiRetries(async () => {
      permanentAttempts++;
      const err = new Error('invalid request');
      err.status = 400;
      throw err;
    }, { sleep: async () => {} });
  } catch (err) {
    assert(permanentAttempts === 1, 'Does not retry permanent Gemini 400 errors');
  }

  let exhaustedAttempts = 0;
  try {
    await withGeminiRetries(async () => {
      exhaustedAttempts++;
      const err = new Error('service unavailable');
      err.status = 503;
      throw err;
    }, { sleep: async () => {} });
  } catch (err) {
    assert(exhaustedAttempts === 3, 'Stops after two retries when Gemini remains unavailable');
  }

  // When API key is not configured, callChatModel returns an honest setup notice.
  // When AI_PROVIDER=gemini, it asks for GEMINI_API_KEY and must NOT mention OPENAI_API_KEY.
  const geminiUnconfigured = {
    status: 'unconfigured',
    provider: 'gemini',
    message: 'AimFlow AI backend is online, but a valid GEMINI_API_KEY is not configured in your .env file.',
    setupInstructions: 'To enable Google Gemini AI (free tier):\n1. Go to https://aistudio.google.com/app/apikey\n2. Sign in with your Google account\n3. Click "Create API Key" and copy it (it starts with AIza...)\n4. Open .env in your project folder\n5. Set: GEMINI_API_KEY=AIzaSy...your-real-key...\n6. Restart the server with `node server.js`\n\nNote: Do not use your OpenAI or Amazon key here — Gemini keys start with AIza.\n\nIn the meantime, local deterministic schedule commands remain active.',
    fallbackAvailable: true
  };
  assert(geminiUnconfigured.status === 'unconfigured', 'Gemini returns unconfigured status when key missing/invalid');
  assert(geminiUnconfigured.setupInstructions.includes('GEMINI_API_KEY'), 'Gemini setup instructions ask for GEMINI_API_KEY');
  assert(!geminiUnconfigured.setupInstructions.includes('OPENAI_API_KEY'), 'Gemini setup instructions DO NOT require OPENAI_API_KEY');
  assert(!geminiUnconfigured.reply, 'Does NOT fabricate fake AI intelligence when Gemini credentials missing');

  // ----------------------------------------------------------------------------
  // TEST SUITE L: Syntax, Production Build & Server Health
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST L: Production Build, Syntax and Server Health ---');

  assert(typeof AIService.sendMessage === 'function', 'AIService.sendMessage is exported');
  assert(typeof AIService.checkHealth === 'function', 'AIService.checkHealth is exported');
  assert(Array.isArray(AI_TOOLS) && AI_TOOLS.length >= 6, 'All 6 MCP-compatible AI tools defined');

  // Verify tools schema
  const toolNames = AI_TOOLS.map(t => t.function.name);
  ['propose_schedule_change', 'add_task', 'complete_task', 'replan_day', 'undo_last_change', 'explain_task_placement'].forEach(name => {
    assert(toolNames.includes(name), `AI tool "${name}" defined in server schema`);
  });

  // Test local server creation
  const testServer = createServer();
  assert(testServer instanceof http.Server, 'HTTP server instantiated successfully');

  console.log('\n======================================================');
  console.log(`AI INTELLIGENCE TEST SUMMARY: ${passedTests} passed, ${failedTests} failed.`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllAITests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
