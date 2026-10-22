import {
  CaseDocument,
  CaseworkDayContext,
  CaseworkPlan,
  InquiryPlan,
  addCitation,
  askInquiry,
  caseDocumentAvailable,
  caseMailMatches,
  caseworkInputError,
  choiceOutputOf,
  citationOf,
  citesField,
  codeStateOf,
  emptyCaseworkProgress,
  generatedVersionOf,
  inquiryReplyArrived,
  latestCaseworkVersion,
  removeCitation,
  rollInquiryTiming,
  scopeListCount,
  scopeResultOf,
  submitCaseworkVersion,
  withCaseworkDraft,
} from './casework';

const REQUEST: CaseDocument = {
  id: 'doc.request',
  version: 0,
  heading: '申請節錄',
  fields: [
    { label: '對象編號', value: '0742' },
    { label: '補充備註', value: '上午不方便，若有下午時段請先通知。' },
  ],
};
const LIST: CaseDocument = {
  id: 'doc.list',
  version: 0,
  heading: '代理清單',
  fields: [
    { label: '對象編號', value: '0742' },
    { label: '預排時段', value: '10:30' },
  ],
};
const SLOT_ID = 'doc.slot';

const PACKET: CaseworkPlan = {
  caseId: 'case.packet',
  taskId: 'task.packet',
  variant: 'citation-packet',
  documentIds: [REQUEST.id, LIST.id, SLOT_ID],
  bindingIds: [],
  inquiryId: null,
  minimumCitations: 1,
  choices: [
    { id: 'standard', output: { variant: 'citation-packet', route: 'standard-packet' } },
    { id: 'manual-read', output: { variant: 'citation-packet', route: 'manual-read-packet' } },
  ],
};

const SCOPE: CaseworkPlan = {
  caseId: 'case.scope',
  taskId: 'task.scope',
  variant: 'batch-scope',
  documentIds: [],
  bindingIds: [],
  inquiryId: null,
  minimumCitations: 0,
  choices: [
    { id: 'all-imported', output: { variant: 'batch-scope', route: 'window-all', pendingDisposition: 'included-and-marked' } },
    { id: 'ready-first', output: { variant: 'batch-scope', route: 'window-ready', pendingDisposition: 'separate-list' } },
    { id: 'request-source', output: { variant: 'batch-scope', route: 'source-review', pendingDisposition: 'source-requested' } },
  ],
};

const INQUIRY: InquiryPlan = {
  id: 'inquiry.slot',
  caseId: 'case.proposal',
  eventId: 'm2.inquiry.r27-slot',
  requestedOn: 'day.08',
  earlyAfterTask: 'task.followup',
  guaranteedBy: 'day.09',
  documentId: SLOT_ID,
  timings: ['after-current-work', 'next-arrival'],
};

const DAY_NUMBERS: Record<string, number> = { 'day.07': 7, 'day.08': 8, 'day.09': 9, 'day.10': 10 };

function day(dayId: string, done: string[] = []): CaseworkDayContext {
  return { dayId, dayNumber: (id) => DAY_NUMBERS[id] ?? -1, taskDone: (t) => done.includes(t) };
}

function docs(...available: CaseDocument[]) {
  return (id: string) => available.find((d) => d.id === id) ?? null;
}

/** 找出兩個 seed：一個擲到早回、一個擲到次日回（固定 eventId）。 */
function seedFor(timing: 'after-current-work' | 'next-arrival'): number {
  for (let s = 1; s < 1000; s++) if (rollInquiryTiming(s, INQUIRY) === timing) return s;
  throw new Error('no seed');
}

