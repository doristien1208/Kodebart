import { CONTENT, archiveTask, contentTask, reconcileTask, taskHeading } from '../content/bundle';
import { ContentRecord, DayContent, issueTaskId } from '../content/schema';
import { DOCUMENT_ISSUES_UI } from '../content/text';
import { TaskPlan, batchIdOfTask, casePlanOf, findAudit, findCase, firstTaskOf, taskPlanOf } from '../core/day-plan';
import { SourceRecord } from '../core/types';
import { DAY_DIRECTORY, buildDayDirectory, issueTaskIdOf } from './day-directory';

/**
 * content → core 的唯一橋接：由正式內容建立 DayDirectory。
 * 這裡用正式 DAY_DIRECTORY，驗證它與 data/days/*.json 的 task／batch／nextDayId 一致。
 */

const DAY_01 = 'day.01';
const DAY_02 = 'day.02';
const DAY_06 = 'day.06';
const TASK_DAY1 = 'task.day1.archive';
const TASK_DAY1_FOLLOWUP = 'task.day1.archive-followup';
const TASK_DAY2 = 'task.day2.reconcile';
const TASK_DAY2_ARCHIVE = 'task.day2.archive';
const TASK_DAY6 = 'task.day6.field-map';
const TASK_DAY4_RETURN = 'task.day4.return-review';
/** R11：沒有內容定義 return-review 的日子，狀態層在第一件工作之後插入的虛擬「錯誤文件處理」位置。 */
const VIRTUAL_ISSUE: Record<string, string> = {
  'day.01': 'task.day1.return-review',
  'day.02': 'task.day2.return-review',
  'day.03': 'task.day3.return-review',
  'day.05': 'task.day5.return-review',
  'day.06': 'task.day6.return-review',
};
const BATCH_DAY01 = 'batch.day01.archive';
const BATCH_DAY01_FOLLOWUP = 'batch.day01.archive-followup';
const BATCH_DAY02 = 'batch.day02.archive';

const ALL_DAYS = ['day.01', 'day.02', 'day.03', 'day.04', 'day.05', 'day.06'];

/**
 * 當日有序工作佇列（R8：Day 1、Day 2 各兩件；R11：每天一個錯誤文件處理位置）。
 * Day 4 用內容定義的 task.day4.return-review（位置由內容決定：原歸檔工作之後）；
 * 其他日由狀態層在當日第一件工作之後插入虛擬的 task.day<N>.return-review。只在排入到期案件時適用。
 */
const DAY_TASKS: Record<string, readonly { id: string; kind: TaskPlan['kind'] }[]> = {
  'day.01': [
    { id: TASK_DAY1, kind: 'archive' },
    { id: VIRTUAL_ISSUE['day.01'], kind: 'return-review' },
    { id: TASK_DAY1_FOLLOWUP, kind: 'archive' },
  ],
  'day.02': [
    { id: TASK_DAY2, kind: 'reconcile' },
    { id: VIRTUAL_ISSUE['day.02'], kind: 'return-review' },
    { id: TASK_DAY2_ARCHIVE, kind: 'archive' },
  ],
  'day.03': [
    { id: 'task.day3.archive', kind: 'archive' },
    { id: VIRTUAL_ISSUE['day.03'], kind: 'return-review' },
  ],
  'day.04': [
    { id: 'task.day4.archive', kind: 'archive' },
    { id: TASK_DAY4_RETURN, kind: 'return-review' },
  ],
  'day.05': [
    { id: 'task.day5.archive', kind: 'archive' },
    { id: VIRTUAL_ISSUE['day.05'], kind: 'return-review' },
  ],
  'day.06': [
    { id: TASK_DAY6, kind: 'field-map' },
    { id: VIRTUAL_ISSUE['day.06'], kind: 'return-review' },
  ],
};

