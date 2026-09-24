import { CONTENT_SOURCES } from './bundle';
import { ContentInput } from './schema';
import { formatIssues, validateContent } from './validate-content';

/**
 * KB-R5-05 第 1 點：content/README.md 的範例必須能通過目前的內容驗證。
 * 以下 JSON 與 README 對應段落逐字相同；改 README 範例時要同步改這裡（反之亦然）。
 * 範例只是結構示意（文字都標「範例」），不是正式內容。
 */

function clone(): ContentInput {
  return JSON.parse(JSON.stringify(CONTENT_SOURCES)) as ContentInput;
}

function obj(root: unknown, ...path: (string | number)[]): Record<string, unknown> {
  let cur: unknown = root;
  for (const part of path) cur = (cur as Record<string, unknown>)[String(part)];
  return cur as Record<string, unknown>;
}

/** README「新增訊息」的範例。 */
const README_MESSAGE_EXAMPLE = {
  id: 'msg.day2.example',
  channelId: 'channel.dm.lin-yuan',
  actorId: 'actor.lin-yuan',
  time: '09:15',
  visibleFrom: 'day.02',
  unlock: [],
  lines: ['範例：第一段。', '範例：第二段。'],
};

/** README「新增訊息」帶 variant 的範例（放在 day-03；Day 2 的 0／1 已被既有訊息用掉）。 */
const README_VARIANT_EXAMPLE = {
  id: 'msg.day3.example-variant',
  channelId: 'channel.dm.lin-yuan',
  actorId: 'actor.lin-yuan',
  time: '09:16',
  visibleFrom: 'day.03',
  unlock: ['cond.night.smalltalk.0'],
  variant: { key: 'night.smallTalkVariant', value: 0 },
  lines: ['範例：只有版本 0 會看到這句。'],
};

/** README「固定回覆（replyPrompt）」的範例（放在 day-05）。 */
const README_REPLY_PROMPT_EXAMPLE = {
  id: 'msg.day5.example-ask',
  channelId: 'channel.group.lunch-chat',
  actorId: 'actor.wu-wan-ting',
  time: '12:30',
  visibleFrom: 'day.05',
  unlock: [],
  lines: ['範例：要不要一起去買飲料？'],
  replyPrompt: {
    id: 'prompt.day5.example-drink',
    availableThrough: 'day.05',
    choices: [
      {
        id: 'yes',
        text: '範例：好啊。',
        responses: [
          { id: 'msg.day5.reply.example-yes', actorId: 'actor.wu-wan-ting', time: '12:31', lines: ['範例：那我先下樓。'] },
        ],
      },
      {
        id: 'no',
        text: '範例：我今天先不用。',
        responses: [
          { id: 'msg.day5.reply.example-no', actorId: 'actor.yang-zi-qian', time: '12:31', lines: ['範例：我也不用。'] },
        ],
      },
    ],
  },
};

/** README「條件」的聊天回覆條件範例（放在 day-05；引用 Day 3 午餐 prompt）。 */
const README_CHAT_CONDITION_EXAMPLE = {
  id: 'msg.day5.example-chat',
  channelId: 'channel.dm.wu-wan-ting',
  actorId: 'actor.wu-wan-ting',
  time: '09:30',
  visibleFrom: 'day.05',
  unlock: ['cond.chat.day3.lunch-plan.brought-own'],
  lines: ['範例：Day 3 回答「我自己帶了」時才看到這句。'],
};

/** README「新增頻道」的範例。 */
const README_CHANNEL_EXAMPLE = {
  id: 'channel.group.example',
  kind: 'group',
  title: '範例：頻道名稱',
  topic: '範例：頻道說明',
  actorIds: ['actor.lin-yuan'],
};

/** README「條件」的批次覆核範例（放在 day-05；引用 Day 4 的批次）。 */
const README_REVIEW_EXAMPLE = {
  id: 'msg.day5.example-review',
  channelId: 'channel.group.lunch-chat',
  actorId: 'actor.wu-wan-ting',
  time: '09:20',
  visibleFrom: 'day.05',
  unlock: ['cond.review.any.batch.day04.archive'],
  lines: ['範例：Day 4 批次至少一筆送覆核時才看到這句。'],
};

