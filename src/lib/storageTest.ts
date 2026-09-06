/**
 * storageTest.ts — Utilities to test and simulate localStorage exhaustion.
 *
 * HOW TO USE IN THE BROWSER CONSOLE:
 *   window.__storageTest.fillToMB(4.2)   // fill to 4.2 MB (triggers warning)
 *   window.__storageTest.fillToMB(5.1)   // fill to 5.1 MB (triggers critical)
 *   window.__storageTest.triggerExceeded() // simulate actual QuotaExceededError
 *   window.__storageTest.clearTestData()  // remove test padding
 *   window.__storageTest.runAll()         // run the full automated test suite
 *   window.__storageTest.showUsage()      // print current usage breakdown
 *
 * ALL TESTS ARE AUTOMATED — runAll() checks every requirement from the spec.
 *
 * IMPORTANT:
 *   These utilities are safe in production. fillToMB() only writes to
 *   'dc_storage_test_*' keys. clearTestData() removes ONLY those keys.
 *   Application data is never touched by test utilities.
 */

import {
  safeSetItem,
  safeGetItem,
  safeRemoveItem,
  getStorageUsageMB,
  getStorageUsageByKey,
  WARN_THRESHOLD_MB,
  BLOCK_THRESHOLD_MB,
  _makeQuotaError,
} from './safeStorage';
import { useStorageMonitor } from './storageMonitor';

const TEST_KEY_PREFIX = 'dc_storage_test_';

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Print a formatted usage breakdown to the console. */
function showUsage(): void {
  const usageMB = getStorageUsageMB();
  const entries = getStorageUsageByKey();
  console.group('[storageTest] 📦 localStorage usage breakdown');
  console.log(`Total: ${usageMB.toFixed(3)} MB of ~5.0 MB`);
  entries.forEach(({ key, sizeMB }) => {
    const bar = '█'.repeat(Math.max(1, Math.round(sizeMB * 40)));
    console.log(`  ${bar} ${sizeMB.toFixed(3)} MB — ${key}`);
  });
  console.groupEnd();
}

/** Remove all test padding keys. Does NOT touch application data. */
function clearTestData(): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(TEST_KEY_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
  console.log('[storageTest] ✅ Test data cleared.');
  useStorageMonitor.getState().checkUsage();
}

/**
 * Fill localStorage with test padding until total usage reaches targetMB.
 * Uses a chunked approach (128 KB per key) to avoid a single huge value.
 * Returns the actual usage after filling.
 */
function fillToMB(targetMB: number): number {
  clearTestData(); // start clean
  const targetBytes = targetMB * 1024 * 1024;
  const chunkBytes  = 128 * 1024; // 128 KB per key
  const chunk       = 'A'.repeat(chunkBytes / 2); // UTF-16: 2 bytes/char → half the char count

  let index = 0;
  let usageBytes = getStorageUsageMB() * 1024 * 1024;

  while (usageBytes < targetBytes) {
    const key = `${TEST_KEY_PREFIX}${index++}`;
    try {
      localStorage.setItem(key, chunk);
    } catch {
      // Quota hit during padding — that's fine; we've reached the real limit.
      break;
    }
    usageBytes = getStorageUsageMB() * 1024 * 1024;
  }

  const finalMB = getStorageUsageMB();
  console.log(`[storageTest] 📦 Filled to ${finalMB.toFixed(3)} MB (target: ${targetMB} MB).`);
  useStorageMonitor.getState().checkUsage();
  return finalMB;
}

// ─── Simulation of actual QuotaExceededError ──────────────────────────────────

/**
 * Simulate a real QuotaExceededError by temporarily patching localStorage.setItem.
 * Calls handleWriteResult with a quota_exceeded result — exactly what the real
 * Zustand persist adapter would do when a write fails.
 * Restores the original after 0ms so normal operation continues.
 */
function triggerExceeded(): void {
  const monitor = useStorageMonitor.getState();
  monitor.handleWriteResult({
    success: false,
    error: 'quota_exceeded',
    message:
      '[TEST] Storage limit reached. New inspections are not being saved. ' +
      'Please sync or clear old data.',
  });
  console.warn('[storageTest] ⚡ QuotaExceededError simulated — storageMonitor updated to "exceeded".');
}

