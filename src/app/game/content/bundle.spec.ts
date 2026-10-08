import { NightResult, Stage } from '../core/types';
import { PLAYER_NAME_MAX } from '../core/validate';
import * as bundle from './bundle';
import {
  ALL_MESSAGES,
  ALL_PROMPTS,
  CONTENT,
  CONTENT_FILES,
  CONTENT_SOURCES,
  DAY_IDS,
  actorName,
  archiveTask,
  caseNumberTemplateOf,
  channel,
  channelTitle,
  channelsOfKind,
  chatDateLabel,
  contentTask,
  dayContentById,
  dayOrder,
  dayPlan,
  documentsOfTask,
  endTransitionText,
  fieldMapTask,
  issueTaskText,
  messagesOfChannel,
  promptOf,
  promptsOfChannel,
  receiptDocument,
  reconcileTask,
  recordsOfTask,
  reportDocument,
  returnAuditOf,
  returnReviewTask,
  tasksOfDay,
  unlockedMessages,
  wrapTransitionText,
} from './bundle';
import {
  ConditionContext,
  caseConditionId,
  chatConditionId,
  conditionsHold,
  evaluateCondition,
  helpConditionId,
  isConditionId,
  isUnlocked,
  isVisibleFrom,
  parseCaseCondition,
  parseChatCondition,
  parseHelpCondition,
  parseReturnCondition,
  parseReviewCondition,
  returnConditionId,
  reviewConditionId,
} from './conditions';
import { DAY_SOURCES } from './data/manifest';
import * as records from './records';
import { ContentRecord, ID_PREFIX, ISSUE_RECEIPT_KINDS, RETURN_RECEIPT_MAIL_PACK_ID, issueTaskId, parseIssueTaskId } from './schema';
import { ASIDE, NEWS } from './text';

/**
 * KB-R4-03／KB-R5-01／KB-R5-03：載入後的內容。
 * 檢查 ID 穩定性、前導零、日程查表、條件解析、跨日訊息歷史，
 * 以及文案確實來自資料檔（訊息文字直接以頻道 API 逐字驗證）。
 */

const DM = 'channel.dm.lin-yuan';
const DM_WU = 'channel.dm.wu-wan-ting';
const LUNCH_PROMPT = 'prompt.day3.lunch-plan';
const DEPT = 'channel.department.data-ops';
const LUNCH = 'channel.group.lunch-chat';
const ALL_RECORDS: readonly ContentRecord[] = CONTENT.days.flatMap((d) => d.records);
const record = (id: string): ContentRecord => {
  const r = ALL_RECORDS.find((x) => x.id === id);
  if (r === undefined) throw new Error(id);
  return r;
};

/** archive 批次 → 所屬日與筆數；ctx 的預設 archivedCount 用（早於目前日的批次視為已全部提交）。 */
const BATCH_INFO: ReadonlyMap<string, { day: number; size: number }> = new Map(
  CONTENT.days.flatMap((d) =>
    d.tasks.flatMap((t) => (t.kind === 'archive' ? [[t.batchId, { day: d.day, size: t.recordIds.length }] as const] : [])),
  ),
);

const night = (smallTalkVariant: number): NightResult => ({
  intervention: false,
  smallTalkVariant,
  reportRevision: 1,
});

/**
 * `reviewed`：存檔中至少有一筆 origin=review 的批次。
 * `chat`：存檔中已回答的 prompt → choiceId；值為 null 代表 skipped（與未回答一樣回傳 null）。
 * `archived`：批次 → 已提交筆數（R8）。未指定的批次：早於目前日者視為全部提交，當日與之後為 0，
 * 與正常進行的存檔一致（已過的日一定全部完成）。
 * `cases`：案件 → 已保存的決定 ID（R9）；未指定或 null＝尚未決定／舊存檔沒有案件決定。
 * `notified`：已通知退件的稽核 ID（R10）；呼叫端（狀態層）負責「已保存退件且已到通知日」，這裡只是樁。
 * `asked`：已送出的提問 ID（R12，存檔 helpRequests 的鍵）。
 */
const ctx = (
  dayId: string,
  stage: Stage = 'work',
  n: NightResult | null = null,
  reviewed: readonly string[] = [],
  chat: Readonly<Record<string, string | null>> = {},
  archived: Readonly<Record<string, number>> = {},
  cases: Readonly<Record<string, string | null>> = {},
  notified: readonly string[] = [],
  asked: readonly string[] = [],
): ConditionContext => ({
  dayId,
  dayOrder,
  stage,
  night: n,
  hasReview: (batchId) => reviewed.includes(batchId),
  chatChoice: (promptId) => chat[promptId] ?? null,
  archivedCount: (batchId) => {
    if (batchId in archived) return archived[batchId];
    const info = BATCH_INFO.get(batchId);
    return info !== undefined && info.day < dayOrder(dayId) ? info.size : 0;
  },
  caseDecision: (caseId) => cases[caseId] ?? null,
  returnNotified: (auditId) => notified.includes(auditId),
  helpRequested: (requestId) => asked.includes(requestId),
});

const ids = (messages: readonly { id: string }[]): string[] => messages.map((m) => m.id);

describe('內容 ID', () => {
  it('全部 ID 唯一', () => {
    const all = [
      ...CONTENT.actors.map((a) => a.id),
      ...CONTENT.channels.map((c) => c.id),
      ...CONTENT.bulletins.map((b) => b.id),
      ...CONTENT.days.map((d) => d.id),
      ...CONTENT.days.map((d) => d.transition.id),
      ...CONTENT.days.flatMap((d) => d.records.map((r) => r.id)),
      ...CONTENT.days.flatMap((d) => d.documents.map((x) => x.id)),
      ...CONTENT.days.flatMap((d) => d.tasks.map((t) => t.id)),
      ...ALL_MESSAGES.map((m) => m.id),
      ...ALL_PROMPTS.map((e) => e.prompt.id),
      ...ALL_PROMPTS.flatMap((e) => e.prompt.choices.flatMap((c) => c.responses.map((r) => r.id))),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('每一種內容都有自己的命名空間', () => {
    for (const a of CONTENT.actors) expect(a.id.startsWith(ID_PREFIX.actor)).toBeTrue();
    for (const c of CONTENT.channels) expect(c.id.startsWith(ID_PREFIX.channel)).toBeTrue();
    for (const b of CONTENT.bulletins) expect(b.id.startsWith(ID_PREFIX.bulletin)).toBeTrue();
    for (const m of ALL_MESSAGES) expect(m.id.startsWith(ID_PREFIX.message)).toBeTrue();
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt.id.startsWith(ID_PREFIX.prompt)).toBeTrue();
      for (const c of prompt.choices) {
        expect(c.id).not.toContain('.');
        for (const r of c.responses) expect(r.id.startsWith(ID_PREFIX.message)).toBeTrue();
      }
    }
    for (const r of ALL_RECORDS) expect(r.id.startsWith(ID_PREFIX.record)).toBeTrue();
    for (const d of CONTENT.days) {
      expect(d.id.startsWith(ID_PREFIX.day)).toBeTrue();
      expect(d.transition.id.startsWith(ID_PREFIX.transition)).toBeTrue();
      for (const t of d.tasks) {
        expect(t.id.startsWith(ID_PREFIX.task)).toBeTrue();
        if (t.kind === 'archive') expect(t.batchId.startsWith(ID_PREFIX.batch)).toBeTrue();
        else if (t.kind === 'reconcile') expect(t.sourceBatchId.startsWith(ID_PREFIX.batch)).toBeTrue();
        else if (t.kind === 'field-map') for (const row of t.rows) expect(row.id.startsWith(ID_PREFIX.row)).toBeTrue();
        else if (t.kind === 'return-review' && t.auditId !== undefined) expect(t.auditId).not.toContain('.');
      }
      for (const x of d.documents) expect(x.id.startsWith(ID_PREFIX.document)).toBeTrue();
    }
  });
});

describe('日程查表（KB-R5-03）', () => {
  it('DAY_IDS 依 day 數字排序，dayOrder 由內容目錄解析', () => {
    expect(DAY_IDS).toEqual(['day.01', 'day.02', 'day.03', 'day.04', 'day.05', 'day.06']);
    expect(CONTENT.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dayOrder('day.01')).toBe(1);
    expect(dayOrder('day.06')).toBe(6);
    expect(dayOrder('day.09')).toBeNaN();
    expect(dayOrder('')).toBeNaN();
  });

  it('每日檔清單只來自 data/manifest.ts，且依日序', () => {
    expect(CONTENT_SOURCES.days.map((d) => d.file)).toEqual(DAY_SOURCES.map((d) => d.file));
    expect(CONTENT_FILES.days).toEqual(DAY_SOURCES.map((d) => d.file));
    expect(DAY_SOURCES.map((d) => d.file)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `data/days/day-0${n}.json`));
    expect(DAY_SOURCES.map((d) => (d.data as { id: string }).id)).toEqual([...DAY_IDS]);
  });

  it('日程為 Day 1 → 2 → 3 → 4 → 5 → 6，只有 Day 6 結束；每日工作依 JSON 順序（R8）', () => {
    expect(DAY_IDS.map((id) => dayPlan(id).nextDayId)).toEqual(['day.02', 'day.03', 'day.04', 'day.05', 'day.06', null]);
    expect(DAY_IDS.map((id) => dayPlan(id).tasks.map((t) => t.kind))).toEqual([
      ['archive', 'archive'],
      ['reconcile', 'archive'],
      ['archive'],
      // M1：Day 4／5 加入附件關聯與批次轉換，Day 6 加入交付報告
      ['archive', 'return-review', 'attachment', 'transform'],
      ['archive', 'attachment', 'transform'],
      ['field-map', 'report'],
    ]);
    expect(DAY_IDS.map((id) => tasksOfDay(id).map((t) => t.id))).toEqual(DAY_IDS.map((id) => dayPlan(id).tasks.map((t) => t.id)));
  });

  it('Day 1 是兩批歸檔（各 3 筆），各自定義批次；nextDayId 指向 Day 2', () => {
    const plan = dayPlan('day.01');
    expect(plan.dayId).toBe('day.01');
    expect(plan.dayNumber).toBe(1);
    expect(plan.nextDayId).toBe('day.02');
    expect(plan.tasks).toEqual([
      {
        id: 'task.day1.archive',
        kind: 'archive',
        batchId: 'batch.day01.archive',
        recordIds: ['record.h17', 'record.b102', 'record.b607'],
        documentIds: [],
      },
      {
        id: 'task.day1.archive-followup',
        kind: 'archive',
        batchId: 'batch.day01.archive-followup',
        recordIds: ['record.day1-h18', 'record.day1-h19', 'record.day1-h20'],
        documentIds: [],
      },
    ]);
  });

  it('Day 2 先核對（指回 Day 1 原第一批與核對紀錄，附 R10 下游稽核），再歸檔 4 筆新件；接 Day 3', () => {
    const plan = dayPlan('day.02');
    expect(plan.nextDayId).toBe('day.03');
    expect(plan.tasks).toEqual([
      {
        id: 'task.day2.reconcile',
        kind: 'reconcile',
        sourceBatchId: 'batch.day01.archive',
        subjectRecordId: 'record.b102',
        recordIds: ['record.b102', 'record.b607'],
        documentIds: ['doc.day2.summary', 'doc.day2.receipt'],
        returnAudit: {
          id: 'day1-code-audit',
          notifyDayId: 'day.03',
          reviewTaskId: 'task.day4.return-review',
          caseNumberTemplate: 'RT-{key}',
        },
      },
      {
        id: 'task.day2.archive',
        kind: 'archive',
        batchId: 'batch.day02.archive',
        recordIds: ['record.day2-h31', 'record.day2-h32', 'record.day2-h33', 'record.day2-h34'],
        documentIds: [],
      },
    ]);
  });

  it('documentsOfTask／recordsOfTask 依任務的 ID 順序取得（可跨日）', () => {
    expect(documentsOfTask('task.day2.reconcile').map((d) => d.kind)).toEqual(['report', 'receipt']);
    expect(documentsOfTask('task.day1.archive')).toEqual([]);
    expect(recordsOfTask('task.day2.reconcile').map((r) => r.code)).toEqual(['0102', '0607']);
    expect(() => documentsOfTask('task.day9.nope')).toThrowError(/task\.day9\.nope/);
  });

  it('tasksOfDay 取該日全部任務；以 taskId 精確取得任務，不看陣列位置（R8）', () => {
    expect(tasksOfDay('day.01').map((t) => t.id)).toEqual(['task.day1.archive', 'task.day1.archive-followup']);
    expect(tasksOfDay('day.06').map((t) => t.id)).toEqual(['task.day6.field-map', 'task.day6.m1-report']);
    expect(() => tasksOfDay('day.09')).toThrowError(/day\.09/);
    expect(contentTask('task.day1.archive-followup')).toBe(tasksOfDay('day.01')[1]);
    expect(archiveTask('task.day2.archive').batchId).toBe('batch.day02.archive');
    expect(() => contentTask('task.day9.nope')).toThrowError(/task\.day9\.nope/);
  });

  it('bundle 不再有 contentTaskOf（R8：不讀 tasks[0] 當目前工作）', () => {
    expect(Object.keys(bundle)).not.toContain('contentTaskOf');
  });

  it('未知的 day ID 直接丟例外，不會回傳空計畫', () => {
    expect(() => dayPlan('day.09')).toThrowError(/day\.09/);
    expect(() => dayContentById('day.09')).toThrowError(/day\.09/);
  });

  it('依 kind 收斂的取值：kind 不符時是內容錯誤', () => {
    expect(archiveTask('task.day1.archive').text.heading).toBe('人員資料歸檔');
    expect(reconcileTask('task.day2.reconcile').text.choices.review).toBe('附上昨日副本，請求覆核');
    expect(() => archiveTask('task.day2.reconcile')).toThrowError(/不是 archive/);
    expect(() => reconcileTask('task.day1.archive')).toThrowError(/不是 reconcile/);
    expect(reportDocument('doc.day2.summary').text.sourceOrigin.rules).toBe('規則彙整');
    expect(receiptDocument('doc.day2.receipt').text.destReview).toBe('去向：資料覆核佇列');
    expect(() => reportDocument('doc.day2.receipt')).toThrowError(/不是 report/);
    expect(() => receiptDocument('doc.day2.summary')).toThrowError(/不是 receipt/);
  });

  it('轉場形狀由 nextDayId 決定：Day 1–5 為日結轉場，只有 Day 6 為結束轉場', () => {
    expect(['day.01', 'day.02', 'day.03', 'day.04', 'day.05'].map((id) => wrapTransitionText(id).docTitle)).toEqual([
      '第一日交接完成',
      '第二日交接完成',
      '第三日交接完成',
      '第四日交接完成',
      '第五日交接完成',
    ]);
    expect(endTransitionText('day.06').outro).toBe('六日試玩結束');
    expect(() => wrapTransitionText('day.06')).toThrowError(/沒有下一日/);
    for (const id of ['day.01', 'day.02', 'day.03', 'day.04', 'day.05']) {
      expect(() => endTransitionText(id)).toThrowError(/還有下一日/);
    }
  });

  it('Day 1／2 日結轉場文字（R8：countLabel／next 改由 ui.handoff 提供）', () => {
    expect(wrapTransitionText('day.01')).toEqual({
      docTitle: '第一日交接完成',
      eyebrow: 'DAY / 01 — COMPLETE',
      heading: '今天辛苦了。',
      body: '今日資料已完成交接。謝謝你的協助，明天見。',
      backToCover: '返回開始頁',
    });
    expect(wrapTransitionText('day.02')).toEqual({
      docTitle: '第二日交接完成',
      eyebrow: 'DAY / 02 — COMPLETE',
      heading: '本日交接完成。',
      body: '明日工作將於到班後更新。',
      backToCover: '返回開始頁',
    });
  });

  it('Day 3–5 日結轉場文字', () => {
    const names = { 3: ['三'], 4: ['四'], 5: ['五'] } as const;
    for (const n of [3, 4, 5] as const) {
      expect(wrapTransitionText(`day.0${n}`)).toEqual({
        docTitle: `第${names[n][0]}日交接完成`,
        eyebrow: `DAY / 0${n} — COMPLETE`,
        heading: '本日批次已完成。',
        body: '今日資料已完成交接。下一個工作日見。',
        backToCover: '返回開始頁',
      });
    }
  });

  it('Day 6 結束轉場文字（task-neutral，沒有 outcome）', () => {
    const end = endTransitionText('day.06');
    expect(end).toEqual({
      docTitle: '六日試玩結束',
      eyebrow: 'DAY / 06 — COMPLETE',
      heading: '本日匯入已完成。',
      body: '欄位對應與處理結果已保存至本日批次。',
      summary: '明日工作將於到班後更新。',
      thanks: '感謝你的協助。',
      outro: '六日試玩結束',
      backToCover: '返回開始頁',
    });
    expect('outcome' in end).toBeFalse();
  });
});