/** README「新增一天」第 2 步：前一日（day-06）從結束轉場換成日結轉場的 text。 */
const README_PREVIOUS_DAY_WRAP_TRANSITION_TEXT = {
  docTitle: '範例：第六日交接完成',
  eyebrow: 'DAY / 06 — COMPLETE',
  heading: '範例：本日匯入已完成。',
  body: '範例：今日資料已完成交接。',
  backToCover: '範例：返回開始頁',
};

/** README「工作進度解鎖（unlockAfter）」的範例（放在 day-05；引用當日批次）。 */
const README_UNLOCK_AFTER_EXAMPLE = {
  id: 'msg.day5.example-progress',
  channelId: 'channel.group.lunch-chat',
  actorId: 'actor.yang-zi-qian',
  time: '11:20',
  visibleFrom: 'day.05',
  unlock: [],
  unlockAfter: { archiveBatchId: 'batch.day05.archive', archivedCount: 3 },
  lines: ['範例：本日批次提交 3 筆後才看到這句。'],
};

/** README「新增一天」的完整範例（day-07.json）。 */
const README_DAY_EXAMPLE = {
  id: 'day.07',
  day: 7,
  nextDayId: null,
  chatDateLabel: '範例：9 月 23 日',
  workbench: { greeting: '範例：第七日問候。', workHeading: '範例：今日工作' },
  aside: { heading: '範例：側欄標題', body: '範例：側欄說明。' },
  records: [
    { id: 'record.day7-x01', key: 'X01', name: null, code: '0701', refusal: null, refusalApplies: true },
  ],
  documents: [],
  tasks: [
    {
      id: 'task.day7.archive',
      kind: 'archive',
      batchId: 'batch.day07.archive',
      recordIds: ['record.day7-x01'],
      documentIds: [],
      text: {
        eyebrow: 'ARCHIVE / BATCH 07',
        heading: '範例：任務標題',
        instruction: '範例：任務說明。',
      },
    },
  ],
  messages: [
    {
      id: 'msg.day7.example',
      channelId: 'channel.department.data-ops',
      actorId: 'actor.lin-yuan',
      time: '09:15',
      visibleFrom: 'day.07',
      unlock: [],
      lines: ['範例：第七日訊息。'],
    },
  ],
  transition: {
    id: 'transition.day7.end',
    text: {
      docTitle: '範例：結束',
      eyebrow: 'DAY / 07 — COMPLETE',
      heading: '範例：結束標題',
      body: '範例：結束內文。',
      summary: '範例：摘要',
      thanks: '範例：感謝',
      outro: '範例：結語',
      backToCover: '範例：返回開始頁',
    },
  },
};

/** README「任務與批次」的 field-map 任務範例（替換範例 day-07 的任務）。 */
const README_FIELD_MAP_TASK_EXAMPLE = {
  id: 'task.day7.field-map',
  kind: 'field-map',
  recordIds: [],
  documentIds: [],
  sourceFields: [
    { id: 'old-code', label: '範例：舊編號' },
    { id: 'old-flag', label: '範例：舊旗標' },
  ],
  targetFields: [
    { id: 'new-code', label: '範例：新編號', sourceId: 'old-code', convert: 'text' },
    { id: 'new-flag', label: '範例：新旗標', sourceId: 'old-flag', convert: 'boolean', trueValue: '是', falseValue: '否' },
  ],
  rows: [
    { id: 'row.0701', values: { 'old-code': '0701', 'old-flag': '是' } },
    { id: 'row.0702', values: { 'old-code': '0702', 'old-flag': '' } },
  ],
  text: {
    eyebrow: 'IMPORT / MAPPING 07',
    heading: '範例：任務標題',
    instruction: '範例：任務說明。',
    policyDefault: '範例：轉為 false',
    policyReview: '範例：保留 null',
  },
};

/** README「條件」的案件條件範例（放在 day-05；引用 Day 3 案件的 review 決定）。 */
const README_CASE_CONDITION_EXAMPLE = {
  id: 'msg.day5.example-case',
  channelId: 'channel.dm.lin-yuan',
  actorId: 'actor.lin-yuan',
  time: '09:40',
  visibleFrom: 'day.05',
  unlock: ['cond.case.day3.h204.review'],
  lines: ['範例：Day 3 案件選了 review 時才看到這句。'],
};

