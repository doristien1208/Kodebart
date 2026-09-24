import {
  CasePlan,
  DayPlan,
  FieldMapTaskPlan,
  batchIdOfTask,
  casePlanOf,
  createDayDirectory,
  dayOfBatch,
  firstDay,
  findAudit,
  findCase,
  firstTaskOf,
  lastDayNumber,
  taskPlanOf,
} from './day-plan';
import { SourceRecord } from './types';

/**
 * DayDirectory：core 只認這個介面；這裡驗證測試／adapter 共用的簡單實作。
 * 所有 fixture 皆為測試自建，不依賴正式內容。
 */

const RECORDS_A: readonly SourceRecord[] = [
  { key: 'A1', name: null, code: '0001', refusal: null, refusalApplies: false },
  { key: 'A2', name: '測試對象', code: '0002', refusal: true, refusalApplies: true },
];
const RECORDS_C: readonly SourceRecord[] = [{ key: 'C1', name: null, code: '0301', refusal: null, refusalApplies: false }];

const FIELD_MAP: FieldMapTaskPlan = {
  id: 'task.d',
  kind: 'field-map',
  sourceFieldIds: ['s1', 's2'],
  targets: [
    { id: 't1', sourceId: 's1', convert: 'text' },
    { id: 't2', sourceId: 's2', convert: 'boolean', trueValue: '有', falseValue: '無' },
  ],
  rows: [{ id: 'row.1', values: { s1: '0102', s2: '' } }],
};

const PLANS: readonly DayPlan[] = [
  // 故意亂序，驗證會依 dayNumber 排序
  { dayId: 'day.c', dayNumber: 3, nextDayId: 'day.d', tasks: [{ id: 'task.c', kind: 'archive', batchId: 'batch.c', recordKeys: ['C1'], caseReviews: [] }] },
  {
    dayId: 'day.a',
    dayNumber: 1,
    nextDayId: 'day.b',
    tasks: [
      { id: 'task.a', kind: 'archive', batchId: 'batch.a', recordKeys: ['A1', 'A2'], caseReviews: [] },
      { id: 'task.a2', kind: 'archive', batchId: 'batch.a2', recordKeys: [], caseReviews: [] },
    ],
  },
  { dayId: 'day.d', dayNumber: 6, nextDayId: null, tasks: [FIELD_MAP] },
  { dayId: 'day.b', dayNumber: 2, nextDayId: 'day.c', tasks: [{ id: 'task.b', kind: 'reconcile', sourceBatchId: 'batch.a', subjectKey: 'A2', recordKeys: ['A2'] }] },
];

describe('createDayDirectory', () => {
  const dir = createDayDirectory(PLANS, { 'batch.a': RECORDS_A, 'batch.c': RECORDS_C });

  it('days 依 dayNumber 排序，不依傳入順序', () => {
    expect(dir.days).toEqual(['day.a', 'day.b', 'day.c', 'day.d']);
  });

  it('plan(dayId) 回傳該日日程；未知日回傳 undefined', () => {
    expect(dir.plan('day.a')).toEqual(PLANS[1]);
    expect(dir.plan('day.b')!.nextDayId).toBe('day.c');
    expect(dir.plan('day.d')!.nextDayId).toBeNull();
    expect(dir.plan('day.d')!.tasks).toEqual([FIELD_MAP]);
    expect(dir.plan('day.d')!.tasks[0]).toBe(FIELD_MAP);
    expect(dir.plan('day.zz')).toBeUndefined();
  });

  it('planOfTask(taskId) 反查所在日；未知工作回傳 undefined', () => {
    expect(dir.planOfTask('task.a')!.dayId).toBe('day.a');
    expect(dir.planOfTask('task.b')!.dayId).toBe('day.b');
    expect(dir.planOfTask('task.a2')!.dayId).toBe('day.a');
    expect(dir.planOfTask('task.d')!.dayId).toBe('day.d');
    expect(dir.planOfTask('task.zz')).toBeUndefined();
    // 不把 dayId 當 taskId
    expect(dir.planOfTask('day.a')).toBeUndefined();
  });

  it('核對工作的 subjectKey 原樣保留', () => {
    const task = dir.plan('day.b')!.tasks[0]!;
    expect(task.kind === 'reconcile' && task.subjectKey).toBe('A2');
  });

  it('records(batchId) 回傳該批次自己的集合；未知批次回傳空集合而不是拋錯', () => {
    expect(dir.records('batch.a')).toBe(RECORDS_A);
    expect(dir.records('batch.c')).toBe(RECORDS_C);
    expect(dir.records('batch.nonexistent')).toEqual([]);
  });

  it('不改動傳入的 plans 陣列順序', () => {
    expect(PLANS.map((p) => p.dayId)).toEqual(['day.c', 'day.a', 'day.d', 'day.b']);
  });
});

