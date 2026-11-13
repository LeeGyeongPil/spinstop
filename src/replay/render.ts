// replay 결과를 사람이 읽는 표 또는 JSON 으로 만든다.

import type { ReplayResult } from './run.js';
import { MESSAGES, normalizeLang, type Lang } from '../i18n.js';

// Korean (and other East Asian wide) characters take two terminal columns.
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const wide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60);
    width += wide ? 2 : 1;
  }
  return width;
}

const padCell = (cell: string, width: number) => cell + ' '.repeat(Math.max(0, width - displayWidth(cell)));

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((r) => displayWidth(r[col]!))));
  return rows.map((r) => r.map((cell, col) => padCell(cell, widths[col]!)).join('  ').trimEnd()).join('\n');
}

/** Internal: `lang` goes through the same normalization as the CLI flag (default en). */
export function renderTable(result: ReplayResult, file: string, lang: Lang | string = 'en'): string {
  const m = MESSAGES[normalizeLang(lang)];
  const out: string[] = [];
  out.push(m.replayTitle(file));
  out.push(m.summary(result.format === 'jsonl' ? m.formatJsonl : m.formatSteps, result.steps, result.calls));
  out.push('');

  const header = [m.colStep, m.colTool, m.colAction, m.colRule, m.colCount, m.colWouldRun];
  const body = result.rows.map((r) => [
    String(r.step),
    r.toolName,
    r.action,
    r.rule ? r.rule + (r.also ? ` (+${r.also.join(', ')})` : '') : '-',
    r.count !== undefined && r.action !== 'allow' ? String(r.count) : '-',
    r.wouldRun ? m.yes : m.no,
  ]);
  for (const e of result.stepEvents) {
    body.push([String(e.step), m.stepEnd, e.action, e.rule, String(e.count), '-']);
  }
  // step 순으로, 같은 step 안에서는 호출 다음에 step 끝 판정
  body.sort((a, b) => Number(a[0]) - Number(b[0]));
  out.push(table([header, ...body]));
  out.push('');

  if (result.worst === 'allow') {
    out.push(m.noLoop);
    return out.join('\n');
  }

  const at = (n?: number) => (n === undefined ? '-' : m.atStep(n));
  out.push(m.firstLine(at(result.firstIntervention), at(result.firstBlock), at(result.stopStep)));
  out.push(m.saved(result.saved, result.calls));

  // 처음 걸린 block·stop 의 메시지를 보여 준다(모델이 받았을 글).
  const firstHard = result.rows.find((r) => r.action === 'block' || r.action === 'stop');
  if (firstHard?.message) out.push(m.messageAt(firstHard.step, firstHard.message));
  return out.join('\n');
}

export function renderJson(result: ReplayResult, file: string): string {
  return JSON.stringify({ file, ...result }, null, 2);
}
