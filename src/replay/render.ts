// replay 결과를 사람이 읽는 표 또는 JSON 으로 만든다.

import type { ReplayResult } from './run.js';

const FORMAT_LABEL = { 'ai-sdk-steps': 'AI SDK steps', jsonl: 'JSONL records' } as const;

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((r) => r[col]!.length)));
  return rows.map((r) => r.map((cell, col) => cell.padEnd(widths[col]!)).join('  ').trimEnd()).join('\n');
}

export function renderTable(result: ReplayResult, file: string): string {
  const out: string[] = [];
  out.push(`spinstop replay: ${file}`);
  out.push(`${FORMAT_LABEL[result.format]} · ${result.steps} steps · ${result.calls} tool calls`);
  out.push('');

  const header = ['step', 'tool', 'action', 'rule', 'count', 'would run'];
  const body = result.rows.map((r) => [
    String(r.step),
    r.toolName,
    r.action,
    r.rule ? r.rule + (r.also ? ` (+${r.also.join(', ')})` : '') : '-',
    r.count !== undefined && r.action !== 'allow' ? String(r.count) : '-',
    r.wouldRun ? 'yes' : 'no',
  ]);
  for (const e of result.stepEvents) {
    body.push([String(e.step), '(step end)', e.action, e.rule, String(e.count), '-']);
  }
  // step 순으로, 같은 step 안에서는 호출 다음에 step 끝 판정
  body.sort((a, b) => Number(a[0]) - Number(b[0]));
  out.push(table([header, ...body]));
  out.push('');

  if (result.worst === 'allow') {
    out.push('no loop detected');
    return out.join('\n');
  }

  const at = (n?: number) => (n === undefined ? '-' : `step ${n}`);
  out.push(`first intervention: ${at(result.firstIntervention)} · first block: ${at(result.firstBlock)} · stop: ${at(result.stopStep)}`);
  out.push(`saved ${result.saved} of ${result.calls} executions (calls the guard would not have run)`);

  // 처음 걸린 block·stop 의 메시지를 보여 준다(모델이 받았을 글).
  const firstHard = result.rows.find((r) => r.action === 'block' || r.action === 'stop');
  if (firstHard?.message) out.push(`message at step ${firstHard.step}: ${firstHard.message}`);
  return out.join('\n');
}

export function renderJson(result: ReplayResult, file: string): string {
  return JSON.stringify({ file, ...result }, null, 2);
}