/** README「比對案件（caseReview）」的文件範例（替換範例 day-07 的 documents）。 */
const README_CASE_DOCUMENTS_EXAMPLE = [
  { id: 'doc.day7.x01.form', kind: 'case-source', recordIds: ['record.day7-x01'], text: { heading: '範例：原表', fields: [{ label: '範例：編號', value: '0701' }] } },
  { id: 'doc.day7.x01.update', kind: 'case-source', recordIds: ['record.day7-x01'], text: { heading: '範例：補件', fields: [{ label: '範例：編號', value: '0710' }] } },
  { id: 'doc.day7.x01.status-a', kind: 'case-source', recordIds: ['record.day7-x01'], text: { heading: '範例：收件狀態', fields: [{ label: '範例：狀態', value: '範例：已收件' }] } },
  { id: 'doc.day7.x01.status-b', kind: 'case-source', recordIds: ['record.day7-x01'], text: { heading: '範例：收件狀態', fields: [{ label: '範例：狀態', value: '範例：待回傳' }] } },
];

/** README「比對案件（caseReview）」的任務範例（替換範例 day-07 的 tasks[0]）。 */
const README_CASE_TASK_EXAMPLE = {
  id: 'task.day7.archive',
  kind: 'archive',
  batchId: 'batch.day07.archive',
  recordIds: ['record.day7-x01'],
  documentIds: ['doc.day7.x01.form', 'doc.day7.x01.update', 'doc.day7.x01.status-a', 'doc.day7.x01.status-b'],
  text: {
    eyebrow: 'ARCHIVE / BATCH 07',
    heading: '範例：任務標題',
    instruction: '範例：任務說明。',
  },
  caseReview: {
    id: 'case.day7.x01',
    recordId: 'record.day7-x01',
    sourceDocumentIds: ['doc.day7.x01.form', 'doc.day7.x01.update'],
    receiptVariants: [
      { id: 'a', documentId: 'doc.day7.x01.status-a' },
      { id: 'b', documentId: 'doc.day7.x01.status-b' },
    ],
    decisions: [
      { id: 'form', label: '範例：依原表', archiveCode: '0701', destination: 'archive', basisDocumentId: 'doc.day7.x01.form', note: '範例：採用原表。' },
      { id: 'update', label: '範例：依補件', archiveCode: '0710', destination: 'archive', basisDocumentId: 'doc.day7.x01.update', note: '範例：採用補件。' },
      { id: 'hold', label: '範例：送待查', archiveCode: '0701', destination: 'review', basisDocumentId: 'doc.day7.x01.form', note: '範例：待確認。' },
    ],
  },
};

/** README「條件」的退件條件範例（放在 day-05；引用 Day 2 核對的稽核，通知日 Day 3）。 */
const README_RETURN_CONDITION_EXAMPLE = {
  id: 'msg.day5.example-return',
  channelId: 'channel.dm.lin-yuan',
  actorId: 'actor.lin-yuan',
  time: '09:50',
  visibleFrom: 'day.05',
  unlock: ['cond.return.notified.day1-code-audit'],
  lines: ['範例：Day 1 批次有退件時才看到這句。'],
};

/** README「退件稽核與錯誤文件處理」的 returnAudit（正式資料 task.day2.reconcile 的同一份）。 */
const README_RETURN_AUDIT_EXAMPLE = {
  id: 'day1-code-audit',
  notifyDayId: 'day.03',
  reviewTaskId: 'task.day4.return-review',
  caseNumberTemplate: 'RT-{key}',
};

/** README「退件稽核與錯誤文件處理」的最小寫法：省略 reviewTaskId（R11）。 */
const README_RETURN_AUDIT_MINIMAL_EXAMPLE = { id: 'day1-code-audit', notifyDayId: 'day.03', caseNumberTemplate: 'RT-{key}' };

/** README「退件稽核與錯誤文件處理」的最小寫法：return-review 省略 auditId（R11）。 */
const README_ISSUE_TASK_MINIMAL_EXAMPLE = {
  id: 'task.day4.return-review',
  kind: 'return-review',
  recordIds: [],
  documentIds: [],
  text: { eyebrow: 'RETURN / REVIEW 04' },
};

/** README「退件稽核與錯誤文件處理」的 return-review 任務（正式資料 day-04 的同一份）。 */
const README_RETURN_REVIEW_TASK_EXAMPLE = {
  id: 'task.day4.return-review',
  kind: 'return-review',
  auditId: 'day1-code-audit',
  recordIds: [],
  documentIds: [],
  text: { eyebrow: 'RETURN / REVIEW 04' },
};