describe('Day 3–5 歸檔內容（COLLABORATION §4）', () => {
  const expected = {
    3: {
      greeting: '早安，今日舊檔批次已送達。',
      heading: '舊檔資料歸檔',
      eyebrow: 'ARCHIVE / BATCH 03',
      aside: '資料量較昨日增加。請依來源逐筆核對，缺少的欄位仍可送交覆核。',
      instruction: '請依來源資料核對人員編號，完成本日舊檔歸檔。',
      records: [
        ['record.day3-h204', 'H204', '黃品蓉', 'H-204', null, false],
        ['record.day3-h219', 'H219', '邱奕辰', 'H-219', null, false],
        ['record.day3-b314', 'B314', null, '0314', null, true],
        ['record.day3-b448', 'B448', null, '0448', true, true],
        ['record.day3-b521', 'B521', null, '0521', null, true],
      ],
    },
    4: {
      greeting: '早安，補充批次已排入今日佇列。',
      heading: '補充資料歸檔',
      eyebrow: 'ARCHIVE / BATCH 04',
      aside: '本批包含已附欄位與待補欄位；請以每筆來源資料為準。',
      instruction: '請核對補充資料的人員編號與欄位狀態。',
      records: [
        ['record.day4-h233', 'H233', '楊以安', 'H-233', null, false],
        ['record.day4-h240', 'H240', '謝宗翰', 'H-240', null, false],
        ['record.day4-b716', 'B716', null, '0716', null, true],
        ['record.day4-b731', 'B731', null, '0731', false, true],
        ['record.day4-b842', 'B842', null, '0842', true, true],
        ['record.day4-b905', 'B905', null, '0905', null, true],
      ],
    },
    5: {
      greeting: '早安，本週最後一批舊檔已送達。',
      heading: '週末批次歸檔',
      eyebrow: 'ARCHIVE / BATCH 05',
      aside: '請在今日交接前完成本批資料；系統維護不影響已保存的草稿。',
      instruction: '請依來源逐筆完成核對；已提交的紀錄將鎖定。',
      records: [
        ['record.day5-h251', 'H251', '沈若庭', 'H-251', null, false],
        ['record.day5-h267', 'H267', '江柏宇', 'H-267', null, false],
        ['record.day5-b1013', 'B1013', null, '1013', null, true],
        ['record.day5-b1044', 'B1044', null, '1044', true, true],
        ['record.day5-b1108', 'B1108', null, '1108', null, true],
        ['record.day5-b1160', 'B1160', null, '1160', false, true],
        ['record.day5-b1202', 'B1202', null, '1202', true, true],
        ['record.day5-b1219', 'B1219', null, '1219', null, true],
      ],
    },
  } as const;

  for (const n of [3, 4, 5] as const) {
    it(`Day ${n}：task、batch、筆數與文字`, () => {
      const e = expected[n];
      const day = dayContentById(`day.0${n}`);
      const task = archiveTask(`task.day${n}.archive`);
      // R10：Day 4 在原歸檔之後加入退件複審（沒有退件時由狀態層略過），歸檔本身不變；
      // M1：Day 4／5 另有附件關聯與批次轉換
      const m1 = n === 3 ? [] : [`task.day${n}.m1-attachment`, `task.day${n}.m1-transform`];
      expect(tasksOfDay(day.id).map((t) => t.id)).toEqual(n === 4 ? [task.id, 'task.day4.return-review', ...m1] : [task.id, ...m1]);
      expect(task.batchId).toBe(`batch.day0${n}.archive`);
      expect(task.recordIds.length).toBe(e.records.length);
      expect(task.text).toEqual({ eyebrow: e.eyebrow, heading: e.heading, instruction: e.instruction });
      expect(day.workbench.greeting).toBe(e.greeting);
      expect(day.aside.body).toBe(e.aside);
      expect(
        recordsOfTask(task.id).map((r) => [r.id, r.key, r.name, r.code, r.refusal, r.refusalApplies]),
      ).toEqual(e.records.map((r) => [...r]));
    });
  }

  it('Day 3／4／5 筆數為 5／6／8，各自只引用當日紀錄', () => {
    expect([3, 4, 5].map((n) => archiveTask(`task.day${n}.archive`).recordIds.length)).toEqual([5, 6, 8]);
    for (const n of [3, 4, 5]) {
      expect(archiveTask(`task.day${n}.archive`).recordIds.every((id) => id.startsWith(`record.day${n}-`))).toBeTrue();
    }
  });
});

describe('Day 1／2 新增工作（R8 §5）', () => {
  const rec = (id: string) => {
    const r = record(id);
    return [r.id, r.key, r.name, r.code, r.refusal, r.refusalApplies];
  };

  it('Day 1 第二批：3 筆一般來源資料與任務文字', () => {
    const task = archiveTask('task.day1.archive-followup');
    expect(task.batchId).toBe('batch.day01.archive-followup');
    expect(task.documentIds).toEqual([]);
    expect(task.text).toEqual({
      eyebrow: 'ARCHIVE / BATCH 02',
      heading: '補入資料歸檔',
      instruction: '請依來源資料核對人員編號，完成第二批歸檔。',
    });
    expect(recordsOfTask(task.id).map((r) => rec(r.id))).toEqual([
      ['record.day1-h18', 'H18', '陳書宜', 'H-18', null, false],
      ['record.day1-h19', 'H19', '許柏仁', 'H-19', null, false],
      ['record.day1-h20', 'H20', '郭佳穎', 'H-20', null, false],
    ]);
    // 原第一批不變
    expect(recordsOfTask('task.day1.archive').map((r) => r.code)).toEqual(['H-17', '0102', '0607']);
    expect(dayContentById('day.01').records.map((r) => r.id)).toEqual([
      'record.h17',
      'record.b102',
      'record.b607',
      'record.day1-h18',
      'record.day1-h19',
      'record.day1-h20',
    ]);
  });

  it('Day 2 新件：4 筆一般來源資料與任務文字；核對任務仍讀 Day 1 原第一批', () => {
    const task = archiveTask('task.day2.archive');
    expect(task.text).toEqual({
      eyebrow: 'ARCHIVE / BATCH 03',
      heading: '今日新件歸檔',
      instruction: '摘要核對完成後，請依來源資料核對這批新件的人員編號。',
    });
    expect(recordsOfTask(task.id).map((r) => rec(r.id))).toEqual([
      ['record.day2-h31', 'H31', '邱怡珊', 'H-31', null, false],
      ['record.day2-h32', 'H32', '方宗翰', 'H-32', null, false],
      ['record.day2-h33', 'H33', '洪妍希', 'H-33', null, false],
      ['record.day2-h34', 'H34', '江祐廷', 'H-34', null, false],
    ]);
    const reconcile = reconcileTask('task.day2.reconcile');
    expect(reconcile.sourceBatchId).toBe('batch.day01.archive');
    expect(recordsOfTask(reconcile.id).map((r) => r.code)).toEqual(['0102', '0607']);
    expect('finish' in reconcile.text.dialog).toBeFalse();
  });

  it('Day 2 工作台、側欄、備註與 08:42 訊息依 R8 §5 替換', () => {
    const day = dayContentById('day.02');
    expect(day.workbench).toEqual({ greeting: '早安，昨日資料已完成交接。', workHeading: '今日工作' });
    expect(day.aside).toEqual({ heading: '今日工作', body: '先核對昨日摘要，再處理今日新件。' });
    expect(day.note).toBe('Day 2 先核對 day-01 原批次，之後處理本日新件；新批次不得改動原摘要與四格結果。');
    const handoff = bundle.contentMessage('msg.day2.handoff');
    expect(handoff.lines).toEqual(['昨天那批已經收到。今天先核對摘要，晚點還有一批新件。']);
    expect([handoff.channelId, handoff.actorId, handoff.time, handoff.visibleFrom, handoff.unlock]).toEqual([
      DM,
      'actor.lin-yuan',
      '08:42',
      'day.02',
      [],
    ]);
    expect(Object.keys(day)).not.toContain('messageOverride');
  });

  it('新增的人員只是一般來源：有姓名、H 開頭、不適用拒絕紀錄', () => {
    for (const id of ['record.day1-h18', 'record.day1-h19', 'record.day1-h20', 'record.day2-h31', 'record.day2-h32', 'record.day2-h33', 'record.day2-h34']) {
      const r = record(id);
      expect(r.name).withContext(id).not.toBeNull();
      expect(r.key.startsWith('H')).withContext(id).toBeTrue();
      expect(r.refusalApplies).withContext(id).toBeFalse();
    }
  });
});