/** 各歸檔工作的批次與佇列順序（COLLABORATION.md §4／§5）。 */
const ARCHIVE_DAYS = [
  { dayId: 'day.01', taskId: TASK_DAY1, batchId: BATCH_DAY01, keys: ['H17', 'B102', 'B607'], codes: ['H-17', '0102', '0607'] },
  {
    dayId: 'day.01',
    taskId: TASK_DAY1_FOLLOWUP,
    batchId: BATCH_DAY01_FOLLOWUP,
    keys: ['H18', 'H19', 'H20'],
    codes: ['H-18', 'H-19', 'H-20'],
  },
  {
    dayId: 'day.02',
    taskId: TASK_DAY2_ARCHIVE,
    batchId: BATCH_DAY02,
    keys: ['H31', 'H32', 'H33', 'H34'],
    codes: ['H-31', 'H-32', 'H-33', 'H-34'],
  },
  {
    dayId: 'day.03',
    taskId: 'task.day3.archive',
    batchId: 'batch.day03.archive',
    keys: ['H204', 'H219', 'B314', 'B448', 'B521'],
    codes: ['H-204', 'H-219', '0314', '0448', '0521'],
  },
  {
    dayId: 'day.04',
    taskId: 'task.day4.archive',
    batchId: 'batch.day04.archive',
    keys: ['H233', 'H240', 'B716', 'B731', 'B842', 'B905'],
    codes: ['H-233', 'H-240', '0716', '0731', '0842', '0905'],
  },
  {
    dayId: 'day.05',
    taskId: 'task.day5.archive',
    batchId: 'batch.day05.archive',
    keys: ['H251', 'H267', 'B1013', 'B1044', 'B1108', 'B1160', 'B1202', 'B1219'],
    codes: ['H-251', 'H-267', '1013', '1044', '1108', '1160', '1202', '1219'],
  },
] as const;