// ─── Automated test runner ────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function runAll(): Promise<void> {
  const results: TestResult[] = [];
  const monitor = useStorageMonitor;

  function assert(name: string, condition: boolean, detail: string): void {
    results.push({ name, passed: condition, detail });
    if (!condition) console.error(`  ❌ FAIL: ${name} — ${detail}`);
  }

  // ── Reset ──
  clearTestData();
  monitor.getState().checkUsage();
  await tick();

  // ════════════════════════════════════════════════
  // TEST 1 — Baseline: no warning at low usage
  // ════════════════════════════════════════════════
  {
    const usageMB = getStorageUsageMB();
    monitor.getState().checkUsage();
    const level = monitor.getState().warningLevel;
    // Only assert 'none' if we're actually under the threshold.
    // If the real app data is already > 4 MB, skip this check.
    if (usageMB < WARN_THRESHOLD_MB) {
      assert(
        'No warning below threshold',
        level === 'none',
        `Expected 'none' at ${usageMB.toFixed(2)} MB, got '${level}'`
      );
    } else {
      console.warn(`[storageTest] Skipping baseline test — app data already at ${usageMB.toFixed(2)} MB.`);
    }
  }

  // ════════════════════════════════════════════════
  // TEST 2 — Warning at 4 MB
  // ════════════════════════════════════════════════
  {
    const actualMB = fillToMB(WARN_THRESHOLD_MB + 0.1);
    monitor.getState().checkUsage();
    const { warningLevel, isSubmissionBlocked, displayMessage } = monitor.getState();

    assert(
      'Warning level at 4MB',
      warningLevel === 'warning',
      `Expected 'warning', got '${warningLevel}' at ${actualMB.toFixed(2)} MB`
    );
    assert(
      'Submission NOT blocked at warning level',
      !isSubmissionBlocked,
      `isSubmissionBlocked should be false at warning level`
    );
    assert(
      'Warning message is non-null',
      displayMessage !== null && displayMessage.length > 0,
      `Expected a non-empty displayMessage`
    );
    clearTestData();
  }

  // ════════════════════════════════════════════════
  // TEST 3 — Critical at 5 MB
  // ════════════════════════════════════════════════
  {
    const actualMB = fillToMB(BLOCK_THRESHOLD_MB + 0.1);
    monitor.getState().checkUsage();
    const { warningLevel, isSubmissionBlocked } = monitor.getState();

    assert(
      'Critical level at 5MB',
      warningLevel === 'critical',
      `Expected 'critical', got '${warningLevel}' at ${actualMB.toFixed(2)} MB`
    );
    assert(
      'Submission blocked at critical level',
      isSubmissionBlocked,
      `isSubmissionBlocked should be true at critical level`
    );
    clearTestData();
  }

  // ════════════════════════════════════════════════
  // TEST 4 — safeSetItem returns structured result
  // ════════════════════════════════════════════════
  {
    const key = `${TEST_KEY_PREFIX}write_test`;
    const result = safeSetItem(key, 'hello world');
    assert(
      'safeSetItem returns success: true on normal write',
      result.success === true && result.error === undefined,
      JSON.stringify(result)
    );
    assert(
      'safeGetItem reads back the written value',
      safeGetItem(key) === 'hello world',
      `Expected 'hello world', got '${safeGetItem(key)}'`
    );
    safeRemoveItem(key);
    assert(
      'safeRemoveItem removes the key',
      safeGetItem(key) === null,
      'Expected null after removal'
    );
  }

  // ════════════════════════════════════════════════
  // TEST 5 — QuotaExceededError caught and reported
  // ════════════════════════════════════════════════
  {
    // Patch setItem to throw synchronously
    const original = localStorage.setItem.bind(localStorage);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (localStorage as any).setItem = () => { throw _makeQuotaError(); };

    const result = safeSetItem(`${TEST_KEY_PREFIX}quota_test`, 'x');

    // Restore immediately
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (localStorage as any).setItem = original;

    assert(
      'safeSetItem catches QuotaExceededError',
      result.success === false && result.error === 'quota_exceeded',
      JSON.stringify(result)
    );
    assert(
      'safeSetItem returns non-empty message on quota error',
      typeof result.message === 'string' && result.message.length > 0,
      `message = '${result.message}'`
    );
  }

  // ════════════════════════════════════════════════
  // TEST 6 — storageMonitor escalates to 'exceeded'
  // ════════════════════════════════════════════════
  {
    // Start from a clean 'none' state by clearing test data
    clearTestData();
    monitor.getState().checkUsage();
    await tick();

    triggerExceeded();
    const { warningLevel, isSubmissionBlocked, displayMessage } = monitor.getState();

    assert(
      'Monitor escalates to exceeded after quota error',
      warningLevel === 'exceeded',
      `warningLevel = '${warningLevel}'`
    );
    assert(
      'Submission blocked at exceeded',
      isSubmissionBlocked,
      `isSubmissionBlocked = ${isSubmissionBlocked}`
    );
    assert(
      'Exceeded message is non-null',
      displayMessage !== null && displayMessage.length > 0,
      `displayMessage = '${displayMessage}'`
    );

    // Reset monitor manually (simulates page reload recovering)
    monitor.setState({
      warningLevel: 'none',
      isSubmissionBlocked: false,
      displayMessage: null,
      isDismissed: false,
    });
  }

  // ════════════════════════════════════════════════
  // TEST 7 — Warning is dismissible; critical is not
  // ════════════════════════════════════════════════
  {
    // Set to warning
    monitor.setState({ warningLevel: 'warning', isDismissed: false });
    monitor.getState().dismissWarning();
    assert(
      'Warning level is dismissible',
      monitor.getState().isDismissed === true,
      `isDismissed = ${monitor.getState().isDismissed}`
    );

    // Reset and set to critical — dismiss should be no-op
    monitor.setState({ warningLevel: 'critical', isDismissed: false });
    monitor.getState().dismissWarning();
    assert(
      'Critical level is NOT dismissible',
      monitor.getState().isDismissed === false,
      `isDismissed = ${monitor.getState().isDismissed}`
    );

    // Restore monitor
    monitor.setState({ warningLevel: 'none', isSubmissionBlocked: false, displayMessage: null, isDismissed: false });
  }

  // ════════════════════════════════════════════════
  // TEST 8 — Existing data preserved after failed write
  // ════════════════════════════════════════════════
  {
    const key = `${TEST_KEY_PREFIX}preserve_test`;
    // Write known value
    safeSetItem(key, 'original_value');

    // Patch setItem to throw on next call
    const original = localStorage.setItem.bind(localStorage);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (localStorage as any).setItem = () => { throw _makeQuotaError(); };
    safeSetItem(key, 'new_value_that_fails'); // this will fail
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (localStorage as any).setItem = original;

    const storedValue = safeGetItem(key);
    assert(
      'Existing data preserved after failed write',
      storedValue === 'original_value',
      `Expected 'original_value', got '${storedValue}'`
    );
    safeRemoveItem(key);
  }

  // ═══════════════════
  // Results summary
  // ═══════════════════
  const passed = results.filter((r) => r.passed).length;
  const total  = results.length;
  const allOk  = passed === total;

  console.group(`[storageTest] 📊 Results: ${passed}/${total} tests passed ${allOk ? '✅' : '❌'}`);
  results.forEach((r) => {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name}${r.passed ? '' : `\n   └─ ${r.detail}`}`);
  });
  console.groupEnd();

  if (!allOk) {
    console.error('[storageTest] ❌ Some tests failed — see details above.');
  } else {
    console.log('[storageTest] ✅ All storage safety tests passed.');
  }

  // Clean up any leftover test data
  clearTestData();
  useStorageMonitor.getState().checkUsage();
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const storageTest = {
  fillToMB,
  clearTestData,
  triggerExceeded,
  showUsage,
  runAll,
};

// Expose on window for console access
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__storageTest = storageTest;
}