describe('Day 3 午餐群組依工作進度解鎖（unlockAfter，R8 §4）', () => {
  const D3 = 'batch.day03.archive';
  const LUNCH_DAY3 = ['msg.day3.lunch-order', 'msg.day3.lunch-yesterday', 'msg.day3.lunch-hungry', 'msg.day3.lunch-ask-player'];
  const shown = (archived: number | undefined, dayId = 'day.03', stage: Stage = 'work') =>
    ids(unlockedMessages(LUNCH, ctx(dayId, stage, null, [], {}, archived === undefined ? {} : { [D3]: archived })));

  it('四則都帶同一個 unlockAfter；其他欄位與台詞不變', () => {
    for (const id of LUNCH_DAY3) {
      expect(bundle.contentMessage(id).unlockAfter).withContext(id).toEqual({ archiveBatchId: D3, archivedCount: 2 });
      expect(bundle.contentMessage(id).visibleFrom).toBe('day.03');
      expect(bundle.contentMessage(id).unlock).toEqual([]);
    }
    // M1 的新訊息另有工作進度條件（見 validate-content 的正式資料測試）；午餐四則以外的 Day 3 條件都不是這一組
    expect(ALL_MESSAGES.filter((m) => m.unlockAfter !== undefined && m.channelId === LUNCH && m.visibleFrom === 'day.03').map((m) => m.id)).toEqual([
      ...LUNCH_DAY3,
      'msg.day3.m1-printer',
      'msg.day3.m1-printer-wu',
    ]);
  });

  it('一進 Day 3（0 筆）與提交第 1 筆後都看不到', () => {
    expect(shown(undefined)).toEqual([]);
    expect(shown(0)).toEqual([]);
    expect(shown(1)).toEqual([]);
  });

  it('提交第 2 筆起四則一起出現，之後筆數增加不改變', () => {
    for (const n of [2, 3, 5]) expect(shown(n).slice(0, 4)).withContext(String(n)).toEqual(LUNCH_DAY3);
    // M1：提交第 3 筆起另有印表機兩則（不影響午餐四則）
    expect(shown(2)).toEqual(LUNCH_DAY3);
    expect(shown(3)).toEqual([...LUNCH_DAY3, 'msg.day3.m1-printer', 'msg.day3.m1-printer-wu']);
  });

  it('只看 Day 3 原批次：其他批次的進度不解鎖', () => {
    const c = ctx('day.03', 'work', null, [], {}, { 'batch.day01.archive': 3, 'batch.day02.archive': 4 });
    expect(unlockedMessages(LUNCH, c)).toEqual([]);
  });

  it('同一個 isUnlocked：prompt 的 anchor 也要等到第 2 筆才可回答', () => {
    const anchorOpen = (n: number) =>
      promptsOfChannel(LUNCH)
        .filter((e) => e.anchor.visibleFrom === 'day.03')
        .map((e) => isUnlocked(e.anchor, ctx('day.03', 'work', null, [], {}, { [D3]: n })));
    expect(anchorOpen(1)).toEqual([false]);
    expect(anchorOpen(2)).toEqual([true]);
  });

  it('isUnlocked 與 unlockedMessages 對同一則訊息一致（未讀／對話串共用）', () => {
    for (const n of [0, 1, 2]) {
      const c = ctx('day.03', 'work', null, [], {}, { [D3]: n });
      const byIsUnlocked = messagesOfChannel(LUNCH).filter((m) => isUnlocked(m, c)).map((m) => m.id);
      expect(ids(unlockedMessages(LUNCH, c))).withContext(String(n)).toEqual(byIsUnlocked);
    }
  });

  it('Day 3 日結與之後各日（批次已完成）仍留在頻道歷史', () => {
    expect(shown(5, 'day.03', 'wrap').slice(0, 4)).toEqual(LUNCH_DAY3);
    for (const dayId of ['day.04', 'day.05', 'day.06']) {
      expect(shown(undefined, dayId).slice(0, 4)).withContext(dayId).toEqual(LUNCH_DAY3);
    }
  });

  it('Day 3 的其他頻道不受影響：部門頻道與私訊一進 Day 3 就可見', () => {
    expect(ids(unlockedMessages(DEPT, ctx('day.03')))).toEqual(['msg.day3.dept-large-batch']);
    expect(ids(unlockedMessages(DM, ctx('day.03'))).includes('msg.day3.dm-drafts')).toBeTrue();
  });

  it('progressHolds：沒有 unlockAfter 恆成立；未知批次視為 0 筆', () => {
    expect(isUnlocked({ visibleFrom: 'day.03', unlock: [] }, ctx('day.03'))).toBeTrue();
    expect(
      isUnlocked(
        { visibleFrom: 'day.03', unlock: [], unlockAfter: { archiveBatchId: 'batch.day09.archive', archivedCount: 1 } },
        ctx('day.03'),
      ),
    ).toBeFalse();
  });
});

describe('Day 6 欄位映射內容（COLLABORATION §6）', () => {
  const task = fieldMapTask('task.day6.field-map');

  it('一對一的正確配對、boolean 轉換與 8 列資料', () => {
    expect(task.sourceFields.map((f) => [f.id, f.label])).toEqual([
      ['record-date', '資料日期'],
      ['contact-result', '聯繫結果'],
      ['legacy-id', '登記編號'],
      ['objection-reply', '異議回覆'],
    ]);
    expect(task.targetFields.map((f) => [f.id, f.label, f.sourceId, f.convert])).toEqual([
      ['personnel-code', '人員編號', 'legacy-id', 'text'],
      ['exclude-flag', '排除狀態', 'objection-reply', 'boolean'],
      ['contact-status', '聯繫狀態', 'contact-result', 'text'],
      ['effective-date', '生效日期', 'record-date', 'text'],
    ]);
    const flag = task.targetFields[1];
    expect(flag.convert === 'boolean' ? [flag.trueValue, flag.falseValue] : null).toEqual(['有', '無']);
    expect(task.rows.length).toBe(8);
    expect(task.rows.map((r) => r.id)).toEqual(
      ['0102', '0314', '0521', '0716', '0905', '1013', '1108', '1219'].map((c) => `row.${c}`),
    );
  });

  it('來源欄位順序已打亂（R7 §6.3）：目標仍依 sourceId 對到來源，不依陣列位置', () => {
    const labelOf = (sourceId: string) => task.sourceFields.find((f) => f.id === sourceId)?.label;
    expect(task.targetFields.map((t) => [t.id, labelOf(t.sourceId)])).toEqual([
      ['personnel-code', '登記編號'],
      ['exclude-flag', '異議回覆'],
      ['contact-status', '聯繫結果'],
      ['effective-date', '資料日期'],
    ]);
    // 沒有任何一個目標的正確來源剛好在同一個陣列位置
    task.targetFields.forEach((t, i) => expect(task.sourceFields[i].id).withContext(t.id).not.toBe(t.sourceId));
    // 資料列仍以欄位 ID 為鍵，與 sourceFields 的順序無關
    for (const row of task.rows) {
      expect(Object.keys(row.values).sort()).toEqual(task.sourceFields.map((f) => f.id).sort());
    }
  });

  it('資料列值逐字；0102 保留前導零，空白 4 列', () => {
    expect(task.rows.map((r) => Object.values(r.values))).toEqual([
      ['0102', '', '未接', '2026-09-16'],
      ['0314', '無', '已確認', '2026-09-17'],
      ['0521', '', '待回覆', '2026-09-17'],
      ['0716', '有', '已確認', '2026-09-18'],
      ['0905', '', '未接', '2026-09-18'],
      ['1013', '無', '待回覆', '2026-09-19'],
      ['1108', '無', '已確認', '2026-09-19'],
      ['1219', '', '未接', '2026-09-20'],
    ]);
    expect(task.rows[0].values['legacy-id']).toBe('0102');
    expect(task.rows.filter((r) => r.values['objection-reply'] === '').length).toBe(4);
  });

  it('日別文字與 policy 選項', () => {
    expect(task.text).toEqual({
      eyebrow: 'IMPORT / MAPPING 06',
      heading: '服務銜接表欄位轉換',
      instruction: '將來源欄位對應到目標格式，驗證預覽後完成匯入。',
      policyDefault: '空白視為「未排除」，繼續匯入',
      policyReview: '空白保留為「待確認」，送資料覆核',
    });
    const day = dayContentById('day.06');
    expect(day.workbench.greeting).toBe('早安，新的匯入批次已開放。');
    expect(day.aside.body).toBe('來源表使用舊欄位名稱。請先建立一對一欄位對應，再處理空白值。');
    expect(dayPlan('day.06').tasks).toEqual([
      { id: task.id, kind: 'field-map', recordIds: [], documentIds: [] },
      // M1：欄位映射之後的交付報告
      { id: 'task.day6.m1-report', kind: 'report', recordIds: [], documentIds: [] },
    ]);
  });

  it('依 kind 收斂：field-map 不是 archive／reconcile', () => {
    expect(() => archiveTask('task.day6.field-map')).toThrowError(/不是 archive/);
    expect(() => fieldMapTask('task.day1.archive')).toThrowError(/不是 field-map/);
  });
});

describe('移除的舊入口（R6-01）', () => {
  it('bundle 不再有數字版 dayContent、ALL_RECORDS、contentRecord', () => {
    const keys = Object.keys(bundle);
    for (const removed of ['dayContent', 'ALL_RECORDS', 'contentRecord']) expect(keys).not.toContain(removed);
  });

  it('records 只剩顯示輔助', () => {
    expect(Object.keys(records).sort()).toEqual(['NAME_UNREGISTERED', 'hasName', 'recordLabel']);
  });
});

describe('紀錄載入', () => {
  it('存檔 key 不隨內容 ID 改變', () => {
    expect(record('record.h17').key).toBe('H17');
    expect(record('record.b102').key).toBe('B102');
    expect(record('record.b607').key).toBe('B607');
  });

  it('人員編號一律是字串，前導零保留', () => {
    for (const r of ALL_RECORDS) expect(typeof r.code).toBe('string');
    expect(record('record.b102').code).toBe('0102');
    expect(record('record.b607').code).toBe('0607');
    expect(record('record.day3-b314').code).toBe('0314');
    expect(record('record.day4-b716').code).toBe('0716');
  });

  it('全部日別的存檔 key 不重複', () => {
    const keys = ALL_RECORDS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(3 + 3 + 4 + 5 + 6 + 8);
  });

  it('沒有姓名的來源仍然只是「未登記」，不會被補上名字', () => {
    expect(record('record.b102').name).toBeNull();
    expect(record('record.b607').name).toBeNull();
    for (const r of ALL_RECORDS.filter((x) => x.key.startsWith('B'))) expect(r.name).toBeNull();
  });
});

describe('頻道結構（KB-R4-04、R7 §4）', () => {
  it('部門、群組各一個頻道；私訊兩個', () => {
    expect(channelsOfKind('department').map((c) => c.id)).toEqual([DEPT]);
    expect(channelsOfKind('group').map((c) => c.id)).toEqual([LUNCH]);
    expect(channelsOfKind('direct').map((c) => c.id)).toEqual([DM, DM_WU]);
    expect(channelTitle(DEPT)).toBe('資料作業組');
    expect(channelTitle(LUNCH)).toBe('午休雜談');
  });

  it('department／group 的 topic 與成員；direct 沒有 topic', () => {
    expect(channel(DEPT).topic).toBe('每日批次、交接與作業通知');
    expect(channel(LUNCH).topic).toBe('午餐、辦公室雜務與其他不重要的事');
    const trio = ['actor.lin-yuan', 'actor.wu-wan-ting', 'actor.yang-zi-qian'];
    expect(channel(DEPT).actorIds).toEqual(trio);
    expect(channel(LUNCH).actorIds).toEqual(trio);
    expect(channel(DM).topic).toBeUndefined();
    expect(channel(DM_WU).topic).toBeUndefined();
  });

  it('私訊標題取自對方的稱呼，不另外寫死', () => {
    for (const dm of channelsOfKind('direct')) expect(channelTitle(dm.id)).toBe(actorName(dm.actorIds[0]));
    expect(channelTitle(DM)).toBe('林予安');
    expect(channelTitle(DM_WU)).toBe('吳婉庭');
  });

  it('新增的兩位同事只有姓名', () => {
    expect(actorName('actor.wu-wan-ting')).toBe('吳婉庭');
    expect(actorName('actor.yang-zi-qian')).toBe('楊子謙');
  });

  it('每則訊息都有作者、時間與 visibleFrom，且 ID 含所屬日識別（詢問說明訊息含 help 識別，R12）', () => {
    for (const m of ALL_MESSAGES) {
      expect(m.time.length).toBeGreaterThan(0);
      expect(DAY_IDS).toContain(m.visibleFrom);
      expect(m.unlock.some((c) => c.startsWith('cond.day.'))).toBeFalse();
      if (bundle.helpRequestOfMessage(m.id) !== undefined) expect(m.id).toContain('.help.');
      else expect(m.id).toContain(`.day${dayOrder(m.visibleFrom)}.`);
    }
  });

  it('私訊順序：先 visibleFrom 日序，再檔案內順序（詢問說明訊息排在同一 visibleFrom 的每日訊息之後，R12）', () => {
    expect(ids(messagesOfChannel(DM))).toEqual([
      'msg.day1.welcome',
      'msg.day1.pace',
      'msg.help.refusal.meaning',
      'msg.help.refusal.paths',
      'msg.day2.handoff',
      'msg.day2.smalltalk-printer',
      'msg.day2.smalltalk-tea',
      'msg.day2.check-in',
      'msg.day3.dm-drafts',
      'msg.day3.return-code-audit',
      'msg.day3.m1-find-version',
      'msg.day4.h204.registry',
      'msg.day4.h204.supplement',
      'msg.day4.h204.review',
      'msg.day4.m1-window-receipt',
      'msg.day5.m1-default-question',
      'msg.day6.dm-field-order',
      'msg.day6.m1-handoff-meaning',
    ]);
    expect(ids(messagesOfChannel(DM_WU))).toEqual(['msg.day4.dm-lunch-join', 'msg.day4.dm-lunch-floor', 'msg.day4.dm-lunch-own']);
  });

  it('部門頻道與午休群組的順序', () => {
    expect(ids(messagesOfChannel(DEPT))).toEqual([
      'msg.day3.dept-large-batch',
      'msg.day4.dept-report',
      'msg.day5.dept-maintenance',
      'msg.day5.m1-paper-notice',
      'msg.day6.dept-field-map',
    ]);
    expect(ids(messagesOfChannel(LUNCH))).toEqual([
      'msg.day3.lunch-order',
      'msg.day3.lunch-yesterday',
      'msg.day3.lunch-hungry',
      'msg.day3.lunch-ask-player',
      'msg.day3.m1-printer',
      'msg.day3.m1-printer-wu',
      'msg.day4.review-returned',
      'msg.day4.review-name',
      'msg.day4.review-mood',
      'msg.day4.quick-praise',
      'msg.day4.green-number',
      'msg.day4.m1-desk-fan',
      'msg.day5.m1-coffee',
      'msg.day5.box-question',
      'msg.day5.box-receipt',
      'msg.day5.box-is-box',
      'msg.day6.m1-week-start',
      'msg.day6.box-stop',
      'msg.day6.box-closed',
      'msg.day6.box-found',
      'msg.day6.box-system',
    ]);
  });
});

