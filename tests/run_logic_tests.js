/**
 * LifePilot AI — Node.js Logic Tests
 * Tests the scheduling engine and NLP interpreter without a browser.
 */

// Mock browser globals needed by script.js
global.window = {
  addEventListener: () => {},
  SpeechRecognition: null,
  webkitSpeechRecognition: null,
  AudioContext: null,
  webkitAudioContext: null,
  confirm: () => true,
  alert: () => {}
};
global.document = { getElementById: () => null, querySelectorAll: () => { const arr = []; arr.forEach = () => {}; return arr; }, createElement: () => ({
  className: '', id: '', setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {},
  style: {}, innerHTML: '', textContent: '', classList: { add: () => {}, remove: () => {}, contains: () => false },
  childNodes: { forEach: () => {} }, querySelector: () => null, remove: () => {}
})};
global.localStorage = {
  data: {},
  getItem(k) { return this.data[k] || null; },
  setItem(k, v) { this.data[k] = v; },
  removeItem(k) { delete this.data[k]; }
};
global.Node = { TEXT_NODE: 3 };
global.alert = () => {};
global.confirm = () => true;

// Load script
require('../script.js');

// The script exports to window.* in 'use strict' mode
const { createDemoTasks, createDefaultConstraints, getRelativeDate,
        SchedulingEngine, NaturalLanguageInterpreter, ProposalManager,
        StorageService, AppState } = global.window;

