// Core API only: no model, no framework, no network.
// Run: node examples/quickstart-core.mjs  (after `npm run build`)

import { createLoopGuard } from 'spinstop';

const guard = createLoopGuard();
const call = { toolName: 'send_email', input: { to: 'team@example.com', subject: 'Weekly report' } };

for (let i = 1; i <= 5; i++) {
  const verdict = guard.check(call); // judge BEFORE running the tool
  console.log(`call ${i}: ${verdict.action}${verdict.rule ? ` (${verdict.rule} x${verdict.count})` : ''}`);
  if (verdict.action === 'block' || verdict.action === 'stop') {
    guard.record(call, { blocked: true }); // the tool did not run
  } else {
    guard.record(call, { output: { status: 'sent' } }); // run the tool, then record its result
  }
}

console.log('stats:', JSON.stringify(guard.stats()));