function contentDay(id: string): DayContent {
  const d = CONTENT.days.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown day ${id}`);
  return d;
}

/** 某個工作在正式目錄中的日程；不存在即拋錯。 */
function taskOf(dayId: string, taskId: string): TaskPlan {
  const t = DAY_DIRECTORY.plan(dayId)?.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error(`Task ${taskId} is not on ${dayId}`);
  return t;
}

function toSource(r: ContentRecord): SourceRecord {
  return { key: r.key, name: r.name, code: r.code, refusal: r.refusal, refusalApplies: r.refusalApplies };
}

describe('DAY_DIRECTORY（正式內容）', () => {
  it('六天依序 day.01 → … → day.06，與內容檔一致', () => {
    const expected = [...CONTENT.days].sort((a, b) => a.day - b.day).map((d) => d.id);
    expect(DAY_DIRECTORY.days).toEqual(expected);
    expect(DAY_DIRECTORY.days).toEqual(ALL_DAYS);
  });

  it('nextDayId 串成 day.01→02→03→04→05→06→null，日序 1～6', () => {
    const chain: (string | null)[] = [];
    let cur: string | null = DAY_DIRECTORY.days[0];
    while (cur) {
      expect(chain).not.toContain(cur);
      chain.push(cur);
      const plan = DAY_DIRECTORY.plan(cur);
      expect(plan).toBeDefined();
      expect(plan!.dayNumber).toBe(chain.length);
      cur = plan!.nextDayId;
    }
    expect(chain).toEqual(ALL_DAYS);
    expect(DAY_DIRECTORY.plan(DAY_06)!.nextDayId).toBeNull();
    // 只有最後一天沒有下一天
    expect(ALL_DAYS.filter((id) => DAY_DIRECTORY.plan(id)!.nextDayId === null)).toEqual([DAY_06]);
  });

  it('當日有序工作：每天恰好一個 return-review 位置（Day 4 內容定義、其他日虛擬插在第一件之後）；第一件工作與 R7 相同', () => {
    for (const dayId of ALL_DAYS) {
      const tasks = DAY_DIRECTORY.plan(dayId)!.tasks;
      expect(tasks.map((t) => ({ id: t.id, kind: t.kind }))).withContext(dayId).toEqual([...DAY_TASKS[dayId]]);
      expect(firstTaskOf(DAY_DIRECTORY.plan(dayId)!).id).toBe(DAY_TASKS[dayId][0].id);
    }
    // 第一件工作（舊檔真正做過的那件）與 R7 相同
    expect(ALL_DAYS.map((id) => DAY_DIRECTORY.plan(id)!.tasks[0].kind)).toEqual([
      'archive',
      'reconcile',
      'archive',
      'archive',
      'archive',
      'field-map',
    ]);
    expect(ALL_DAYS.map((id) => DAY_DIRECTORY.plan(id)!.tasks.length)).toEqual([3, 3, 2, 2, 2, 2]);
    // 每天恰好一個錯誤文件處理位置，且不是當日第一件
    for (const dayId of ALL_DAYS) {
      const issue = DAY_DIRECTORY.plan(dayId)!.tasks.filter((t) => t.kind === 'return-review');
      expect(issue.length).withContext(dayId).toBe(1);
      expect(DAY_DIRECTORY.plan(dayId)!.tasks.indexOf(issue[0])).withContext(dayId).toBe(1);
    }
  });

  it('taskId 全域唯一；taskPlanOf 只在自己的那一天找得到', () => {
    const ids = ALL_DAYS.flatMap((d) => DAY_DIRECTORY.plan(d)!.tasks.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(14);
    for (const dayId of ALL_DAYS) {
      const plan = DAY_DIRECTORY.plan(dayId)!;
      for (const id of ids) {
        const own = DAY_TASKS[dayId].some((t) => t.id === id);
        expect(taskPlanOf(plan, id) !== undefined).withContext(`${dayId} ${id}`).toBe(own);
      }
    }
  });

  for (const a of ARCHIVE_DAYS) {
    it(`${a.dayId} ${a.taskId}：歸檔批次 ${a.batchId}，${a.keys.length} 筆，鍵依佇列順序`, () => {
      const task = taskOf(a.dayId, a.taskId);
      expect(task.kind).toBe('archive');
      if (task.kind !== 'archive') return;
      expect(task.batchId).toBe(a.batchId);
      expect(task.recordKeys).toEqual([...a.keys]);
      expect(batchIdOfTask(task)).toBe(a.batchId);

      const records = DAY_DIRECTORY.records(a.batchId);
      expect(records.length).toBe(a.keys.length);
      expect(records.map((r) => r.key)).toEqual([...a.keys]);
      expect(records.map((r) => r.code)).toEqual([...a.codes]);
      for (const r of records) {
        expect(typeof r.code).toBe('string');
        expect(Object.keys(r).sort()).toEqual(['code', 'key', 'name', 'refusal', 'refusalApplies']);
      }
    });
  }

  it('批次筆數 3／3／4／5／6／8，批次 ID 與紀錄鍵各批互不重疊', () => {
    expect(ARCHIVE_DAYS.map((a) => DAY_DIRECTORY.records(a.batchId).length)).toEqual([3, 3, 4, 5, 6, 8]);
    expect(new Set(ARCHIVE_DAYS.map((a) => a.batchId)).size).toBe(ARCHIVE_DAYS.length);
    const allKeys = ARCHIVE_DAYS.flatMap((a) => DAY_DIRECTORY.records(a.batchId).map((r) => r.key));
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it('records(batch.day01.archive) 與內容檔的 Day 1 紀錄逐欄相同；0102 保留前導零', () => {
    const day1 = contentDay(DAY_01);
    const byId = new Map(day1.records.map((r) => [r.id, r] as const));
    const expected = ['record.h17', 'record.b102', 'record.b607'].map((id) => toSource(byId.get(id)!));
    expect(DAY_DIRECTORY.records(BATCH_DAY01)).toEqual(expected);
    expect(DAY_DIRECTORY.records(BATCH_DAY01).find((r) => r.key === 'B102')!.code).toBe('0102');
  });

  it('Day 1 補入批次 H18／H19／H20 與 Day 1 內容檔逐欄相同；H 類無拒絕紀錄欄位', () => {
    const day1 = contentDay(DAY_01);
    const byId = new Map(day1.records.map((r) => [r.id, r] as const));
    const expected = ['record.day1-h18', 'record.day1-h19', 'record.day1-h20'].map((id) => toSource(byId.get(id)!));
    expect(DAY_DIRECTORY.records(BATCH_DAY01_FOLLOWUP)).toEqual(expected);
    for (const r of DAY_DIRECTORY.records(BATCH_DAY01_FOLLOWUP)) {
      expect(r.refusalApplies).toBeFalse();
      expect(r.refusal).toBeNull();
    }
    // 補入批次不混入第一批
    expect(DAY_DIRECTORY.records(BATCH_DAY01).map((r) => r.key)).toEqual(['H17', 'B102', 'B607']);
  });

  it('Day 2 新件批次 H31–H34 取自 Day 2 內容檔', () => {
    const day2 = contentDay(DAY_02);
    const byId = new Map(day2.records.map((r) => [r.id, r] as const));
    const expected = ['record.day2-h31', 'record.day2-h32', 'record.day2-h33', 'record.day2-h34'].map((id) => toSource(byId.get(id)!));
    expect(DAY_DIRECTORY.records(BATCH_DAY02)).toEqual(expected);
  });

  it('Day 3–5 的 B 類編號為字串且保留前導零（0314、0448、0716、0905…）', () => {
    const codes = ARCHIVE_DAYS.filter((a) => ['day.03', 'day.04', 'day.05'].includes(a.dayId)).flatMap((a) => DAY_DIRECTORY.records(a.batchId).map((r) => r.code));
    for (const c of ['0314', '0448', '0521', '0716', '0731', '0842', '0905']) expect(codes).toContain(c);
    for (const c of codes) expect(typeof c).toBe('string');
  });

  it('day.02：第一件是核對（來源 batch.day01.archive、subjectKey B102），之後是錯誤文件處理位置與今日新件 batch.day02.archive；下一天 day.03', () => {
    const plan = DAY_DIRECTORY.plan(DAY_02)!;
    expect(plan.dayNumber).toBe(2);
    expect(plan.nextDayId).toBe('day.03');
    const task = plan.tasks[0];
    expect(task.kind).toBe('reconcile');
    expect(task.id).toBe(TASK_DAY2);
    if (task.kind !== 'reconcile') return;
    expect(task.sourceBatchId).toBe(BATCH_DAY01);
    expect(task.subjectKey).toBe('B102');
    expect(batchIdOfTask(task)).toBe(BATCH_DAY01);
    expect(DAY_DIRECTORY.records(task.sourceBatchId).some((r) => r.key === 'B102')).toBeTrue();
    // 核對不看補入批次，也不看今日新件
    expect(task.sourceBatchId).not.toBe(BATCH_DAY01_FOLLOWUP);
    // 第二件是虛擬的錯誤文件處理位置（R11），今日新件是第三件
    expect(batchIdOfTask(plan.tasks[1])).toBeNull();
    expect(batchIdOfTask(plan.tasks[2])).toBe(BATCH_DAY02);
  });

  it('day.02 核對的 recordKeys 取自 task.recordIds（B102、B607，共 2 筆），不是來源批次的 3 筆', () => {
    const task = taskOf(DAY_02, TASK_DAY2);
    if (task.kind !== 'reconcile') throw new Error('day.02 first task is not reconcile');
    expect(task.recordKeys).toEqual(['B102', 'B607']);
    expect(task.recordKeys.length).toBe(2);
    expect(DAY_DIRECTORY.records(task.sourceBatchId).length).toBe(3);
    expect(reconcileTask(TASK_DAY2).recordIds.length).toBe(task.recordKeys.length);
    // subject 在核對範圍內；每個 key 都屬於來源批次
    expect(task.recordKeys).toContain(task.subjectKey);
    for (const k of task.recordKeys) expect(DAY_DIRECTORY.records(task.sourceBatchId).some((r) => r.key === k)).toBeTrue();
  });

  describe('文件問題（R10／R11）：Day 2 核對的 returnAudit 與每日錯誤文件處理位置', () => {
    it('task.day2.reconcile 帶 returnAudit day1-code-audit（通知日 day.03）；core 只拿 id 與 notifyDayId（不綁複審工作）', () => {
      const task = taskOf(DAY_02, TASK_DAY2);
      if (task.kind !== 'reconcile') throw new Error('day.02 first task is not reconcile');
      expect(task.returnAudit).toEqual({ id: 'day1-code-audit', notifyDayId: 'day.03' });
      const content = reconcileTask(TASK_DAY2).returnAudit!;
      expect(task.returnAudit).toEqual({ id: content.id, notifyDayId: content.notifyDayId });
      // 通知日晚於核對日
      const days = DAY_DIRECTORY.days;
      expect(days.indexOf(task.returnAudit!.notifyDayId)).toBeGreaterThan(days.indexOf(DAY_02));
    });

    it('正式內容只有一個稽核 day1-code-audit；findAudit 找得到它與所屬核對工作，未知稽核為 undefined', () => {
      const audits = ALL_DAYS.flatMap((d) => DAY_DIRECTORY.plan(d)!.tasks).flatMap((t) => (t.kind === 'reconcile' && t.returnAudit ? [t.returnAudit.id] : []));
      expect(audits).toEqual(['day1-code-audit']);
      const found = findAudit(DAY_DIRECTORY, 'day1-code-audit')!;
      expect(found.task.id).toBe(TASK_DAY2);
      expect(found.plan.dayId).toBe(DAY_02);
      expect(found.task.sourceBatchId).toBe(BATCH_DAY01);
      expect(findAudit(DAY_DIRECTORY, 'nope')).toBeUndefined();
    });

    it('task.day4.return-review（內容定義）：ReturnReviewTaskPlan 只有 id／kind／dayId，沒有歸檔批次，排在 Day 4 原歸檔工作之後', () => {
      const plan = DAY_DIRECTORY.plan('day.04')!;
      expect(plan.tasks.map((t) => t.id)).toEqual(['task.day4.archive', TASK_DAY4_RETURN]);
      const task = plan.tasks[1];
      expect(task).toEqual({ id: TASK_DAY4_RETURN, kind: 'return-review', dayId: 'day.04' });
      expect(Object.keys(task).sort()).toEqual(['dayId', 'id', 'kind']);
      expect(contentTask(TASK_DAY4_RETURN).kind).toBe('return-review');
      expect(batchIdOfTask(task)).toBeNull();
      expect(casePlanOf(task, 'B102')).toBeUndefined();
      // 內容已有 return-review 的日子不再插入虛擬位置
      expect(plan.tasks.some((t) => t.id === 'task.day4.return-review' && t !== task)).toBeFalse();
      expect(issueTaskIdOf(contentDay('day.04'))).toBe(TASK_DAY4_RETURN);
    });

    for (const dayId of Object.keys(VIRTUAL_ISSUE)) {
      it(`${dayId}：虛擬 ${VIRTUAL_ISSUE[dayId]} 插在第一件工作之後；只有 id／kind／dayId，不在內容檔，標題為「錯誤文件處理」`, () => {
        const plan = DAY_DIRECTORY.plan(dayId)!;
        const slot = plan.tasks[1];
        expect(slot).toEqual({ id: VIRTUAL_ISSUE[dayId], kind: 'return-review', dayId });
        expect(slot.id).toBe(issueTaskIdOf(contentDay(dayId)));
        expect(slot.id).toBe(issueTaskId(plan.dayNumber));
        expect(firstTaskOf(plan).kind).not.toBe('return-review');
        expect(batchIdOfTask(slot)).toBeNull();
        expect(contentDay(dayId).tasks.some((t) => t.id === slot.id)).toBeFalse();
        expect(DAY_DIRECTORY.planOfTask(slot.id)).toBe(plan);
        expect(taskHeading(slot.id)).toBe(DOCUMENT_ISSUES_UI.taskHeading);
      });
    }

    it('錯誤文件處理的標題（內容定義與虛擬）一律是 documentIssues.taskHeading「錯誤文件處理」', () => {
      expect(DOCUMENT_ISSUES_UI.taskHeading).toBe('錯誤文件處理');
      expect(taskHeading(TASK_DAY4_RETURN)).toBe('錯誤文件處理');
      for (const id of Object.values(VIRTUAL_ISSUE)) expect(taskHeading(id)).withContext(id).toBe('錯誤文件處理');
    });
  });

  describe('多來源比對案件（R9）', () => {
    const TASK_DAY3 = 'task.day3.archive';
    const CASE_ID = 'case.day3.h204';

    it('只有 task.day3.archive 帶一個案件；其他歸檔工作 caseReviews 為空陣列', () => {
      for (const dayId of ALL_DAYS) {
        for (const t of DAY_DIRECTORY.plan(dayId)!.tasks) {
          if (t.kind !== 'archive') continue;
          expect(t.caseReviews.length).withContext(t.id).toBe(t.id === TASK_DAY3 ? 1 : 0);
        }
      }
    });

    it('task.day3.archive 的案件計畫：id、recordKey H204、變體 received／pending、三個決定', () => {
      const task = taskOf('day.03', TASK_DAY3);
      if (task.kind !== 'archive') throw new Error('not archive');
      expect(task.caseReviews).toEqual([
        {
          id: CASE_ID,
          recordKey: 'H204',
          variantIds: ['received', 'pending'],
          decisions: [
            {
              id: 'registry',
              archiveCode: 'H-204',
              destination: 'archive',
              basisDocumentId: 'doc.day3.h204.registry',
              note: '原表與補件編號不同；採用原表，保留補件。',
            },
            {
              id: 'supplement',
              archiveCode: 'H-205',
              destination: 'archive',
              basisDocumentId: 'doc.day3.h204.supplement',
              note: '原表與補件編號不同；採用補件，保留原表。',
            },
            {
              id: 'review',
              archiveCode: 'H-204',
              destination: 'review',
              basisDocumentId: 'doc.day3.h204.registry',
              note: '兩份來源編號不同，待窗口確認。',
            },
          ],
        },
      ]);
    });

    it('案件計畫逐欄取自內容檔 caseReview（basis／note 與內容一致；label 不進 core）', () => {
      const task = taskOf('day.03', TASK_DAY3);
      if (task.kind !== 'archive') throw new Error('not archive');
      const review = archiveTask(TASK_DAY3).caseReview!;
      const plan = task.caseReviews[0];
      expect(plan.id).toBe(review.id);
      expect(plan.variantIds).toEqual(review.receiptVariants.map((v) => v.id));
      expect(plan.decisions.map((d) => d.id)).toEqual(review.decisions.map((d) => d.id));
      review.decisions.forEach((d, i) => {
        expect(plan.decisions[i]).toEqual({
          id: d.id,
          archiveCode: d.archiveCode,
          destination: d.destination,
          basisDocumentId: d.basisDocumentId,
          note: d.note,
        });
        expect(review.sourceDocumentIds).toContain(plan.decisions[i].basisDocumentId);
      });
      expect(Object.keys(plan.decisions[0]).sort()).toEqual(['archiveCode', 'basisDocumentId', 'destination', 'id', 'note']);
    });

    it('casePlanOf／findCase：H204 找得到，其他紀錄與其他工作找不到；H204 的來源編號仍是 H-204', () => {
      const task = taskOf('day.03', TASK_DAY3);
      expect(casePlanOf(task, 'H204')?.id).toBe(CASE_ID);
      for (const k of ['H219', 'B314', 'B448', 'B521']) expect(casePlanOf(task, k)).withContext(k).toBeUndefined();
      expect(casePlanOf(taskOf(DAY_02, TASK_DAY2), 'B102')).toBeUndefined();
      const found = findCase(DAY_DIRECTORY, CASE_ID)!;
      expect(found.plan.dayId).toBe('day.03');
      expect(found.task.id).toBe(TASK_DAY3);
      expect(found.task.batchId).toBe('batch.day03.archive');
      expect(findCase(DAY_DIRECTORY, 'case.nope')).toBeUndefined();
      expect(DAY_DIRECTORY.records('batch.day03.archive').find((r) => r.key === 'H204')!.code).toBe('H-204');
    });
  });

  describe('day.06：欄位映射', () => {
    function fieldMapPlan() {
      const task = DAY_DIRECTORY.plan(DAY_06)!.tasks[0];
      if (task.kind !== 'field-map') throw new Error('day.06 is not a field-map task');
      return task;
    }

    it('沒有歸檔批次；四個來源欄位、四個目標欄位，正確配對一對一', () => {
      const t = fieldMapPlan();
      expect(t.id).toBe(TASK_DAY6);
      expect(batchIdOfTask(t)).toBeNull();
      // R7：來源欄位順序已打亂，配對只依 ID，不依陣列位置
      expect([...t.sourceFieldIds].sort()).toEqual(['contact-result', 'legacy-id', 'objection-reply', 'record-date']);
      expect(t.sourceFieldIds).not.toEqual(t.targets.map((x) => x.sourceId));
      expect(t.targets.map((x) => x.id)).toEqual(['personnel-code', 'exclude-flag', 'contact-status', 'effective-date']);
      expect(Object.fromEntries(t.targets.map((x) => [x.id, x.sourceId]))).toEqual({
        'personnel-code': 'legacy-id',
        'exclude-flag': 'objection-reply',
        'contact-status': 'contact-result',
        'effective-date': 'record-date',
      });
      expect(new Set(t.targets.map((x) => x.sourceId)).size).toBe(4);
      for (const x of t.targets) expect(t.sourceFieldIds).toContain(x.sourceId);
    });

    it('exclude-flag 為 boolean（有／無），其餘為 text 且不帶 true/false 值', () => {
      const t = fieldMapPlan();
      const flag = t.targets.find((x) => x.id === 'exclude-flag')!;
      expect(flag).toEqual({ id: 'exclude-flag', sourceId: 'objection-reply', convert: 'boolean', trueValue: '有', falseValue: '無' });
      for (const other of t.targets.filter((x) => x.id !== 'exclude-flag')) {
        expect(other.convert).toBe('text');
        expect(other.trueValue).toBeUndefined();
        expect(other.falseValue).toBeUndefined();
      }
    });

    it('8 列，列 id 與登記編號都是字串且保留前導零；4 列異議回覆為空', () => {
      const t = fieldMapPlan();
      expect(t.rows.length).toBe(8);
      expect(t.rows.map((r) => r.id)).toEqual([
        'row.0102',
        'row.0314',
        'row.0521',
        'row.0716',
        'row.0905',
        'row.1013',
        'row.1108',
        'row.1219',
      ]);
      expect(t.rows.map((r) => r.values['legacy-id'])).toEqual(['0102', '0314', '0521', '0716', '0905', '1013', '1108', '1219']);
      for (const r of t.rows) {
        expect(Object.keys(r.values).sort()).toEqual([...t.sourceFieldIds].sort());
        for (const v of Object.values(r.values)) expect(typeof v).toBe('string');
      }
      expect(t.rows.filter((r) => r.values['objection-reply'] === '').map((r) => r.id)).toEqual([
        'row.0102',
        'row.0521',
        'row.0905',
        'row.1219',
      ]);
      expect(t.rows.find((r) => r.id === 'row.0716')!.values['objection-reply']).toBe('有');
    });

    it('資料列是複本：改動目錄的列不會影響內容檔', () => {
      const t = fieldMapPlan();
      const content = contentDay(DAY_06).tasks[0];
      if (content.kind !== 'field-map') throw new Error('unexpected kind');
      expect(t.rows[0].values).not.toBe(content.rows[0].values);
      expect(t.rows[0].values).toEqual(content.rows[0].values);
    });
  });

  it('planOfTask：每個 taskId（含同日第二件）反查到自己的那一天；未知 taskId 為 undefined', () => {
    let count = 0;
    for (const dayId of ALL_DAYS) {
      const plan = DAY_DIRECTORY.plan(dayId)!;
      for (const t of plan.tasks) {
        expect(DAY_DIRECTORY.planOfTask(t.id)).withContext(t.id).toBe(plan);
        count++;
      }
    }
    expect(count).toBe(14);
    expect(DAY_DIRECTORY.planOfTask(TASK_DAY4_RETURN)!.dayId).toBe('day.04');
    expect(DAY_DIRECTORY.planOfTask('task.day3.return-review')!.dayId).toBe('day.03');
    expect(DAY_DIRECTORY.planOfTask('task.day6.return-review')!.dayId).toBe(DAY_06);
    expect(DAY_DIRECTORY.planOfTask(TASK_DAY1_FOLLOWUP)!.dayId).toBe(DAY_01);
    expect(DAY_DIRECTORY.planOfTask(TASK_DAY2_ARCHIVE)!.dayId).toBe(DAY_02);
    expect(DAY_DIRECTORY.planOfTask(TASK_DAY6)!.dayId).toBe(DAY_06);
    expect(DAY_DIRECTORY.planOfTask('task.day3.archive')!.dayNumber).toBe(3);
    expect(DAY_DIRECTORY.planOfTask('task.nonexistent')).toBeUndefined();
  });

  it('未知批次與未知日回傳空集合／undefined，不拋錯', () => {
    expect(DAY_DIRECTORY.records('batch.nonexistent')).toEqual([]);
    expect(DAY_DIRECTORY.plan('day.99')).toBeUndefined();
  });

  it('核對工作引用的來源批次一定是某個歸檔工作定義的批次', () => {
    for (const dayId of DAY_DIRECTORY.days) {
      for (const task of DAY_DIRECTORY.plan(dayId)!.tasks) {
        if (task.kind !== 'reconcile') continue;
        expect(DAY_DIRECTORY.records(task.sourceBatchId).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('buildDayDirectory', () => {
  it('只給第一天 → 目錄只有 day.01，其餘日不存在', () => {
    const dir = buildDayDirectory([contentDay(DAY_01)]);
    expect(dir.days).toEqual([DAY_01]);
    expect(dir.plan(DAY_02)).toBeUndefined();
    expect(dir.planOfTask(TASK_DAY2)).toBeUndefined();
    expect(dir.records(BATCH_DAY01).length).toBe(3);
    expect(dir.records(BATCH_DAY01_FOLLOWUP).length).toBe(3);
    expect(dir.planOfTask(TASK_DAY1_FOLLOWUP)!.dayId).toBe(DAY_01);
    expect(dir.plan(DAY_01)!.tasks.map((t) => t.id)).toEqual([TASK_DAY1, 'task.day1.return-review', TASK_DAY1_FOLLOWUP]);
    expect(dir.records(BATCH_DAY02)).toEqual([]);
    expect(dir.records('batch.day03.archive')).toEqual([]);
  });

  it('預設用全部內容，與 DAY_DIRECTORY 等價', () => {
    const dir = buildDayDirectory();
    expect(dir.days).toEqual(DAY_DIRECTORY.days);
    for (const id of dir.days) expect(dir.plan(id)).toEqual(DAY_DIRECTORY.plan(id));
    for (const a of ARCHIVE_DAYS) expect(dir.records(a.batchId)).toEqual(DAY_DIRECTORY.records(a.batchId));
  });

  it('某一天沒有 task 時拋錯，不會產生沒有工作的日別', () => {
    expect(() => buildDayDirectory([{ ...contentDay(DAY_01), tasks: [] }])).toThrowError(/no task/);
  });

  it('紀錄由傳入的 days 解析，缺引用會明確拋錯而不是靜默略過', () => {
    const days = CONTENT.days.map((d) => ({ ...d, records: [] }));
    expect(() => buildDayDirectory(days)).toThrowError(/Unknown record/);
  });

  it('Day 2 的紀錄取自 Day 1 內容檔：只傳 Day 2 → subjectRecordId 無法解析而拋錯', () => {
    expect(() => buildDayDirectory([contentDay(DAY_02)])).toThrowError(/Unknown record/);
  });
});

/* ---------- 合成的額外日別不得污染 Day 1 ---------- */

describe('buildDayDirectory：在最後一天後加入合成 Day 7，Day 1 完全不變', () => {
  /** 只存在於測試內的第七日；不寫入內容檔，不代表任何人物或案件。 */
  function withSyntheticDay7() {
    const days = CONTENT.days.map((d) => ({ ...d }));
    const last = days.find((d) => d.id === DAY_06)!;
    last.nextDayId = 'day.07';
    const day1 = days.find((d) => d.id === DAY_01)!;
    const day7 = {
      ...day1,
      id: 'day.07',
      day: 7,
      nextDayId: null,
      records: [
        { id: 'record.t1', key: 'T1', name: '測試對象一', code: '0901', refusal: null, refusalApplies: false },
        { id: 'record.t2', key: 'T2', name: null, code: '0902', refusal: true, refusalApplies: true },
      ],
      documents: [],
      messages: [],
      tasks: [
        {
          ...day1.tasks[0],
          id: 'task.day7.archive',
          kind: 'archive' as const,
          batchId: 'batch.day07.archive',
          recordIds: ['record.t1', 'record.t2'],
          documentIds: [],
        },
      ],
    };
    return buildDayDirectory([...days, day7 as (typeof days)[number]]);
  }

  it('Day 1 的批次資料集合、總數與順序一字不變', () => {
    const grown = withSyntheticDay7();
    expect(grown.records(BATCH_DAY01)).toEqual(DAY_DIRECTORY.records(BATCH_DAY01));
    expect(grown.records(BATCH_DAY01).map((r) => r.key)).toEqual(['H17', 'B102', 'B607']);
    expect(grown.plan(DAY_01)).toEqual(DAY_DIRECTORY.plan(DAY_01));
    for (const a of ARCHIVE_DAYS) expect(grown.records(a.batchId)).toEqual(DAY_DIRECTORY.records(a.batchId));
  });

  it('Day 7 有自己的批次與紀錄，且與其他日完全分離', () => {
    const grown = withSyntheticDay7();
    expect(grown.days).toEqual([...ALL_DAYS, 'day.07']);
    expect(grown.plan(DAY_06)!.nextDayId).toBe('day.07');
    const day7 = grown.plan('day.07')!;
    // 新增日也自動得到錯誤文件處理位置（不必把退件日寫死在內容裡）
    expect(day7.tasks.map((t) => t.kind)).toEqual(['archive', 'return-review']);
    expect(day7.tasks[1]).toEqual({ id: 'task.day7.return-review', kind: 'return-review', dayId: 'day.07' });
    expect(grown.planOfTask('task.day7.archive')).toBe(day7);
    expect(grown.records('batch.day07.archive').map((r) => r.key)).toEqual(['T1', 'T2']);
    expect(grown.records('batch.day07.archive').map((r) => r.code)).toEqual(['0901', '0902']);
    for (const a of ARCHIVE_DAYS) expect(grown.records(a.batchId).some((r) => r.key.startsWith('T'))).toBeFalse();
  });

  it('正式目錄不受影響：仍是六天、day.06 仍為最後一天', () => {
    withSyntheticDay7();
    expect(DAY_DIRECTORY.days).toEqual(ALL_DAYS);
    expect(DAY_DIRECTORY.plan(DAY_06)!.nextDayId).toBeNull();
    expect(contentDay(DAY_06).nextDayId).toBeNull();
  });
});