describe('解鎖條件', () => {
  it('依畫面階段解析，不再有 phase 或逐日條件', () => {
    expect(evaluateCondition('cond.stage.work', ctx('day.01', 'work'))).toBeTrue();
    expect(evaluateCondition('cond.stage.wrap', ctx('day.01', 'work'))).toBeFalse();
    expect(evaluateCondition('cond.stage.wrap', ctx('day.01', 'wrap'))).toBeTrue();
    expect(evaluateCondition('cond.stage.end', ctx('day.02', 'end'))).toBeTrue();
    expect(evaluateCondition('cond.day.1', ctx('day.01'))).toBeFalse();
    expect(evaluateCondition('cond.phase.day1', ctx('day.01'))).toBeFalse();
  });

  it('夜間閒聊版本依存檔決定，沒有 night 時不解鎖', () => {
    expect(evaluateCondition('cond.night.smalltalk.0', ctx('day.02'))).toBeFalse();
    expect(evaluateCondition('cond.night.smalltalk.0', ctx('day.02', 'work', night(0)))).toBeTrue();
    expect(evaluateCondition('cond.night.smalltalk.1', ctx('day.02', 'work', night(0)))).toBeFalse();
  });

  it('未知條件一律 false，不會被當成成立', () => {
    expect(evaluateCondition('cond.made.up', ctx('day.01'))).toBeFalse();
    expect(conditionsHold(['cond.always', 'cond.made.up'], ctx('day.01'))).toBeFalse();
  });

  it('批次覆核條件依 hasReview 解析，any／none 互補', () => {
    const batch = 'batch.day03.archive';
    const any = reviewConditionId('any', batch);
    const none = reviewConditionId('none', batch);
    expect(any).toBe('cond.review.any.batch.day03.archive');
    expect(parseReviewCondition(none)).toEqual({ mode: 'none', batchId: batch });
    expect(parseReviewCondition('cond.review.any.day03')).toBeNull();
    expect(parseReviewCondition('cond.review.some.batch.day03.archive')).toBeNull();
    expect(isConditionId(any)).toBeTrue();
    expect(isConditionId('cond.review.any.')).toBeFalse();
    expect(evaluateCondition(any, ctx('day.04', 'work', null, [batch]))).toBeTrue();
    expect(evaluateCondition(none, ctx('day.04', 'work', null, [batch]))).toBeFalse();
    expect(evaluateCondition(any, ctx('day.04'))).toBeFalse();
    expect(evaluateCondition(none, ctx('day.04'))).toBeTrue();
    // 只看指定的那一批
    expect(evaluateCondition(any, ctx('day.04', 'work', null, ['batch.day01.archive']))).toBeFalse();
  });

  it('空條件代表無條件', () => {
    expect(conditionsHold([], ctx('day.01'))).toBeTrue();
  });

  it('visibleFrom 是「從某日起」而不是「剛好那一天」', () => {
    expect(isVisibleFrom('day.01', ctx('day.01'))).toBeTrue();
    expect(isVisibleFrom('day.01', ctx('day.02'))).toBeTrue();
    expect(isVisibleFrom('day.02', ctx('day.01'))).toBeFalse();
    expect(isVisibleFrom('day.02', ctx('day.02'))).toBeTrue();
  });

  it('未知的 day ID（NaN 日序）視為不可見，不會因 NaN 比較而意外成立', () => {
    expect(isVisibleFrom('day.09', ctx('day.02'))).toBeFalse();
    expect(isVisibleFrom('day.01', ctx('day.nope'))).toBeFalse();
    expect(isUnlocked({ visibleFrom: 'day.09', unlock: [] }, ctx('day.02'))).toBeFalse();
  });

  it('isUnlocked 同時需要日期到了與 unlock 全部成立', () => {
    expect(isUnlocked({ visibleFrom: 'day.01', unlock: [] }, ctx('day.01'))).toBeTrue();
    expect(isUnlocked({ visibleFrom: 'day.01', unlock: ['cond.stage.wrap'] }, ctx('day.01', 'work'))).toBeFalse();
    expect(isUnlocked({ visibleFrom: 'day.01', unlock: ['cond.stage.wrap'] }, ctx('day.01', 'wrap'))).toBeTrue();
  });
});

describe('跨日訊息歷史（KB-R5-01）', () => {
  it('第一天只看到第一天的兩則', () => {
    expect(ids(unlockedMessages(DM, ctx('day.01')))).toEqual(['msg.day1.welcome', 'msg.day1.pace']);
  });

  it('第二天同時看到 Day 1 的兩則舊訊息與 Day 2 當前分支的三則，依日別再依內容順序', () => {
    const v0 = ids(unlockedMessages(DM, ctx('day.02', 'work', night(0))));
    const v1 = ids(unlockedMessages(DM, ctx('day.02', 'work', night(1))));
    expect(v0).toEqual(['msg.day1.welcome', 'msg.day1.pace', 'msg.day2.handoff', 'msg.day2.smalltalk-printer', 'msg.day2.check-in']);
    expect(v1).toEqual(['msg.day1.welcome', 'msg.day1.pace', 'msg.day2.handoff', 'msg.day2.smalltalk-tea', 'msg.day2.check-in']);
  });

  it('第二天沒有 night 時只多出不需擲骰的兩則，閒聊不重抽', () => {
    expect(ids(unlockedMessages(DM, ctx('day.02')))).toEqual([
      'msg.day1.welcome',
      'msg.day1.pace',
      'msg.day2.handoff',
      'msg.day2.check-in',
    ]);
  });

  it('階段改變不會讓已解鎖的歷史消失', () => {
    for (const stage of ['work', 'wrap', 'end'] as const) {
      expect(ids(unlockedMessages(DM, ctx('day.02', stage, night(1))))).toEqual([
        'msg.day1.welcome',
        'msg.day1.pace',
        'msg.day2.handoff',
        'msg.day2.smalltalk-tea',
        'msg.day2.check-in',
      ]);
    }
  });
});

describe('Day 4 互斥訊息（cond.review.*，R7 §5）', () => {
  const D3 = 'batch.day03.archive';
  const ANY = ['msg.day4.review-returned', 'msg.day4.review-name', 'msg.day4.review-mood'];
  const NONE = ['msg.day4.quick-praise', 'msg.day4.green-number'];
  /** Day 4 依 Day 3 覆核狀態互斥的訊息（M1 的生活訊息另有自己的送達條件，不在這組）。 */
  const isReviewPair = (m: { visibleFrom: string; unlock: readonly string[] }) =>
    m.visibleFrom === 'day.04' && m.unlock.some((c) => c.startsWith('cond.review.'));
  const reviewShown = (reviewed: readonly string[], dayId = 'day.04', stage: Stage = 'work') =>
    unlockedMessages(LUNCH, ctx(dayId, stage, null, reviewed)).filter(isReviewPair);

  it('Day 3 批次有 review → 只出現「回到佇列」的三則', () => {
    const shown = reviewShown([D3]);
    expect(ids(shown)).toEqual(ANY);
    expect(shown.map((m) => [actorName(m.actorId), m.time, ...m.lines])).toEqual([
      ['吳婉庭', '10:51', '昨天送覆核的幾筆，早上又回到佇列了。'],
      ['楊子謙', '10:52', '我這邊也有兩筆。他們說要再找承辦拿附件。'],
      ['吳婉庭', '10:53', '所以今天先留著？我怕下午又要全部重送。'],
    ]);
  });

  it('Day 3 批次沒有 review → 只出現「結得很快」的兩則', () => {
    const shown = reviewShown([]);
    expect(ids(shown)).toEqual(NONE);
    expect(shown.map((m) => [actorName(m.actorId), m.time, ...m.lines])).toEqual([
      ['吳婉庭', '10:51', '昨天那批結得很快，主管剛在大群稱讚進度。'],
      ['楊子謙', '10:52', '不過我昨天留的那幾筆待補還沒回。有人接到窗口電話嗎？'],
    ]);
  });

  it('任何存檔在 Day 4 之後的每一天都恰好一組，且不因其他批次或聊天回覆改變', () => {
    const saves: (readonly string[])[] = [[], [D3], ['batch.day01.archive'], ['batch.day01.archive', D3], ['batch.day04.archive']];
    for (const reviewed of saves) {
      for (const dayId of ['day.04', 'day.05', 'day.06']) {
        for (const stage of ['work', 'wrap', 'end'] as const) {
          const chat = { [LUNCH_PROMPT]: 'join', 'prompt.day4.review-returned': 'ask-useful' };
          const shown = unlockedMessages(LUNCH, ctx(dayId, stage, null, reviewed, chat)).filter(isReviewPair);
          expect(ids(shown)).withContext(`${dayId} ${stage} ${reviewed.join(',')}`).toEqual(reviewed.includes(D3) ? ANY : NONE);
        }
      }
    }
  });

  it('兩組各自的 prompt：只有已解鎖那組的 anchor 可回答', () => {
    const anchors = (reviewed: readonly string[]) => {
      const c = ctx('day.04', 'work', null, reviewed);
      return promptsOfChannel(LUNCH)
        .filter((e) => e.anchor.visibleFrom === 'day.04' && isUnlocked(e.anchor, c))
        .map((e) => [e.prompt.id, e.anchor.id]);
    };
    expect(anchors([D3])).toEqual([['prompt.day4.review-returned', 'msg.day4.review-mood']]);
    expect(anchors([])).toEqual([['prompt.day4.quick-close', 'msg.day4.green-number']]);
  });

  it('Day 3 看不到 Day 4 的任何一則', () => {
    expect(reviewShown([D3], 'day.03')).toEqual([]);
    expect(reviewShown([], 'day.03')).toEqual([]);
  });

  it('Day 4 午休群組的完整順序', () => {
    expect(ids(unlockedMessages(LUNCH, ctx('day.04', 'work', null, [D3])))).toEqual([
      'msg.day3.lunch-order',
      'msg.day3.lunch-yesterday',
      'msg.day3.lunch-hungry',
      'msg.day3.lunch-ask-player',
      // M1：Day 3 批次已完成 → 印表機兩則也在歷史裡
      'msg.day3.m1-printer',
      'msg.day3.m1-printer-wu',
      ...ANY,
    ]);
  });
});

describe('Day 3 比對案件 case.day3.h204（R9 §1–2）', () => {
  const CASE = 'case.day3.h204';
  const TASK = 'task.day3.archive';
  const DOCS = ['doc.day3.h204.registry', 'doc.day3.h204.supplement', 'doc.day3.h204.received', 'doc.day3.h204.pending'];

  it('caseReviewOf：案件、所屬任務、日別與紀錄的存檔 key', () => {
    const entry = bundle.caseReviewOf(CASE);
    expect(entry).toBeDefined();
    expect(entry?.taskId).toBe(TASK);
    expect(entry?.dayId).toBe('day.03');
    expect(entry?.recordKey).toBe('H204');
    expect(entry?.review).toBe(archiveTask(TASK).caseReview);
    expect(bundle.ALL_CASE_REVIEWS.map((e) => e.review.id)).toEqual([CASE]);
  });

  it('caseReview 逐字（COLLABORATION §2）', () => {
    expect(archiveTask(TASK).caseReview).toEqual({
      id: CASE,
      recordId: 'record.day3-h204',
      sourceDocumentIds: ['doc.day3.h204.registry', 'doc.day3.h204.supplement'],
      receiptVariants: [
        { id: 'received', documentId: 'doc.day3.h204.received' },
        { id: 'pending', documentId: 'doc.day3.h204.pending' },
      ],
      decisions: [
        {
          id: 'registry',
          label: '依來源登記表歸檔',
          archiveCode: 'H-204',
          destination: 'archive',
          basisDocumentId: 'doc.day3.h204.registry',
          note: '原表與補件編號不同；採用原表，保留補件。',
        },
        {
          id: 'supplement',
          label: '依補件歸檔並附註',
          archiveCode: 'H-205',
          destination: 'archive',
          basisDocumentId: 'doc.day3.h204.supplement',
          note: '原表與補件編號不同；採用補件，保留原表。',
        },
        {
          id: 'review',
          label: '保留原表編號，送窗口待查',
          archiveCode: 'H-204',
          destination: 'review',
          basisDocumentId: 'doc.day3.h204.registry',
          note: '兩份來源編號不同，待窗口確認。',
        },
      ],
    });
  });

  it('caseReviewForRecord：內容 ID 或存檔 key 都可查；其他紀錄、其他任務與未知案件為 undefined', () => {
    const entry = bundle.caseReviewOf(CASE);
    expect(bundle.caseReviewForRecord(TASK, 'H204')).toBe(entry);
    expect(bundle.caseReviewForRecord(TASK, 'record.day3-h204')).toBe(entry);
    for (const other of ['H219', 'B314', 'B448', 'B521', 'record.day3-b314']) {
      expect(bundle.caseReviewForRecord(TASK, other)).withContext(other).toBeUndefined();
    }
    expect(bundle.caseReviewForRecord('task.day4.archive', 'H204')).toBeUndefined();
    expect(bundle.caseReviewForRecord('task.day1.archive', 'B102')).toBeUndefined();
    expect(bundle.caseReviewOf('case.day9.retired')).toBeUndefined();
  });

  it('四份 case-source 文件掛在 task.day3.archive；欄位順序、標題與字串值逐字', () => {
    expect(archiveTask(TASK).documentIds).toEqual(DOCS);
    expect(documentsOfTask(TASK).map((d) => [d.id, d.kind, d.recordIds])).toEqual(
      DOCS.map((id) => [id, 'case-source', ['record.day3-h204']]),
    );
    const view = (id: string) => {
      const d = bundle.caseSourceDocument(id);
      return [d.text.heading, ...d.text.fields.map((f) => `${f.label}=${f.value}`)];
    };
    expect(view(DOCS[0])).toEqual(['來源登記表', '收件參照=HR-3-204', '姓名=黃品蓉', '人員編號=H-204', '登錄時間=08:42']);
    expect(view(DOCS[1])).toEqual(['補件資料', '收件參照=HR-3-204', '姓名=黃品蓉', '人員編號=H-205', '送件時間=09:06']);
    expect(view(DOCS[2])).toEqual(['補件收件狀態', '收件參照=HR-3-204', '窗口狀態=已收件', '更新時間=09:18']);
    expect(view(DOCS[3])).toEqual(['補件收件狀態', '收件參照=HR-3-204', '窗口狀態=回條待回傳', '更新時間=09:18']);
    for (const id of DOCS) {
      expect(bundle.caseSourceDocument(id).text.fields.every((f) => typeof f.value === 'string')).withContext(id).toBeTrue();
    }
  });

  it('依 kind 收斂：case-source 不能當 report／receipt 讀，反之亦然', () => {
    expect(() => bundle.caseSourceDocument('doc.day2.summary')).toThrowError(/不是 case-source/);
    expect(() => reportDocument(DOCS[0])).toThrowError(/不是 report/);
    expect(() => receiptDocument(DOCS[2])).toThrowError(/不是 receipt/);
  });

  it('每個決定的 archiveCode 取自自己的依據文件；依據一定是兩份來源之一', () => {
    const review = bundle.caseReviewOf(CASE)!.review;
    for (const d of review.decisions) {
      expect(review.sourceDocumentIds).withContext(d.id).toContain(d.basisDocumentId);
      const values = bundle.caseSourceDocument(d.basisDocumentId).text.fields.map((f) => f.value);
      expect(values).withContext(d.id).toContain(d.archiveCode);
    }
    // 變體文件只放佐證，不與來源重疊
    expect(review.receiptVariants.some((v) => review.sourceDocumentIds.includes(v.documentId))).toBeFalse();
  });

  it('dayPlan 仍只有一項 Day 3 歸檔、5 筆；其他四筆與 0314 等前導零不變', () => {
    const plan = dayPlan('day.03');
    expect(plan.tasks.map((t) => [t.id, t.kind, t.recordIds.length])).toEqual([[TASK, 'archive', 5]]);
    expect(plan.tasks[0].documentIds).toEqual(DOCS);
    expect(recordsOfTask(TASK).map((r) => r.code)).toEqual(['H-204', 'H-219', '0314', '0448', '0521']);
  });
});

