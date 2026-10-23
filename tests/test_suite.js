/**
 * Automated Verification Test Suite for LifePilot AI
 * Validates deterministic scheduling engine, scoring mathematics,
 * natural language parser, proposal manager, undo stack, and state transitions.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`FAIL [Test #${totalTests}]: ${message}`);
    process.exitCode = 1;
  } else {
    passedTests++;
    console.log(`PASS [Test #${totalTests}]: ${message}`);
  }
}

// 1. Mock Browser Environment in Node VM
const scriptContent = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

const mockLocalStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; }
};

const domElements = {};
function createMockElement(id) {
  return {
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
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    appendChild() {},
    children: []
  };
}

const mockDocument = {
  getElementById(id) {
    if (!domElements[id]) domElements[id] = createMockElement(id);
    return domElements[id];
  },
  querySelectorAll() { return []; },
  createElement(tag) { return createMockElement(tag); },
  addEventListener() {}
};

const sandbox = {
  window: {
    localStorage: mockLocalStorage,
    addEventListener() {},
    confirm() { return true; },
    alert() {},
    speechSynthesis: {
      cancel() {},
      speak() {},
      getVoices() { return []; }
    }
  },
  document: mockDocument,
  localStorage: mockLocalStorage,
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  SpeechSynthesisUtterance: function() {}
};

vm.createContext(sandbox);
vm.runInContext(scriptContent, sandbox);

console.log('\n--- LIFEPILOT AI ENGINE TEST SUITE ---\n');

// 2. Test calculateDaysUntil
const SchedulingEngine = sandbox.window.SchedulingEngine;
assert(typeof SchedulingEngine !== 'undefined', 'SchedulingEngine is defined');

const todayStr = sandbox.window.getRelativeDate(0, '22:00');
const tomorrowStr = sandbox.window.getRelativeDate(1, '22:00');
const threeDaysStr = sandbox.window.getRelativeDate(3, '22:00');

assert(SchedulingEngine.calculateDaysUntil(todayStr) === 0, 'Days until today equals 0');
assert(SchedulingEngine.calculateDaysUntil(tomorrowStr) === 1, 'Days until tomorrow equals 1');
assert(SchedulingEngine.calculateDaysUntil(threeDaysStr) === 3, 'Days until 3 days offset equals 3');

// 3. Test Task Scoring Logic
const sampleTaskHighTomorrow = {
  id: 't1',
  title: 'Urgent Task',
  priority: 'high',
  deadline: tomorrowStr,
  completed: false,
  estimatedDuration: 60
};
const score1 = SchedulingEngine.calculateTaskScore(sampleTaskHighTomorrow);
// Urgency: Tomorrow (80) * 1.5 = 120; Priority: High (50) * 1.0 = 50. Total = 170.
assert(score1.compositeScore === 170, `High priority due tomorrow scores 170 (got ${score1.compositeScore})`);

const sampleTaskMedTomorrow = {
  id: 't2',
  title: 'Med Task',
  priority: 'medium',
  deadline: tomorrowStr,
  completed: false,
  estimatedDuration: 60
};
const score2 = SchedulingEngine.calculateTaskScore(sampleTaskMedTomorrow);
// Urgency: Tomorrow (80) * 1.5 = 120; Priority: Medium (30) * 1.0 = 30. Total = 150.
assert(score2.compositeScore === 150, `Medium priority due tomorrow scores 150 (got ${score2.compositeScore})`);

// 4. Test Demo Scenario Baseline Computation
const demoTasks = sandbox.window.createDemoTasks();
const defaultConstraints = sandbox.window.createDefaultConstraints();

assert(demoTasks.length === 4, 'Demo tasks contain exactly 4 tasks');
assert(defaultConstraints.availableMinutesToday === 180, 'Default study capacity is 180 minutes (3 hours)');

const initialPlan = SchedulingEngine.computePlan(demoTasks, defaultConstraints);
assert(initialPlan.totalAvailable === 180, 'Initial plan net available is 180m');
assert(initialPlan.scheduledMinutes === 180, 'Initial plan schedules all 180m');
assert(initialPlan.timeline.length > 0, 'Initial plan generates chronological timeline slots');

// 5. Test Compound Challenge: "Hackathon deadline moved to tomorrow, only 1 hour study"
const NaturalLanguageInterpreter = sandbox.window.NaturalLanguageInterpreter;
assert(typeof NaturalLanguageInterpreter !== 'undefined', 'NaturalLanguageInterpreter is defined');

const challengeUtterance = "My hackathon deadline moved to tomorrow, and I only have one hour to study today.";
const interpreted = NaturalLanguageInterpreter.interpret(challengeUtterance, demoTasks, defaultConstraints);

assert(interpreted.type === 'ADAPTIVE_CHANGE', 'Interprets compound command as ADAPTIVE_CHANGE');
assert(interpreted.deadlineChanges && interpreted.deadlineChanges.length === 1, 'Detects deadline change');
assert(interpreted.deadlineChanges[0].taskTitle === 'Hackathon project', 'Correctly matches Hackathon project task');
assert(interpreted.timeChange !== null, 'Detects time change constraint');
assert(interpreted.timeChange.newMinutes === 60, `Detects new study time as 60 mins (got ${interpreted.timeChange.newMinutes})`);

// 6. Test Proposal Generation & Mathematical Trade-Offs
const ProposalManager = sandbox.window.ProposalManager;
sandbox.window.AppState.tasks = demoTasks;
sandbox.window.AppState.constraints = defaultConstraints;

const proposal = ProposalManager.createProposal(interpreted);
assert(proposal !== null, 'Creates schedule adaptation proposal');
assert(proposal.status === 'pending', 'Proposal starts in pending review status');
assert(proposal.proposedPlan.totalAvailable === 60, 'Proposed plan limits total available to 60m');
assert(proposal.proposedPlan.scheduledMinutes === 60, 'Proposed plan allocates 60m focus block');

// The hackathon project requires 180m, fits 60m, has 120m deficit
const hackathonScheduled = proposal.proposedPlan.scheduledItems.find(i => i.task.title === 'Hackathon project');
assert(hackathonScheduled && hackathonScheduled.allocatedDuration === 60, 'Hackathon project gets the 60m focus block');
assert(hackathonScheduled.isPartial === true, 'Hackathon project is flagged as partial focus block');

// Unscheduled or at-risk count
assert(proposal.proposedPlan.atRiskItems.length >= 1, 'At-risk items flagged due to finite capacity');
assert(proposal.explanation.why.includes('exceeds today\'s available time'), 'Explanation documents capacity deficit honestly');

// 7. Test Proposal Approval & State Commit
const applySuccess = ProposalManager.applyProposal(proposal.id);
assert(applySuccess === true, 'Proposal applied successfully');
assert(sandbox.window.AppState.constraints.availableMinutesToday === 60, 'AppState study hours updated to 60m');
assert(sandbox.window.AppState.undoStack.length === 1, 'Snapshot pushed to undo stack');

// 8. Test Undo Capability
const undoResult = ProposalManager.undoLastChange();
assert(undoResult !== null, 'Undo operation executed successfully');
assert(sandbox.window.AppState.constraints.availableMinutesToday === 180, 'Restored previous 180m available study time');
assert(sandbox.window.AppState.undoStack.length === 0, 'Undo stack emptied after revert');

// 9. Test Natural Language Parser Variations
const queryNext = NaturalLanguageInterpreter.interpret("What should I do next?", demoTasks, defaultConstraints);
assert(queryNext.type === 'WHAT_NEXT', 'Interprets "What should I do next?"');

const queryWhy = NaturalLanguageInterpreter.interpret("Why did you move my programming task?", demoTasks, defaultConstraints);
assert(queryWhy.type === 'EXPLAIN_WHY', 'Interprets "Why did you move my programming task?"');

const queryWhatChanged = NaturalLanguageInterpreter.interpret("Show me what changed.", demoTasks, defaultConstraints);
assert(queryWhatChanged.type === 'WHAT_CHANGED', 'Interprets "Show me what changed."');

const queryComplete = NaturalLanguageInterpreter.interpret("I finished my mathematics revision", demoTasks, defaultConstraints);
assert(queryComplete.type === 'COMPLETE_TASK', 'Interprets "I finished my mathematics revision"');
assert(queryComplete.task.title === 'Mathematics revision', 'Matches mathematics revision task for completion');

const queryUndo = NaturalLanguageInterpreter.interpret("Undo that", demoTasks, defaultConstraints);
assert(queryUndo.type === 'UNDO', 'Interprets "Undo that"');

const queryCommitment = NaturalLanguageInterpreter.interpret("I have an unexpected two-hour commitment", demoTasks, defaultConstraints);
assert(queryCommitment.type === 'ADAPTIVE_CHANGE' && queryCommitment.commitmentAdded.durationMinutes === 120, 'Interprets 2-hour unexpected commitment');

// 10. Verify index.html Integrity and Element IDs
const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const requiredIds = [
  'currentDateDisplay',
  'tryDemoBtn',
  'headerUndoBtn',
  'resetDemoBtn',
  'metricAvailableHours',
  'metricScheduledMinutes',
  'metricDueSoon',
  'metricAtRisk',
  'metricProgressText',
  'metricProgressFill',
  'timelineContainer',
  'taskListContainer',
  'chatMessagesStream',
  'chatInput',
  'chatForm',
  'chatVoiceBtn',
  'chatSendBtn',
  'taskModal',
  'timeModal',
  'taskSearchInput',
  'categoryFilterSelect'
];

requiredIds.forEach(id => {
  assert(htmlContent.includes(`id="${id}"`), `index.html contains #${id}`);
});

assert(htmlContent.includes('href="assets/favicon.svg"'), 'index.html references relative favicon');
assert(htmlContent.includes('href="style.css"'), 'index.html references relative stylesheet');
assert(htmlContent.includes('src="script.js"'), 'index.html references relative script');

console.log(`\n========================================`);
console.log(`TEST SUMMARY: ${passedTests} of ${totalTests} assertions passed.`);
console.log(`========================================\n`);
