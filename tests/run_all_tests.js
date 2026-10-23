/**
 * AimFlow AI — Master Test Suite Runner
 * Runs all 5 test suites sequentially and reports aggregate test metrics.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const testSuites = [
  'tests/test_suite.js',
  'tests/audit_scenario_test.js',
  'tests/run_logic_tests.js',
  'tests/voice_input_test.js',
  'tests/ai_intelligence_test.js'
];

console.log('\n======================================================');
console.log('🚀 Running AimFlow AI Master Test Suite');
console.log('======================================================\n');

let allPassed = true;
const results = [];

for (const suite of testSuites) {
  const fullPath = path.resolve(__dirname, '..', suite);
  console.log(`\n▶️  Running ${suite}...`);
  const startTime = Date.now();

  const child = spawnSync(process.execPath, [fullPath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    stdio: 'inherit'
  });

  const durationMs = Date.now() - startTime;
  const passed = child.status === 0;
  results.push({ suite, passed, durationMs, exitCode: child.status });

  if (!passed) {
    allPassed = false;
    console.error(`\n❌ ${suite} failed with exit code ${child.status}`);
  }
}

console.log('\n======================================================');
console.log('📊 MASTER TEST SUMMARY:');
console.log('======================================================');

results.forEach(r => {
  const icon = r.passed ? '✅' : '❌';
  console.log(`${icon} ${r.suite.padEnd(35)} [${r.durationMs}ms]`);
});

if (allPassed) {
  console.log('\n🎉 ALL 5 TEST SUITES PASSED FLAWLESSLY!\n');
  process.exit(0);
} else {
  console.error('\n💥 SOME TESTS FAILED!\n');
  process.exit(1);
}