describe('casework：引用快照', () => {
  it('保存 documentId／版本／fieldIndex／label／value；欄位不存在回傳 null', () => {
    expect(citationOf(REQUEST, 1)).toEqual({
      documentId: 'doc.request',
      version: 0,
      fieldIndex: 1,
      label: '補充備註',
      value: '上午不方便，若有下午時段請先通知。',
    });
    expect(citationOf(REQUEST, 2)).toBeNull();
    expect(citationOf(REQUEST, -1)).toBeNull();
  });

  it('同一欄不重複加入；可移除；移除不存在的引用回傳原陣列', () => {
    const a = citationOf(REQUEST, 1)!;
    const b = citationOf(LIST, 1)!;
    const list = addCitation(addCitation([], a), b);
    expect(addCitation(list, { ...a })).toBe(list);
    expect(list.map((c) => c.documentId)).toEqual(['doc.request', 'doc.list']);
    const removed = removeCitation(list, a);
    expect(removed.map((c) => c.documentId)).toEqual(['doc.list']);
    expect(removeCitation(removed, a)).toBe(removed);
  });

  it('快照不隨原文件異動改寫', () => {
    const fields = [{ label: '補充備註', value: '下午' }];
    const doc: CaseDocument = { id: 'doc.x', version: 1, heading: 'x', fields };
    const c = citationOf(doc, 0)!;
    fields[0] = { label: '補充備註', value: '改了' };
    expect(c.value).toBe('下午');
  });

  it('citesField 依文件與欄位判斷，不看版本', () => {
    const list = [{ ...citationOf(REQUEST, 1)!, version: 3 }];
    expect(citesField(list, 'doc.request', 1)).toBeTrue();
    expect(citesField(list, 'doc.request', 0)).toBeFalse();
  });

  it('生成副本的版本號：來源第 n 版 → n＋1；缺漏沿用 0', () => {
    expect(generatedVersionOf(null)).toBe(0);
    expect(generatedVersionOf(0)).toBe(1);
    expect(generatedVersionOf(2)).toBe(3);
  });
});

describe('casework：交付前的程序驗證', () => {
  const ctx = { document: docs(REQUEST, LIST), sourceAttached: true };

  it('引用不足、沒選處理方式各有錯誤；合法即可送出，不判斷語意', () => {
    expect(caseworkInputError(PACKET, { citations: [] }, ctx)).toBe('needCitation');
    const onlyList = [citationOf(LIST, 1)!];
    expect(caseworkInputError(PACKET, { citations: onlyList }, ctx)).toBe('needAction');
    expect(caseworkInputError(PACKET, { citations: onlyList, choiceId: 'nope' }, ctx)).toBe('needAction');
    // 只引用清單、沒附下午備註也能送出（語意不擋送）。
    expect(caseworkInputError(PACKET, { citations: onlyList, choiceId: 'standard' }, ctx)).toBeNull();
  });

  it('未知文件、未送達的查詢文件、欄位不存在、版本或快照不符都是不合法引用', () => {
    const ok = citationOf(REQUEST, 1)!;
    const run = (c: typeof ok) => caseworkInputError(PACKET, { citations: [c], choiceId: 'standard' }, ctx);
    expect(run({ ...ok, documentId: 'doc.unknown' })).toBe('invalidCitation');
    expect(run({ ...ok, documentId: SLOT_ID })).toBe('invalidCitation');
    expect(run({ ...ok, fieldIndex: 9 })).toBe('invalidCitation');
    expect(run({ ...ok, version: 1 })).toBe('invalidCitation');
    expect(run({ ...ok, value: '偷改的值' })).toBe('invalidCitation');
    expect(run(ok)).toBeNull();
  });

  it('舊批次未附時，整批／先交可轉送列不能造出空的成功輸出；請窗口補件仍可交付', () => {
    const missing = { document: docs(), sourceAttached: false };
    expect(caseworkInputError(SCOPE, { citations: [], choiceId: 'all-imported' }, missing)).toBe('sourceMissing');
    expect(caseworkInputError(SCOPE, { citations: [], choiceId: 'ready-first' }, missing)).toBe('sourceMissing');
    expect(caseworkInputError(SCOPE, { citations: [], choiceId: 'request-source' }, missing)).toBeNull();
    expect(caseworkInputError(SCOPE, { citations: [], choiceId: 'all-imported' }, { ...missing, sourceAttached: true })).toBeNull();
  });

  it('choiceOutputOf 回傳內容 enum；未知選項為 null', () => {
    expect(choiceOutputOf(SCOPE, 'ready-first')).toEqual({ variant: 'batch-scope', route: 'window-ready', pendingDisposition: 'separate-list' });
    expect(choiceOutputOf(SCOPE, 'x')).toBeNull();
  });
});