const tasks = createDemoTasks();
const constraints = createDefaultConstraints();
let pass = 0;
let fail = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${name}${detail ? ' — ' + detail : ''}`);
    pass++;
  } else {
    console.error(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    fail++;
  }
}

console.log('\n=== LifePilot AI — Core Logic Tests ===\n');

// TEST 1: Demo Tasks
console.log('1. Demo Task Creation');
assert('4 demo tasks created', tasks.length === 4);
assert('Hackathon task exists', tasks.some(t => t.id === 'task_demo_hackathon'));
assert('Math task has medium priority', tasks.find(t => t.id === 'task_demo_math')?.priority === 'medium');
assert('All tasks have deadlines', tasks.every(t => !!t.deadline));
assert('All tasks have estimatedDuration', tasks.every(t => t.estimatedDuration > 0));

// TEST 2: Default Constraints
console.log('\n2. Default Constraints');
assert('Available 180 mins', constraints.availableMinutesToday === 180);
assert('Day start at 16:00', constraints.dayStartTime === '16:00');
assert('Empty commitments array', Array.isArray(constraints.commitments) && constraints.commitments.length === 0);

// TEST 3: Scheduling Engine — computePlan
console.log('\n3. Scheduling Engine');
const plan = SchedulingEngine.computePlan(tasks, constraints);
assert('Plan has scheduledItems', Array.isArray(plan.scheduledItems));
assert('Plan has timeline', Array.isArray(plan.timeline) && plan.timeline.length > 0, `${plan.timeline.length} slots`);
assert('Plan totalAvailable = 180m', plan.totalAvailable === 180);
assert('Scheduled minutes <= available', plan.scheduledMinutes <= 180);
assert('Timeline has time badges', plan.timeline.every(s => s.startTimeFormatted && s.endTimeFormatted));

// TEST 3b: Scoring
const hackathonTask = tasks.find(t => t.id === 'task_demo_hackathon');
const mathTask = tasks.find(t => t.id === 'task_demo_math');
const hackScore = SchedulingEngine.calculateTaskScore(hackathonTask);
const mathScore = SchedulingEngine.calculateTaskScore(mathTask);
assert('Math (due tomorrow) scores higher urgency than hackathon (due +3d)', mathScore.compositeScore > hackScore.compositeScore);

// TEST 3c: Overdue scoring
const overdueTask = { ...hackathonTask, deadline: getRelativeDate(-2, '10:00'), completed: false };
const overdueScore = SchedulingEngine.calculateTaskScore(overdueTask);
assert('Overdue task urgency = 100', overdueScore.urgencyPoints === 100);
assert('Overdue task isOverdue = true', overdueScore.isOverdue === true);

// TEST 4: NLP — Compound hackathon demo prompt
console.log('\n4. NLP Interpreter — Compound Demo Prompt');
const demoPrompt = 'My hackathon deadline moved to tomorrow, and I only have one hour to study today.';
const demoIntent = NaturalLanguageInterpreter.interpret(demoPrompt, tasks, constraints);
assert('Demo prompt -> ADAPTIVE_CHANGE', demoIntent.type === 'ADAPTIVE_CHANGE');
assert('Deadline change detected for hackathon', demoIntent.deadlineChanges.length > 0);
assert('Time change detected (1 hour = 60m)', demoIntent.timeChange?.newMinutes === 60);

// TEST 5: NLP — "I lost X hours"
console.log('\n5. NLP Interpreter — Time Loss Phrasing');
const lostIntent = NaturalLanguageInterpreter.interpret('I lost 2 hours today', tasks, constraints);
assert('"I lost 2 hours" -> ADAPTIVE_CHANGE', lostIntent.type === 'ADAPTIVE_CHANGE');
assert('"I lost 2 hours" reduces from 180 to 60m', lostIntent.timeChange?.newMinutes === 60, `Got: ${lostIntent.timeChange?.newMinutes}m`);

// TEST 6: NLP — What's next
console.log('\n6. NLP Interpreter — Query Intents');
const nextIntent = NaturalLanguageInterpreter.interpret('What should I do next?', tasks, constraints);
assert('WHAT_NEXT intent recognized', nextIntent.type === 'WHAT_NEXT');

const whatChangedIntent = NaturalLanguageInterpreter.interpret('Show me what changed.', tasks, constraints);
assert('WHAT_CHANGED recognized', whatChangedIntent.type === 'WHAT_CHANGED');

const explainIntent = NaturalLanguageInterpreter.interpret('Why did you move my programming task?', tasks, constraints);
assert('EXPLAIN_WHY recognized', explainIntent.type === 'EXPLAIN_WHY');

const undoIntent = NaturalLanguageInterpreter.interpret('Undo last change', tasks, constraints);
assert('UNDO recognized', undoIntent.type === 'UNDO');

// TEST 7: NLP — Complete task
console.log('\n7. NLP Interpreter — Task Completion');
const completeIntent = NaturalLanguageInterpreter.interpret('I finished my mathematics revision.', tasks, constraints);
assert('COMPLETE_TASK recognized', completeIntent.type === 'COMPLETE_TASK');
assert('Matched mathematics revision task', completeIntent.task?.id === 'task_demo_math');

// TEST 8: ProposalManager
console.log('\n8. ProposalManager');
Object.assign(AppState, {
  tasks: JSON.parse(JSON.stringify(tasks)),
  constraints: JSON.parse(JSON.stringify(constraints)),
  undoStack: [],
  pendingProposal: null,
  lastAppliedProposal: null
});

const triggerInfo = {
  raw: 'My hackathon deadline moved to tomorrow and I only have 1 hour',
  deadlineChanges: [{
    taskId: 'task_demo_hackathon',
    taskTitle: 'Hackathon project',
    oldDeadline: tasks.find(t => t.id === 'task_demo_hackathon').deadline,
    oldDeadlineText: 'in 3 days',
    newDeadline: getRelativeDate(1, '20:00'),
    newDeadlineText: 'tomorrow'
  }],
  timeChange: { oldMinutes: 180, newMinutes: 60 },
  commitmentAdded: null
};
const proposal = ProposalManager.createProposal(triggerInfo);
assert('Proposal created with ID', !!proposal.id);
assert('Proposal status = pending', proposal.status === 'pending');
assert('Explanation has changesDetected', proposal.explanation.changesDetected.length > 0);
assert('Explanation has actionsTaken', proposal.explanation.actionsTaken.length > 0);
assert('Explanation has why text', !!proposal.explanation.why);
assert('Before plan has items', proposal.beforePlan.scheduledItems.length > 0);
assert('After plan available = 60m', proposal.proposedPlan.totalAvailable === 60, `Got: ${proposal.proposedPlan.totalAvailable}m`);

// Apply proposal
const applyResult = ProposalManager.applyProposal(proposal.id);
assert('Proposal applied successfully', applyResult === true);
assert('After apply: no pending proposal', AppState.pendingProposal === null);
assert('After apply: undo stack has entry', AppState.undoStack.length === 1);

// Undo
const undoResult = ProposalManager.undoLastChange();
assert('Undo successful', undoResult !== null);
assert('After undo: undo stack empty', AppState.undoStack.length === 0);

// TEST 9: StorageService
console.log('\n9. StorageService');
Object.assign(AppState, {
  tasks: [],
  constraints: createDefaultConstraints(),
  chatMessages: [],
  undoStack: [],
  pendingProposal: null,
  lastAppliedProposal: null,
  settings: { voiceSpeechEnabled: false, soundEffectsEnabled: true }
});
StorageService.loadAll();
assert('Load initializes with demo tasks (fresh localStorage)', AppState.tasks.length === 4);
StorageService.saveTasks();
const savedTasksJSON = localStorage.getItem('lifepilot_tasks_v1');
assert('Tasks saved to localStorage', !!savedTasksJSON);
const savedParsed = JSON.parse(savedTasksJSON);
assert('Saved tasks parseable and have 4 items', savedParsed.length === 4);

console.log(`\n=== TEST RESULTS: ${pass} PASSED, ${fail} FAILED ===\n`);
process.exit(fail > 0 ? 1 : 0);