describe('Day 4 林予安私訊依 Day 3 案件決定擇一顯示（cond.case.*，R9 §2）', () => {
  const CASE = 'case.day3.h204';
  const D3 = 'batch.day03.archive';
  const EXPECTED: Readonly<Record<string, string>> = {
    registry: 'msg.day4.h204.registry',
    supplement: 'msg.day4.h204.supplement',
    review: 'msg.day4.h204.review',
  };
  const caseShown = (decision: string | null | undefined, dayId = 'day.04', reviewed: readonly string[] = [], stage: Stage = 'work') =>
    ids(
      unlockedMessages(DM, ctx(dayId, stage, null, reviewed, {}, {}, decision === undefined ? {} : { [CASE]: decision })).filter((m) =>
        m.id.startsWith('msg.day4.h204.'),
      ),
    );

  it('三則的欄位與台詞逐字', () => {
    const row = (id: string) => {
      const m = bundle.contentMessage(id);
      return [m.channelId, m.actorId, m.time, m.visibleFrom, m.unlock, m.lines];
    };
    expect(row(EXPECTED['registry'])).toEqual([DM, 'actor.lin-yuan', '09:21', 'day.04', ['cond.case.day3.h204.registry'], [
      '昨天黃品蓉那張補件，窗口說會再核一下。我看原表跟補件都還在附件裡，先不用重做。',
    ]]);
    expect(row(EXPECTED['supplement'])).toEqual([DM, 'actor.lin-yuan', '09:21', 'day.04', ['cond.case.day3.h204.supplement'], [
      '昨天黃品蓉那筆先照補件送出了，原表也留在附件。窗口如果回問，我再轉給你。',
    ]]);
    expect(row(EXPECTED['review'])).toEqual([DM, 'actor.lin-yuan', '09:21', 'day.04', ['cond.case.day3.h204.review'], [
      '昨天那筆待查件窗口收到了，還沒回哪個編號要用。先放著，我有消息再跟你說。',
    ]]);
  });

  it('三個決定互斥：每個決定只解鎖對應的一則，Day 4 之後各日與不同覆核結果都一樣', () => {
    for (const [decision, id] of Object.entries(EXPECTED)) {
      for (const dayId of ['day.04', 'day.05', 'day.06']) {
        for (const reviewed of [[], [D3]]) {
          expect(caseShown(decision, dayId, reviewed)).withContext(`${decision} ${dayId} ${reviewed.join(',')}`).toEqual([id]);
        }
      }
      expect(caseShown(decision, 'day.06', [], 'end')).toEqual([id]);
    }
  });

  it('沒有案件決定（null、未保存、舊存檔）或未知決定都不顯示任何一則', () => {
    expect(caseShown(null)).toEqual([]);
    expect(caseShown(undefined)).toEqual([]);
    expect(caseShown('other')).toEqual([]);
    expect(caseShown(undefined, 'day.06', [D3], 'end')).toEqual([]);
  });

  it('Day 3 當天做了決定也還看不到（visibleFrom 是 Day 4）', () => {
    for (const decision of Object.keys(EXPECTED)) expect(caseShown(decision, 'day.03')).withContext(decision).toEqual([]);
  });

  it('只看 case.day3.h204：其他案件 ID 的決定不影響', () => {
    const c = ctx('day.04', 'work', null, [], {}, {}, { 'case.day9.other': 'registry' });
    expect(ids(unlockedMessages(DM, c)).some((id) => id.startsWith('msg.day4.h204.'))).toBeFalse();
  });

  it('私訊頻道完整順序：案件訊息接在 Day 3 之後、Day 6 之前', () => {
    expect(ids(unlockedMessages(DM, ctx('day.06', 'end', night(0), [], {}, {}, { [CASE]: 'supplement' })))).toEqual([
      'msg.day1.welcome',
      'msg.day1.pace',
      'msg.day2.handoff',
      'msg.day2.smalltalk-printer',
      'msg.day2.check-in',
      'msg.day3.dm-drafts',
      'msg.day4.h204.supplement',
      'msg.day6.dm-field-order',
    ]);
  });

  it('isUnlocked 與 unlockedMessages 一致（未讀／對話串共用）', () => {
    for (const decision of [null, 'registry', 'supplement', 'review']) {
      const c = ctx('day.04', 'work', null, [], {}, {}, { [CASE]: decision });
      expect(ids(unlockedMessages(DM, c))).withContext(String(decision)).toEqual(
        messagesOfChannel(DM).filter((m) => isUnlocked(m, c)).map((m) => m.id),
      );
    }
  });

  it('Day 4 午休群組 review.any／none 不受案件決定影響（案件的待查 ≠ origin=review）', () => {
    const ANY = ['msg.day4.review-returned', 'msg.day4.review-name', 'msg.day4.review-mood'];
    const NONE = ['msg.day4.quick-praise', 'msg.day4.green-number'];
    for (const decision of [null, 'registry', 'supplement', 'review']) {
      for (const reviewed of [[], [D3]]) {
        const shown = unlockedMessages(LUNCH, ctx('day.04', 'work', null, reviewed, {}, {}, { [CASE]: decision })).filter(
          (m) => m.visibleFrom === 'day.04',
        );
        expect(ids(shown)).withContext(`${decision} ${reviewed.join(',')}`).toEqual(reviewed.includes(D3) ? ANY : NONE);
      }
    }
  });

  it('Day 3 午餐 unlockAfter 與 Day 4 吳婉庭私訊分支不受案件決定影響', () => {
    for (const decision of [null, 'registry', 'review']) {
      const cases = { [CASE]: decision };
      expect(unlockedMessages(LUNCH, ctx('day.03', 'work', null, [], {}, { [D3]: 1 }, cases))).withContext(String(decision)).toEqual([]);
      expect(unlockedMessages(LUNCH, ctx('day.03', 'work', null, [], {}, { [D3]: 2 }, cases)).length).withContext(String(decision)).toBe(4);
      expect(ids(unlockedMessages(DM_WU, ctx('day.04', 'work', null, [], { [LUNCH_PROMPT]: 'join' }, {}, cases)))).toEqual([
        'msg.day4.dm-lunch-join',
      ]);
      expect(unlockedMessages(DM_WU, ctx('day.04', 'work', null, [], {}, {}, cases))).toEqual([]);
    }
  });
});

describe('Day 3 退件通知與 Day 4 退件複審（cond.return.notified.*，R10 §5）', () => {
  const AUDIT = 'day1-code-audit';
  const MSG = 'msg.day3.return-code-audit';
  const REVIEW_TASK = 'task.day4.return-review';
  const D3 = 'batch.day03.archive';
  const CASE = 'case.day3.h204';
  /** `notified`：狀態層回報已通知退件的稽核。 */
  const dmShown = (notified: readonly string[], dayId = 'day.03', stage: Stage = 'work') =>
    ids(unlockedMessages(DM, ctx(dayId, stage, null, [], {}, {}, {}, notified)));

  it('訊息逐字整合自 doc/content/R10-return-review.json（欄位、條件與台詞不改寫）', () => {
    const m = bundle.contentMessage(MSG);
    expect(m).toEqual({
      id: MSG,
      channelId: DM,
      actorId: 'actor.lin-yuan',
      time: '09:32',
      visibleFrom: 'day.03',
      unlock: ['cond.return.notified.day1-code-audit'],
      lines: [
        '窗口剛把文件退回來了，人員編號跟原表對不上。你昨天核對時怎麼還是放行了？',
        '退件明天會回到你的待辦，原表跟送件紀錄都附在裡面。這次請逐筆看過再送。',
      ],
    });
    expect(dayContentById('day.03').messages.map((x) => x.id)).toContain(MSG);
    expect(ALL_MESSAGES.filter((x) => x.unlock.some((c) => c.startsWith('cond.return.'))).map((x) => x.id)).toEqual([MSG]);
  });

  it('沒有 returnNotified（沒有退件、資料正確、保留待查、只確認收件、舊檔）時不顯示', () => {
    for (const dayId of ['day.03', 'day.04', 'day.06']) {
      expect(dmShown([], dayId)).withContext(dayId).not.toContain(MSG);
    }
    expect(dmShown(['other-audit'])).not.toContain(MSG);
  });

  it('returnNotified(day1-code-audit) 為真才解鎖；之後各日（含處理完畢）仍留在頻道歷史', () => {
    expect(dmShown([AUDIT])).toContain(MSG);
    for (const dayId of ['day.04', 'day.05', 'day.06']) {
      for (const stage of ['work', 'wrap', 'morning'] as const) {
        expect(dmShown([AUDIT], dayId, stage)).withContext(`${dayId} ${stage}`).toContain(MSG);
      }
    }
    expect(dmShown([AUDIT], 'day.06', 'end')).toContain(MSG);
  });

  it('visibleFrom 仍是 Day 3：Day 2 即使回報已通知也看不到', () => {
    expect(dmShown([AUDIT], 'day.02')).not.toContain(MSG);
  });

  it('私訊頻道完整順序：接在 Day 3 早訊之後、Day 4 案件訊息之前', () => {
    expect(ids(unlockedMessages(DM, ctx('day.04', 'work', night(1), [], {}, {}, { [CASE]: 'registry' }, [AUDIT])))).toEqual([
      'msg.day1.welcome',
      'msg.day1.pace',
      'msg.day2.handoff',
      'msg.day2.smalltalk-tea',
      'msg.day2.check-in',
      'msg.day3.dm-drafts',
      MSG,
      'msg.day4.h204.registry',
    ]);
  });

  it('isUnlocked 與 unlockedMessages 一致（未讀／對話串共用）', () => {
    for (const notified of [[], [AUDIT]]) {
      const c = ctx('day.03', 'work', null, [], {}, {}, {}, notified);
      expect(ids(unlockedMessages(DM, c))).withContext(notified.join(',')).toEqual(
        messagesOfChannel(DM).filter((m) => isUnlocked(m, c)).map((m) => m.id),
      );
    }
  });

  it('day-04 工作為 [archive, return-review, attachment, transform]；複審任務沒有自己的紀錄與文件', () => {
    expect(tasksOfDay('day.04').map((t) => [t.id, t.kind])).toEqual([
      ['task.day4.archive', 'archive'],
      [REVIEW_TASK, 'return-review'],
      ['task.day4.m1-attachment', 'attachment'],
      ['task.day4.m1-transform', 'transform'],
    ]);
    expect(returnReviewTask(REVIEW_TASK)).toEqual({
      id: REVIEW_TASK,
      kind: 'return-review',
      auditId: AUDIT,
      recordIds: [],
      documentIds: [],
      text: { eyebrow: 'RETURN / REVIEW 04' },
    });
    // auditId 是可省略的作者參照（R11 起不決定處理對象）；內容有填才帶
    expect(dayPlan('day.04').tasks[1]).toEqual({ id: REVIEW_TASK, kind: 'return-review', auditId: AUDIT, recordIds: [], documentIds: [] });
    expect(recordsOfTask(REVIEW_TASK)).toEqual([]);
    expect(documentsOfTask(REVIEW_TASK)).toEqual([]);
    expect(() => returnReviewTask('task.day4.archive')).toThrowError(/不是 return-review/);
    expect(() => archiveTask(REVIEW_TASK)).toThrowError(/不是 archive/);
  });

  it('稽核定義在 Day 2 核對任務：通知 Day 3、複審 Day 4、案號樣板 RT-{key}；returnAuditOf 未知回傳 undefined', () => {
    expect(reconcileTask('task.day2.reconcile').returnAudit).toEqual({
      id: AUDIT,
      notifyDayId: 'day.03',
      reviewTaskId: REVIEW_TASK,
      caseNumberTemplate: 'RT-{key}',
    });
    expect(bundle.ALL_RETURN_AUDITS.map((e) => e.audit.id)).toEqual([AUDIT]);
    const entry = returnAuditOf(AUDIT);
    expect(entry?.reconcileTaskId).toBe('task.day2.reconcile');
    expect(entry?.dayId).toBe('day.02');
    expect(entry?.sourceBatchId).toBe('batch.day01.archive');
    expect(entry?.audit).toBe(reconcileTask('task.day2.reconcile').returnAudit);
    expect(returnAuditOf('day9-retired')).toBeUndefined();
  });

  it('R11：caseNumberTemplateOf 取稽核的案號樣板；未知稽核回傳 undefined（舊存檔不因此失效）', () => {
    expect(caseNumberTemplateOf(AUDIT)).toBe('RT-{key}');
    expect(caseNumberTemplateOf(AUDIT)).toBe(returnAuditOf(AUDIT)?.audit.caseNumberTemplate);
    expect(caseNumberTemplateOf('day9-retired')).toBeUndefined();
  });

  it('R11：每日錯誤文件處理位置——內容定義的 Day 4 任務用自己的 eyebrow，虛擬任務 issueTaskId(n) 用共用字', () => {
    const ui = CONTENT.ui.documentIssues;
    expect(issueTaskId(4)).toBe(REVIEW_TASK);
    expect(issueTaskText(REVIEW_TASK)).toEqual({ eyebrow: 'RETURN / REVIEW 04', heading: ui.taskHeading, instruction: ui.taskInstruction });
    for (const n of [1, 2, 3, 5, 6]) {
      const id = issueTaskId(n);
      expect(id).toBe(`task.day${n}.return-review`);
      expect(parseIssueTaskId(id)).toBe(n);
      expect(() => contentTask(id)).withContext(id).toThrowError(/找不到任務/);
      expect(issueTaskText(id)).withContext(id).toEqual({ eyebrow: ui.taskEyebrow, heading: ui.taskHeading, instruction: ui.taskInstruction });
    }
    expect(parseIssueTaskId('task.day4.archive')).toBeNaN();
    // 不存在的日、或不是 return-review 的內容任務，都不是錯誤文件處理位置
    expect(() => issueTaskText(issueTaskId(9))).toThrowError(/task\.day9\.return-review/);
    expect(() => issueTaskText('task.day4.archive')).toThrowError(/不是 return-review/);
  });

  it('Day 3 午餐 unlockAfter 不受退件通知影響', () => {
    for (const notified of [[], [AUDIT]]) {
      expect(unlockedMessages(LUNCH, ctx('day.03', 'work', null, [], {}, { [D3]: 1 }, {}, notified))).withContext(notified.join(',')).toEqual([]);
      expect(unlockedMessages(LUNCH, ctx('day.03', 'work', null, [], {}, { [D3]: 2 }, {}, notified)).length).withContext(notified.join(',')).toBe(4);
    }
  });

  it('Day 4 午休群組 review.any／none 不受退件通知影響（退件 ≠ origin=review）', () => {
    const ANY = ['msg.day4.review-returned', 'msg.day4.review-name', 'msg.day4.review-mood'];
    const NONE = ['msg.day4.quick-praise', 'msg.day4.green-number'];
    for (const notified of [[], [AUDIT]]) {
      for (const reviewed of [[], [D3]]) {
        const shown = unlockedMessages(LUNCH, ctx('day.04', 'work', null, reviewed, {}, {}, {}, notified)).filter((m) => m.visibleFrom === 'day.04');
        expect(ids(shown)).withContext(`${notified.join(',')} ${reviewed.join(',')}`).toEqual(reviewed.includes(D3) ? ANY : NONE);
      }
    }
  });

  it('案件與聊天條件不受退件通知影響', () => {
    for (const notified of [[], [AUDIT]]) {
      const caseOnly = ids(unlockedMessages(DM, ctx('day.04', 'work', null, [], {}, {}, { [CASE]: 'review' }, notified)));
      expect(caseOnly.filter((id) => id.startsWith('msg.day4.h204.'))).withContext(notified.join(',')).toEqual(['msg.day4.h204.review']);
      expect(ids(unlockedMessages(DM_WU, ctx('day.04', 'work', null, [], { [LUNCH_PROMPT]: 'ask-floor' }, {}, {}, notified)))).toEqual([
        'msg.day4.dm-lunch-floor',
      ]);
      expect(unlockedMessages(DM_WU, ctx('day.04', 'work', null, [], {}, {}, {}, notified))).toEqual([]);
    }
    // 案件決定與聊天回覆也不會解鎖退件通知
    expect(dmShown([], 'day.04')).not.toContain(MSG);
    const noReturn = ids(unlockedMessages(DM, ctx('day.04', 'work', null, [D3], { [LUNCH_PROMPT]: 'join' }, {}, { [CASE]: 'review' })));
    expect(noReturn).not.toContain(MSG);
  });
});