describe('batchIdOfTask／firstDay／lastDayNumber', () => {
  it('歸檔工作回 batchId，核對工作回 sourceBatchId，欄位映射回 null', () => {
    expect(batchIdOfTask({ id: 't', kind: 'archive', batchId: 'batch.x', recordKeys: [], caseReviews: [] })).toBe('batch.x');
    expect(batchIdOfTask({ id: 't', kind: 'reconcile', sourceBatchId: 'batch.y', subjectKey: 'K', recordKeys: ['K'] })).toBe('batch.y');
    expect(batchIdOfTask(FIELD_MAP)).toBeNull();
    expect(batchIdOfTask({ id: 't', kind: 'return-review', dayId: 'day.x' })).toBeNull();
  });

  it('firstDay 回傳排序後的第一天；空目錄拋錯', () => {
    expect(firstDay(createDayDirectory(PLANS, {}))).toBe('day.a');
    expect(() => firstDay(createDayDirectory([], {}))).toThrowError(/no days/);
  });

  it('lastDayNumber 回傳最後一天的日序（不是天數）；空目錄為 0', () => {
    expect(lastDayNumber(createDayDirectory(PLANS, {}))).toBe(6);
    expect(lastDayNumber(createDayDirectory(PLANS.slice(0, 2), {}))).toBe(3);
    expect(lastDayNumber(createDayDirectory([], {}))).toBe(0);
  });
});

describe('taskPlanOf／firstTaskOf／dayOfBatch（R8 多工作日程）', () => {
  const dir = createDayDirectory(PLANS, { 'batch.a': RECORDS_A, 'batch.c': RECORDS_C });

  it('tasks 保持內容傳入的順序', () => {
    expect(dir.plan('day.a')!.tasks.map((t) => t.id)).toEqual(['task.a', 'task.a2']);
  });

  it('taskPlanOf 依 taskId 精確取得當日工作；不屬於這一天回傳 undefined', () => {
    const a = dir.plan('day.a')!;
    expect(taskPlanOf(a, 'task.a2')!.id).toBe('task.a2');
    expect(taskPlanOf(a, 'task.a')!.id).toBe('task.a');
    expect(taskPlanOf(a, 'task.b')).toBeUndefined();
    expect(taskPlanOf(a, 'task.zz')).toBeUndefined();
  });

  it('firstTaskOf 回傳 tasks[0]；空佇列拋錯', () => {
    expect(firstTaskOf(dir.plan('day.a')!).id).toBe('task.a');
    expect(firstTaskOf(dir.plan('day.d')!)).toBe(FIELD_MAP);
    expect(() => firstTaskOf({ dayId: 'day.empty', dayNumber: 9, nextDayId: null, tasks: [] })).toThrowError(/no task/);
  });

  it('dayOfBatch 只認歸檔工作寫入的批次（含同日第二件）；核對來源批次不算、未知回傳 undefined', () => {
    expect(dayOfBatch(dir, 'batch.a')).toBe('day.a');
    expect(dayOfBatch(dir, 'batch.a2')).toBe('day.a');
    expect(dayOfBatch(dir, 'batch.c')).toBe('day.c');
    expect(dayOfBatch(dir, 'batch.zz')).toBeUndefined();
  });
});

