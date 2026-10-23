/**
 * AimFlow AI — Adaptive Life Engine & Simulated Alexa+ Experience
 * Track: Alexa+ (Amazon Developer Hackathon)
 * Tagline: "Plan That Bend. Dream That Don't."
 * 
 * Pure Vanilla JavaScript (ES6+). Zero external frameworks, zero external dependencies.
 * Deterministic scheduling algorithm, natural language command parser, and state persistence.
 */

'use strict';

// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================

const STORAGE_KEYS = {
  TASKS: 'lifepilot_tasks_v1',
  CONSTRAINTS: 'lifepilot_constraints_v1',
  HISTORY: 'lifepilot_history_v1',
  UNDO_STACK: 'lifepilot_undo_stack_v1',
  LAST_PROPOSAL: 'lifepilot_last_proposal_v1',
  SETTINGS: 'lifepilot_settings_v1'
};

const CATEGORIES = ['Project', 'Exam Prep', 'Assignment', 'Revision', 'Personal'];
const PRIORITIES = ['high', 'medium', 'low'];

// Transparent scoring weights
const SCORING_WEIGHTS = {
  URGENCY_MULTIPLIER: 1.5,
  PRIORITY_MULTIPLIER: 1.0,
  PRIORITY_POINTS: {
    high: 50,
    medium: 30,
    low: 10
  },
  URGENCY_POINTS: {
    OVERDUE: 100,
    TODAY: 90,
    TOMORROW: 80,
    TWO_DAYS: 60,
    THREE_DAYS: 45,
    FOUR_TO_SIX_DAYS: 30,
    SEVEN_PLUS_DAYS: 15
  }
};

// ============================================================================
// 2. DEFAULT STATE & DEMO SCENARIO DATA
// ============================================================================

/**
 * Returns a fresh ISO date string relative to today at midnight or specified offset in days.
 */
function getRelativeDate(daysOffset = 0, timeStr = '23:59') {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}T${timeStr}`;
}

function getTodayDateOnly() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Exact demo scenario as required by Section 5 of the specification:
 * - Hackathon project: 180 min, due in 3 days, high priority
 * - Mathematics revision: 60 min, due tomorrow, medium priority
 * - Programming assignment: 90 min, due in 2 days, high priority
 * - General revision: 60 min, due in 4 days, low priority
 * Initial available time: 3 hours (180 mins) today.
 */
function createDemoTasks() {
  const now = new Date().toISOString();
  return [
    {
      id: 'task_demo_hackathon',
      title: 'Hackathon project',
      category: 'Project',
      deadline: getRelativeDate(3, '22:00'),
      estimatedDuration: 180, // minutes
      priority: 'high',
      completed: false,
      completedAt: null,
      notes: 'Final prototype build, video demo, and submission documentation.',
      createdAt: now,
      updatedAt: now,
      status: 'scheduled'
    },
    {
      id: 'task_demo_math',
      title: 'Mathematics revision',
      category: 'Exam Prep',
      deadline: getRelativeDate(1, '18:00'),
      estimatedDuration: 60,
      priority: 'medium',
      completed: false,
      completedAt: null,
      notes: 'Linear algebra review and practice problem set.',
      createdAt: now,
      updatedAt: now,
      status: 'scheduled'
    },
    {
      id: 'task_demo_programming',
      title: 'Programming assignment',
      category: 'Assignment',
      deadline: getRelativeDate(2, '23:59'),
      estimatedDuration: 90,
      priority: 'high',
      completed: false,
      completedAt: null,
      notes: 'Data structures assignment on graph traversal algorithms.',
      createdAt: now,
      updatedAt: now,
      status: 'scheduled'
    },
    {
      id: 'task_demo_general',
      title: 'General revision',
      category: 'Revision',
      deadline: getRelativeDate(4, '20:00'),
      estimatedDuration: 60,
      priority: 'low',
      completed: false,
      completedAt: null,
      notes: 'Review elective course reading notes.',
      createdAt: now,
      updatedAt: now,
      status: 'scheduled'
    }
  ];
}

function createDefaultConstraints() {
  return {
    availableMinutesToday: 180, // 3 hours initially
    dayStartTime: '16:00', // 4:00 PM start time for study blocks
    commitments: [], // unexpected or logged calendar commitments
    date: getTodayDateOnly()
  };
}

// ============================================================================
// 3. APPLICATION STATE
// ============================================================================

const AppState = {
  tasks: [],
  constraints: createDefaultConstraints(),
  currentPlan: null,
  pendingProposal: null,
  lastAppliedProposal: null,
  chatMessages: [],
  undoStack: [],
  selectedTaskId: null,
  filterCategory: 'all',
  filterStatus: 'all',
  searchQuery: '',
  settings: {
    voiceSpeechEnabled: false,
    voiceAutoSubmit: false,
    soundEffectsEnabled: true
  }
};

// ============================================================================
// 4. STORAGE & PERSISTENCE
// ============================================================================

const StorageService = {
  getStorage() {
    return (typeof window !== 'undefined' && window.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
  },

  isAvailable() {
    try {
      const storage = this.getStorage();
      if (!storage) return false;
      const test = '__storage_test__';
      storage.setItem(test, test);
      storage.removeItem(test);
      return true;
    } catch (e) {
      console.warn('localStorage is unavailable, falling back to memory state.', e);
      return false;
    }
  },

  loadAll() {
    if (!this.isAvailable()) {
      AppState.tasks = createDemoTasks();
      AppState.constraints = createDefaultConstraints();
      return;
    }

    try {
      const storage = this.getStorage();
      const savedTasks = storage ? storage.getItem(STORAGE_KEYS.TASKS) : null;
      const savedConstraints = storage ? storage.getItem(STORAGE_KEYS.CONSTRAINTS) : null;
      const savedChat = storage ? storage.getItem(STORAGE_KEYS.HISTORY) : null;
      const savedProposal = storage ? storage.getItem(STORAGE_KEYS.LAST_PROPOSAL) : null;
      const savedSettings = storage ? storage.getItem(STORAGE_KEYS.SETTINGS) : null;

      if (savedTasks) {
        AppState.tasks = JSON.parse(savedTasks);
      } else {
        AppState.tasks = createDemoTasks();
        this.saveTasks();
      }

      if (savedConstraints) {
        AppState.constraints = JSON.parse(savedConstraints);
      } else {
        AppState.constraints = createDefaultConstraints();
        this.saveConstraints();
      }

      if (savedChat) {
        AppState.chatMessages = JSON.parse(savedChat);
      }

      if (savedProposal) {
        AppState.lastAppliedProposal = JSON.parse(savedProposal);
      }

      if (savedSettings) {
        AppState.settings = Object.assign(AppState.settings, JSON.parse(savedSettings));
      }
    } catch (e) {
      console.error('Error loading state from localStorage:', e);
      AppState.tasks = createDemoTasks();
      AppState.constraints = createDefaultConstraints();
    }
  },

  saveTasks() {
    if (!this.isAvailable()) return;
    try {
      const storage = this.getStorage();
      if (storage) storage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(AppState.tasks));
    } catch (e) {
      console.error('Failed to save tasks:', e);
    }
  },

  saveConstraints() {
    if (!this.isAvailable()) return;
    try {
      const storage = this.getStorage();
      if (storage) storage.setItem(STORAGE_KEYS.CONSTRAINTS, JSON.stringify(AppState.constraints));
    } catch (e) {
      console.error('Failed to save constraints:', e);
    }
  },

  saveChat() {
    if (!this.isAvailable()) return;
    try {
      // Keep only last 40 messages to avoid exceeding storage quota
      const storage = this.getStorage();
      const trimmed = AppState.chatMessages.slice(-40);
      if (storage) storage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(trimmed));
    } catch (e) {
      console.error('Failed to save chat:', e);
    }
  },

  saveLastProposal(proposal) {
    if (!this.isAvailable()) return;
    try {
      const storage = this.getStorage();
      if (storage) storage.setItem(STORAGE_KEYS.LAST_PROPOSAL, JSON.stringify(proposal));
    } catch (e) {
      console.error('Failed to save last proposal:', e);
    }
  },

  saveSettings() {
    if (!this.isAvailable()) return;
    try {
      const storage = this.getStorage();
      if (storage) storage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(AppState.settings));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  },

  clearAllData() {
    if (this.isAvailable()) {
      const storage = this.getStorage();
      if (storage) {
        storage.removeItem(STORAGE_KEYS.TASKS);
        storage.removeItem(STORAGE_KEYS.CONSTRAINTS);
        storage.removeItem(STORAGE_KEYS.HISTORY);
        storage.removeItem(STORAGE_KEYS.UNDO_STACK);
        storage.removeItem(STORAGE_KEYS.LAST_PROPOSAL);
      }
    }
    AppState.tasks = [];
    AppState.constraints = createDefaultConstraints();
    AppState.chatMessages = [];
    AppState.undoStack = [];
    AppState.pendingProposal = null;
    AppState.lastAppliedProposal = null;
  },

  resetDemo() {
    AppState.tasks = createDemoTasks();
    AppState.constraints = createDefaultConstraints();
    AppState.pendingProposal = null;
    AppState.undoStack = [];
    this.saveTasks();
    this.saveConstraints();
  }
};

// ============================================================================
// 5. DETERMINISTIC SCHEDULING & IMPACT ENGINE
// ============================================================================

/**
 * Transparent Scoring Algorithm:
 * - Deadline Urgency:
 *     Overdue (< 0 days): 100 pts
 *     Due Today (0 days): 90 pts
 *     Due Tomorrow (1 day): 80 pts
 *     Due in 2 days: 60 pts
 *     Due in 3 days: 45 pts
 *     Due in 4-6 days: 30 pts
 *     Due >= 7 days: 15 pts
 * - Priority:
 *     High: 50 pts
 *     Medium: 30 pts
 *     Low: 10 pts
 * - Composite Score = (UrgencyScore * 1.5) + (PriorityScore * 1.0)
 * - Tie-breaker: Shorter duration scheduled first (Shortest Processing Time).
 */
const SchedulingEngine = {
  calculateDaysUntil(deadlineStr) {
    if (!deadlineStr) return 999;
    const deadlineDate = new Date(deadlineStr);
    if (isNaN(deadlineDate.getTime())) return 999;
    const now = new Date();
    // Normalize to local date boundary
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const deadlineMidnight = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
    
    const diffTime = deadlineMidnight.getTime() - todayMidnight.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  },

  calculateTaskScore(task) {
    if (task.completed) return -1; // Completed tasks do not compete for study slots

    const days = this.calculateDaysUntil(task.deadline);
    let urgencyPoints = SCORING_WEIGHTS.URGENCY_POINTS.SEVEN_PLUS_DAYS;

    if (days < 0) {
      urgencyPoints = SCORING_WEIGHTS.URGENCY_POINTS.OVERDUE;
    } else if (days === 0) {
      urgencyPoints = SCORING_WEIGHTS.URGENCY_POINTS.TODAY;
    } else if (days === 1) {
      urgencyPoints = SCORING_WEIGHTS.URGENCY_POINTS.TOMORROW;
    } else if (days === 2) {
      urgencyPoints = SCORING_WEIGHTS.URGENCY_POINTS.TWO_DAYS;
    } else if (days === 3) {
      urgencyPoints = SCORING_WEIGHTS.URGENCY_POINTS.THREE_DAYS;
    } else if (days <= 6) {
      urgencyPoints = SCORING_WEIGHTS.URGENCY_POINTS.FOUR_TO_SIX_DAYS;
    }

    const priorityPoints = SCORING_WEIGHTS.PRIORITY_POINTS[task.priority] || 10;
    const compositeScore = (urgencyPoints * SCORING_WEIGHTS.URGENCY_MULTIPLIER) + 
                           (priorityPoints * SCORING_WEIGHTS.PRIORITY_MULTIPLIER);

    return {
      daysUntilDeadline: days,
      urgencyPoints,
      priorityPoints,
      compositeScore,
      isOverdue: days < 0,
      isDueSoon: days <= 1
    };
  },

  /**
   * Generates a concrete timeline with realistic clock times.
   * Day starts at constraints.dayStartTime (e.g. 16:00 / 4:00 PM).
   * Includes 5-10 minute buffer intervals between heavy sessions.
   */
  generateTimelineSlots(scheduledItems, startTimeStr = '16:00') {
    const slots = [];
    const [startH, startM] = startTimeStr.split(':').map(Number);
    let currentMinutes = (startH * 60) + startM;

    for (const item of scheduledItems) {
      const fromH = Math.floor(currentMinutes / 60) % 24;
      const fromM = currentMinutes % 60;
      
      const toMinutes = currentMinutes + item.allocatedDuration;
      const toH = Math.floor(toMinutes / 60) % 24;
      const toM = toMinutes % 60;

      const formatTime = (h, m) => {
        const period = h >= 12 ? 'PM' : 'AM';
        const displayH = h % 12 === 0 ? 12 : h % 12;
        const displayM = String(m).padStart(2, '0');
        return `${displayH}:${displayM} ${period}`;
      };

      slots.push({
        taskId: item.task.id,
        title: item.task.title,
        category: item.task.category,
        priority: item.task.priority,
        allocatedDuration: item.allocatedDuration,
        startTimeFormatted: formatTime(fromH, fromM),
        endTimeFormatted: formatTime(toH, toM),
        isPartial: item.isPartial,
        notes: item.notes
      });

      // 5-minute breather break between blocks
      currentMinutes = toMinutes + 5;
    }

    return slots;
  },

  /**
   * Builds a deterministic schedule plan from given tasks and constraints.
   */
  computePlan(tasks, constraints) {
    const totalAvailable = Math.max(0, constraints.availableMinutesToday);
    
    // Commitments consume available study capacity
    const commitmentMinutes = (constraints.commitments || []).reduce((sum, c) => sum + (c.durationMinutes || 0), 0);
    const netStudyTime = Math.max(0, totalAvailable - commitmentMinutes);

    // Filter uncompleted tasks and score them
    const activeTasks = tasks.filter(t => !t.completed).map(task => {
      const scoreData = this.calculateTaskScore(task);
      return {
        task,
        ...scoreData
      };
    });

    // Completed tasks are preserved
    const completedTasks = tasks.filter(t => t.completed);

    // Sort descending by composite score; tie-break with shorter duration first
    activeTasks.sort((a, b) => {
      if (b.compositeScore !== a.compositeScore) {
        return b.compositeScore - a.compositeScore;
      }
      return a.task.estimatedDuration - b.task.estimatedDuration;
    });

    let remainingMinutes = netStudyTime;
    const scheduledItems = [];
    const atRiskItems = [];
    const postponedItems = [];

    let totalDurationNeeded = 0;

    for (const item of activeTasks) {
      const taskDuration = Math.max(5, Math.round(Number(item.task.estimatedDuration) || 30));
      totalDurationNeeded += taskDuration;

      if (remainingMinutes >= taskDuration) {
        // Fits fully into today's available time
        scheduledItems.push({
          task: item.task,
          allocatedDuration: taskDuration,
          isPartial: false,
          notes: 'Fully scheduled within available study window.'
        });
        remainingMinutes -= taskDuration;
      } else if (remainingMinutes > 0) {
        // Fits partially - allocate remaining focus time, flag remaining as at-risk
        const partialDuration = remainingMinutes;
        const deficit = taskDuration - partialDuration;

        scheduledItems.push({
          task: item.task,
          allocatedDuration: partialDuration,
          isPartial: true,
          notes: `Allocated ${partialDuration}m focus block; ${deficit}m remaining requires future study window.`
        });

        atRiskItems.push({
          task: item.task,
          allocatedDuration: partialDuration,
          deficitMinutes: deficit,
          reason: `High-priority work requiring ${taskDuration}m, but only ${partialDuration}m could fit today.`
        });

        remainingMinutes = 0;
      } else {
        // Does not fit today
        const isUrgent = item.daysUntilDeadline <= 1;
        const reason = isUrgent
          ? `Due ${item.daysUntilDeadline === 0 ? 'today' : 'tomorrow'} but exceeded today's ${netStudyTime}m study capacity.`
          : `Postponed to later study window to prioritize nearest deadlines.`;

        if (isUrgent) {
          atRiskItems.push({
            task: item.task,
            allocatedDuration: 0,
            deficitMinutes: taskDuration,
            reason
          });
        }

        postponedItems.push({
          task: item.task,
          allocatedDuration: 0,
          reason
        });
      }
    }

    const scheduledMinutes = netStudyTime - remainingMinutes;
    const capacityDeficit = Math.max(0, totalDurationNeeded - netStudyTime);
    const timeline = this.generateTimelineSlots(scheduledItems, constraints.dayStartTime || '16:00');

    return {
      totalAvailable: netStudyTime,
      totalDurationNeeded,
      scheduledMinutes,
      unusedMinutes: remainingMinutes,
      capacityDeficit,
      scheduledItems,
      atRiskItems,
      postponedItems,
      completedTasks,
      timeline
    };
  },

  /**
   * Generates a clear, explainable impact analysis comparing before and after.
   */
  generateImpactExplanation(beforePlan, proposedPlan, changeTrigger) {
    const changesDetected = [];
    const actionsTaken = [];

    // 1. Detect change causes
    if (changeTrigger.deadlineChanges && changeTrigger.deadlineChanges.length > 0) {
      for (const dc of changeTrigger.deadlineChanges) {
        changesDetected.push(`Deadline for "${dc.taskTitle}" moved from ${dc.oldDeadlineText} to ${dc.newDeadlineText}.`);
      }
    }

    if (changeTrigger.timeChange) {
      changesDetected.push(`Available study time changed from ${changeTrigger.timeChange.oldMinutes} mins to ${changeTrigger.timeChange.newMinutes} mins.`);
    }

    if (changeTrigger.commitmentAdded) {
      changesDetected.push(`Unexpected commitment "${changeTrigger.commitmentAdded.title}" logged for ${changeTrigger.commitmentAdded.durationMinutes} mins.`);
    }

    if (changeTrigger.taskCompleted) {
      changesDetected.push(`Marked "${changeTrigger.taskCompleted.title}" as completed.`);
    }

    if (changesDetected.length === 0) {
      changesDetected.push('Schedule re-optimized based on current task deadlines and priorities.');
    }

    // 2. Identify actions taken
    const scheduledNowIds = new Set(proposedPlan.scheduledItems.map(i => i.task.id));
    const scheduledBeforeIds = new Set((beforePlan ? beforePlan.scheduledItems : []).map(i => i.task.id));

    // Tasks newly scheduled
    const newlyScheduled = proposedPlan.scheduledItems.filter(i => !scheduledBeforeIds.has(i.task.id));
    if (newlyScheduled.length > 0) {
      actionsTaken.push(`Prioritized ${newlyScheduled.map(i => `"${i.task.title}" (${i.allocatedDuration}m)`).join(', ')}.`);
    }

    // Tasks postponed
    const newlyPostponed = proposedPlan.postponedItems.filter(i => scheduledBeforeIds.has(i.task.id));
    if (newlyPostponed.length > 0) {
      actionsTaken.push(`Moved ${newlyPostponed.map(i => `"${i.task.title}"`).join(', ')} to later study sessions.`);
    }

    // Partial focus allocations
    const partials = proposedPlan.scheduledItems.filter(i => i.isPartial);
    if (partials.length > 0) {
      for (const p of partials) {
        actionsTaken.push(`Allocated maximum available ${p.allocatedDuration}m focus block for "${p.task.title}" (needs ${p.task.estimatedDuration}m total).`);
      }
    }

    // Preserved work
    actionsTaken.push(`Preserved ${proposedPlan.completedTasks.length} already completed task(s).`);

    // At risk warnings
    if (proposedPlan.atRiskItems.length > 0) {
      actionsTaken.push(`Flagged ${proposedPlan.atRiskItems.length} task(s) at risk due to finite study hours.`);
    }

    // 3. Synthesize human "Why?" rationale
    let why = '';
    if (proposedPlan.capacityDeficit > 0) {
      const topUrgent = proposedPlan.scheduledItems[0];
      const urgentName = topUrgent ? `"${topUrgent.task.title}"` : 'urgent deadlines';
      why = `Your total workload (${proposedPlan.totalDurationNeeded}m) exceeds today's available time (${proposedPlan.totalAvailable}m) by ${proposedPlan.capacityDeficit}m. AimFlow prioritized ${urgentName} with the nearest deadline instead of pretending every task can be completed today.`;
    } else {
      why = `All your active tasks fit comfortably within today's ${proposedPlan.totalAvailable}m window. Work is ordered by deadline urgency to minimize procrastination and late submissions.`;
    }

    return {
      changesDetected,
      actionsTaken,
      why,
      metrics: {
        timeBefore: beforePlan ? beforePlan.totalAvailable : proposedPlan.totalAvailable,
        timeAfter: proposedPlan.totalAvailable,
        scheduledBefore: beforePlan ? beforePlan.scheduledMinutes : 0,
        scheduledAfter: proposedPlan.scheduledMinutes,
        deficit: proposedPlan.capacityDeficit,
        atRiskCount: proposedPlan.atRiskItems.length
      }
    };
  }
};