describe('退件條件 ID（R10）', () => {
  it('returnConditionId／parseReturnCondition 互為反函式', () => {
    const id = returnConditionId('day1-code-audit');
    expect(id).toBe('cond.return.notified.day1-code-audit');
    expect(parseReturnCondition(id)).toEqual({ auditId: 'day1-code-audit' });
    expect(isConditionId(id)).toBeTrue();
  });

  it('格式不符回傳 null、組裝時丟例外', () => {
    for (const bad of ['cond.return.notified.', 'cond.return.notified.Day1', 'cond.return.notified.a.b', 'cond.return.day1-code-audit', 'cond.return.']) {
      expect(parseReturnCondition(bad)).withContext(bad).toBeNull();
      expect(isConditionId(bad)).withContext(bad).toBeFalse();
    }
    expect(parseReturnCondition('cond.case.day3.h204.review')).toBeNull();
    expect(() => returnConditionId('a.b')).toThrowError(/無法組出退件條件/);
    expect(() => returnConditionId('')).toThrowError(/無法組出退件條件/);
  });

  it('evaluateCondition 只讀 returnNotified；其他狀態不影響', () => {
    const id = 'cond.return.notified.day1-code-audit';
    expect(evaluateCondition(id, ctx('day.03', 'work', null, [], {}, {}, {}, ['day1-code-audit']))).toBeTrue();
    expect(evaluateCondition(id, ctx('day.03'))).toBeFalse();
    expect(evaluateCondition(id, ctx('day.03', 'work', null, ['batch.day01.archive'], {}, {}, { 'case.day3.h204': 'review' }, ['other']))).toBeFalse();
  });
});

describe('案件條件 ID（R9）', () => {
  it('caseConditionId／parseCaseCondition 互為反函式；以最後一個 . 切開', () => {
    const id = caseConditionId('case.day3.h204', 'supplement');
    expect(id).toBe('cond.case.day3.h204.supplement');
    expect(parseCaseCondition(id)).toEqual({ caseId: 'case.day3.h204', decisionId: 'supplement' });
    expect(isConditionId(id)).toBeTrue();
  });

  it('格式不符回傳 null、組裝時丟例外', () => {
    for (const bad of ['cond.case.', 'cond.case.day3', 'cond.case.day3.h204.Registry', 'cond.case..registry', 'cond.case.day3.h204.']) {
      expect(parseCaseCondition(bad)).withContext(bad).toBeNull();
      expect(isConditionId(bad)).withContext(bad).toBeFalse();
    }
    expect(parseCaseCondition('cond.chat.day3.lunch-plan.join')).toBeNull();
    expect(() => caseConditionId('day3.h204', 'registry')).toThrowError(/無法組出案件條件/);
    expect(() => caseConditionId('case.day3.h204', 'a.b')).toThrowError(/無法組出案件條件/);
  });

  it('evaluateCondition 只讀 caseDecision；null 不成立', () => {
    const c = (decision: string | null) => ctx('day.04', 'work', null, [], {}, {}, { 'case.day3.h204': decision });
    expect(evaluateCondition('cond.case.day3.h204.review', c('review'))).toBeTrue();
    expect(evaluateCondition('cond.case.day3.h204.review', c('registry'))).toBeFalse();
    expect(evaluateCondition('cond.case.day3.h204.review', c(null))).toBeFalse();
  });
});

describe('Day 4 吳婉庭私訊依 Day 3 午餐回覆解鎖（cond.chat.*，R7 §3、§8）', () => {
  const EXPECTED: Readonly<Record<string, string>> = {
    join: 'msg.day4.dm-lunch-join',
    'ask-floor': 'msg.day4.dm-lunch-floor',
    'brought-own': 'msg.day4.dm-lunch-own',
  };

  it('三個 choice 各自只解鎖對應的一則', () => {
    expect(promptOf(LUNCH_PROMPT)?.prompt.choices.map((c) => c.id)).toEqual(Object.keys(EXPECTED));
    for (const [choice, id] of Object.entries(EXPECTED)) {
      for (const dayId of ['day.04', 'day.05', 'day.06']) {
        for (const reviewed of [[], ['batch.day03.archive']]) {
          const shown = unlockedMessages(DM_WU, ctx(dayId, 'work', null, reviewed, { [LUNCH_PROMPT]: choice }));
          expect(ids(shown)).withContext(`${choice} ${dayId}`).toEqual([id]);
        }
      }
    }
  });

  it('skipped 或未回答都不解鎖任何一則', () => {
    expect(unlockedMessages(DM_WU, ctx('day.04', 'work', null, [], { [LUNCH_PROMPT]: null }))).toEqual([]);
    expect(unlockedMessages(DM_WU, ctx('day.04'))).toEqual([]);
    expect(unlockedMessages(DM_WU, ctx('day.06', 'end'))).toEqual([]);
  });

  it('只看 Day 3 午餐 prompt：其他 prompt 的回答不影響', () => {
    const other = { 'prompt.day1.welcome': 'thanks', 'prompt.day2.check-in': 'complicated' };
    expect(unlockedMessages(DM_WU, ctx('day.04', 'work', null, [], other))).toEqual([]);
  });

  it('Day 3 當天回答後私訊還不會出現（visibleFrom 是 Day 4）', () => {
    expect(unlockedMessages(DM_WU, ctx('day.03', 'work', null, [], { [LUNCH_PROMPT]: 'join' }))).toEqual([]);
  });

  it('私訊文字逐字', () => {
    expect(Object.values(EXPECTED).map((id) => bundle.contentMessage(id).lines)).toEqual([
      ['昨天午餐的 85 我晚點再跟你收，先記著。'],
      ['七樓今天可以送上去了。昨天那袋我拿到時，醬汁已經漏一半。'],
      ['你今天也有帶嗎？我正在認真考慮改過自新。'],
    ]);
  });
});

