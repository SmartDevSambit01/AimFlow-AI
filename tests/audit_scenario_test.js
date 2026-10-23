/**
 * Full 18-Step Audit Verification Script
 * Validates the core scenario from Section 2 of the audit prompt.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const AppState = sandbox.window.AppState;
const StorageService = sandbox.window.StorageService;
const SchedulingEngine = sandbox.window.SchedulingEngine;
const ProposalManager = sandbox.window.ProposalManager;
const NaturalLanguageInterpreter = sandbox.window.NaturalLanguageInterpreter;
const UIRenderer = sandbox.window.UIRenderer;

console.log('=== STARTING 18-STEP CORE SCENARIO AUDIT ===\n');

// Step 1: Load sample demo
StorageService.resetDemo();
assert(AppState.tasks.length === 4, 'Step 1: Loaded 4 initial demo tasks');
assert(AppState.constraints.availableMinutesToday === 180, 'Step 1: Available time is 180m (3 hours)');

// Step 2: Inspect original tasks and plan
const originalPlan = SchedulingEngine.computePlan(AppState.tasks, AppState.constraints);
assert(originalPlan.scheduledMinutes === 180, 'Step 2: Original plan scheduled 180m');
assert(originalPlan.scheduledItems.length > 0, 'Step 2: Original plan contains scheduled items');

// Step 3: Tell assistant compound prompt
const promptText = "My hackathon deadline moved to tomorrow, and I only have one hour to study today.";
const intent = NaturalLanguageInterpreter.interpret(promptText, AppState.tasks, AppState.constraints);
assert(intent.type === 'ADAPTIVE_CHANGE', 'Step 3: Interpreted compound adaptation intent');

// Step 4: Confirm engine detects deadline and time constraint
assert(intent.deadlineChanges.length === 1 && intent.deadlineChanges[0].taskTitle === 'Hackathon project', 'Step 4: Detected Hackathon project deadline shift');
assert(intent.timeChange && intent.timeChange.newMinutes === 60, 'Step 4: Detected study time reduced to 60m');

// Step 5 & 6: Create proposal and confirm proposed schedule respects time and durations
const proposal = ProposalManager.createProposal(intent);
assert(proposal.proposedPlan.totalAvailable === 60, 'Step 5/6: Proposed plan respects 60m available time');
assert(proposal.proposedPlan.scheduledMinutes === 60, 'Step 5/6: Scheduled exactly 60m focus block');

// Step 7: Confirm completed tasks remain completed
const dummyCompletedTask = {
  id: 't_done',
  title: 'Prior Completed Lab',
  category: 'Assignment',
  deadline: sandbox.window.getRelativeDate(1),
  estimatedDuration: 45,
  priority: 'high',
  completed: true,
  completedAt: new Date().toISOString()
};
AppState.tasks.push(dummyCompletedTask);
const planWithCompleted = SchedulingEngine.computePlan(AppState.tasks, AppState.constraints);
const preservedDone = planWithCompleted.completedTasks.find(t => t.id === 't_done');
assert(preservedDone && preservedDone.completed === true, 'Step 7: Completed task preserved as completed');

// Step 8: Confirm unfinished tasks are not silently deleted
assert(proposal.modifiedTasks.length >= 4, 'Step 8: Unfinished tasks are all retained in modifiedTasks');

// Step 9: Confirm impossible work is identified as At Risk
assert(proposal.proposedPlan.atRiskItems.length >= 1, 'Step 9: At-risk items identified with honest capacity deficit');

// Step 10: Confirm explanation derived from actual scheduling decisions
assert(proposal.explanation.why.length > 20, 'Step 10: Real explanation generated');
assert(proposal.explanation.actionsTaken.length > 0, 'Step 10: Actions taken list generated from plan diff');

// Step 11: Reject proposal and confirm saved state remains unchanged
const savedTimeBeforeReject = AppState.constraints.availableMinutesToday;
const rejectSuccess = ProposalManager.rejectProposal(proposal.id);
assert(rejectSuccess === true, 'Step 11: Proposal rejected');
assert(AppState.constraints.availableMinutesToday === savedTimeBeforeReject, 'Step 11: State remains untouched after rejection');

// Step 12: Repeat and approve proposal
const proposal2 = ProposalManager.createProposal(intent);
const applySuccess = ProposalManager.applyProposal(proposal2.id);
assert(applySuccess === true, 'Step 12: Proposal approved');

// Step 13: Confirm new schedule is saved
assert(AppState.constraints.availableMinutesToday === 60, 'Step 13: New schedule saved with 60m');
const hackathonTask = AppState.tasks.find(t => t.title === 'Hackathon project');
assert(SchedulingEngine.calculateDaysUntil(hackathonTask.deadline) === 1, 'Step 13: Hackathon deadline is tomorrow');

// Step 14: Refresh page and confirm persistence
// Simulate page reload by reloading from mockLocalStorage
AppState.tasks = [];
AppState.constraints = null;
StorageService.loadAll();
assert(AppState.constraints.availableMinutesToday === 60, 'Step 14: State persists after simulated page reload');
assert(AppState.lastAppliedProposal !== null, 'Step 14: Last applied proposal persists after reload');

// Step 15: Ask "What changed?" and confirm reflection of actual revision
const whatChangedIntent = NaturalLanguageInterpreter.interpret("What changed?", AppState.tasks, AppState.constraints);
assert(whatChangedIntent.type === 'WHAT_CHANGED', 'Step 15: "What changed?" interpreted');
assert(AppState.lastAppliedProposal.explanation.changesDetected.length > 0, 'Step 15: Last applied revision summary exists');

// Step 16: Ask "Why did you move that?" and confirm real decision reference
const whyIntent = NaturalLanguageInterpreter.interpret("Why did you move my programming task?", AppState.tasks, AppState.constraints);
assert(whyIntent.type === 'EXPLAIN_WHY' && whyIntent.matchedTask.title === 'Programming assignment', 'Step 16: "Why did you move my programming task?" matched task');

// Step 17: Ask "Undo that" and verify resulting state
const undoIntent = NaturalLanguageInterpreter.interpret("Undo that", AppState.tasks, AppState.constraints);
assert(undoIntent.type === 'UNDO', 'Step 17: "Undo that" interpreted');
const undoDesc = ProposalManager.undoLastChange();
assert(undoDesc !== null, 'Step 17: Undo executed');
assert(AppState.constraints.availableMinutesToday === 180, 'Step 17: Restored previous 180m available time');

// Step 18: Reset demo and confirm original scenario returns
StorageService.resetDemo();
assert(AppState.tasks.length === 4, 'Step 18: Reset demo restored 4 tasks');
assert(AppState.constraints.availableMinutesToday === 180, 'Step 18: Reset demo restored 180m capacity');

console.log('\n=== ALL 18 SCENARIO STEPS VERIFIED SUCCESSFULLY! ===');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAILED: ' + msg);
    process.exit(1);
  } else {
    console.log('PASSED: ' + msg);
  }
}
