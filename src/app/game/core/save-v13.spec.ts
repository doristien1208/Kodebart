import { CaseworkProgress, InquiryPlan } from './casework';
import { LEGACY_CHAPTER_END_DAY } from './day-map';
import { CaseworkTaskPlan, createDayDirectory } from './day-plan';
import { advanceDay, completeWork, continueChapter, createSave, isTaskDone, startDay } from './rules';
import { migrateToCurrent, migrateV12ToV13 } from './save-migrate';
import { isValidLegacySaveV12, isValidSave } from './save-schema';
import { SAVE_VERSION, Save, SaveV12 } from './types';

/**
 * 存檔 v13（M2）：承辦查詢與案件工作進度的嚴格驗證、v12 遷移，以及舊章節終點的明確續接。
 * 用合成日程（舊六日的最後一天＋第七日、各一件案件工作），不依賴正式內容。
 */

const DAY_1 = LEGACY_CHAPTER_END_DAY;
const DAY_2 = 'day.07';
const TASK_1 = 'task.day6.case';
const TASK_2 = 'task.day7.case';

function caseTask(id: string): CaseworkTaskPlan {
  return {
    id,
    kind: 'casework',
    casework: {
      caseId: `case.${id}`,
      taskId: id,
      variant: 'contact-route',
      documentIds: ['doc.test.registry', 'doc.test.current'],
      bindingIds: [],
      inquiryId: 'inquiry.test.contact',
      minimumCitations: 0,
      choices: [
        { id: 'registry-window', output: { variant: 'contact-route', route: 'registry-window', noticeState: 'queued' } },
        { id: 'clarify-first', output: { variant: 'contact-route', route: 'manual-check', noticeState: 'pending' } },
      ],
    },
  };
}

const INQUIRY: InquiryPlan = {
  id: 'inquiry.test.contact',
  caseId: `case.${TASK_1}`,
  eventId: 'test.inquiry.contact',
  requestedOn: DAY_1,
  earlyAfterTask: TASK_1,
  guaranteedBy: DAY_2,
  documentId: 'doc.test.current',
  timings: ['after-current-work', 'next-arrival'],
};

const DIR = createDayDirectory(
  [
    { dayId: DAY_1, dayNumber: 6, nextDayId: DAY_2, tasks: [caseTask(TASK_1)] },
    { dayId: DAY_2, dayNumber: 7, nextDayId: null, tasks: [caseTask(TASK_2)] },
  ],
  {},
  [],
  [INQUIRY],
);

function delivered(dayId: string): CaseworkProgress {
  return {
    kind: 'casework',
    opened: true,
    draft: { citations: [] },
    versions: [
      {
        index: 0,
        choiceId: 'registry-window',
        output: { variant: 'contact-route', route: 'registry-window', noticeState: 'queued' },
        citations: [{ documentId: 'doc.test.registry', version: 0, fieldIndex: 1, label: '原登記編號', value: 'H-204' }],
        dayId,
      },
    ],
  };
}

const DONE = delivered(DAY_1);

function withCase(save: Save, taskId: string, progress: unknown): Save {
  return { ...save, taskProgress: { ...save.taskProgress, [taskId]: progress as CaseworkProgress } };
}