describe('固定回覆 prompt（R7 §3）', () => {
  it('每個 prompt 都能用 promptOf 取得，anchor 就是掛著它的訊息', () => {
    expect(ALL_PROMPTS.map((e) => [e.prompt.id, e.anchor.id, e.anchor.channelId, e.prompt.availableThrough])).toEqual([
      ['prompt.day1.welcome', 'msg.day1.pace', DM, 'day.01'],
      ['prompt.help.refusal', 'msg.help.refusal.paths', DM, 'day.06'],
      ['prompt.day2.check-in', 'msg.day2.check-in', DM, 'day.02'],
      ['prompt.day3.lunch-plan', 'msg.day3.lunch-ask-player', LUNCH, 'day.03'],
      ['prompt.day3.m1-find-version', 'msg.day3.m1-find-version', DM, 'day.03'],
      ['prompt.day4.review-returned', 'msg.day4.review-mood', LUNCH, 'day.04'],
      ['prompt.day4.quick-close', 'msg.day4.green-number', LUNCH, 'day.04'],
      ['prompt.day4.m1-desk-fan', 'msg.day4.m1-desk-fan', LUNCH, 'day.04'],
      ['prompt.day4.m1-window-receipt', 'msg.day4.m1-window-receipt', DM, 'day.04'],
      ['prompt.day5.m1-coffee', 'msg.day5.m1-coffee', LUNCH, 'day.05'],
      ['prompt.day5.missing-box', 'msg.day5.box-is-box', LUNCH, 'day.05'],
      ['prompt.day5.m1-default-question', 'msg.day5.m1-default-question', DM, 'day.05'],
      ['prompt.day6.m1-week-start', 'msg.day6.m1-week-start', LUNCH, 'day.06'],
      ['prompt.day6.closed-box', 'msg.day6.box-system', LUNCH, 'day.06'],
      ['prompt.day6.m1-handoff-meaning', 'msg.day6.m1-handoff-meaning', DM, 'day.06'],
    ]);
    for (const e of ALL_PROMPTS) {
      const found = promptOf(e.prompt.id);
      expect(found).withContext(e.prompt.id).toBeDefined();
      expect(found?.anchor).toBe(e.anchor);
      expect(found?.prompt).toBe(e.anchor.replyPrompt as NonNullable<typeof e.anchor.replyPrompt>);
      expect(dayOrder(e.prompt.availableThrough)).toBeGreaterThanOrEqual(dayOrder(e.anchor.visibleFrom));
    }
  });

  it('未知的 prompt 回傳 undefined（舊存檔的 prompt 可能已從內容移除）', () => {
    expect(promptOf('prompt.day9.nope')).toBeUndefined();
    expect(promptOf('')).toBeUndefined();
  });

  it('promptsOfChannel 依內容順序', () => {
    expect(promptsOfChannel(DM).map((e) => e.prompt.id)).toEqual([
      'prompt.day1.welcome',
      'prompt.help.refusal',
      'prompt.day2.check-in',
      'prompt.day3.m1-find-version',
      'prompt.day4.m1-window-receipt',
      'prompt.day5.m1-default-question',
      'prompt.day6.m1-handoff-meaning',
    ]);
    expect(promptsOfChannel(LUNCH).map((e) => e.prompt.id)).toEqual([
      'prompt.day3.lunch-plan',
      'prompt.day4.review-returned',
      'prompt.day4.quick-close',
      'prompt.day4.m1-desk-fan',
      'prompt.day5.m1-coffee',
      'prompt.day5.missing-box',
      'prompt.day6.m1-week-start',
      'prompt.day6.closed-box',
    ]);
    expect(promptsOfChannel(DEPT)).toEqual([]);
    expect(promptsOfChannel(DM_WU)).toEqual([]);
  });

  it('每則回應的作者都是 anchor 頻道成員，時間為 HH:MM', () => {
    for (const { prompt, anchor } of ALL_PROMPTS) {
      const members = channel(anchor.channelId).actorIds;
      for (const r of prompt.choices.flatMap((c) => c.responses)) {
        expect(members).withContext(r.id).toContain(r.actorId);
        expect(r.time).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });

  it('回應不另存頻道與可見日（繼承 anchor）', () => {
    for (const { prompt } of ALL_PROMPTS) {
      for (const r of prompt.choices.flatMap((c) => c.responses)) {
        expect(Object.keys(r).sort()).withContext(r.id).toEqual(['actorId', 'id', 'lines', 'time']);
      }
    }
  });

  it('Day 3 午餐 prompt 逐字', () => {
    expect(promptOf(LUNCH_PROMPT)?.prompt).toEqual({
      id: 'prompt.day3.lunch-plan',
      availableThrough: 'day.03',
      choices: [
        {
          id: 'join',
          text: '都可以，我跟你們一起。',
          responses: [
            { id: 'msg.day3.reply.join-wu', actorId: 'actor.wu-wan-ting', time: '11:46', lines: ['好，我先幫你點不辣的。不要香菜的現在說。'] },
            { id: 'msg.day3.reply.join-yang', actorId: 'actor.yang-zi-qian', time: '11:47', lines: ['我的不要。婉庭，上次妳說有記住。'] },
          ],
        },
        {
          id: 'ask-floor',
          text: '七樓為什麼不收外送？',
          responses: [
            { id: 'msg.day3.reply.floor-yang', actorId: 'actor.yang-zi-qian', time: '11:46', lines: ['警衛說今天那邊在清點，先放一樓。'] },
            { id: 'msg.day3.reply.floor-wu', actorId: 'actor.wu-wan-ting', time: '11:47', lines: ['那我先下去拿。再放下去湯都涼了。'] },
          ],
        },
        {
          id: 'brought-own',
          text: '我自己帶了。',
          responses: [
            { id: 'msg.day3.reply.own-wu', actorId: 'actor.wu-wan-ting', time: '11:46', lines: ['好。下次要訂再跟我說，我每天都在湊免運。'] },
          ],
        },
      ],
    });
  });

  it('其他 prompt 的選項文字', () => {
    const texts = (id: string) => promptOf(id)?.prompt.choices.map((c) => [c.id, c.text]);
    expect(texts('prompt.day1.welcome')).toEqual([['thanks', '好，謝謝。'], ['ask-review-time', '送覆核通常要等多久？']]);
    expect(texts('prompt.day2.check-in')).toEqual([['complicated', '還可以，系統比我想的複雜。'], ['checking-summary', '我還在看昨天的摘要。']]);
    expect(texts('prompt.day4.review-returned')).toEqual([['ask-useful', '那送覆核有用嗎？'], ['follow-rules', '我今天還是照規則做。']]);
    expect(texts('prompt.day4.quick-close')).toEqual([['is-praise', '這算稱讚嗎？'], ['ask-where', '那些資料後來去哪裡？']]);
    expect(texts('prompt.day5.missing-box')).toEqual([
      ['ask-signer', '簽收人是誰？'],
      ['wait-slip', '先等移交單回來。'],
      ['ask-upstairs', '要不要直接問樓上？'],
    ]);
    expect(texts('prompt.day6.closed-box')).toEqual([
      ['not-found', '那不算找到吧。'],
      ['no-more-calls', '至少不會再有人來問。'],
      ['ask-closer', '誰把單關掉的？'],
    ]);
  });
});

describe('聊天條件 ID（R7）', () => {
  it('chatConditionId／parseChatCondition 互為反函式；以最後一個 . 切開', () => {
    const id = chatConditionId(LUNCH_PROMPT, 'ask-floor');
    expect(id).toBe('cond.chat.day3.lunch-plan.ask-floor');
    expect(parseChatCondition(id)).toEqual({ promptId: LUNCH_PROMPT, choiceId: 'ask-floor' });
    expect(isConditionId(id)).toBeTrue();
    for (const { prompt } of ALL_PROMPTS) {
      for (const c of prompt.choices) {
        expect(parseChatCondition(chatConditionId(prompt.id, c.id))).toEqual({ promptId: prompt.id, choiceId: c.id });
      }
    }
  });

  it('格式不符時 parse 回傳 null、組裝丟例外', () => {
    for (const bad of ['cond.chat.', 'cond.chat.join', 'cond.chat.day3.lunch-plan.', 'cond.chat.day3.lunch-plan.Join', 'cond.review.any.x']) {
      expect(parseChatCondition(bad)).withContext(bad).toBeNull();
    }
    expect(isConditionId('cond.chat.join')).toBeFalse();
    expect(() => chatConditionId('day3.lunch-plan', 'join')).toThrowError(/prompt/);
    expect(() => chatConditionId(LUNCH_PROMPT, 'a.b')).toThrowError(/choice/);
  });

  it('evaluateCondition 只讀 chatChoice；skipped（null）與未回答都不成立', () => {
    const id = chatConditionId(LUNCH_PROMPT, 'join');
    expect(evaluateCondition(id, ctx('day.04', 'work', null, [], { [LUNCH_PROMPT]: 'join' }))).toBeTrue();
    expect(evaluateCondition(id, ctx('day.04', 'work', null, [], { [LUNCH_PROMPT]: 'brought-own' }))).toBeFalse();
    expect(evaluateCondition(id, ctx('day.04', 'work', null, [], { [LUNCH_PROMPT]: null }))).toBeFalse();
    expect(evaluateCondition(id, ctx('day.04'))).toBeFalse();
  });
});

describe('訊息頁日期標籤（R7 §4）', () => {
  it('chatDateLabel 依日取得，不含 DAY／第 N 天', () => {
    expect(DAY_IDS.map(chatDateLabel)).toEqual(['9 月 15 日', '9 月 16 日', '9 月 17 日', '9 月 18 日', '9 月 19 日', '9 月 22 日']);
    for (const id of DAY_IDS) {
      expect(chatDateLabel(id)).not.toMatch(/DAY|第.+天/);
    }
    expect(() => chatDateLabel('day.09')).toThrowError(/day\.09/);
  });
});

describe('Day 3–6 訊息逐字（R7 §5）', () => {
  const line = (id: string) => bundle.contentMessage(id);
  const row = (id: string) => {
    const m = line(id);
    return [channelTitle(m.channelId), actorName(m.actorId), m.time, m.visibleFrom, ...m.lines];
  };

  it('Day 3', () => {
    // R9 §2：兩則早訊只換 lines；ID、頻道、人物、時間、解鎖條件不變
    expect(row('msg.day3.dept-large-batch')).toEqual(['資料作業組', '林予安', '08:19', 'day.03', '早，舊檔跟補件都到了。原表別刪，下午交接還會用。']);
    expect(row('msg.day3.dm-drafts')).toEqual(['林予安', '林予安', '08:24', 'day.03', '黃品蓉那筆有兩個版本。我先去回電話，你把自己用哪一份留在送件紀錄裡，免得窗口回問找不到。']);
    for (const id of ['msg.day3.dept-large-batch', 'msg.day3.dm-drafts']) {
      expect(line(id).unlock).withContext(id).toEqual([]);
      expect(line(id).actorId).withContext(id).toBe('actor.lin-yuan');
      expect('unlockAfter' in line(id)).withContext(id).toBeFalse();
    }
    expect(row('msg.day3.lunch-order')).toEqual(['午休雜談', '吳婉庭', '11:43', 'day.03', '有人要訂午餐嗎？七樓今天又不收外送。']);
    expect(row('msg.day3.lunch-yesterday')).toEqual(['午休雜談', '楊子謙', '11:44', 'day.03', '妳昨天才說那家很難吃。']);
    expect(row('msg.day3.lunch-hungry')).toEqual(['午休雜談', '吳婉庭', '11:44', 'day.03', '昨天的我沒有今天這麼餓。']);
    expect(row('msg.day3.lunch-ask-player')).toEqual(['午休雜談', '吳婉庭', '11:45', 'day.03', '你中午要不要一起訂？我差一份免運。']);
  });

  it('Day 4', () => {
    expect(row('msg.day4.dept-report')).toEqual(['資料作業組', '楊子謙', '08:15', 'day.04', '昨天的處理量已經併進本週報表。今天批次格式一樣。']);
    expect(row('msg.day4.dm-lunch-join')).toEqual(['吳婉庭', '吳婉庭', '09:07', 'day.04', '昨天午餐的 85 我晚點再跟你收，先記著。']);
    expect(row('msg.day4.dm-lunch-floor')).toEqual(['吳婉庭', '吳婉庭', '09:07', 'day.04', '七樓今天可以送上去了。昨天那袋我拿到時，醬汁已經漏一半。']);
    expect(row('msg.day4.dm-lunch-own')).toEqual(['吳婉庭', '吳婉庭', '09:07', 'day.04', '你今天也有帶嗎？我正在認真考慮改過自新。']);
    expect(row('msg.day4.review-returned')).toEqual(['午休雜談', '吳婉庭', '10:51', 'day.04', '昨天送覆核的幾筆，早上又回到佇列了。']);
    expect(row('msg.day4.review-name')).toEqual(['午休雜談', '楊子謙', '10:52', 'day.04', '我這邊也有兩筆。他們說要再找承辦拿附件。']);
    expect(row('msg.day4.review-mood')).toEqual(['午休雜談', '吳婉庭', '10:53', 'day.04', '所以今天先留著？我怕下午又要全部重送。']);
    expect(row('msg.day4.quick-praise')).toEqual(['午休雜談', '吳婉庭', '10:51', 'day.04', '昨天那批結得很快，主管剛在大群稱讚進度。']);
    expect(row('msg.day4.green-number')).toEqual(['午休雜談', '楊子謙', '10:52', 'day.04', '不過我昨天留的那幾筆待補還沒回。有人接到窗口電話嗎？']);
  });

  it('Day 5', () => {
    expect(row('msg.day5.dept-maintenance')).toEqual(['資料作業組', '林予安', '08:31', 'day.05', '下午會做例行維護，請在下班前完成交接。']);
    expect(row('msg.day5.box-question')).toEqual(['午休雜談', '吳婉庭', '12:06', 'day.05', '樓上昨天是不是少了一箱紙本？剛剛又打來問。']);
    expect(row('msg.day5.box-receipt')).toEqual(['午休雜談', '楊子謙', '12:07', 'day.05', '窗口顯示已簽收。']);
    expect(row('msg.day5.box-is-box')).toEqual(['午休雜談', '吳婉庭', '12:07', 'day.05', '我知道回條到了。我剛剛找過，箱子沒放在那裡。']);
  });

  it('Day 6', () => {
    expect(row('msg.day6.dept-field-map')).toEqual(['資料作業組', '林予安', '08:18', 'day.06', '今天改做服務銜接表的欄位轉換。先完成欄位對應，再確認匯入預覽。']);
    expect(row('msg.day6.dm-field-order')).toEqual(['林予安', '林予安', '08:27', 'day.06', '舊表的欄位順序每批不一樣，照欄位說明核對，不要只看畫面左右位置。']);
    expect(row('msg.day6.box-stop')).toEqual(['午休雜談', '吳婉庭', '11:56', 'day.06', '昨天那箱紙本不用找了。']);
    expect(row('msg.day6.box-closed')).toEqual(['午休雜談', '楊子謙', '11:57', 'day.06', '窗口把單關了。']);
    expect(row('msg.day6.box-found')).toEqual(['午休雜談', '吳婉庭', '11:57', 'day.06', '所以是找到了？']);
    expect(row('msg.day6.box-system')).toEqual(['午休雜談', '楊子謙', '11:58', 'day.06', '還沒找到。昨天收到的是電子回條，不是那張紙本移交單。']);
  });

  it('Day 3 起跨日歷史保留：Day 6 私訊包含 Day 1–6 的訊息', () => {
    expect(ids(unlockedMessages(DM, ctx('day.06', 'end', night(0))))).toEqual([
      'msg.day1.welcome',
      'msg.day1.pace',
      'msg.day2.handoff',
      'msg.day2.smalltalk-printer',
      'msg.day2.check-in',
      'msg.day3.dm-drafts',
      'msg.day6.dm-field-order',
    ]);
    expect(unlockedMessages(DEPT, ctx('day.02'))).toEqual([]);
    expect(ids(unlockedMessages(DEPT, ctx('day.03')))).toEqual(['msg.day3.dept-large-batch']);
  });
});

describe('訊息文案只有一份來源（以頻道 API 逐字驗證）', () => {
  it('Day 1 兩則訊息的作者、時間與內容', () => {
    const day1 = unlockedMessages(DM, ctx('day.01'));
    expect(day1.map((m) => actorName(m.actorId))).toEqual(['林予安', '林予安']);
    expect(day1.map((m) => m.time)).toEqual(['08:36', '08:37']);
    expect(day1.flatMap((m) => m.lines)).toEqual([
      '早安！今天先熟悉歸檔就好。左邊是送來的資料，右邊依來源核對人員編號。',
      '遇到缺的項目可以送覆核，不用急。茶水間的杯子都能用。',
    ]);
  });

  it('Day 2 主訊息與兩個閒聊版本的內容，版本由 night.smallTalkVariant 決定', () => {
    const v0 = unlockedMessages(DM, ctx('day.02', 'work', night(0))).slice(2);
    const v1 = unlockedMessages(DM, ctx('day.02', 'work', night(1))).slice(2);
    expect(v0.map((m) => m.time)).toEqual(['08:42', '08:43', '08:44']);
    expect(v0.flatMap((m) => m.lines)).toEqual([
      '昨天那批已經收到。今天先核對摘要，晚點還有一批新件。',
      '對了，窗邊那台印表機有時候要多等一下。它不是壞掉，只是很有自己的步調。',
      '昨天第一天還習慣嗎？',
    ]);
    expect(v1.flatMap((m) => m.lines)).toEqual([
      '昨天那批已經收到。今天先核對摘要，晚點還有一批新件。',
      '茶水間補了新的茶包。紙盒上寫高山茶，喝起來比較像熱水，但至少是熱的。',
      '昨天第一天還習慣嗎？',
    ]);
    expect(v1[1].variant).toEqual({ key: 'night.smallTalkVariant', value: 1 });
  });

  it('訊息文字與每日資料檔一致', () => {
    expect(unlockedMessages(DM, ctx('day.01')).flatMap((m) => m.lines)).toEqual(
      dayContentById('day.01').messages.flatMap((m) => m.lines),
    );
  });

  it('同事稱呼來自 actors.json，不在介面檔另存一份', () => {
    expect(ASIDE.colleague).toBe(actorName(CONTENT.ui.aside.colleagueActorId));
    expect(ASIDE.colleague).toBe(channelTitle(DM));
  });

  it('公告文字來自 bulletins.json', () => {
    const welcome = CONTENT.bulletins[0];
    expect(NEWS.title).toBe(welcome.title);
    expect(NEWS.body).toBe(welcome.body[0]);
  });
});

/* ---------- R12：郵件、入職與詢問說明包 ---------- */

describe('R12 內容包的載入與清單', () => {
  it('三種內容包都經 manifest 載入並通過驗證', () => {
    expect(CONTENT_FILES.mail).toEqual(['data/mail/return-receipts.json']);
    expect(CONTENT_FILES.onboarding).toBe('data/onboarding/first-arrival.json');
    expect(CONTENT_FILES.help).toEqual(['data/help/refusal-record.json']);
    expect(CONTENT.mail.map((m) => m.id)).toEqual(['mail.return-receipts']);
    expect(CONTENT.onboarding.id).toBe('onboarding.first-arrival');
    expect(CONTENT.help.map((h) => h.id)).toEqual(['help.refusal-record']);
  });

  it('dayDateLabel 與訊息頁日期同一份（chatDateLabel）', () => {
    for (const id of DAY_IDS) expect(bundle.dayDateLabel(id)).withContext(id).toBe(chatDateLabel(id));
    expect(() => bundle.dayDateLabel('day.09')).toThrowError(/day\.09/);
  });
});

describe('郵件包（R12）', () => {
  it('mailPack 取得退件回條包：寄件者、returned／resolved 模板逐字', () => {
    const pack = bundle.mailPack(RETURN_RECEIPT_MAIL_PACK_ID);
    expect(bundle.MAIL_PACKS.map((p) => p.id)).toEqual([RETURN_RECEIPT_MAIL_PACK_ID]);
    expect(pack?.sender).toEqual({ id: 'sender.data-desk', name: '資料作業窗口' });
    expect(pack?.templates.returned.subject).toBe('文件退回｜{caseNumber}');
    expect(pack?.templates.returned.lines).toEqual([
      '你好，這筆文件核對後仍需修正。',
      '案件：{caseNumber}',
      '核對版本：{versionLabel}',
      '退回原因：{reason}',
      '請從本信附件開啟文件，確認後重新送審；需要補查的項目也可以轉交窗口。',
    ]);
    expect(pack?.templates.resolved.subject).toBe('文件核對完成｜{caseNumber}');
    expect(pack?.templates.resolved.attachmentLabel).toBe('{caseNumber}｜{versionLabel}｜核對結果');
  });

  it('模板 ID 就是回條種類（ISSUE_RECEIPT_KINDS）', () => {
    const pack = bundle.mailPack(RETURN_RECEIPT_MAIL_PACK_ID);
    expect(Object.keys(pack?.templates ?? {})).toEqual([...ISSUE_RECEIPT_KINDS]);
  });

  it('未知郵件包回傳 undefined（舊存檔可能引用已移除的包）', () => {
    expect(bundle.mailPack('mail.retired')).toBeUndefined();
    expect(bundle.mailPack('')).toBeUndefined();
  });
});

describe('入職前情包（R12）', () => {
  it('八段依序；合約是第六段（index 5），不在頭尾', () => {
    expect(bundle.ONBOARDING.steps.map((s) => [s.id, s.kind])).toEqual([
      ['offer', 'line'],
      ['letter', 'line'],
      ['company', 'line'],
      ['arrival', 'line'],
      ['welcome', 'line'],
      ['contract', 'contract'],
      ['signed', 'line'],
      ['workday', 'line'],
    ]);
    expect(bundle.onboardingContractIndex).toBe(5);
  });

  it('“Welcome to KodeBart.” 只在簽名後出現一次；簽名前的 welcome 段是接待人員遞文件', () => {
    const lines = bundle.ONBOARDING.steps.map((s) => (s.kind === 'line' ? s.text : ''));
    const welcomes = lines.flatMap((text, i) => (text.includes('Welcome to KodeBart') ? [i] : []));
    expect(welcomes).toEqual([bundle.onboardingContractIndex + 1]);
    expect(bundle.ONBOARDING.steps[bundle.onboardingContractIndex + 1]?.id).toBe('signed');
    expect(lines[bundle.ONBOARDING.steps.findIndex((s) => s.id === 'welcome')]).toBe('接待人員遞來一份入職文件。');
  });

  it('LEGACY_PLAYER_NAME：舊存檔沒有姓名時顯示「員工」（入職包 ui）', () => {
    expect(bundle.LEGACY_PLAYER_NAME).toBe('員工');
    expect(bundle.LEGACY_PLAYER_NAME).toBe(bundle.ONBOARDING.ui.legacyPlayerName);
  });

  it('合約條款與簽名欄逐字；簽名上限等於 core 的 PLAYER_NAME_MAX', () => {
    const contract = bundle.ONBOARDING.steps[bundle.onboardingContractIndex];
    if (contract.kind !== 'contract') throw new Error('contract');
    expect(contract.heading).toBe('現在，請閱讀以下合約內容。');
    expect(contract.clauses).toEqual(['一、請遵守工作守則，配合作業。', '二、請勿進入未獲授權的限制區域。', '三、請勿將機密資料攜出公司。']);
    expect(contract.signature.submit).toBe('同意並簽名');
    expect(contract.signature.maxGraphemes).toBe(PLAYER_NAME_MAX);
  });

  it('呈現設定：黑底白字、每字 40ms', () => {
    expect(bundle.ONBOARDING.presentation).toEqual({
      background: '#000000',
      foreground: '#ffffff',
      characterIntervalMs: 40,
      advance: 'reveal-current-then-next',
      reducedMotion: 'show-current-step',
    });
  });
});

describe('詢問說明包（R12）', () => {
  const REQUEST = 'request.refusal-record';
  const COND = 'cond.help.refusal-record.requested';
  const HELP_IDS = ['msg.help.refusal.meaning', 'msg.help.refusal.paths'];
  /** 已送出提問的 ctx。 */
  const asked = (dayId: string) => ctx(dayId, 'work', null, [], {}, {}, {}, [], [REQUEST]);

  it('helpRequestOf／helpPackOf：提問在林予安私訊，玩家提問文字逐字', () => {
    const request = bundle.helpRequestOf(REQUEST);
    expect(request).toEqual({
      id: REQUEST,
      channelId: DM,
      unlockCondition: COND,
      playerText: '予安，來源沒有附回覆紀錄，這兩種處理方式差在哪裡？',
      oncePerSave: true,
    });
    expect(bundle.helpPackOf(REQUEST)?.id).toBe('help.refusal-record');
    expect(bundle.HELP_PACKS.map((h) => h.request.id)).toEqual([REQUEST]);
  });

  it('helpMessages 依送達順序；未知提問回傳 undefined／空陣列', () => {
    expect(ids(bundle.helpMessages(REQUEST))).toEqual(HELP_IDS);
    expect(bundle.helpMessages('request.nobody')).toEqual([]);
    expect(bundle.helpRequestOf('request.nobody')).toBeUndefined();
    expect(bundle.helpPackOf('request.nobody')).toBeUndefined();
  });

  it('helpRequestOfMessage：只有說明訊息錨定在提問上（每日訊息、回應與未知 ID 為 undefined）', () => {
    for (const id of HELP_IDS) expect(bundle.helpRequestOfMessage(id)).withContext(id).toBe(REQUEST);
    expect(bundle.helpRequestOfMessage('msg.help.refusal.blank-response')).toBeUndefined();
    expect(bundle.helpRequestOfMessage('msg.day1.welcome')).toBeUndefined();
    expect(bundle.helpRequestOfMessage('msg.nobody')).toBeUndefined();
  });

  it('說明訊息加入 ALL_MESSAGES／contentMessage，prompt 加入 ALL_PROMPTS／promptOf', () => {
    for (const id of HELP_IDS) {
      expect(ALL_MESSAGES.map((m) => m.id)).withContext(id).toContain(id);
      expect(bundle.contentMessage(id).channelId).toBe(DM);
    }
    const entry = promptOf('prompt.help.refusal');
    expect(entry?.anchor.id).toBe('msg.help.refusal.paths');
    expect(entry?.prompt.availableThrough).toBe('day.06');
    expect(entry?.prompt.choices.map((c) => c.id)).toEqual(['ask-blank', 'ack']);
  });

  it('沒有提問時不解鎖；提問後從 Day 1 起任何一天都解鎖，排在同一 visibleFrom 的每日訊息之後', () => {
    for (const day of DAY_IDS) {
      expect(ids(unlockedMessages(DM, ctx(day))).filter((id) => HELP_IDS.includes(id))).withContext(day).toEqual([]);
      expect(ids(unlockedMessages(DM, asked(day))).filter((id) => HELP_IDS.includes(id))).withContext(day).toEqual(HELP_IDS);
    }
    expect(ids(unlockedMessages(DM, asked('day.01')))).toEqual(['msg.day1.welcome', 'msg.day1.pace', ...HELP_IDS]);
    expect(ids(unlockedMessages(DM, asked('day.02'))).slice(0, 5)).toEqual(['msg.day1.welcome', 'msg.day1.pace', ...HELP_IDS, 'msg.day2.handoff']);
  });

  it('說明訊息逐字（不給正解、不提世界觀）：安排項目、來源沒附回覆紀錄，以及兩種處理動作的去向', () => {
    expect(bundle.helpMessages(REQUEST).map((m) => m.lines)).toEqual([
      ['「拒絕紀錄」記的是有沒有拒絕後續聯繫安排。這張卡沒有附回覆紀錄，不用再找另一張表。'],
      ['你可以照部門預設補登後歸檔，或先留空送窗口查核。', '補登只是照規則處理，不代表本人真的回答過。'],
    ]);
  });

  it('追問與確認選項逐字（選項與回應 ID 不變）；確認選項是決定處理動作', () => {
    const choices = promptOf('prompt.help.refusal')?.prompt.choices ?? [];
    expect(choices.map((c) => [c.id, c.text, c.responses.map((r) => [r.id, r.lines])])).toEqual([
      [
        'ask-blank',
        '那補登的「未拒絕」，不是本人回覆？',
        [['msg.help.refusal.blank-response', ['對，是歸檔時套用的預設值。選「保留缺漏並送覆核」就不會補上這個答案。']]],
      ],
      ['ack', '懂了，我選怎麼處理這筆缺漏。', [['msg.help.refusal.ack-response', ['嗯，有卡住再問我。']]]],
    ]);
  });

  it('說明不以「未拒絕」「未確認」指代選項，也不要求另找原表', () => {
    const choices = promptOf('prompt.help.refusal')?.prompt.choices ?? [];
    const texts = [
      bundle.helpRequestOf(REQUEST)?.playerText ?? '',
      ...bundle.helpMessages(REQUEST).flatMap((m) => m.lines),
      ...choices.flatMap((c) => [c.text, ...c.responses.flatMap((r) => r.lines)]),
    ];
    expect(texts.length).toBe(8);
    for (const line of texts) {
      expect(line).withContext(line).not.toMatch(/選「(未拒絕|未確認)」/);
      expect(line).withContext(line).not.toContain('原表');
    }
  });
});

describe('詢問條件 ID（R12）', () => {
  const REQUEST = 'request.refusal-record';

  it('helpConditionId／parseHelpCondition 互為反函式', () => {
    const id = helpConditionId(REQUEST);
    expect(id).toBe('cond.help.refusal-record.requested');
    expect(parseHelpCondition(id)).toEqual({ requestId: REQUEST });
    expect(isConditionId(id)).toBeTrue();
    expect(parseHelpCondition(helpConditionId('request.a.b'))).toEqual({ requestId: 'request.a.b' });
  });

  it('格式不符時 parse 回傳 null、組裝丟例外', () => {
    for (const bad of ['cond.help.', 'cond.help..requested', 'cond.help.refusal-record', 'cond.help.Refusal.requested', 'cond.help.requested']) {
      expect(parseHelpCondition(bad)).withContext(bad).toBeNull();
    }
    expect(isConditionId('cond.help.refusal-record')).toBeFalse();
    expect(() => helpConditionId('refusal-record')).toThrowError(/request/);
    expect(() => helpConditionId('request.')).toThrowError(/request/);
  });

  it('evaluateCondition 只讀 helpRequested（已送出提問才成立）', () => {
    const id = helpConditionId(REQUEST);
    expect(evaluateCondition(id, ctx('day.03'))).toBeFalse();
    expect(evaluateCondition(id, ctx('day.03', 'work', null, [], {}, {}, {}, [], [REQUEST]))).toBeTrue();
    expect(evaluateCondition(id, ctx('day.03', 'work', null, [], {}, {}, {}, [], ['request.other']))).toBeFalse();
  });
});