describe('casework：送件版本（已交付副本唯讀、最新修訂獨立）', () => {
  const ctx = { document: docs(REQUEST, LIST), sourceAttached: true };
  const note = citationOf(REQUEST, 1)!;
  const list = citationOf(LIST, 1)!;

  it('第一次交付建立第 0 版並清空草稿；草稿暫存不動已交付版本', () => {
    let p = withCaseworkDraft(emptyCaseworkProgress(), { choiceId: 'standard', citations: [list] });
    expect(p.versions.length).toBe(0);
    const r = submitCaseworkVersion(PACKET, p, p.draft, ctx, 'day.09', null);
    if (!r.ok) throw new Error(r.error);
    p = r.progress;
    expect(r.version).toEqual({
      index: 0,
      choiceId: 'standard',
      output: { variant: 'citation-packet', route: 'standard-packet' },
      citations: [list],
      dayId: 'day.09',
    });
    expect(p.draft).toEqual({ citations: [] });
    expect(latestCaseworkVersion(p)?.index).toBe(0);
  });

  it('修訂附加新版本，舊版本原樣保留；之後改草稿不回寫已交付副本', () => {
    const first = submitCaseworkVersion(PACKET, emptyCaseworkProgress(), { choiceId: 'standard', citations: [list] }, ctx, 'day.09', null);
    if (!first.ok) throw new Error(first.error);
    const second = submitCaseworkVersion(PACKET, first.progress, { choiceId: 'manual-read', citations: [list, note] }, ctx, 'day.09', 0);
    if (!second.ok) throw new Error(second.error);
    expect(second.progress.versions.map((v) => v.index)).toEqual([0, 1]);
    expect(second.progress.versions[0]).toBe(first.version);
    expect(second.progress.versions[0]?.citations).toEqual([list]);
    const edited = withCaseworkDraft(second.progress, { choiceId: 'standard', citations: [] });
    expect(edited.versions).toBe(second.progress.versions);
  });

  it('畫面過期（重複送出或已有新版本）回傳 stale，不覆寫', () => {
    const first = submitCaseworkVersion(PACKET, emptyCaseworkProgress(), { choiceId: 'standard', citations: [list] }, ctx, 'day.09', null);
    if (!first.ok) throw new Error(first.error);
    const again = submitCaseworkVersion(PACKET, first.progress, { choiceId: 'standard', citations: [list] }, ctx, 'day.09', null);
    expect(again).toEqual({ ok: false, error: 'stale' });
    const ahead = submitCaseworkVersion(PACKET, first.progress, { choiceId: 'standard', citations: [list] }, ctx, 'day.09', 3);
    expect(ahead).toEqual({ ok: false, error: 'stale' });
  });

  it('驗證失敗時不建立版本，輸入原樣保留給玩家重試', () => {
    const p = withCaseworkDraft(emptyCaseworkProgress(), { choiceId: 'standard', citations: [] });
    expect(submitCaseworkVersion(PACKET, p, p.draft, ctx, 'day.09', null)).toEqual({ ok: false, error: 'needCitation' });
    expect(p.draft.choiceId).toBe('standard');
    expect(p.versions.length).toBe(0);
  });
});

describe('casework：承辦查詢的早回／次日回', () => {
  it('同一 seed 與 eventId 永遠擲到同一結果；固定 seed 兩路都存在', () => {
    const early = seedFor('after-current-work');
    const late = seedFor('next-arrival');
    expect(rollInquiryTiming(early, INQUIRY)).toBe('after-current-work');
    expect(rollInquiryTiming(early, INQUIRY)).toBe('after-current-work');
    expect(rollInquiryTiming(late, INQUIRY)).toBe('next-arrival');
  });

  it('已詢問過不重擲：回傳原保存狀態', () => {
    const saved = { dayId: 'day.08', timing: 'next-arrival' as const };
    expect(askInquiry(seedFor('after-current-work'), INQUIRY, saved, 'day.08')).toBe(saved);
    expect(askInquiry(seedFor('after-current-work'), INQUIRY, undefined, 'day.08')).toEqual({ dayId: 'day.08', timing: 'after-current-work' });
  });

  it('早回：指定工作完成後送達；之前不送達', () => {
    const state = { dayId: 'day.08', timing: 'after-current-work' as const };
    expect(inquiryReplyArrived(INQUIRY, state, day('day.08'))).toBeFalse();
    expect(inquiryReplyArrived(INQUIRY, state, day('day.08', ['task.followup']))).toBeTrue();
  });

  it('次日回：當天即使指定工作完成也不送達，下一個工作日送達', () => {
    const state = { dayId: 'day.08', timing: 'next-arrival' as const };
    expect(inquiryReplyArrived(INQUIRY, state, day('day.08', ['task.followup']))).toBeFalse();
    expect(inquiryReplyArrived(INQUIRY, state, day('day.09'))).toBeTrue();
  });

  it('沒有詢問就不會送達回覆', () => {
    expect(inquiryReplyArrived(INQUIRY, undefined, day('day.10', ['task.followup']))).toBeFalse();
  });

  it('查詢附件：未送達時不可開；保底日起不論有沒有詢問都可查', () => {
    const none = {};
    expect(caseDocumentAvailable(SLOT_ID, [INQUIRY], none, day('day.08', ['task.followup']))).toBeFalse();
    expect(caseDocumentAvailable(SLOT_ID, [INQUIRY], none, day('day.09'))).toBeTrue();
    const asked = { [INQUIRY.id]: { dayId: 'day.08', timing: 'after-current-work' as const } };
    expect(caseDocumentAvailable(SLOT_ID, [INQUIRY], asked, day('day.08'))).toBeFalse();
    expect(caseDocumentAvailable(SLOT_ID, [INQUIRY], asked, day('day.08', ['task.followup']))).toBeTrue();
    // 一般文件不受查詢影響。
    expect(caseDocumentAvailable(REQUEST.id, [INQUIRY], none, day('day.08'))).toBeTrue();
  });
});