describe('存檔 v13（M2）', () => {
  it('新存檔為 v13、承辦查詢為空物件，並通過驗證', () => {
    const s = createSave(7, DIR);
    expect(SAVE_VERSION).toBe(13);
    expect(s.version).toBe(13);
    expect(s.inquiries).toEqual({});
    expect(isValidSave(s, DIR)).toBeTrue();
    expect(isValidSave({ ...s, inquiries: undefined }, DIR)).toBeFalse();
  });

  it('案件工作：有交付版本才算完成；交付後完成當日進入本日交接', () => {
    const s = withCase(createSave(7, DIR), TASK_1, DONE);
    expect(isValidSave(s, DIR)).toBeTrue();
    expect(isTaskDone(createSave(7, DIR), DIR, caseTask(TASK_1))).toBeFalse();
    expect(isTaskDone(s, DIR, caseTask(TASK_1))).toBeTrue();
    expect(completeWork(s, DIR).stage).toBe('wrap');
  });

  it('案件工作：引用快照只驗結構，不比對文件目前內容；草稿可只有引用、沒有選項', () => {
    const v = DONE.versions[0]!;
    const free = { ...DONE, draft: { citations: [{ ...v.citations[0]!, value: '任意保存值 0102' }] } };
    expect(isValidSave(withCase(createSave(7, DIR), TASK_1, free), DIR)).toBeTrue();
  });

  it('案件工作：選項不屬於本案、序號不連續、引用他案文件或重複、輸出不在白名單、交付日未知 → 存檔不合法', () => {
    const v = DONE.versions[0]!;
    const c = v.citations[0]!;
    const bad: unknown[] = [
      { ...DONE, opened: 'yes' },
      { ...DONE, draft: { choiceId: 'other', citations: [] } },
      { ...DONE, draft: { choiceId: 'registry-window' } },
      { ...DONE, versions: [{ ...v, index: 1 }] },
      { ...DONE, versions: [{ ...v, choiceId: 'other' }] },
      { ...DONE, versions: [{ ...v, citations: [{ ...c, documentId: 'doc.other' }] }] },
      { ...DONE, versions: [{ ...v, citations: [{ ...c, fieldIndex: -1 }] }] },
      { ...DONE, versions: [{ ...v, citations: [{ ...c, version: 0.5 }] }] },
      { ...DONE, versions: [{ ...v, citations: [{ ...c, value: null }] }] },
      { ...DONE, versions: [{ ...v, citations: [c, c] }] },
      { ...DONE, versions: [{ ...v, output: { variant: 'batch-scope', route: 'window-all', pendingDisposition: 'separate-list' } }] },
      { ...DONE, versions: [{ ...v, output: { ...v.output, route: 'somewhere' } }] },
      { ...DONE, versions: [{ ...v, output: { ...v.output, extra: true } }] },
      { ...DONE, versions: [{ ...v, dayId: 'day.99' }] },
      { ...DONE, kind: 'attachment' },
    ];
    for (const p of bad) {
      expect(isValidSave(withCase(createSave(7, DIR), TASK_1, p), DIR))
        .withContext(JSON.stringify(p))
        .toBeFalse();
    }
  });

  it('承辦查詢：已知查詢在可詢問日送出、時機屬於變體 → 合法；未知 ID、送出日不符、時機不在變體或多欄 → 不合法', () => {
    const base = createSave(7, DIR);
    for (const timing of INQUIRY.timings) {
      expect(isValidSave({ ...base, inquiries: { [INQUIRY.id]: { dayId: DAY_1, timing } } }, DIR)).toBeTrue();
    }
    const bad: unknown[] = [
      { 'inquiry.test.unknown': { dayId: DAY_1, timing: 'next-arrival' } },
      { [INQUIRY.id]: { dayId: DAY_2, timing: 'next-arrival' } },
      { [INQUIRY.id]: { dayId: DAY_1, timing: 'later' } },
      { [INQUIRY.id]: { dayId: DAY_1, timing: 'next-arrival', roll: 0.3 } },
      { [INQUIRY.id]: 'next-arrival' },
      [],
    ];
    for (const inquiries of bad) {
      expect(isValidSave({ ...base, inquiries } as unknown, DIR))
        .withContext(JSON.stringify(inquiries))
        .toBeFalse();
    }
  });

  it('舊章節終點：停在 end、這一天仍有下一天且工作已結清 → 合法；讀檔不自動跳日，按「繼續工作」才到下一天', () => {
    const atEnd: Save = { ...withCase(createSave(7, DIR), TASK_1, DONE), stage: 'end', readMessages: ['msg.a'] };
    expect(isValidSave(atEnd, DIR)).toBeTrue();

    const reloaded = migrateToCurrent(JSON.parse(JSON.stringify(atEnd)), DIR)!;
    expect(reloaded.from).toBe(13);
    expect(reloaded.save).toEqual(atEnd);

    const next = continueChapter(reloaded.save, DIR);
    expect(next.dayId).toBe(DAY_2);
    expect(next.stage).toBe('morning');
    expect(next.taskId).toBe(TASK_2);
    expect(next.taskProgress).toEqual(atEnd.taskProgress);
    expect(next.readMessages).toEqual(['msg.a']);
    expect(next.seed).toBe(7);
    expect(next.night).toBeDefined();
    expect(isValidSave(next, DIR)).toBeTrue();
    expect(startDay(next).stage).toBe('work');
    // 已跨日：再按一次不會重跑
    expect(continueChapter(next, DIR)).toBe(next);
  });

  it('舊章節終點只限六日內容的最後一天：其他有下一天的日子停在 end 仍不合法', () => {
    const other = createDayDirectory(
      [
        { dayId: 'day.01', dayNumber: 1, nextDayId: 'day.02', tasks: [caseTask(TASK_1)] },
        { dayId: 'day.02', dayNumber: 2, nextDayId: null, tasks: [caseTask(TASK_2)] },
      ],
      {},
    );
    const settled = withCase(createSave(7, other), TASK_1, delivered('day.01'));
    expect(isValidSave(settled, other)).toBeTrue();
    expect(isValidSave({ ...settled, stage: 'end' }, other)).toBeFalse();
  });

  it('舊章節終點：工作未結清的 end 仍不合法；繼續工作只在 end 且有下一天時生效（最後一天的 end 不動）', () => {
    expect(isValidSave({ ...createSave(7, DIR), stage: 'end' }, DIR)).toBeFalse();

    const working = withCase(createSave(7, DIR), TASK_1, DONE);
    expect(continueChapter(working, DIR)).toBe(working);
    const wrap = completeWork(working, DIR);
    expect(continueChapter(wrap, DIR)).toBe(wrap);

    const day2 = withCase(startDay(advanceDay(wrap, DIR)), TASK_2, delivered(DAY_2));
    const finalEnd = completeWork(day2, DIR);
    expect(finalEnd.stage).toBe('end');
    expect(isValidSave(finalEnd, DIR)).toBeTrue();
    expect(continueChapter(finalEnd, DIR)).toBe(finalEnd);
  });

  it('v12 → v13：只補空的承辦查詢，其餘欄位（含停在 end 的舊章節終點）原樣保留', () => {
    const current: Save = { ...withCase(createSave(7, DIR), TASK_1, DONE), stage: 'end', readMessages: ['msg.a'] };
    const { inquiries: _q, ...rest } = current;
    const v12: SaveV12 = { ...rest, version: 12 };
    expect(isValidLegacySaveV12(v12, DIR)).toBeTrue();
    expect(migrateV12ToV13(v12)).toEqual(current);

    const before = JSON.stringify(v12);
    const result = migrateToCurrent(JSON.parse(before), DIR)!;
    expect(result.from).toBe(12);
    expect(result.save).toEqual(current);
    expect(result.save.stage).toBe('end');
    expect(JSON.stringify(v12)).toBe(before);
  });
});