const DAY2 = 1;
const DAY3 = 2;
const DAY4 = 3;
const DAY5 = 4;
const DAY6 = 5;
const DAY7 = 6;

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** README「新增一天」的步驟：新檔（manifest 另加一行）、前一日的 nextDayId 與日結轉場、ui 的 dayName。 */
function addExampleDay(input: ContentInput): void {
  input.days.push({ file: 'data/days/day-07.json', data: copy(README_DAY_EXAMPLE) });
  obj(input.days[DAY6].data)['nextDayId'] = 'day.07';
  obj(input.days[DAY6].data, 'transition')['text'] = copy(README_PREVIOUS_DAY_WRAP_TRANSITION_TEXT);
  obj(input.ui.data, 'workbench', 'dayName')['7'] = '七';
}

describe('README 範例可通過目前的內容驗證（KB-R5-05 第 1 點）', () => {
  it('新增訊息範例', () => {
    const input = clone();
    (obj(input.days[DAY2].data)['messages'] as unknown[]).push(README_MESSAGE_EXAMPLE);
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });

  it('新增帶 variant 的訊息範例（放在 day-03）', () => {
    const input = clone();
    (obj(input.days[DAY3].data)['messages'] as unknown[]).push(README_VARIANT_EXAMPLE);
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });

  it('同一天、同一頻道重複 variant value 會被擋下（Day 2 的 0 已被既有訊息使用）', () => {
    const input = clone();
    const dup = { ...README_VARIANT_EXAMPLE, id: 'msg.day2.example-variant', visibleFrom: 'day.02' };
    (obj(input.days[DAY2].data)['messages'] as unknown[]).push(dup);
    const issues = validateContent(input);
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('messages[4].variant');
    expect(issues[0].message).toContain('已由 msg.day2.smalltalk-printer 使用');
  });

  it('固定回覆範例（day-05）', () => {
    const input = clone();
    (obj(input.days[DAY5].data)['messages'] as unknown[]).push(copy(README_REPLY_PROMPT_EXAMPLE));
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });

  it('固定回覆範例的回應若另存 channelId，或回應者不是頻道成員，會被擋下', () => {
    const input = clone();
    const bad = copy(README_REPLY_PROMPT_EXAMPLE);
    const response = bad.replyPrompt.choices[0].responses[0] as Record<string, unknown>;
    response['channelId'] = 'channel.group.lunch-chat';
    bad.channelId = 'channel.dm.lin-yuan';
    bad.actorId = 'actor.lin-yuan';
    (obj(input.days[DAY5].data)['messages'] as unknown[]).push(bad);
    const issues = validateContent(input);
    expect(issues.map((i) => i.message)).toEqual(
      jasmine.arrayWithExactContents([
        jasmine.stringContaining('回應繼承 anchor 訊息的 channelId'),
        jasmine.stringContaining('不是頻道 channel.dm.lin-yuan 的成員'),
        jasmine.stringContaining('不是頻道 channel.dm.lin-yuan 的成員'),
      ]),
    );
  });

  it('聊天回覆條件範例（day-05 引用 Day 3 午餐 prompt）', () => {
    const input = clone();
    (obj(input.days[DAY5].data)['messages'] as unknown[]).push(README_CHAT_CONDITION_EXAMPLE);
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });

  it('新增頻道範例；group 缺 topic 會被擋下', () => {
    const input = clone();
    (obj(input.channels.data)['channels'] as unknown[]).push(copy(README_CHANNEL_EXAMPLE));
    const ok = validateContent(input);
    expect(ok.length).withContext(formatIssues(ok)).toBe(0);
    const noTopic = clone();
    const { topic: _omit, ...rest } = README_CHANNEL_EXAMPLE;
    (obj(noTopic.channels.data)['channels'] as unknown[]).push(rest);
    const issues = validateContent(noTopic);
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('channels[4].topic');
  });

  it('新增一天時漏掉 chatDateLabel 會被擋下', () => {
    const input = clone();
    addExampleDay(input);
    delete obj(input.days[DAY7].data)['chatDateLabel'];
    const issues = validateContent(input);
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('day.07');
    expect(issues[0].field).toBe('chatDateLabel');
  });

  it('批次覆核條件範例（day-05 引用 Day 4 批次）', () => {
    const input = clone();
    (obj(input.days[DAY5].data)['messages'] as unknown[]).push(README_REVIEW_EXAMPLE);
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });

  it('批次覆核條件引用當日批次會被擋下', () => {
    const input = clone();
    const sameDay = { ...README_REVIEW_EXAMPLE, unlock: ['cond.review.any.batch.day05.archive'] };
    (obj(input.days[DAY5].data)['messages'] as unknown[]).push(sameDay);
    const issues = validateContent(input);
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('必須早於訊息的 visibleFrom');
  });

  it('新增一天範例（day-07.json ＋ day-06 的 nextDayId 與日結轉場 ＋ ui 的 dayName.7）', () => {
    const input = clone();
    addExampleDay(input);
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });

  it('field-map 任務範例（替換範例 day-07 的任務）', () => {
    const input = clone();
    addExampleDay(input);
    obj(input.days[DAY7].data)['tasks'] = [copy(README_FIELD_MAP_TASK_EXAMPLE)];
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });

  it('新增一天時忘了把前一日的結束轉場換成日結轉場會被擋下', () => {
    const input = clone();
    addExampleDay(input);
    obj(input.days[DAY6].data, 'transition')['text'] = copy(obj(CONTENT_SOURCES.days[DAY6].data, 'transition')['text']);
    const issues = validateContent(input);
    expect(issues.map((i) => i.field)).toEqual(
      jasmine.arrayWithExactContents(['transition.text.summary', 'transition.text.thanks', 'transition.text.outro']),
    );
    expect(issues.every((i) => i.id === 'transition.day6.end')).toBeTrue();
  });

  it('新增一天時漏掉 ui 的 dayName.7 會被擋下', () => {
    const input = clone();
    addExampleDay(input);
    delete obj(input.ui.data, 'workbench', 'dayName')['7'];
    const issues = validateContent(input);
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('workbench.dayName.7');
  });

  it('新增一天時把前一日 nextDayId 打錯會被擋下', () => {
    const input = clone();
    addExampleDay(input);
    obj(input.days[DAY6].data)['nextDayId'] = 'day.7';
    const issues = validateContent(input);
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('找不到日別 day.7');
  });

  it('範例 day.07 若不是最後一日（有 nextDayId）就必須換成日結轉場的形狀', () => {
    const input = clone();
    addExampleDay(input);
    obj(input.days[DAY7].data)['nextDayId'] = 'day.01';
    const issues = validateContent(input);
    expect(issues.map((i) => i.field)).toEqual(
      jasmine.arrayWithExactContents(['transition.text.summary', 'transition.text.thanks', 'transition.text.outro']),
    );
  });

  it('工作進度解鎖範例（day-05 引用當日批次）', () => {
    const input = clone();
    (obj(input.days[DAY5].data)['messages'] as unknown[]).push(copy(README_UNLOCK_AFTER_EXAMPLE));
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });

  it('工作進度解鎖的筆數超過批次（Day 5 為 8 筆）會被擋下', () => {
    const input = clone();
    const bad = copy(README_UNLOCK_AFTER_EXAMPLE);
    bad.unlockAfter.archivedCount = 9;
    (obj(input.days[DAY5].data)['messages'] as unknown[]).push(bad);
    const issues = validateContent(input);
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('超過批次 batch.day05.archive 的筆數（8 筆）');
  });

  it('一天多項工作範例：day-07 先 archive 再 field-map（README「任務與批次」）', () => {
    const input = clone();
    addExampleDay(input);
    const tasks = obj(input.days[DAY7].data)['tasks'] as unknown[];
    tasks.push(copy(README_FIELD_MAP_TASK_EXAMPLE));
    expect((tasks as { id: string }[]).map((t) => t.id)).toEqual(['task.day7.archive', 'task.day7.field-map']);
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });
  it('案件條件範例（day-05 引用 Day 3 案件）；引用當日（day-03）會被擋下', () => {
    const input = clone();
    (obj(input.days[DAY5].data)['messages'] as unknown[]).push(copy(README_CASE_CONDITION_EXAMPLE));
    const ok = validateContent(input);
    expect(ok.length).withContext(formatIssues(ok)).toBe(0);
    const sameDay = clone();
    (obj(sameDay.days[DAY3].data)['messages'] as unknown[]).push({ ...copy(README_CASE_CONDITION_EXAMPLE), id: 'msg.day3.example-case', visibleFrom: 'day.03' });
    const issues = validateContent(sameDay);
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('必須早於訊息的 visibleFrom');
  });

  it('比對案件範例（替換範例 day-07 的 documents 與 tasks[0]）', () => {
    const input = clone();
    addExampleDay(input);
    obj(input.days[DAY7].data)['documents'] = copy(README_CASE_DOCUMENTS_EXAMPLE);
    obj(input.days[DAY7].data)['tasks'] = [copy(README_CASE_TASK_EXAMPLE)];
    const issues = validateContent(input);
    expect(issues.length).withContext(formatIssues(issues)).toBe(0);
  });

  it('比對案件範例的 archiveCode 若不是依據文件的值（例如寫成另一份來源的編號）會被擋下', () => {
    const input = clone();
    addExampleDay(input);
    obj(input.days[DAY7].data)['documents'] = copy(README_CASE_DOCUMENTS_EXAMPLE);
    const task = copy(README_CASE_TASK_EXAMPLE);
    task.caseReview.decisions[2].archiveCode = '0710';
    obj(input.days[DAY7].data)['tasks'] = [task];
    const issues = validateContent(input);
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].caseReview.decisions[2].archiveCode');
  });

  it('退件條件範例（day-05 引用 Day 3 通知的稽核）；放在通知日之前（day-02）會被擋下', () => {
    const input = clone();
    (obj(input.days[DAY5].data)['messages'] as unknown[]).push(copy(README_RETURN_CONDITION_EXAMPLE));
    const ok = validateContent(input);
    expect(ok.length).withContext(formatIssues(ok)).toBe(0);
    const early = clone();
    (obj(early.days[DAY2].data)['messages'] as unknown[]).push({ ...copy(README_RETURN_CONDITION_EXAMPLE), id: 'msg.day2.example-return', visibleFrom: 'day.02' });
    const issues = validateContent(early);
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('晚於訊息的 visibleFrom');
  });

  it('退件稽核與錯誤文件處理範例就是正式資料（Day 2 核對的 returnAudit、Day 4 的 return-review）', () => {
    const tasks = (day: number) => obj(CONTENT_SOURCES.days[day].data)['tasks'] as Record<string, unknown>[];
    expect(tasks(DAY2).find((t) => t['id'] === 'task.day2.reconcile')?.['returnAudit']).toEqual(README_RETURN_AUDIT_EXAMPLE);
    expect(tasks(DAY4).find((t) => t['id'] === 'task.day4.return-review')).toEqual(README_RETURN_REVIEW_TASK_EXAMPLE);
  });

  it('最小寫法範例（省略 reviewTaskId 與 auditId，R11）可通過驗證；只省略 reviewTaskId 而任務仍帶 auditId 會被擋下', () => {
    const input = clone();
    const reconcile = (obj(input.days[DAY2].data)['tasks'] as Record<string, unknown>[]).find((t) => t['id'] === 'task.day2.reconcile');
    if (reconcile === undefined) throw new Error('task.day2.reconcile missing');
    reconcile['returnAudit'] = copy(README_RETURN_AUDIT_MINIMAL_EXAMPLE);
    (obj(input.days[DAY4].data)['tasks'] as Record<string, unknown>[])[1] = copy(README_ISSUE_TASK_MINIMAL_EXAMPLE);
    const ok = validateContent(input);
    expect(ok.length).withContext(formatIssues(ok)).toBe(0);
    const half = clone();
    const halfReconcile = (obj(half.days[DAY2].data)['tasks'] as Record<string, unknown>[]).find((t) => t['id'] === 'task.day2.reconcile');
    if (halfReconcile === undefined) throw new Error('task.day2.reconcile missing');
    halfReconcile['returnAudit'] = copy(README_RETURN_AUDIT_MINIMAL_EXAMPLE);
    const issues = validateContent(half);
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[1].auditId');
  });

  it('複審範例的 recordIds 若放入紀錄會被擋下（處理對象是存檔排入當日的文件問題案件）', () => {
    const input = clone();
    const tasks = obj(input.days[DAY4].data)['tasks'] as Record<string, unknown>[];
    tasks[1] = { ...copy(README_RETURN_REVIEW_TASK_EXAMPLE), recordIds: ['record.b102'] };
    const issues = validateContent(input);
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[1].recordIds');
  });
});