// ============================================================================
// 6. NATURAL LANGUAGE COMMAND INTERPRETER
// ============================================================================

const NaturalLanguageInterpreter = {
  /**
   * Parses time expressions like "1 hour", "90 minutes", "2.5 hours", "30 mins".
   * Returns minutes as integer, or null.
   */
  extractMinutes(text) {
    // e.g. "one hour", "two hours", "three hours", "half an hour", "two-hour"
    const wordNums = {
      'half an': 30,
      'half a': 30,
      'one': 60,
      'two': 120,
      'three': 180,
      'four': 240,
      'five': 300
    };

    for (const [word, mins] of Object.entries(wordNums)) {
      if (new RegExp(`\\b${word}[\\s-]+hours?\\b`, 'i').test(text)) {
        return mins;
      }
    }

    // Check "1 hour", "1.5 hours", "2 hrs", "2-hour"
    const hourMatch = text.match(/(\d+(?:\.\d+)?)[-\s]*(?:hours?|hrs?|h)\b/i);
    if (hourMatch) {
      return Math.round(parseFloat(hourMatch[1]) * 60);
    }

    // Check "45 minutes", "90 mins", "45-min"
    const minMatch = text.match(/(\d+)[-\s]*(?:minutes?|mins?|m)\b/i);
    if (minMatch) {
      return parseInt(minMatch[1], 10);
    }

    return null;
  },

  /**
   * Matches relative deadline strings to actual ISO dates.
   */
  extractDeadline(text) {
    const lower = text.toLowerCase();

    // Look around deadline keywords first if present to avoid cross-talk with "today" elsewhere in compound utterances
    const deadlineContext = lower.match(/(?:deadline|due|move|moved|reschedule|rescheduled|postpone|postponed|shift|shifted)[^.,;]*(?:to|is|on|by)?\s*([a-z0-9\s]+)/i);
    const scope = deadlineContext ? deadlineContext[0] : lower;

    if (scope.includes('day after tomorrow') || lower.includes('day after tomorrow')) {
      return getRelativeDate(2, '20:00');
    }
    if (scope.includes('tomorrow') || lower.includes('tomorrow')) {
      return getRelativeDate(1, '20:00');
    }
    if (scope.includes('today') || scope.includes('tonight')) {
      return getRelativeDate(0, '22:00');
    }
    
    // "in X days"
    const inDaysMatch = scope.match(/in\s+(\d+)\s+days?/) || lower.match(/in\s+(\d+)\s+days?/);
    if (inDaysMatch) {
      return getRelativeDate(parseInt(inDaysMatch[1], 10), '20:00');
    }

    // Day of week matching
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < daysOfWeek.length; i++) {
      if (scope.includes(daysOfWeek[i]) || lower.includes(daysOfWeek[i])) {
        const today = new Date().getDay();
        let diff = i - today;
        if (diff <= 0) diff += 7; // next occurrence
        return getRelativeDate(diff, '20:00');
      }
    }

    if (lower.includes('today') || lower.includes('tonight')) {
      return getRelativeDate(0, '22:00');
    }

    return null;
  },

  /**
   * Fuzzy matches a task title or keywords from the user utterance.
   */
  findMatchingTask(text, tasks) {
    const candidates = this.findMatchingTasks(text, tasks);
    return candidates.length > 0 ? candidates[0].task : null;
  },

  findMatchingTasks(text, tasks) {
    const clean = text.toLowerCase();
    const scored = [];

    for (const t of tasks) {
      const titleLower = t.title.toLowerCase();
      let score = 0;

      // Exact substring match
      if (clean.includes(titleLower)) {
        score += 100;
      }

      // Check significant words
      const words = titleLower.split(/\s+/).filter(w => w.length > 2);
      for (const w of words) {
        if (clean.includes(w)) {
          score += 25;
        }
      }

      // Check category
      if (clean.includes(t.category.toLowerCase())) {
        score += 15;
      }

      if (score >= 20) {
        scored.push({ task: t, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  },

  /**
   * Main intent parsing method. Returns a structured intent object.
   */
  interpret(userInput, tasks, currentConstraints) {
    const raw = userInput.trim();
    // Strip trailing punctuation
    const clean = raw.replace(/[.?!,;]+$/, '').trim();
    const lower = clean.toLowerCase();

    // 0. Check for APPROVAL or REJECTION of pending proposal in chat
    if (typeof AppState !== 'undefined' && AppState && AppState.pendingProposal) {
      if (/^(?:apply|apply revised plan|apply plan|approve|yes|confirm|accept|agree|proceed)\b/i.test(lower)) {
        return { type: 'APPROVE_PROPOSAL', proposalId: AppState.pendingProposal.id, raw };
      }
      if (/^(?:reject|cancel|no|keep original|keep original plan|decline|discard)\b/i.test(lower)) {
        return { type: 'REJECT_PROPOSAL', proposalId: AppState.pendingProposal.id, raw };
      }
    }

    // 1. Check for UNDO
    if (/^(?:undo|undo that|undo last|undo change|revert|go back)\b/i.test(lower)) {
      return { type: 'UNDO', raw };
    }

    // 2. Check for WHAT CHANGED
    if (/(?:what changed|show me what changed|show changes|summary of changes|what did you change)/i.test(lower)) {
      return { type: 'WHAT_CHANGED', raw };
    }

    // 3. Check for WHY DID YOU CHANGE / MOVE
    if (/(?:why did you move|why did you change|why was .* moved|why is .* postponed|why were .* moved|explain why)/i.test(lower)) {
      const candidates = this.findMatchingTasks(lower, tasks);
      const isAmbiguous = candidates.length > 1 && candidates[0].score === candidates[1].score;
      const matchedTask = candidates.length > 0 ? candidates[0].task : null;
      return {
        type: 'EXPLAIN_WHY',
        matchedTask,
        isAmbiguous,
        matchingCandidates: candidates.map(c => c.task),
        raw
      };
    }

    // 4. Check for WHAT SHOULD I DO NEXT
    if (/(?:what should i do next|what to do next|what's next|whats next|next task|what now)/i.test(lower)) {
      return { type: 'WHAT_NEXT', raw };
    }

    // 5. Check for COMPLETE TASK
    if (/(?:finished|completed|done with|marked?\s+\S+.*?\s+as\s+(?:done|complete)|check off|i(?:'ve| have) finished|just finished)\b/i.test(lower)) {
      const matchedTask = this.findMatchingTask(lower, tasks);
      if (matchedTask) {
        return { type: 'COMPLETE_TASK', task: matchedTask, raw };
      }
    }

    // 6. Check for REPLAN / OPTIMIZE (removed ^ anchor to allow mid-sentence matches)
    if (/(?:replan|replan my day|optimize(?:\s+my)?\s+schedule|re-organize|reorganize my day|rebuild(?:\s+my)?\s+plan)/i.test(lower)) {
      return { type: 'REPLAN_DAY', raw };
    }

    // 7. Check for ADD TASK (e.g. "Add a programming assignment due Friday for 90 minutes.")
    if (/^add\s+(?:a\s+|an\s+)?(?:new\s+)?(?:task|assignment|project|exam prep|revision)?\b/i.test(lower)) {
      const duration = this.extractMinutes(lower) || 60;
      const deadline = this.extractDeadline(lower) || getRelativeDate(2, '20:00');
      let priority = 'medium';
      if (lower.includes('high')) priority = 'high';
      if (lower.includes('low')) priority = 'low';

      let category = 'Assignment';
      if (lower.includes('project')) category = 'Project';
      else if (lower.includes('exam') || lower.includes('prep') || lower.includes('test')) category = 'Exam Prep';
      else if (lower.includes('revision')) category = 'Revision';
      else if (lower.includes('personal')) category = 'Personal';

      // Clean title
      let title = clean
        .replace(/^add\s+(?:a\s+|an\s+)?(?:new\s+)?(?:task|assignment|project|exam prep|revision)?\s*/i, '')
        .replace(/\b(?:due|on|by)\s+[a-z0-9\s]+$/i, '')
        .replace(/\b(?:for|taking)?\s*\d+\s*(?:hours?|minutes?|mins?|m|h)\b.*/i, '')
        .replace(/\b(?:with\s+)?(?:high|medium|low)\s+priority\b.*/i, '')
        .trim();

      if (!title || title.length < 2) {
        title = 'New ' + category;
      }

      return {
        type: 'ADD_TASK',
        taskData: {
          title,
          category,
          deadline,
          estimatedDuration: duration,
          priority
        },
        raw
      };
    }

    // 8. Check for ADAPTIVE INTENTS & DEADLINE SHIFTS:
    const detectedDeadlines = [];
    let detectedTimeChange = null;
    let detectedCommitment = null;

    // Check if available study time is mentioned
    // Handles absolute time: "only have X hours", "study time is X", "can study for X", "just X hours", etc.
    if (/(?:only have|have only|available time|study time|can study for|time left|study window|have just|just have|only got|got only|reducing.*to|cut.*to\s+\d)/i.test(lower)) {
      const minutes = this.extractMinutes(lower);
      if (minutes !== null) {
        detectedTimeChange = {
          oldMinutes: currentConstraints.availableMinutesToday,
          newMinutes: minutes
        };
      }
    } else if (/(?:i(?:'ve| have)? lost|lost me|lost\s+(?:an?|\d)|losing\s+\d)/i.test(lower)) {
      // Relative time loss: "I lost X hours" reduces the current available time by the extracted amount
      const lostMins = this.extractMinutes(lower);
      if (lostMins !== null) {
        const newMinutes = Math.max(0, currentConstraints.availableMinutesToday - lostMins);
        detectedTimeChange = {
          oldMinutes: currentConstraints.availableMinutesToday,
          newMinutes
        };
      }
    }

    // Check if an unexpected commitment is mentioned
    if (/(?:unexpected|commitment|appointment|emergency meeting|doctor|dentist)/i.test(lower) && !detectedTimeChange) {
      const commitmentMinutes = this.extractMinutes(lower) || 60;
      detectedCommitment = {
        title: 'Unexpected commitment',
        durationMinutes: commitmentMinutes
      };
    }

    // Check if deadline is mentioned
    if (/(?:deadline|due|move|moved|reschedule|rescheduled|postpone|postponed|shift|shifted)\b/i.test(lower)) {
      const targetDeadline = this.extractDeadline(lower);
      const matchedTask = this.findMatchingTask(lower, tasks);

      if (targetDeadline && matchedTask) {
        detectedDeadlines.push({
          taskId: matchedTask.id,
          taskTitle: matchedTask.title,
          oldDeadline: matchedTask.deadline,
          oldDeadlineText: new Date(matchedTask.deadline).toLocaleDateString(),
          newDeadline: targetDeadline,
          newDeadlineText: new Date(targetDeadline).toLocaleDateString()
        });
      }
    }

    // If compound or specific adaptation triggers were found:
    if (detectedDeadlines.length > 0 || detectedTimeChange || detectedCommitment) {
      return {
        type: 'ADAPTIVE_CHANGE',
        deadlineChanges: detectedDeadlines,
        timeChange: detectedTimeChange,
        commitmentAdded: detectedCommitment,
        raw
      };
    }

    // Unsupported command with helpful guidance
    return {
      type: 'UNSUPPORTED',
      raw
    };
  }
};

// ============================================================================
// 7. PROPOSAL, APPROVAL & UNDO MANAGER
// ============================================================================

const ProposalManager = {
  /**
   * Prepares a schedule revision proposal without overwriting the user's plan.
   */
  createProposal(triggerInfo) {
    const beforeTasks = JSON.parse(JSON.stringify(AppState.tasks));
    const beforeConstraints = JSON.parse(JSON.stringify(AppState.constraints));
    const beforePlan = SchedulingEngine.computePlan(beforeTasks, beforeConstraints);

    // Apply hypothetical changes to a clone
    const modifiedTasks = JSON.parse(JSON.stringify(AppState.tasks));
    const modifiedConstraints = JSON.parse(JSON.stringify(AppState.constraints));

    if (triggerInfo.deadlineChanges) {
      for (const dc of triggerInfo.deadlineChanges) {
        const t = modifiedTasks.find(item => item.id === dc.taskId);
        if (t) {
          t.deadline = dc.newDeadline;
          t.updatedAt = new Date().toISOString();
        }
      }
    }

    if (triggerInfo.timeChange) {
      modifiedConstraints.availableMinutesToday = triggerInfo.timeChange.newMinutes;
    }

    if (triggerInfo.commitmentAdded) {
      modifiedConstraints.commitments = modifiedConstraints.commitments || [];
      modifiedConstraints.commitments.push({
        id: 'comm_' + Date.now(),
        title: triggerInfo.commitmentAdded.title,
        durationMinutes: triggerInfo.commitmentAdded.durationMinutes
      });
    }

    const proposedPlan = SchedulingEngine.computePlan(modifiedTasks, modifiedConstraints);
    const explanation = SchedulingEngine.generateImpactExplanation(beforePlan, proposedPlan, triggerInfo);

    const proposal = {
      id: 'prop_' + Date.now(),
      timestamp: new Date().toISOString(),
      triggerText: triggerInfo.raw,
      triggerInfo,
      beforeTasks,
      beforeConstraints,
      beforePlan,
      modifiedTasks,
      modifiedConstraints,
      proposedPlan,
      explanation,
      status: 'pending'
    };

    AppState.pendingProposal = proposal;
    return proposal;
  },

  /**
   * Applies the approved revision to the primary application state.
   */
  applyProposal(proposalId) {
    if (!AppState.pendingProposal || AppState.pendingProposal.id !== proposalId) {
      return false;
    }

    const p = AppState.pendingProposal;

    // Push previous state to undo stack
    AppState.undoStack.push({
      timestamp: new Date().toISOString(),
      description: `Reverted plan adaptation: "${p.triggerText}"`,
      tasks: JSON.parse(JSON.stringify(AppState.tasks)),
      constraints: JSON.parse(JSON.stringify(AppState.constraints)),
      lastAppliedProposal: AppState.lastAppliedProposal
    });

    // Commit changes
    AppState.tasks = p.modifiedTasks;
    AppState.constraints = p.modifiedConstraints;
    AppState.currentPlan = p.proposedPlan;
    AppState.lastAppliedProposal = p;
    AppState.pendingProposal = null;

    p.status = 'approved';

    StorageService.saveTasks();
    StorageService.saveConstraints();
    StorageService.saveLastProposal(p);

    return true;
  },

  /**
   * Discards the proposed schedule revision.
   */
  rejectProposal(proposalId) {
    if (AppState.pendingProposal && AppState.pendingProposal.id === proposalId) {
      AppState.pendingProposal.status = 'rejected';
      AppState.pendingProposal = null;
      return true;
    }
    return false;
  },

  /**
   * Safely undoes the last applied schedule revision.
   */
  undoLastChange() {
    if (AppState.undoStack.length === 0) {
      return null;
    }

    const snapshot = AppState.undoStack.pop();
    AppState.tasks = snapshot.tasks;
    AppState.constraints = snapshot.constraints;
    AppState.lastAppliedProposal = snapshot.lastAppliedProposal;
    AppState.pendingProposal = null;
    AppState.currentPlan = SchedulingEngine.computePlan(AppState.tasks, AppState.constraints);

    StorageService.saveTasks();
    StorageService.saveConstraints();
    if (AppState.lastAppliedProposal) {
      StorageService.saveLastProposal(AppState.lastAppliedProposal);
    }

    return snapshot.description;
  }
};

// ============================================================================
// 8. SPEECH SYNTHESIS & SOUND (Simulated Alexa+ Voice & Cues)
// ============================================================================

const AudioService = {
  speak(text) {
    if (!AppState.settings.voiceSpeechEnabled) return;
    if (!('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      
      // Attempt to pick a smooth English voice
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha')));
      if (preferred) {
        utterance.voice = preferred;
      }
      
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
    }
  },

  playChime(type = 'chime') {
    if (!AppState.settings.soundEffectsEnabled) return;
    if (!('AudioContext' in window || 'webkitAudioContext' in window)) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'chime') {
        // Alexa-style soft two-tone ascending chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12); // A5
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } else if (type === 'alert') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.setValueAtTime(330, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch (e) {
      // Audio autoplay may be blocked until user gesture, safely ignore
    }
  }
};

// ============================================================================
// 8b. VOICE INPUT & SPEECH RECOGNITION (Alexa+ Voice Engine)
// ============================================================================

const VoiceRecognitionState = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  RECEIVED: 'received',
  PERMISSION_DENIED: 'permission_denied',
  UNAVAILABLE: 'unavailable',
  UNSUPPORTED: 'unsupported',
  ERROR: 'error'
};

const VoiceInputService = {
  recognition: null,
  currentState: VoiceRecognitionState.IDLE,
  isSessionActive: false,
  onStateChangeCallbacks: [],

  isSupported() {
    if (typeof window === 'undefined') return false;
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  getRecognitionConstructor() {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  },

  init() {
    // Feature detect without requesting microphone permissions prematurely
    if (!this.isSupported()) {
      this.currentState = VoiceRecognitionState.UNSUPPORTED;
    }

    // Clean up recognition session when window/tab is closing or hidden
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const cleanup = () => this.stop();
      window.addEventListener('beforeunload', cleanup);
      window.addEventListener('pagehide', cleanup);
    }
  },

  onStateChange(cb) {
    if (typeof cb === 'function') {
      this.onStateChangeCallbacks.push(cb);
    }
  },

  setState(state, details = {}) {
    this.currentState = state;
    for (const cb of this.onStateChangeCallbacks) {
      try {
        cb(state, details);
      } catch (err) {
        console.error('Error in voice state change callback:', err);
      }
    }
  },

  getState() {
    return this.currentState;
  },

  start(options = {}) {
    // Prevent multiple simultaneous recognition sessions
    if (this.isSessionActive) {
      console.warn('Voice recognition session is already active.');
      return;
    }

    if (!this.isSupported()) {
      this.setState(VoiceRecognitionState.UNSUPPORTED, {
        message: 'Speech recognition is not supported in this browser. Please type your message.'
      });
      return;
    }

    const SpeechRecognition = this.getRecognitionConstructor();
    try {
      const recognition = new SpeechRecognition();
      this.recognition = recognition;

      recognition.continuous = false; // Capture command phrase and conclude on pause
      recognition.interimResults = true; // Stream interim text while speaking
      recognition.maxAlternatives = 1;
      recognition.lang = options.lang || (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

      let finalCapturedText = '';

      recognition.onstart = () => {
        this.isSessionActive = true;
        this.setState(VoiceRecognitionState.LISTENING, {
          message: 'Listening... Speak your command (e.g., “Replan my day”)'
        });
        if (typeof AudioService !== 'undefined') {
          AudioService.playChime('chime');
        }
      };

      recognition.onaudiostart = () => {
        // Audio stream started capturing
      };

      recognition.onspeechstart = () => {
        this.setState(VoiceRecognitionState.LISTENING, {
          message: 'Listening to your voice...'
        });
      };

      recognition.onspeechend = () => {
        this.setState(VoiceRecognitionState.PROCESSING, {
          message: 'Transcribing speech...'
        });
      };

      recognition.onresult = (event) => {
        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalText += res[0].transcript;
          } else {
            interimText += res[0].transcript;
          }
        }

        if (finalText) {
          finalCapturedText = finalText.trim();
        }

        if (typeof options.onTranscript === 'function') {
          options.onTranscript({
            interim: interimText,
            final: finalText,
            text: (finalCapturedText || interimText).trim()
          });
        }
      };

      let errorHandled = false;

      recognition.onerror = (event) => {
        errorHandled = true;
        this.isSessionActive = false;
        const errorType = event.error;

        switch (errorType) {
          case 'not-allowed':
          case 'service-not-allowed':
            this.setState(VoiceRecognitionState.PERMISSION_DENIED, {
              error: errorType,
              canRetry: true,
              message: 'Microphone permission denied. Please allow microphone access in your browser settings to use voice input.'
            });
            break;

          case 'audio-capture':
            this.setState(VoiceRecognitionState.UNAVAILABLE, {
              error: errorType,
              canRetry: true,
              message: 'Microphone unavailable. Please verify a microphone is connected and enabled.'
            });
            break;

          case 'no-speech':
            // Conversational silence; return to idle without intrusive error banner
            this.setState(VoiceRecognitionState.IDLE, {
              error: errorType,
              canRetry: true,
              message: 'No speech was detected. Click the microphone or Retry to speak again.'
            });
            break;

          case 'network': {
            // Do not assume user's internet is disconnected unless connectivity check actually fails
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            const message = isOffline
              ? 'Your device appears to be offline. Please check your internet connection or type your command instead.'
              : 'Voice recognition is temporarily unavailable. Check your connection or try another supported browser. You can type your command instead.';

            this.setState(VoiceRecognitionState.ERROR, {
              error: errorType,
              isNetworkError: true,
              canRetry: true,
              message
            });
            break;
          }

          case 'aborted':
            // Intentional cancellation by user or system
            this.setState(VoiceRecognitionState.IDLE, {
              error: errorType,
              canRetry: false,
              message: ''
            });
            break;

          default:
            this.setState(VoiceRecognitionState.ERROR, {
              error: errorType,
              canRetry: true,
              message: `Voice recognition error (${errorType || 'unknown'}). You can type your command instead.`
            });
            break;
        }
      };

      recognition.onend = () => {
        this.isSessionActive = false;
        if (errorHandled) {
          // Keep the error state and message active for the user to review or retry
          return;
        }

        if (finalCapturedText) {
          this.setState(VoiceRecognitionState.RECEIVED, {
            text: finalCapturedText,
            message: 'Voice input captured. Review or edit your command, then click Send.'
          });
          if (typeof options.onFinalText === 'function') {
            options.onFinalText(finalCapturedText);
          }
        } else if (this.currentState === VoiceRecognitionState.LISTENING || this.currentState === VoiceRecognitionState.PROCESSING) {
          this.setState(VoiceRecognitionState.IDLE, {
            message: ''
          });
        }
      };

      // Request microphone access and start listening
      recognition.start();

    } catch (err) {
      this.isSessionActive = false;
      this.setState(VoiceRecognitionState.ERROR, {
        error: err.message,
        message: 'Could not start speech recognition: ' + err.message
      });
    }
  },

  stop() {
    if (this.recognition && this.isSessionActive) {
      try {
        this.recognition.stop();
      } catch (e) {
        try {
          this.recognition.abort();
        } catch (e2) {}
      }
    }
    this.isSessionActive = false;
  },

  toggle(options = {}) {
    if (this.isSessionActive || this.currentState === VoiceRecognitionState.LISTENING || this.currentState === VoiceRecognitionState.PROCESSING) {
      this.stop();
      this.setState(VoiceRecognitionState.IDLE, {
        message: 'Listening stopped.'
      });
    } else {
      this.start(options);
    }
  }
};

// ============================================================================
// 8.5. REAL AI BACKEND SERVICE & LLM PIPELINE
// ============================================================================

const AIService = {
  getApiUrl(endpoint) {
    if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null' && window.location.protocol && window.location.protocol.startsWith('http')) {
      return `${window.location.origin}${endpoint}`;
    }
    const port = (typeof process !== 'undefined' && process.env && process.env.PORT) || 3000;
    return `http://127.0.0.1:${port}${endpoint}`;
  },

  /**
   * Probes the backend server health and checks whether an AI provider is configured.
   */
  async checkHealth() {
    try {
      const url = this.getApiUrl('/api/health');
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) return { ok: false, status: res.status };
      const data = await res.json();
      return { ok: true, ...data };
    } catch (err) {
      return { ok: false, error: err.message, networkError: true };
    }
  },

  /**
   * Dispatches the user prompt, recent conversation context, and current task state
   * to the secure backend AI endpoint.
   */
  async sendMessage({ message, history, tasks, constraints, currentPlan, lastAppliedProposal, pendingProposal }) {
    try {
      const url = this.getApiUrl('/api/chat');

      // Prepare sanitized context snapshot
      const sanitizedHistory = (history || []).slice(-10).map(m => ({
        sender: m.sender,
        text: m.text
      }));

      const sanitizedTasks = (tasks || []).map(t => ({
        id: t.id,
        title: t.title,
        category: t.category,
        estimatedDuration: t.estimatedDuration,
        deadline: t.deadline,
        priority: t.priority,
        completed: Boolean(t.completed)
      }));

      const sanitizedConstraints = constraints ? {
        availableMinutesToday: constraints.availableMinutesToday,
        commitments: constraints.commitments || []
      } : null;

      const sanitizedPlan = currentPlan ? {
        totalAvailable: currentPlan.totalAvailable,
        totalScheduled: currentPlan.totalScheduled,
        capacityDeficit: currentPlan.capacityDeficit,
        scheduledItems: (currentPlan.scheduledItems || []).map(i => ({
          task: { id: i.task.id, title: i.task.title, category: i.task.category, priority: i.task.priority },
          allocatedDuration: i.allocatedDuration,
          isPartial: i.isPartial
        })),
        atRiskItems: (currentPlan.atRiskItems || []).map(i => ({
          task: { id: i.task.id, title: i.task.title },
          deficitMinutes: i.deficitMinutes,
          reason: i.reason
        }))
      } : null;

      const payload = {
        message,
        conversationHistory: sanitizedHistory,
        taskContext: {
          tasks: sanitizedTasks,
          constraints: sanitizedConstraints,
          currentPlan: sanitizedPlan,
          lastAppliedProposal: lastAppliedProposal ? {
            triggerText: lastAppliedProposal.triggerText,
            explanation: lastAppliedProposal.explanation
          } : null,
          pendingProposal: pendingProposal ? {
            id: pendingProposal.id,
            triggerText: pendingProposal.triggerText
          } : null
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(28000)
      });

      if (!res.ok) {
        let errJson = null;
        try { errJson = await res.json(); } catch (e) {}
        return {
          ok: false,
          status: res.status,
          error: (errJson && errJson.message) || `Server returned HTTP ${res.status}`
        };
      }

      const data = await res.json();
      return { ok: true, ...data };
    } catch (err) {
      return {
        ok: false,
        networkError: true,
        error: err.message
      };
    }
  }
};

// ============================================================================
// 9. UI RENDERING & DOM BUILDERS (Accessible, Safe textContent)
// ============================================================================

const UIRenderer = {
  isChatRequestInProgress: false,

  init() {
    VoiceInputService.init();
    this.bindEvents();
    this.refreshAll();
  },

  refreshAll() {
    // Recompute current schedule plan
    AppState.currentPlan = SchedulingEngine.computePlan(AppState.tasks, AppState.constraints);
    
    this.renderHeaderAndContext();
    this.renderMetrics();
    this.renderTimeline();
    this.renderTasks();
    this.renderChat();
    this.updateUndoButton();
  },

  renderHeaderAndContext() {
    const dateDisplay = document.getElementById('currentDateDisplay');
    if (dateDisplay) {
      const now = new Date();
      const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      // Preserve the calendar SVG icon by only updating the text node, not innerHTML
      const dateText = now.toLocaleDateString('en-US', options) + ' · Midterm Sprint';
      // Find or create text node after the SVG
      const svgEl = dateDisplay.querySelector('svg');
      // Remove old text nodes safely
      Array.from(dateDisplay.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) node.remove();
      });
      const textNode = document.createTextNode(' ' + dateText);
      dateDisplay.appendChild(textNode);
    }
  },

  renderMetrics() {
    const plan = AppState.currentPlan;
    if (!plan) return;

    // Available Time
    const availableEl = document.getElementById('metricAvailableHours');
    if (availableEl) {
      const hours = (plan.totalAvailable / 60).toFixed(1);
      availableEl.textContent = `${hours}h (${plan.totalAvailable}m)`;
    }

    // Scheduled Workload
    const scheduledEl = document.getElementById('metricScheduledMinutes');
    if (scheduledEl) {
      const hours = (plan.scheduledMinutes / 60).toFixed(1);
      scheduledEl.textContent = `${hours}h (${plan.scheduledMinutes}m)`;
    }

    // Due Soon
    const dueSoonEl = document.getElementById('metricDueSoon');
    if (dueSoonEl) {
      const count = AppState.tasks.filter(t => !t.completed && SchedulingEngine.calculateDaysUntil(t.deadline) <= 1).length;
      dueSoonEl.textContent = String(count);
    }

    // At Risk
    const atRiskEl = document.getElementById('metricAtRisk');
    if (atRiskEl) {
      atRiskEl.textContent = String(plan.atRiskItems.length);
      const card = document.getElementById('metricAtRiskCard');
      if (card) {
        if (plan.atRiskItems.length > 0) {
          card.classList.add('metric-warning');
        } else {
          card.classList.remove('metric-warning');
        }
      }
    }

    // Progress Bar
    const totalCount = AppState.tasks.length;
    const completedCount = AppState.tasks.filter(t => t.completed).length;
    const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const progressFill = document.getElementById('metricProgressFill');
    const progressText = document.getElementById('metricProgressText');
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressText) progressText.textContent = `${completedCount} of ${totalCount} completed (${percent}%)`;
  },

  renderTimeline() {
    const container = document.getElementById('timelineContainer');
    if (!container) return;

    container.innerHTML = '';
    const plan = AppState.currentPlan;

    if (!plan || plan.timeline.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state-card';
      empty.textContent = 'No study sessions scheduled for today. Adjust your available hours or add tasks to build your plan.';
      container.appendChild(empty);
      return;
    }

    // If there are at-risk items, show a subtle banner above timeline
    if (plan.atRiskItems.length > 0) {
      const banner = document.createElement('div');
      banner.className = 'timeline-alert-banner';
      
      const icon = document.createElement('span');
      icon.className = 'alert-icon';
      icon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      
      const text = document.createElement('div');
      text.className = 'alert-text';
      text.innerHTML = `<strong>Capacity Conflict (${plan.capacityDeficit}m deficit):</strong> ${plan.atRiskItems.length} task(s) cannot fit fully within today's ${plan.totalAvailable}m window.`;
      
      banner.appendChild(icon);
      banner.appendChild(text);
      container.appendChild(banner);
    }

    const list = document.createElement('div');
    list.className = 'timeline-slots-list';

    plan.timeline.forEach((slot, index) => {
      const item = document.createElement('div');
      item.className = 'timeline-slot-item' + (slot.isPartial ? ' is-partial' : '');

      // Time pill
      const timeCol = document.createElement('div');
      timeCol.className = 'slot-time-col';
      const timeBadge = document.createElement('span');
      timeBadge.className = 'slot-time-badge';
      timeBadge.textContent = slot.startTimeFormatted;
      const durationBadge = document.createElement('span');
      durationBadge.className = 'slot-duration-text';
      durationBadge.textContent = `${slot.allocatedDuration}m`;
      timeCol.appendChild(timeBadge);
      timeCol.appendChild(durationBadge);

      // Card body
      const content = document.createElement('div');
      content.className = 'slot-content-card';

      const header = document.createElement('div');
      header.className = 'slot-header';
      
      const title = document.createElement('h4');
      title.className = 'slot-title';
      title.textContent = slot.title;
      
      const catBadge = document.createElement('span');
      catBadge.className = `category-badge cat-${slot.category.toLowerCase().replace(/\s+/g, '-')}`;
      catBadge.textContent = slot.category;

      header.appendChild(title);
      header.appendChild(catBadge);

      const notes = document.createElement('p');
      notes.className = 'slot-notes';
      notes.textContent = slot.notes;

      content.appendChild(header);
      content.appendChild(notes);

      item.appendChild(timeCol);
      item.appendChild(content);
      list.appendChild(item);
    });

    container.appendChild(list);
  },

  renderTasks() {
    const listContainer = document.getElementById('taskListContainer');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    // Filter tasks
    let filtered = AppState.tasks.slice();

    // Category filter
    if (AppState.filterCategory !== 'all') {
      filtered = filtered.filter(t => t.category.toLowerCase() === AppState.filterCategory.toLowerCase());
    }

    // Status filter
    if (AppState.filterStatus === 'active') {
      filtered = filtered.filter(t => !t.completed);
    } else if (AppState.filterStatus === 'completed') {
      filtered = filtered.filter(t => t.completed);
    } else if (AppState.filterStatus === 'dueSoon') {
      filtered = filtered.filter(t => !t.completed && SchedulingEngine.calculateDaysUntil(t.deadline) <= 1);
    } else if (AppState.filterStatus === 'atRisk') {
      const atRiskIds = new Set((AppState.currentPlan?.atRiskItems || []).map(i => i.task.id));
      filtered = filtered.filter(t => atRiskIds.has(t.id));
    }

    // Search query
    if (AppState.searchQuery.trim()) {
      const q = AppState.searchQuery.toLowerCase();
      filtered = filtered.filter(t => t.title.toLowerCase().includes(q) || (t.notes && t.notes.toLowerCase().includes(q)));
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state-card';
      empty.textContent = 'No matching tasks found. Try adjusting your filters or add a new task.';
      listContainer.appendChild(empty);
      return;
    }

    filtered.forEach(task => {
      const card = this.createTaskCard(task);
      listContainer.appendChild(card);
    });
  },

  createTaskCard(task) {
    const card = document.createElement('article');
    card.className = 'task-card' + (task.completed ? ' is-completed' : '');
    card.id = `task-card-${task.id}`;
    card.setAttribute('tabindex', '0');

    // Selection highlight for context-aware conversation
    if (AppState.selectedTaskId === task.id) {
      card.classList.add('is-selected');
    }

    card.addEventListener('click', (e) => {
      // Avoid triggering when clicking buttons directly
      if (e.target.closest('button') || e.target.closest('input')) return;
      this.selectTask(task.id);
    });

    // Checkbox container
    const checkCol = document.createElement('div');
    checkCol.className = 'task-check-col';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = !!task.completed;
    checkbox.setAttribute('aria-label', `Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`);
    checkbox.addEventListener('change', () => {
      this.toggleTaskCompletion(task.id);
    });
    checkCol.appendChild(checkbox);

    // Body
    const bodyCol = document.createElement('div');
    bodyCol.className = 'task-body-col';

    const header = document.createElement('div');
    header.className = 'task-header-row';

    const title = document.createElement('h3');
    title.className = 'task-title-text';
    title.textContent = task.title;

    const badges = document.createElement('div');
    badges.className = 'task-badge-group';

    const priBadge = document.createElement('span');
    priBadge.className = `priority-badge pri-${task.priority}`;
    priBadge.textContent = task.priority.toUpperCase();

    const catBadge = document.createElement('span');
    catBadge.className = `category-badge cat-${task.category.toLowerCase().replace(/\s+/g, '-')}`;
    catBadge.textContent = task.category;

    badges.appendChild(priBadge);
    badges.appendChild(catBadge);
    header.appendChild(title);
    header.appendChild(badges);

    // Meta row (deadline, duration, status)
    const metaRow = document.createElement('div');
    metaRow.className = 'task-meta-row';

    const days = SchedulingEngine.calculateDaysUntil(task.deadline);
    const deadlineSpan = document.createElement('span');
    deadlineSpan.className = 'task-meta-item meta-deadline' + (days <= 1 && !task.completed ? ' text-urgent' : '');
    
    let deadlineLabel = '';
    if (days < 0) deadlineLabel = `Overdue (${Math.abs(days)}d ago)`;
    else if (days === 0) deadlineLabel = 'Due Today';
    else if (days === 1) deadlineLabel = 'Due Tomorrow';
    else deadlineLabel = `Due in ${days} days`;

    deadlineSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${deadlineLabel}`;

    const durationSpan = document.createElement('span');
    durationSpan.className = 'task-meta-item meta-duration';
    durationSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> ${task.estimatedDuration}m`;

    metaRow.appendChild(deadlineSpan);
    metaRow.appendChild(durationSpan);

    // Check if task is at risk in current plan
    const isAtRisk = (AppState.currentPlan?.atRiskItems || []).some(i => i.task.id === task.id);
    if (isAtRisk && !task.completed) {
      const riskBadge = document.createElement('span');
      riskBadge.className = 'risk-status-badge';
      riskBadge.textContent = 'At Risk (Capacity)';
      metaRow.appendChild(riskBadge);
    }

    bodyCol.appendChild(header);
    bodyCol.appendChild(metaRow);

    if (task.notes) {
      const notesEl = document.createElement('p');
      notesEl.className = 'task-notes-preview';
      notesEl.textContent = task.notes;
      bodyCol.appendChild(notesEl);
    }

    // Actions column
    const actionsCol = document.createElement('div');
    actionsCol.className = 'task-actions-col';

    const editBtn = document.createElement('button');
    editBtn.className = 'action-icon-btn';
    editBtn.title = 'Edit task';
    editBtn.setAttribute('aria-label', `Edit "${task.title}"`);
    editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openEditTaskModal(task.id);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-icon-btn btn-delete';
    deleteBtn.title = 'Delete task';
    deleteBtn.setAttribute('aria-label', `Delete "${task.title}"`);
    deleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.confirmDeleteTask(task.id);
    });

    actionsCol.appendChild(editBtn);
    actionsCol.appendChild(deleteBtn);

    card.appendChild(checkCol);
    card.appendChild(bodyCol);
    card.appendChild(actionsCol);

    return card;
  },

  selectTask(taskId) {
    if (AppState.selectedTaskId === taskId) {
      AppState.selectedTaskId = null; // deselect
    } else {
      AppState.selectedTaskId = taskId;
    }
    this.renderTasks();
  },

  renderChat() {
    const stream = document.getElementById('chatMessagesStream');
    if (!stream) return;

    stream.innerHTML = '';

    if (AppState.chatMessages.length === 0) {
      // Initial welcome message from AimFlow
      const welcome = document.createElement('div');
      welcome.className = 'chat-message msg-assistant';
      
      const avatar = document.createElement('div');
      avatar.className = 'assistant-avatar-ring';
      avatar.innerHTML = `<span class="ring-pulse"></span>`;

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      
      const title = document.createElement('div');
      title.className = 'bubble-title';
      title.textContent = 'Alexa+ AimFlow Ready';

      const p = document.createElement('p');
      p.textContent = 'Welcome! I monitor your deadlines and adapt your schedule when your day shifts. Try saying: "My hackathon deadline moved to tomorrow, and I only have one hour to study today."';

      bubble.appendChild(title);
      bubble.appendChild(p);
      welcome.appendChild(avatar);
      welcome.appendChild(bubble);
      stream.appendChild(welcome);
    } else {
      AppState.chatMessages.forEach(msg => {
        const msgEl = this.createChatMessageElement(msg);
        stream.appendChild(msgEl);
      });
    }

    // Scroll chat to bottom
    stream.scrollTop = stream.scrollHeight;
  },

  createChatMessageElement(msg) {
    const row = document.createElement('div');
    row.className = `chat-message msg-${msg.sender}`;

    if (msg.sender === 'assistant') {
      const avatar = document.createElement('div');
      avatar.className = 'assistant-avatar-ring';
      avatar.innerHTML = `<span class="ring-pulse"></span>`;
      row.appendChild(avatar);
    }

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    if (msg.meta && msg.meta.isAI) {
      row.classList.add('is-ai-response');
      const badge = document.createElement('span');
      badge.className = 'ai-source-badge';
      badge.textContent = 'AI';
      badge.title = `Powered by ${msg.meta.model || 'LLM'}`;
      bubble.appendChild(badge);
    } else if (msg.meta && msg.meta.isSetupNotice) {
      row.classList.add('is-setup-notice');
    } else if (msg.meta && msg.meta.isOfflineNotice) {
      row.classList.add('is-offline-notice');
    }

    // Safe plain text rendering
    if (msg.text) {
      const p = document.createElement('p');
      p.className = 'chat-text';
      p.textContent = msg.text;
      bubble.appendChild(p);
    }

    // If message includes an interactive schedule proposal
    if (msg.proposal) {
      row.classList.add('has-proposal');
      const proposalCard = this.createProposalElement(msg.proposal);
      bubble.appendChild(proposalCard);
    }

    row.appendChild(bubble);
    return row;
  },

  createProposalElement(proposal) {
    const card = document.createElement('div');
    card.className = 'proposal-review-card';

    const header = document.createElement('div');
    header.className = 'proposal-header';
    header.innerHTML = `<strong>Schedule Adaptation Proposal</strong> <span class="proposal-status-pill status-${proposal.status}">${proposal.status.toUpperCase()}</span>`;

    // What Changed section
    const whatChangedSec = document.createElement('div');
    whatChangedSec.className = 'proposal-section';
    const wcTitle = document.createElement('h5');
    wcTitle.textContent = 'What changed?';
    const wcList = document.createElement('ul');
    proposal.explanation.changesDetected.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      wcList.appendChild(li);
    });
    whatChangedSec.appendChild(wcTitle);
    whatChangedSec.appendChild(wcList);

    // What AimFlow Changed section
    const whatAimFlowSec = document.createElement('div');
    whatAimFlowSec.className = 'proposal-section';
    const wlpTitle = document.createElement('h5');
    wlpTitle.textContent = 'What AimFlow adapted';
    const wlpList = document.createElement('ul');
    proposal.explanation.actionsTaken.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      wlpList.appendChild(li);
    });
    whatAimFlowSec.appendChild(wlpTitle);
    whatAimFlowSec.appendChild(wlpList);

    // Why section
    const whySec = document.createElement('div');
    whySec.className = 'proposal-section why-section';
    const whyTitle = document.createElement('h5');
    whyTitle.textContent = 'Why?';
    const whyText = document.createElement('p');
    whyText.className = 'why-quote';
    whyText.textContent = `“${proposal.explanation.why}”`;
    whySec.appendChild(whyTitle);
    whySec.appendChild(whyText);

    // Before / After Comparison Grid
    const diffGrid = document.createElement('div');
    diffGrid.className = 'proposal-diff-grid';

    const beforeCol = document.createElement('div');
    beforeCol.className = 'diff-col diff-before';
    beforeCol.innerHTML = `<h6>Original Plan</h6>
      <div class="diff-metric-row"><span>Available:</span> <strong>${proposal.explanation.metrics.timeBefore}m</strong></div>
      <div class="diff-metric-row"><span>Scheduled:</span> <strong>${proposal.explanation.metrics.scheduledBefore}m</strong></div>
      <div class="diff-metric-row"><span>Scheduled Tasks:</span> <strong>${proposal.beforePlan ? proposal.beforePlan.scheduledItems.length : 0}</strong></div>`;

    const afterCol = document.createElement('div');
    afterCol.className = 'diff-col diff-after';
    afterCol.innerHTML = `<h6>Proposed Plan</h6>
      <div class="diff-metric-row"><span>Available:</span> <strong>${proposal.explanation.metrics.timeAfter}m</strong></div>
      <div class="diff-metric-row"><span>Scheduled:</span> <strong>${proposal.explanation.metrics.scheduledAfter}m</strong></div>
      <div class="diff-metric-row"><span>At Risk Tasks:</span> <strong class="text-urgent">${proposal.explanation.metrics.atRiskCount}</strong></div>`;

    diffGrid.appendChild(beforeCol);
    diffGrid.appendChild(afterCol);

    card.appendChild(header);
    card.appendChild(whatChangedSec);
    card.appendChild(whatAimFlowSec);
    card.appendChild(whySec);
    card.appendChild(diffGrid);

    // Action buttons if proposal is still pending
    if (proposal.status === 'pending') {
      const btnGroup = document.createElement('div');
      btnGroup.className = 'proposal-btn-group';

      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-primary';
      applyBtn.textContent = 'Apply Revised Plan';
      applyBtn.addEventListener('click', () => {
        this.handleApplyProposal(proposal.id);
      });

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn btn-secondary';
      rejectBtn.textContent = 'Keep Original Plan';
      rejectBtn.addEventListener('click', () => {
        this.handleRejectProposal(proposal.id);
      });

      btnGroup.appendChild(applyBtn);
      btnGroup.appendChild(rejectBtn);
      card.appendChild(btnGroup);
    }

    return card;
  },

  updateUndoButton() {
    const undoBtn = document.getElementById('headerUndoBtn');
    if (undoBtn) {
      if (AppState.undoStack.length > 0) {
        undoBtn.disabled = false;
        undoBtn.classList.add('can-undo');
      } else {
        undoBtn.disabled = true;
        undoBtn.classList.remove('can-undo');
      }
    }
  },

  // ==========================================================================
  // ACTION HANDLERS
  // ==========================================================================

  handleApplyProposal(proposalId) {
    const success = ProposalManager.applyProposal(proposalId);
    if (success) {
      AudioService.playChime('chime');
      this.addAssistantMessage('Revised plan applied and saved! Your schedule and dashboard have been updated.');
      AudioService.speak('Plan updated and saved.');
      this.refreshAll();
    }
  },

  handleRejectProposal(proposalId) {
    const success = ProposalManager.rejectProposal(proposalId);
    if (success) {
      this.addAssistantMessage('Understood. I kept your original plan untouched.');
      this.refreshAll();
    }
  },

  toggleTaskCompletion(taskId) {
    const task = AppState.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    task.updatedAt = new Date().toISOString();

    StorageService.saveTasks();
    AudioService.playChime(task.completed ? 'chime' : 'alert');

    const msg = task.completed
      ? `Great job! Marked "${task.title}" as complete. I've reallocated your time.`
      : `Reopened "${task.title}". It has been placed back in your schedule.`;

    this.addAssistantMessage(msg);
    this.refreshAll();
  },

  addUserMessage(text) {
    AppState.chatMessages.push({
      id: 'msg_' + Date.now(),
      sender: 'user',
      text,
      timestamp: new Date().toISOString()
    });
    StorageService.saveChat();
    this.renderChat();
  },

  addAssistantMessage(text, proposal = null, meta = {}) {
    AppState.chatMessages.push({
      id: 'msg_' + Date.now(),
      sender: 'assistant',
      text,
      proposal,
      meta,
      timestamp: new Date().toISOString()
    });
    StorageService.saveChat();
    this.renderChat();
  },

  showThinkingIndicator() {
    const typingId = 'typing_' + Date.now();
    const stream = document.getElementById('chatMessagesStream');
    if (stream) {
      const typingRow = document.createElement('div');
      typingRow.className = 'chat-message msg-assistant msg-typing';
      typingRow.id = typingId;

      const avatar = document.createElement('div');
      avatar.className = 'assistant-avatar-ring';
      avatar.innerHTML = `<span class="ring-pulse"></span>`;

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>`;

      typingRow.appendChild(avatar);
      typingRow.appendChild(bubble);
      stream.appendChild(typingRow);
      stream.scrollTop = stream.scrollHeight;
    }
    return typingId;
  },

  removeThinkingIndicator(typingId) {
    if (!typingId) return;
    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      if (typeof typingEl.remove === 'function') {
        typingEl.remove();
      } else if (typingEl.parentNode && typeof typingEl.parentNode.removeChild === 'function') {
        typingEl.parentNode.removeChild(typingEl);
      }
    }
  },

  /**
   * Shows a typing indicator for delayMs milliseconds, then adds the real assistant message.
   * Makes the assistant feel responsive and Alexa-like.
   */
  addAssistantMessageDelayed(text, proposal = null, delayMs = 600, meta = {}) {
    const typingId = this.showThinkingIndicator();
    setTimeout(() => {
      this.removeThinkingIndicator(typingId);
      this.addAssistantMessage(text, proposal, meta);
    }, delayMs);
  },

  /**
   * Deterministic local fallback used when offline or during backend initialization.
   * Preserves full backward-compatibility for offline demo workflows.
   */
  executeDeterministicFallback(text, isOffline = true) {
    const intent = NaturalLanguageInterpreter.interpret(text, AppState.tasks, AppState.constraints);

    switch (intent.type) {
      case 'APPROVE_PROPOSAL': {
        this.handleApplyProposal(intent.proposalId);
        break;
      }

      case 'REJECT_PROPOSAL': {
        this.handleRejectProposal(intent.proposalId);
        break;
      }

      case 'UNDO': {
        const undoneDesc = ProposalManager.undoLastChange();
        if (undoneDesc) {
          AudioService.playChime('chime');
          this.addAssistantMessage(`Undone: ${undoneDesc}. Your previous schedule has been restored.`, null, { isFallback: true });
          this.refreshAll();
        } else {
          this.addAssistantMessage('There are no recent schedule changes to undo.', null, { isFallback: true });
        }
        break;
      }

      case 'WHAT_CHANGED': {
        if (AppState.lastAppliedProposal) {
          const exp = AppState.lastAppliedProposal.explanation;
          const summary = `Here is the last applied schedule revision:\n• ${exp.changesDetected.join('\n• ')}\n\nResult:\n• ${exp.actionsTaken.join('\n• ')}`;
          this.addAssistantMessage(summary, null, { isFallback: true });
        } else {
          this.addAssistantMessage('No schedule changes have been applied yet today. You are running on the default plan.', null, { isFallback: true });
        }
        break;
      }

      case 'EXPLAIN_WHY': {
        if (intent.isAmbiguous && intent.matchingCandidates && intent.matchingCandidates.length > 1) {
          const names = intent.matchingCandidates.map(t => `"${t.title}"`).join(' and ');
          this.addAssistantMessage(`You have multiple tasks that were adjusted: ${names}. Which specific task would you like me to explain?`, null, { isFallback: true });
          break;
        }

        if (intent.matchedTask) {
          const t = intent.matchedTask;
          const plan = AppState.currentPlan || SchedulingEngine.computePlan(AppState.tasks, AppState.constraints);
          const scheduled = plan.scheduledItems.find(i => i.task.id === t.id);
          const atRisk = plan.atRiskItems.find(i => i.task.id === t.id);
          const postponed = plan.postponedItems.find(i => i.task.id === t.id);

          if (t.completed) {
            this.addAssistantMessage(`"${t.title}" is already completed, so it was preserved without consuming future study hours.`, null, { isFallback: true });
          } else if (scheduled && !scheduled.isPartial) {
            this.addAssistantMessage(`"${t.title}" is fully scheduled for ${scheduled.allocatedDuration}m because of its high composite priority and near deadline.`, null, { isFallback: true });
          } else if (scheduled && scheduled.isPartial) {
            this.addAssistantMessage(`"${t.title}" requires ${t.estimatedDuration}m total, but only ${scheduled.allocatedDuration}m could fit within today's ${plan.totalAvailable}m window. It was prioritized with a focus block, leaving ${t.estimatedDuration - scheduled.allocatedDuration}m at risk.`, null, { isFallback: true });
          } else if (postponed) {
            this.addAssistantMessage(`"${t.title}" (${t.estimatedDuration}m, ${t.priority} priority) was postponed: ${postponed.reason}`, null, { isFallback: true });
          } else if (AppState.lastAppliedProposal) {
            this.addAssistantMessage(`Regarding "${t.title}": ${AppState.lastAppliedProposal.explanation.why}`, null, { isFallback: true });
          } else {
            this.addAssistantMessage(`"${t.title}" is currently placed based on deadline urgency and finite study capacity.`, null, { isFallback: true });
          }
        } else if (AppState.lastAppliedProposal) {
          const why = AppState.lastAppliedProposal.explanation.why;
          this.addAssistantMessage(`Here is why your schedule was adjusted: “${why}”`, null, { isFallback: true });
        } else {
          this.addAssistantMessage('Your schedule is organized by deadline urgency and priority score. High urgency tasks are placed first to protect critical deadlines.', null, { isFallback: true });
        }
        break;
      }

      case 'WHAT_NEXT': {
        const plan = AppState.currentPlan || SchedulingEngine.computePlan(AppState.tasks, AppState.constraints);
        if (plan.scheduledItems.length > 0) {
          const next = plan.scheduledItems[0];
          this.addAssistantMessageDelayed(`Next up: Focus on "${next.task.title}" (${next.allocatedDuration} mins allocated). Category: ${next.task.category}, Priority: ${next.task.priority.toUpperCase()}.`, null, 400, { isFallback: true });
        } else {
          this.addAssistantMessageDelayed('You have no active tasks scheduled for today. You are all caught up or your available hours are currently zero.', null, 400, { isFallback: true });
        }
        break;
      }

      case 'COMPLETE_TASK': {
        this.toggleTaskCompletion(intent.task.id);
        break;
      }

      case 'REPLAN_DAY': {
        const proposal = ProposalManager.createProposal({
          raw: text,
          deadlineChanges: [],
          timeChange: null
        });
        this.addAssistantMessage('I re-evaluated your deadlines, priorities, and study hours. Here is the proposed schedule:', proposal, { isFallback: true });
        break;
      }

      case 'ADAPTIVE_CHANGE': {
        const proposal = ProposalManager.createProposal(intent);
        AudioService.playChime('chime');
        this.addAssistantMessageDelayed('I analyzed your change and calculated the impact on your remaining deadlines. Here is the proposed revision for your approval:', proposal, 700, { isFallback: true });
        AudioService.speak('Change detected. I analyzed the impact and prepared a revised schedule for your approval.');
        break;
      }

      case 'ADD_TASK': {
        const newTask = {
          id: 'task_' + Date.now(),
          title: intent.taskData.title,
          category: intent.taskData.category,
          deadline: intent.taskData.deadline,
          estimatedDuration: intent.taskData.estimatedDuration,
          priority: intent.taskData.priority,
          completed: false,
          completedAt: null,
          notes: 'Added via Alexa+ assistant chat command.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'scheduled'
        };

        AppState.tasks.push(newTask);
        StorageService.saveTasks();
        this.addAssistantMessage(`Added task "${newTask.title}" (${newTask.estimatedDuration}m, due ${new Date(newTask.deadline).toLocaleDateString()}, ${newTask.priority} priority). Schedule updated.`, null, { isFallback: true });
        this.refreshAll();
        break;
      }

      case 'UNSUPPORTED':
      default: {
        const guidance = isOffline
          ? 'AimFlow AI backend is currently offline. Start the server with `npm start` to chat freely with real AI intelligence.\n\nIn offline mode, try commands like:\n• "My hackathon deadline moved to tomorrow, and I only have one hour today."\n• "I finished my mathematics revision."\n• "What should I do next?"\n• "Why did you change that?"\n• "Undo last change"'
          : 'I didn\'t quite catch that. Try commands like:\n• "My hackathon deadline moved to tomorrow, and I only have one hour today."\n• "I finished my mathematics revision."\n• "What should I do next?"\n• "Why did you change that?"\n• "Undo last change"';
        this.addAssistantMessage(guidance, null, { isFallback: true });
        break;
      }
    }
  },

  /**
   * Dispatches model tool calls to the actual task engine without hallucinating actions.
   */
  async handleAIModelSuccess(aiResult, rawUserText) {
    if (Array.isArray(aiResult.toolCalls) && aiResult.toolCalls.length > 0) {
      for (const call of aiResult.toolCalls) {
        const fnName = call.function ? call.function.name : '';
        let args = {};
        try {
          args = typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments)
            : (call.function.arguments || {});
        } catch (e) {
          console.warn('[AimFlow AI] Could not parse tool call arguments:', call.function ? call.function.arguments : '');
        }

        switch (fnName) {
          case 'propose_schedule_change': {
            const deadlineChanges = [];
            if (Array.isArray(args.deadlineChanges)) {
              for (const dc of args.deadlineChanges) {
                const targetName = dc.taskTitleOrId || dc.taskTitle || '';
                const matched = NaturalLanguageInterpreter.findMatchingTask(targetName, AppState.tasks);
                if (matched) {
                  let newDeadline = NaturalLanguageInterpreter.extractDeadline(dc.newDeadline);
                  if (!newDeadline) {
                    if (typeof dc.newDeadline === 'string' && dc.newDeadline.includes('T')) {
                      newDeadline = dc.newDeadline;
                    } else {
                      newDeadline = getRelativeDate(1, '20:00');
                    }
                  }
                  deadlineChanges.push({
                    taskId: matched.id,
                    taskTitle: matched.title,
                    oldDeadline: matched.deadline,
                    oldDeadlineText: new Date(matched.deadline).toLocaleDateString(),
                    newDeadline: newDeadline,
                    newDeadlineText: new Date(newDeadline).toLocaleDateString()
                  });
                }
              }
            }

            let timeChange = null;
            if (typeof args.availableMinutes === 'number') {
              timeChange = {
                oldMinutes: AppState.constraints.availableMinutesToday,
                newMinutes: Math.max(0, args.availableMinutes)
              };
            }

            let commitmentAdded = null;
            if (args.commitmentAdded) {
              commitmentAdded = {
                title: args.commitmentAdded.title || 'Unexpected commitment',
                durationMinutes: args.commitmentAdded.durationMinutes || 60
              };
            }

            const proposal = ProposalManager.createProposal({
              raw: rawUserText,
              deadlineChanges,
              timeChange,
              commitmentAdded
            });

            AudioService.playChime('chime');
            const replyText = aiResult.reply || 'I analyzed your schedule update and calculated the impact on your remaining deadlines. Here is the proposed revision for your approval:';
            this.addAssistantMessage(replyText, proposal, { isAI: true, model: aiResult.model });
            if (AppState.settings.voiceOutput) {
              AudioService.speak('Change detected. I analyzed the impact and prepared a revised schedule for your approval.');
            }
            return;
          }

          case 'add_task': {
            const duration = Math.max(10, Math.min(600, parseInt(args.estimatedDuration, 10) || 60));
            const deadline = NaturalLanguageInterpreter.extractDeadline(args.deadline || '') || getRelativeDate(2, '20:00');
            const priority = ['high', 'medium', 'low'].includes(args.priority) ? args.priority : 'medium';
            const category = CATEGORIES.includes(args.category) ? args.category : 'Assignment';
            const title = (args.title && args.title.trim()) || 'New Task';

            const newTask = {
              id: 'task_' + Date.now(),
              title,
              category,
              deadline,
              estimatedDuration: duration,
              priority,
              completed: false,
              completedAt: null,
              notes: args.notes || 'Added via AimFlow AI assistant.',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              status: 'scheduled'
            };

            AppState.tasks.push(newTask);
            StorageService.saveTasks();
            AudioService.playChime('chime');
            this.refreshAll();

            const msg = aiResult.reply || `Added task "${newTask.title}" (${newTask.estimatedDuration}m, due ${new Date(newTask.deadline).toLocaleDateString()}, ${newTask.priority} priority). Schedule updated.`;
            this.addAssistantMessage(msg, null, { isAI: true, model: aiResult.model });
            if (AppState.settings.voiceOutput) AudioService.speak(msg);
            return;
          }

          case 'complete_task': {
            const query = args.taskTitleOrId || args.taskTitle || '';
            const matched = NaturalLanguageInterpreter.findMatchingTask(query, AppState.tasks);
            if (matched) {
              matched.completed = args.completed !== false;
              matched.completedAt = matched.completed ? new Date().toISOString() : null;
              matched.updatedAt = new Date().toISOString();
              StorageService.saveTasks();
              AudioService.playChime(matched.completed ? 'chime' : 'alert');
              this.refreshAll();
              const msg = aiResult.reply || (matched.completed ? `Great job! Marked "${matched.title}" as complete. I've reallocated your time.` : `Reopened "${matched.title}".`);
              this.addAssistantMessage(msg, null, { isAI: true, model: aiResult.model });
              if (AppState.settings.voiceOutput) AudioService.speak(msg);
            } else {
              this.addAssistantMessage(aiResult.reply || `I couldn't find a task matching "${query}". Please check the task name.`);
            }
            return;
          }

          case 'undo_last_change': {
            const undoneDesc = ProposalManager.undoLastChange();
            if (undoneDesc) {
              AudioService.playChime('chime');
              this.refreshAll();
              const msg = aiResult.reply || `Undone: ${undoneDesc}. Your previous schedule has been restored.`;
              this.addAssistantMessage(msg, null, { isAI: true, model: aiResult.model });
              if (AppState.settings.voiceOutput) AudioService.speak('Last change undone.');
            } else {
              this.addAssistantMessage(aiResult.reply || 'There are no recent schedule changes to undo.', null, { isAI: true });
            }
            return;
          }

          case 'replan_day': {
            const proposal = ProposalManager.createProposal({ raw: rawUserText, deadlineChanges: [], timeChange: null });
            AudioService.playChime('chime');
            const msg = aiResult.reply || 'I re-evaluated your deadlines, priorities, and available hours. Here is the proposed schedule:';
            this.addAssistantMessage(msg, proposal, { isAI: true, model: aiResult.model });
            if (AppState.settings.voiceOutput) AudioService.speak('I re-evaluated your schedule and prepared a new plan.');
            return;
          }

          case 'explain_task_placement': {
            const query = args.taskTitleOrId || '';
            const matched = NaturalLanguageInterpreter.findMatchingTask(query, AppState.tasks);
            if (aiResult.reply) {
              this.addAssistantMessage(aiResult.reply, null, { isAI: true, model: aiResult.model });
              if (AppState.settings.voiceOutput) AudioService.speak(aiResult.reply);
            } else if (matched) {
              const plan = AppState.currentPlan || SchedulingEngine.computePlan(AppState.tasks, AppState.constraints);
              const scheduled = plan.scheduledItems.find(i => i.task.id === matched.id);
              const atRisk = plan.atRiskItems.find(i => i.task.id === matched.id);
              let exp = `Regarding "${matched.title}": Priority is ${matched.priority.toUpperCase()}, due ${new Date(matched.deadline).toLocaleDateString()}. `;
              if (scheduled) exp += `Allocated ${scheduled.allocatedDuration}m focus block today.`;
              else if (atRisk) exp += `Postponed because available study time (${plan.totalAvailable}m) was allocated to closer deadlines.`;
              this.addAssistantMessage(exp, null, { isAI: true });
            } else {
              this.addAssistantMessage('Your schedule is organized by deadline urgency and priority score.');
            }
            return;
          }
        }
      }
    }

    // Conversational model response (greetings, general knowledge, study advice, Hinglish)
    const replyText = aiResult.reply || 'I heard you, but have no response to share.';
    this.addAssistantMessage(replyText, null, { isAI: true, model: aiResult.model });
    if (AppState.settings.voiceOutput && aiResult.reply) {
      AudioService.speak(aiResult.reply);
    }
  },

  /**
   * Main chat pipeline shared by both typed messages and voice-to-text transcripts.
   */
  async handleUserChatSubmit(inputString) {
    const text = inputString.trim();
    if (!text || this.isChatRequestInProgress) return;

    this.addUserMessage(text);

    // Fast-path: Explicit confirmation or rejection of pending schedule proposals
    if (typeof AppState !== 'undefined' && AppState && AppState.pendingProposal) {
      if (/^(?:apply|apply revised plan|apply plan|approve|yes|confirm|accept|agree|proceed)\b/i.test(text)) {
        this.handleApplyProposal(AppState.pendingProposal.id);
        return;
      }
      if (/^(?:reject|cancel|no|keep original|keep original plan|decline|discard)\b/i.test(text)) {
        this.handleRejectProposal(AppState.pendingProposal.id);
        return;
      }
    }

    const typingId = this.showThinkingIndicator();
    this.isChatRequestInProgress = true;

    try {
      const aiResult = await AIService.sendMessage({
        message: text,
        history: AppState.chatMessages,
        tasks: AppState.tasks,
        constraints: AppState.constraints,
        currentPlan: AppState.currentPlan,
        lastAppliedProposal: AppState.lastAppliedProposal,
        pendingProposal: AppState.pendingProposal
      });

      this.removeThinkingIndicator(typingId);

      if (aiResult && aiResult.ok && aiResult.status === 'success') {
        // Genuine LLM Response with tool integration
        await this.handleAIModelSuccess(aiResult, text);
      } else if (aiResult && aiResult.status === 'unconfigured') {
        // Backend online, but active provider API key missing or invalid in .env
        const provider = (aiResult.provider || (aiResult.message && aiResult.message.toLowerCase().includes('gemini') ? 'gemini' : 'openai')).toLowerCase();
        let setupNotice;

        if (aiResult.setupInstructions) {
          const header = `⚙️ **AimFlow AI Setup Required**\n\n${aiResult.message || 'AI provider key is not configured.'}\n\n`;
          setupNotice = `${header}${aiResult.setupInstructions}`;
        } else if (provider === 'gemini') {
          setupNotice = `⚙️ **AimFlow AI Setup Required**\n\nThe local backend is running, but a valid **GEMINI_API_KEY** is not configured in \`.env\`.\n\nTo enable Google Gemini AI (free tier):\n1. Go to **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)**\n2. Sign in with your Google account and create a free API key (starts with \`AIza\`)\n3. Open \`.env\` in your project folder and set: \`GEMINI_API_KEY=AIzaSy...\`\n4. Restart the server (\`node server.js\`)\n\n*(In the meantime, deterministic task commands like 'Replan my day' or 'I lost 2 hours' are active)*`;
        } else {
          setupNotice = `⚙️ **AimFlow AI Setup Required**\n\nThe local backend is running, but **OPENAI_API_KEY** is not configured in \`.env\`.\n\nTo enable genuine AI conversation, study guidance, and general knowledge:\n1. Open \`.env\` in your project folder\n2. Add your key: \`OPENAI_API_KEY=sk-...\`\n3. Restart the server (\`npm start\`)\n\n*(In the meantime, deterministic task commands like 'Replan my day' or 'I lost 2 hours' are active)*`;
        }

        this.addAssistantMessage(setupNotice, null, { isSetupNotice: true });
        this.executeDeterministicFallback(text, false);
      } else if (aiResult && aiResult.status === 'error') {
        // Backend reached provider but received an error (quota, rate-limit, bad key, etc.)
        const errorType = aiResult.errorType || 'AI_ERROR';
        const provider = (aiResult.provider || (aiResult.message && aiResult.message.toLowerCase().includes('gemini') ? 'gemini' : 'openai')).toLowerCase();
        let providerNotice;
        if (errorType === 'RATE_LIMIT_EXCEEDED') {
          if (provider === 'gemini') {
            providerNotice = `⚠️ **AI Provider Notice — Rate Limit Exceeded**\n\n${aiResult.message || 'Gemini API rate limit exceeded.'}\n\nPlease wait before trying again. Provider limits vary by model and account.\n\n*(Deterministic task commands like 'Replan my day' and 'I lost 2 hours' remain fully active)*`;
          } else {
            providerNotice = `⚠️ **AI Provider Notice — Usage Quota Exhausted**\n\n${aiResult.message || 'Your OpenAI account has no remaining credits.'}\n\nTo resolve this:\n1. Visit **[platform.openai.com/settings/organization/billing](https://platform.openai.com/settings/organization/billing)** and add credits to your account.\n2. Once credits are added, your AI chat will work automatically — no restart needed.\n\n*(Deterministic task commands like 'Replan my day' and 'I lost 2 hours' remain fully active)*`;
          }
        } else if (errorType === 'INVALID_CREDENTIALS') {
          if (provider === 'gemini') {
            providerNotice = `⚠️ **AI Provider Notice — Invalid Gemini API Key**\n\n${aiResult.message || 'Authentication failed with Google Gemini.'}\n\nTo resolve this:\n1. Go to **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)** and create a valid key (starts with \`AIza\`).\n2. Open \`.env\` in your project folder and set \`GEMINI_API_KEY=AIzaSy...\`.\n3. Restart the server (\`node server.js\`).\n\n*(Deterministic task commands remain active)*`;
          } else {
            providerNotice = `⚠️ **AI Provider Notice — Invalid API Key**\n\n${aiResult.message || 'Authentication failed with OpenAI.'}\n\nTo resolve this:\n1. Open \`.env\` in your project folder.\n2. Verify \`OPENAI_API_KEY=sk-...\` is your correct, active key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys).\n3. Restart the server (\`node server.js\`).\n\n*(Deterministic task commands remain active)*`;
          }
        } else if (errorType === 'CLIENT_RATE_LIMITED') {
          providerNotice = `⚠️ **Slow Down** — You're sending messages too quickly. Please wait a moment before trying again.`;
        } else {
          providerNotice = `⚠️ **AI Provider Notice**\n\n${aiResult.message || 'The AI provider returned an error. Please try again shortly.'}\n\n*(Deterministic task commands remain active)*`;
        }
        this.addAssistantMessage(providerNotice, null, { isProviderError: true });
        this.executeDeterministicFallback(text, false);
      } else {
        const backendNotice = aiResult && aiResult.networkError
          ? 'Could not reach the AimFlow backend. Check that the server is running, then try again. Local task and schedule commands are still available.'
          : aiResult && Number.isInteger(aiResult.status)
            ? `The AimFlow backend returned HTTP ${aiResult.status}. Local task and schedule commands are still available.`
            : 'AimFlow could not complete the AI request. Local task and schedule commands are still available.';
        this.addAssistantMessage(`⚠️ ${backendNotice}`, null, { isProviderError: true });
        this.executeDeterministicFallback(text, false);
      }
    } catch (err) {
      this.removeThinkingIndicator(typingId);
      console.warn('[AimFlow AI] Chat response could not be processed.');
      this.addAssistantMessage('⚠️ AimFlow could not process that AI response. Your tasks and schedule were not automatically retried; please review them before trying again.', null, { isProviderError: true });
    } finally {
      this.isChatRequestInProgress = false;
    }
  },

  // ==========================================================================
  // MODALS & FORMS
  // ==========================================================================

  openAddTaskModal() {
    const modal = document.getElementById('taskModal');
    if (!modal) return;

    document.getElementById('taskModalTitle').textContent = 'Add New Task';
    document.getElementById('taskIdInput').value = '';
    document.getElementById('taskTitleInput').value = '';
    document.getElementById('taskCategoryInput').value = 'Assignment';
    document.getElementById('taskDeadlineInput').value = getRelativeDate(2, '18:00');
    document.getElementById('taskDurationInput').value = '60';
    document.getElementById('taskPriorityInput').value = 'medium';
    document.getElementById('taskNotesInput').value = '';

    modal.classList.add('is-open');
    document.getElementById('taskTitleInput').focus();
  },

  openEditTaskModal(taskId) {
    const task = AppState.tasks.find(t => t.id === taskId);
    if (!task) return;

    const modal = document.getElementById('taskModal');
    if (!modal) return;

    document.getElementById('taskModalTitle').textContent = 'Edit Task';
    document.getElementById('taskIdInput').value = task.id;
    document.getElementById('taskTitleInput').value = task.title;
    document.getElementById('taskCategoryInput').value = task.category;
    document.getElementById('taskDeadlineInput').value = task.deadline.slice(0, 16);
    document.getElementById('taskDurationInput').value = task.estimatedDuration;
    document.getElementById('taskPriorityInput').value = task.priority;
    document.getElementById('taskNotesInput').value = task.notes || '';

    modal.classList.add('is-open');
    document.getElementById('taskTitleInput').focus();
  },

  closeTaskModal() {
    const modal = document.getElementById('taskModal');
    if (modal) modal.classList.remove('is-open');
  },

  handleSaveTaskForm(e) {
    e.preventDefault();

    const id = document.getElementById('taskIdInput').value;
    const title = document.getElementById('taskTitleInput').value.trim();
    const category = document.getElementById('taskCategoryInput').value;
    const deadline = document.getElementById('taskDeadlineInput').value;
    const duration = parseInt(document.getElementById('taskDurationInput').value, 10);
    const priority = document.getElementById('taskPriorityInput').value;
    const notes = document.getElementById('taskNotesInput').value.trim();

    if (!title) {
      alert('Please enter a task title.');
      return;
    }

    if (isNaN(duration) || duration <= 0) {
      alert('Please enter a valid estimated duration in minutes.');
      return;
    }

    const now = new Date().toISOString();

    if (id) {
      // Edit existing
      const existing = AppState.tasks.find(t => t.id === id);
      if (existing) {
        existing.title = title;
        existing.category = category;
        existing.deadline = deadline;
        existing.estimatedDuration = duration;
        existing.priority = priority;
        existing.notes = notes;
        existing.updatedAt = now;
      }
    } else {
      // Create new
      AppState.tasks.push({
        id: 'task_' + Date.now(),
        title,
        category,
        deadline,
        estimatedDuration: duration,
        priority,
        completed: false,
        completedAt: null,
        notes,
        createdAt: now,
        updatedAt: now,
        status: 'scheduled'
      });
    }

    StorageService.saveTasks();
    this.closeTaskModal();
    this.refreshAll();
  },

  confirmDeleteTask(taskId) {
    const task = AppState.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (window.confirm(`Are you sure you want to delete "${task.title}"? This cannot be undone.`)) {
      AppState.tasks = AppState.tasks.filter(t => t.id !== taskId);
      StorageService.saveTasks();
      this.refreshAll();
    }
  },

  openTimeConstraintModal() {
    const modal = document.getElementById('timeModal');
    if (!modal) return;

    document.getElementById('timeHoursInput').value = (AppState.constraints.availableMinutesToday / 60).toFixed(1);
    modal.classList.add('is-open');
  },

  closeTimeConstraintModal() {
    const modal = document.getElementById('timeModal');
    if (modal) modal.classList.remove('is-open');
  },

  handleSaveTimeConstraint(e) {
    e.preventDefault();
    const hours = parseFloat(document.getElementById('timeHoursInput').value);
    if (isNaN(hours) || hours < 0 || hours > 24) {
      alert('Please enter a valid study hour range between 0 and 24.');
      return;
    }

    const newMinutes = Math.round(hours * 60);
    const oldMinutes = AppState.constraints.availableMinutesToday;

    AppState.constraints.availableMinutesToday = newMinutes;
    StorageService.saveConstraints();
    this.closeTimeConstraintModal();

    this.addAssistantMessage(`Updated your available study time today from ${oldMinutes}m to ${newMinutes}m. Schedule re-evaluated.`);
    this.refreshAll();
  },

  // ==========================================================================
  // EVENT BINDINGS
  // ==========================================================================

  bindEvents() {
    // Chat input & form
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    let isSubmittingChat = false;

    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        // If voice listening is in progress, cleanly stop it
        if (VoiceInputService.isSessionActive) {
          VoiceInputService.stop();
        }
        const val = chatInput.value.trim();
        if (!val || isSubmittingChat) return;

        isSubmittingChat = true;
        chatInput.value = '';
        Promise.resolve(this.handleUserChatSubmit(val)).then(
          () => { isSubmittingChat = false; },
          () => { isSubmittingChat = false; }
        );
      });
    }

    // Prompt chips
    document.querySelectorAll('.prompt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.getAttribute('data-prompt') || chip.textContent;
        this.handleUserChatSubmit(text);
      });
    });

    // Voice recognition button & status feedback banner
    const micBtn = document.getElementById('chatVoiceBtn');
    const statusFeedback = document.getElementById('voiceStatusFeedback');
    const statusText = document.getElementById('voiceStatusText');
    const statusDismissBtn = document.getElementById('voiceStatusDismissBtn');
    const statusRetryBtn = document.getElementById('voiceStatusRetryBtn');

    let statusDismissTimer = null;
    const showVoiceStatus = (state, message, autoDismissMs = 0, showRetry = false) => {
      if (!statusFeedback || !statusText) return;
      if (statusDismissTimer) {
        clearTimeout(statusDismissTimer);
        statusDismissTimer = null;
      }
      statusFeedback.className = 'voice-status-feedback state-' + state;
      statusText.textContent = message;
      if (statusRetryBtn) {
        statusRetryBtn.style.display = showRetry ? 'inline-block' : 'none';
      }
      statusFeedback.style.display = 'flex';

      if (autoDismissMs > 0) {
        statusDismissTimer = setTimeout(() => {
          statusFeedback.style.display = 'none';
          if (statusRetryBtn) statusRetryBtn.style.display = 'none';
        }, autoDismissMs);
      }
    };

    const hideVoiceStatus = () => {
      if (!statusFeedback) return;
      if (statusDismissTimer) {
        clearTimeout(statusDismissTimer);
        statusDismissTimer = null;
      }
      statusFeedback.style.display = 'none';
      if (statusRetryBtn) {
        statusRetryBtn.style.display = 'none';
      }
    };

    if (statusDismissBtn) {
      statusDismissBtn.addEventListener('click', () => {
        hideVoiceStatus();
      });
    }

    const startVoiceRecording = () => {
      if (!VoiceInputService.isSupported()) {
        showVoiceStatus('unsupported', 'Speech recognition is not supported in this browser. You can still type your commands in the chat input.', 0, false);
        return;
      }

      // If starting a fresh recording, remember base input text if any
      let baseText = '';
      if (chatInput && VoiceInputService.getState() === VoiceRecognitionState.IDLE) {
        baseText = chatInput.value ? chatInput.value.trim() + ' ' : '';
      }

      VoiceInputService.toggle({
        onTranscript: ({ text }) => {
          if (chatInput) {
            chatInput.value = baseText + text;
          }
          if (statusText) {
            statusText.textContent = `“${text}”`;
          }
        },
        onFinalText: (finalText) => {
          const combinedText = (baseText + finalText).trim();
          if (chatInput) {
            chatInput.value = combinedText;
            chatInput.focus();
            try {
              chatInput.setSelectionRange(combinedText.length, combinedText.length);
            } catch (e) {}
          }

          // Only auto-submit if user explicitly turned on the Auto-Send preference
          if (AppState.settings.voiceAutoSubmit && combinedText) {
            setTimeout(() => {
              if (chatInput) chatInput.value = '';
              hideVoiceStatus();
              this.handleUserChatSubmit(combinedText);
            }, 400);
          }
        }
      });
    };

    if (statusRetryBtn) {
      statusRetryBtn.addEventListener('click', () => {
        hideVoiceStatus();
        startVoiceRecording();
      });
    }

    // Subscribe to voice state transitions to update mic button and feedback banner
    VoiceInputService.onStateChange((state, details) => {
      if (!micBtn) return;

      // Clear all state styling classes
      micBtn.classList.remove('is-listening', 'is-processing', 'is-success', 'is-error', 'is-unsupported');
      micBtn.setAttribute('aria-pressed', 'false');

      switch (state) {
        case VoiceRecognitionState.IDLE:
          micBtn.title = 'Click to speak (voice command input)';
          if (details && details.message) {
            showVoiceStatus('idle', details.message, 3000, false);
          } else {
            hideVoiceStatus();
          }
          break;

        case VoiceRecognitionState.LISTENING:
          micBtn.classList.add('is-listening');
          micBtn.setAttribute('aria-pressed', 'true');
          micBtn.title = 'Listening... Click to stop recording';
          showVoiceStatus('listening', details.message || 'Listening... Speak your command (e.g. “Replan my day”)', 0, false);
          break;

        case VoiceRecognitionState.PROCESSING:
          micBtn.classList.add('is-processing');
          micBtn.title = 'Transcribing speech...';
          showVoiceStatus('processing', details.message || 'Transcribing speech...', 0, false);
          break;

        case VoiceRecognitionState.RECEIVED:
          micBtn.classList.add('is-success');
          micBtn.title = 'Voice input captured. Review or press Send.';
          showVoiceStatus('received', details.message || 'Voice input captured. Review or edit, then click Send.', 5000, false);
          setTimeout(() => {
            micBtn.classList.remove('is-success');
          }, 2500);
          break;

        case VoiceRecognitionState.PERMISSION_DENIED:
          micBtn.classList.add('is-error');
          micBtn.title = 'Microphone permission denied';
          showVoiceStatus('permission_denied', details.message || 'Microphone access denied. Please allow microphone access in your browser settings to use voice input.', 0, true);
          break;

        case VoiceRecognitionState.UNAVAILABLE:
          micBtn.classList.add('is-error');
          micBtn.title = 'Microphone unavailable';
          showVoiceStatus('unavailable', details.message || 'Microphone unavailable. Please verify a microphone is connected.', 0, true);
          break;

        case VoiceRecognitionState.UNSUPPORTED:
          micBtn.classList.add('is-unsupported');
          micBtn.title = 'Speech recognition is not supported in this browser';
          showVoiceStatus('unsupported', details.message || 'Speech recognition is not supported in this browser. You can still type your commands in the chat input.', 0, false);
          break;

        case VoiceRecognitionState.ERROR:
          micBtn.classList.add('is-error');
          micBtn.title = 'Voice recognition error. Click Retry or type your message.';
          showVoiceStatus('error', details.message || 'Voice recognition is temporarily unavailable. Check your connection or try another supported browser. You can type your command instead.', 0, details && details.canRetry !== false);
          break;
      }
    });

    if (micBtn) {
      if (!VoiceInputService.isSupported()) {
        micBtn.classList.add('is-unsupported');
        micBtn.title = 'Speech recognition is not supported in this browser';
      }

      micBtn.addEventListener('click', () => {
        startVoiceRecording();
      });
    }

    // Header buttons
    const tryDemoBtn = document.getElementById('tryDemoBtn');
    if (tryDemoBtn) {
      tryDemoBtn.addEventListener('click', () => {
        this.replanDay();
      });
    }

    const resetDemoBtn = document.getElementById('resetDemoBtn');
    if (resetDemoBtn) {
      resetDemoBtn.addEventListener('click', () => {
        if (window.confirm('Reset AimFlow AI to the initial hackathon demo scenario?')) {
          StorageService.resetDemo();
          AppState.chatMessages = [];
          this.addAssistantMessage('Reset complete. Loaded default hackathon scenario with 4 tasks and 3 hours study capacity.');
          this.refreshAll();
        }
      });
    }

    const clearAllDataBtn = document.getElementById('clearAllDataBtn');
    if (clearAllDataBtn) {
      clearAllDataBtn.addEventListener('click', () => {
        if (window.confirm('WARNING: This will permanently delete ALL stored tasks, custom study hours, and schedule history. Do you want to proceed with clearing all data?')) {
          StorageService.clearAllData();
          this.addAssistantMessage('All tasks and constraints have been cleared. You are starting with an empty ledger.');
          this.refreshAll();
        }
      });
    }

    const undoBtn = document.getElementById('headerUndoBtn');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        if (AppState.undoStack.length === 0) return;
        const undoneDesc = ProposalManager.undoLastChange();
        if (undoneDesc) {
          AudioService.playChime('chime');
          this.addAssistantMessage(`↩ Undone: ${undoneDesc}. Your previous schedule has been restored.`);
          this.refreshAll();
        }
      });
    }

    // Date / Sprint pill → opens Study Hours modal so sprint context is adjustable
    const datePill = document.getElementById('currentDateDisplay');
    if (datePill) {
      datePill.addEventListener('click', () => {
        this.openTimeConstraintModal();
      });
      // Keyboard support for role=button div
      datePill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.openTimeConstraintModal();
        }
      });
    }

    const addTaskBtn = document.getElementById('addTaskBtn');
    if (addTaskBtn) {
      addTaskBtn.addEventListener('click', () => {
        this.openAddTaskModal();
      });
    }

    const adjustTimeBtn = document.getElementById('adjustTimeBtn');
    if (adjustTimeBtn) {
      adjustTimeBtn.addEventListener('click', () => {
        this.openTimeConstraintModal();
      });
    }

    // Modal close & forms
    const closeTaskModalBtn = document.getElementById('closeTaskModalBtn');
    if (closeTaskModalBtn) closeTaskModalBtn.addEventListener('click', () => this.closeTaskModal());
    const cancelTaskBtn = document.getElementById('cancelTaskBtn');
    if (cancelTaskBtn) cancelTaskBtn.addEventListener('click', () => this.closeTaskModal());
    const taskForm = document.getElementById('taskForm');
    if (taskForm) taskForm.addEventListener('submit', (e) => this.handleSaveTaskForm(e));

    const closeTimeModalBtn = document.getElementById('closeTimeModalBtn');
    if (closeTimeModalBtn) closeTimeModalBtn.addEventListener('click', () => this.closeTimeConstraintModal());
    const cancelTimeBtn = document.getElementById('cancelTimeBtn');
    if (cancelTimeBtn) cancelTimeBtn.addEventListener('click', () => this.closeTimeConstraintModal());
    const timeForm = document.getElementById('timeForm');
    if (timeForm) timeForm.addEventListener('submit', (e) => this.handleSaveTimeConstraint(e));

    // Filters and Search
    const searchInput = document.getElementById('taskSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        AppState.searchQuery = e.target.value;
        this.renderTasks();
      });
    }

    const categoryFilter = document.getElementById('categoryFilterSelect');
    if (categoryFilter) {
      categoryFilter.addEventListener('change', (e) => {
        AppState.filterCategory = e.target.value;
        this.renderTasks();
      });
    }

    document.querySelectorAll('.filter-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        AppState.filterStatus = btn.getAttribute('data-status');
        this.renderTasks();
      });
    });

    // Voice Speech toggle
    const voiceToggle = document.getElementById('voiceToggleCheckbox');
    if (voiceToggle) {
      voiceToggle.checked = AppState.settings.voiceSpeechEnabled;
      voiceToggle.addEventListener('change', () => {
        AppState.settings.voiceSpeechEnabled = voiceToggle.checked;
        StorageService.saveSettings();
        if (voiceToggle.checked) {
          AudioService.speak('Alexa voice synthesis activated.');
        }
      });
    }

    // Voice Auto-Submit toggle
    const voiceAutoSubmit = document.getElementById('voiceAutoSubmitCheckbox');
    if (voiceAutoSubmit) {
      voiceAutoSubmit.checked = Boolean(AppState.settings.voiceAutoSubmit);
      voiceAutoSubmit.addEventListener('change', () => {
        AppState.settings.voiceAutoSubmit = voiceAutoSubmit.checked;
        StorageService.saveSettings();
      });
    }

    // Keyboard ESC listener for modals
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeTaskModal();
          this.closeTimeConstraintModal();
        }
      });
    }
  },

  /**
   * Re-evaluates all current deadlines, priorities, and study hours,
   * then creates an interactive schedule adaptation proposal in the Alexa+ panel.
   */
  replanDay() {
    this.handleUserChatSubmit('Replan my day');
  },

  /**
   * One-click memorable demo scenario demonstrating Section 5:
   * 1. Resets to base 4 tasks and 3h study capacity.
   * 2. Automatically executes the core unexpected life change:
   *    "My hackathon deadline moved to tomorrow, and I only have one hour to study today."
   * 3. Calculates the impact, shows the Before/After diff, and waits for user approval.
   */
  triggerDemoScenario() {
    StorageService.resetDemo();
    AppState.chatMessages = [];
    this.refreshAll();

    // Trigger the compound challenge prompt
    const demoPrompt = 'My hackathon deadline moved to tomorrow, and I only have one hour to study today.';
    this.handleUserChatSubmit(demoPrompt);
  }
};

// ============================================================================
// 10. INITIALIZATION & EXPORTS
// ============================================================================

// Expose core modules on window for debugging, testing, and inspection
if (typeof window !== 'undefined') {
  window.SchedulingEngine = SchedulingEngine;
  window.NaturalLanguageInterpreter = NaturalLanguageInterpreter;
  window.ProposalManager = ProposalManager;
  window.AppState = AppState;
  window.StorageService = StorageService;
  window.UIRenderer = UIRenderer;
  window.AudioService = AudioService;
  window.VoiceInputService = VoiceInputService;
  window.VoiceRecognitionState = VoiceRecognitionState;
  window.AIService = AIService;
  window.getRelativeDate = getRelativeDate;
  window.createDemoTasks = createDemoTasks;
  window.createDefaultConstraints = createDefaultConstraints;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('DOMContentLoaded', () => {
    StorageService.loadAll();
    UIRenderer.init();
  });
}