describe('casework：黃品蓉編號核定', () => {
  const provided = ['H-204', 'H-205'];

  it('文件內的代碼＝待核定（仍不是唯一真值）；任意或缺漏＝pending-code', () => {
    expect(codeStateOf(provided, 'H-204')).toBe('awaiting-code-ratification');
    expect(codeStateOf(provided, 'H-205')).toBe('awaiting-code-ratification');
    expect(codeStateOf(provided, 'H-2O4')).toBe('pending-code');
    expect(codeStateOf(provided, null)).toBe('pending-code');
  });

  it('逐字比對，不修剪、不改大小寫、不自動修正', () => {
    expect(codeStateOf(provided, ' H-204')).toBe('pending-code');
    expect(codeStateOf(provided, 'h-204')).toBe('pending-code');
  });
});

describe('casework：條件回條', () => {
  const noteCited = { choiceId: 'standard', citations: [citationOf(REQUEST, 1)!] };
  const listOnly = { choiceId: 'standard', citations: [citationOf(LIST, 1)!, citationOf(REQUEST, 0)!] };

  it('choice 讀保存的選項', () => {
    expect(caseMailMatches({ kind: 'choice', choiceId: 'standard' }, noteCited)).toBeTrue();
    expect(caseMailMatches({ kind: 'choice', choiceId: 'manual-read' }, noteCited)).toBeFalse();
  });

  it('cites／not-cites 互斥，只看實際引用的欄位', () => {
    const cites = { kind: 'cites' as const, documentId: 'doc.request', fieldIndex: 1 };
    const notCites = { kind: 'not-cites' as const, documentId: 'doc.request', fieldIndex: 1 };
    expect(caseMailMatches(cites, noteCited)).toBeTrue();
    expect(caseMailMatches(notCites, noteCited)).toBeFalse();
    // 引用同一份申請的其他欄（代碼）不算附上下午備註。
    expect(caseMailMatches(cites, listOnly)).toBeFalse();
    expect(caseMailMatches(notCites, listOnly)).toBeTrue();
  });
});

describe('casework：第七日通知範圍', () => {
  const rows = [
    { id: 'row.1', code: '0102', pending: false },
    { id: 'row.2', code: '0314', pending: true },
    { id: 'row.3', code: '0521', pending: false },
  ];

  it('整批：全部列交窗口，待補列仍標示', () => {
    const r = scopeResultOf('window-all', rows);
    expect(r.listRowIds).toEqual(['row.1', 'row.2', 'row.3']);
    expect(r.pendingRowIds).toEqual(['row.2']);
    expect(scopeListCount(r)).toBe(3);
  });

  it('先交可轉送列：待補另列，不刪除原資料', () => {
    const r = scopeResultOf('window-ready', rows);
    expect(r.listRowIds).toEqual(['row.1', 'row.3']);
    expect(r.pendingRowIds).toEqual(['row.2']);
    expect(r.rowIds.length).toBe(3);
  });

  it('請窗口補件：本輪清單為空，原列仍保留', () => {
    const r = scopeResultOf('source-review', rows);
    expect(r.listRowIds).toEqual([]);
    expect(r.rowIds.length).toBe(3);
    expect(scopeListCount(r)).toBe(0);
  });

  it('舊批次未附：列數未知（null），不寫成 0', () => {
    const r = scopeResultOf('source-review', null);
    expect(r.sourceAttached).toBeFalse();
    expect(scopeListCount(r)).toBeNull();
  });
});