describe('casePlanOf／findCase（R9 多來源比對案件）', () => {
  const CASE: CasePlan = {
    id: 'case.test.c1',
    recordKey: 'C1',
    variantIds: ['received', 'pending'],
    decisions: [{ id: 'registry', archiveCode: '0301', destination: 'archive', basisDocumentId: 'doc.test.a', note: 'n' }],
  };
  const plans: readonly DayPlan[] = PLANS.map((p) =>
    p.dayId === 'day.c' ? { ...p, tasks: [{ id: 'task.c', kind: 'archive' as const, batchId: 'batch.c', recordKeys: ['C1'], caseReviews: [CASE] }] } : p,
  );
  const dir = createDayDirectory(plans, { 'batch.a': RECORDS_A, 'batch.c': RECORDS_C });

  it('casePlanOf 只在歸檔工作內依 recordKey 找；非案件紀錄、核對、欄位映射回傳 undefined', () => {
    const c = dir.plan('day.c')!.tasks[0]!;
    expect(casePlanOf(c, 'C1')).toBe(CASE);
    expect(casePlanOf(c, 'A1')).toBeUndefined();
    expect(casePlanOf(dir.plan('day.a')!.tasks[0]!, 'C1')).toBeUndefined();
    // 核對工作即使 subjectKey 同鍵也不是案件
    expect(casePlanOf({ id: 't', kind: 'reconcile', sourceBatchId: 'batch.c', subjectKey: 'C1', recordKeys: ['C1'] }, 'C1')).toBeUndefined();
    expect(casePlanOf(FIELD_MAP, 'C1')).toBeUndefined();
  });

  it('findCase 由 case ID 在全部日程找到案件、所在日與工作；未知回傳 undefined', () => {
    const found = findCase(dir, 'case.test.c1')!;
    expect(found.plan.dayId).toBe('day.c');
    expect(found.task.id).toBe('task.c');
    expect(found.task.batchId).toBe('batch.c');
    expect(found.casePlan).toBe(CASE);
    expect(findCase(dir, 'case.unknown')).toBeUndefined();
    // 不把 recordKey 或 taskId 當 case ID
    expect(findCase(dir, 'C1')).toBeUndefined();
    expect(findCase(dir, 'task.c')).toBeUndefined();
    expect(findCase(createDayDirectory(PLANS, {}), 'case.test.c1')).toBeUndefined();
  });

  it('核對工作的 recordKeys 可以少於來源批次（核對量由 task 決定），batchIdOfTask 不受影響', () => {
    const task = { id: 't', kind: 'reconcile' as const, sourceBatchId: 'batch.a', subjectKey: 'A2', recordKeys: ['A2'] };
    expect(task.recordKeys.length).toBe(1);
    expect(dir.records('batch.a').length).toBe(2);
    expect(batchIdOfTask(task)).toBe('batch.a');
  });
});

describe('findAudit（R10 下游稽核；R11 稽核只有通知日，錯誤文件處理位置以日為鍵）', () => {
  const plans: readonly DayPlan[] = [
    ...PLANS.filter((p) => p.dayId !== 'day.b' && p.dayId !== 'day.c'),
    {
      dayId: 'day.b',
      dayNumber: 2,
      nextDayId: 'day.c',
      tasks: [
        {
          id: 'task.b',
          kind: 'reconcile',
          sourceBatchId: 'batch.a',
          subjectKey: 'A2',
          recordKeys: ['A1', 'A2'],
          returnAudit: { id: 'audit.a', notifyDayId: 'day.c' },
        },
      ],
    },
    {
      dayId: 'day.c',
      dayNumber: 3,
      nextDayId: 'day.d',
      tasks: [
        { id: 'task.c', kind: 'archive', batchId: 'batch.c', recordKeys: ['C1'], caseReviews: [] },
        { id: 'task.c.return', kind: 'return-review', dayId: 'day.c' },
      ],
    },
  ];
  const dir = createDayDirectory(plans, { 'batch.a': RECORDS_A, 'batch.c': RECORDS_C });

  it('由稽核 ID 找到定義它的核對工作、所在日與稽核內容', () => {
    const found = findAudit(dir, 'audit.a')!;
    expect(found.plan.dayId).toBe('day.b');
    expect(found.task.id).toBe('task.b');
    expect(found.audit).toEqual({ id: 'audit.a', notifyDayId: 'day.c' });
  });

  it('未知稽核、沒有 returnAudit 的目錄、以 taskId 或複審工作的 id 查詢都回傳 undefined', () => {
    expect(findAudit(dir, 'audit.zz')).toBeUndefined();
    expect(findAudit(dir, 'task.b')).toBeUndefined();
    expect(findAudit(dir, 'task.c.return')).toBeUndefined();
    expect(findAudit(createDayDirectory(PLANS, {}), 'audit.a')).toBeUndefined();
  });

  it('錯誤文件處理位置可由 planOfTask 反查所在日（與自己的 dayId 一致），且不寫入任何批次', () => {
    expect(dir.planOfTask('task.c.return')!.dayId).toBe('day.c');
    const slot = taskPlanOf(dir.plan('day.c')!, 'task.c.return')!;
    expect(slot.kind === 'return-review' ? slot.dayId : null).toBe('day.c');
    expect(batchIdOfTask(slot)).toBeNull();
    expect(dayOfBatch(dir, 'batch.c')).toBe('day.c');
  });
});
