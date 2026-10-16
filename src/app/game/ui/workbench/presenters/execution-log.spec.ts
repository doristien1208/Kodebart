import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ALL_CASE_REVIEWS, caseSourceDocument, documentsOfTask, reconcileTask } from '../../../content/bundle';
import { DOCUMENT_ISSUES_UI, EXECUTION_LOG_UI, OPERATION_UI, RECORD_REVIEW_UI, RECORD_STATUS, RETURNED_REVIEW_UI, caseNumber } from '../../../content/text';
import { EVENT_KINDS } from '../../../core/rules';
import { GameStateService } from '../../../state/game-state.service';
import type { OperationView } from '../../../state/work-operations.service';
import { archiveAll, archiveFirst, archiveOne, completeTask, finishDay, finishTasks, playTo } from '../../testing/play';
import { archivedRefusalStatus } from '../../shared/presenters/record-status';
import { LogEntry, buildExecutionLog, withOperation } from './execution-log';

/**
 * 系統作業紀錄 presenter（R8 §3）：一個業務事件一筆、值取自保存狀態、不含秘密、換日重置。
 * 一律用 GameStateService 走真實流程取得存檔，不手刻。
 */

const T = EXECUTION_LOG_UI;
const BUSINESS: readonly string[] = [
  EVENT_KINDS.archive,
  EVENT_KINDS.replySubmit,
  EVENT_KINDS.fieldMapSubmit,
  EVENT_KINDS.recordReview,
  EVENT_KINDS.returnResubmit,
  EVENT_KINDS.returnWindow,
  EVENT_KINDS.returnChecked,
  EVENT_KINDS.taskComplete,
];

function boot(): GameStateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  return TestBed.inject(GameStateService);
}

function logOf(game: GameStateService): LogEntry[] {
  const save = game.save();
  if (!save) throw new Error('沒有存檔');
  return buildExecutionLog({ events: game.dayEvents(), save, tasks: game.dayTasks() });
}

/** 畫面上會出現的全部文字（指令列＋輸出），給「不含秘密」檢查用。 */
function visibleText(entries: readonly LogEntry[]): string {
  return entries
    .map((e) =>
      [
        `${T.prompt} ${e.command}${e.arg ? ' ' + e.arg : ''}`,
        ...(e.trail ?? []).map((s) => `{"${s.key}":${s.value}}`),
        `{${e.fields.map((f) => `"${f.key}":${f.value}`).join(',')}}`,
      ].join('\n'),
    )
    .join('\n');
}

function fieldsOf(entry: LogEntry | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of entry?.fields ?? []) out[f.key] = f.value;
  return out;
}

/** 秘密與開發用字樣：origin 代碼、布林／null、task／batch ID、夜間判定與「安排」結論。 */
function expectNoSecrets(game: GameStateService, entries: readonly LogEntry[]): void {
  const text = visibleText(entries);
  expect(text).not.toMatch(/\b(true|false|null|undefined)\b/);
  // origin／缺值處理代碼不得以值出現（指令名 review.record 與鍵名 source 是資料檔的介面字，不是代碼）
  const values = entries.flatMap((e) => [e.arg ?? '', ...(e.trail ?? []).map((s) => s.value), ...e.fields.map((f) => f.value)]);
  for (const v of values) expect(v).not.toMatch(/\b(source|defaulted|review|default_false|request_review)\b/);
  expect(text).not.toMatch(/task\.day|batch\.day|day\.\d|record\./);
  expect(text).not.toMatch(/intervention|smallTalk|reportRevision|night/i);
  const report = documentsOfTask('task.day2.reconcile').find((d) => d.kind === 'report');
  if (report?.kind === 'report') {
    for (const secret of [report.text.arranged, report.text.notArranged, report.text.sourceOrigin.intervention, report.text.sourceOrigin.rules]) {
      expect(text).not.toContain(secret);
    }
  }
  expect(text).not.toContain(JSON.stringify(game.save()));
}

/** 同一天內把排在指定 kind 前面的工作做完，停在該工作。 */
function finishTasksUntil(game: GameStateService, kind: string): void {
  let guard = 0;
  while (game.task()?.kind !== kind) {
    if (game.task()?.kind === 'archive') archiveAll(game);
    if (!game.completeWork() && game.task()?.kind !== kind) throw new Error(`交付 ${game.taskId()} 失敗`);
    if (++guard > 10) throw new Error(`找不到 ${kind} 工作`);
  }
}

describe('buildExecutionLog（系統作業紀錄 presenter）', () => {
  let game: GameStateService;

  beforeEach(() => {
    localStorage.clear();
    game = boot();
    game.newGame();
  });

  afterEach(() => localStorage.clear());

  it('新遊戲沒有任何作業：空陣列（畫面顯示「等待作業輸入」）', () => {
    expect(logOf(game)).toEqual([]);
    expect(T.empty).toBe('等待作業輸入');
  });

  it('每筆歸檔一筆 archive.submit：人員編號、檢查通過、狀態與去向取自提交快照', () => {
    archiveFirst(game, 2, 'request_review');
    const entries = logOf(game);
    expect(entries.length).toBe(2);
    const [h17, b102] = entries;
    expect(h17?.command).toBe(T.command.archive);
    expect(h17?.arg).toBe('H-17');
    expect(fieldsOf(h17)).toEqual({
      [T.key.check]: JSON.stringify(T.check.pass),
      [T.key.personnelId]: JSON.stringify('H-17'),
      [T.key.status]: JSON.stringify(RECORD_STATUS.notApplicable),
      [T.key.destination]: JSON.stringify(T.destination.archive),
    });
    // 0102 的前導零保留；缺拒絕紀錄選「送交資料覆核」→ 資料覆核佇列
    expect(b102?.arg).toBe('0102');
    expect(fieldsOf(b102)).toEqual({
      [T.key.check]: JSON.stringify(T.check.pass),
      [T.key.personnelId]: JSON.stringify('0102'),
      [T.key.status]: JSON.stringify(RECORD_STATUS.unconfirmed),
      [T.key.destination]: JSON.stringify(T.destination.review),
    });
    expect(visibleText([b102!])).toContain(`${T.prompt} ${T.command.archive} 0102`);
    expect(visibleText([b102!])).toContain(`{"check":"通過","personnelId":"0102","status":"未確認","destination":"資料覆核佇列"}`);
    expectNoSecrets(game, entries);
  });

  it('交付一件工作 → task.handoff，items 為該件實際筆數；紀錄與事件一一對應', () => {
    expect(completeTask(game)).toBeTrue();
    const entries = logOf(game);
    const business = game.dayEvents().filter((e) => BUSINESS.includes(e.kind));
    expect(entries.map((e) => e.id)).toEqual(business.map((e) => e.id));
    expect(entries.length).toBe(4);
    const last = entries[entries.length - 1];
    expect(last?.command).toBe(T.command.handoff);
    expect(fieldsOf(last)).toEqual({ [T.key.result]: JSON.stringify(T.result.delivered), [T.key.items]: '3' });
    expect(last?.fields.find((f) => f.key === T.key.items)?.type).toBe('number');
    // 同日第二件工作：紀錄接在後面，仍是當日
    expect(completeTask(game)).toBeTrue();
    expect(game.stage()).toBe('wrap');
    const all = logOf(game);
    expect(all.length).toBe(8);
    expect(all.filter((e) => e.command === T.command.handoff).length).toBe(2);
    expectNoSecrets(game, all);
  });

  it('換日後只顯示新一天的紀錄（次日收件與開始工作時都是空的）', () => {
    finishTasks(game);
    expect(logOf(game).length).toBeGreaterThan(0);
    game.advanceDay();
    expect(game.stage()).toBe('morning');
    expect(logOf(game)).toEqual([]);
    game.startDay();
    expect(logOf(game)).toEqual([]);
  });

  it('Day 2 核對：逐筆審查各一筆 review.record，reply.submit 顯示回覆選項文字與送出結果，不含四格結論或夜間資訊', () => {
    finishDay(game);
    expect(game.dayId()).toBe('day.02');
    const task = game.task();
    const keys = task?.kind === 'reconcile' ? task.recordKeys : [];
    expect(keys.length).toBeGreaterThan(0);
    expect(completeTask(game, 'default_false', 'review')).toBeTrue();
    const entries = logOf(game);
    expect(entries.map((e) => e.command)).toEqual([...keys.map(() => T.command.recordReview), T.command.reply, T.command.handoff]);
    const reply = entries[keys.length];
    expect(fieldsOf(reply)).toEqual({
      [T.key.reply]: JSON.stringify(reconcileTask('task.day2.reconcile').text.choices.review),
      [T.key.result]: JSON.stringify(T.result.sentReview),
    });
    expect(fieldsOf(entries[keys.length + 1])[T.key.items]).toBe(String(game.dayTasks()[0]?.processed));
    expectNoSecrets(game, entries);
  });

  /* ---------- R10：逐筆審查、退件複審與提交過程 ---------- */

  it('逐筆審查：review.record <審查時看到的送件編號>，輸出送件編號、原始來源編號與「核對後放行／保留待查」；改處置各留一筆', () => {
    archiveOne(game, 'B102', 'default_false', undefined, '102');
    finishDay(game);
    expect(game.dayId()).toBe('day.02');
    game.openReport();
    game.openReceipt();
    game.setRecordReview('B102', 'release');
    game.setRecordReview('B102', 'hold');
    const entries = logOf(game);
    expect(entries.map((e) => e.command)).toEqual([T.command.recordReview, T.command.recordReview]);
    expect(T.command.recordReview).toBe('review.record');
    expect(entries.map((e) => e.arg)).toEqual(['102', '102']);
    // 值只取保存的審查紀錄：審查時看到的送件編號與原始來源編號
    const review = game.recordReview('B102');
    expect(review).toEqual(jasmine.objectContaining({ reviewedCode: '102', sourceCode: '0102' }));
    expect(entries[0]?.fields.map((f) => f.key)).toEqual([T.key.personnelId, T.key.source, T.key.result]);
    expect(fieldsOf(entries[0])).toEqual({
      [T.key.personnelId]: JSON.stringify(review?.reviewedCode),
      [T.key.source]: JSON.stringify(review?.sourceCode),
      [T.key.result]: JSON.stringify(RECORD_REVIEW_UI.release),
    });
    expect(visibleText([entries[0]!])).toBe(
      `${T.prompt} review.record 102\n{"personnelId":"102","source":"0102","result":"${RECORD_REVIEW_UI.release}"}`,
    );
    expect(fieldsOf(entries[1])[T.key.result]).toBe(JSON.stringify(RECORD_REVIEW_UI.hold));
    expectNoSecrets(game, entries);
  });

  it('退件複審：return.submit <本次送出的編號>，狀態為「已重新送審」；退件通知本身不產生紀錄', () => {
    archiveOne(game, 'B102', 'default_false', undefined, '102');
    finishDay(game); // → Day 2
    finishDay(game); // Day 2 全部放行 → Day 3（退件通知）
    expect(game.dayId()).toBe('day.03');
    expect(game.save()?.returns.length).toBeGreaterThan(0);
    expect(logOf(game)).toEqual([]);
    finishDay(game); // → Day 4
    expect(game.dayId()).toBe('day.04');
    finishTasksUntil(game, 'return-review');
    const [item] = game.activeReturns();
    if (!item) throw new Error('沒有退件');
    expect(game.resubmitReturnStrict(item.id, game.editableReceiptId(item.id) ?? '', '103')).toBe('ok');
    const entries = logOf(game).filter((e) => e.command === T.command.returnReview);
    expect(entries.length).toBe(1);
    expect(entries[0]?.arg).toBe('103');
    expect(fieldsOf(entries[0])).toEqual({
      [T.key.personnelId]: JSON.stringify('103'),
      [T.key.status]: JSON.stringify(RETURNED_REVIEW_UI.resubmitted),
    });
    expect(visibleText(entries)).not.toContain(item.id);
    expectNoSecrets(game, logOf(game));
  });

  it('退件複審：送窗口待查 → return.submit <沿用的編號>，狀態為「等待窗口確認」', () => {
    archiveOne(game, 'B102', 'default_false', undefined, '102');
    playTo(game, 'day.04');
    finishTasksUntil(game, 'return-review');
    const [item] = game.activeReturns();
    if (!item) throw new Error('沒有退件');
    expect(game.sendReturnToWindowStrict(item.id, game.editableReceiptId(item.id) ?? '')).toBe('ok');
    const [entry] = logOf(game).filter((e) => e.command === T.command.returnReview);
    expect(entry?.arg).toBe('102');
    expect(fieldsOf(entry)[T.key.status]).toBe(JSON.stringify(RETURNED_REVIEW_UI.pendingWindow));
  });

  it('R11 下游回條：隔日進入時 receipt.check <案號>，結果只寫文件核對結論與所核對的編號；重送本身仍是 return.submit', () => {
    archiveOne(game, 'B102', 'default_false', undefined, '102');
    playTo(game, 'day.04');
    finishTasksUntil(game, 'return-review');
    const [item] = game.activeReturns();
    if (!item) throw new Error('沒有退件');
    const number = caseNumber(item.auditId, item.recordKey);
    expect(game.resubmitReturnStrict(item.id, game.editableReceiptId(item.id) ?? '', '103')).toBe('ok');
    finishDay(game); // → Day 5：下游核對 103（仍與來源不同）→ 再次退回
    expect(game.dayId()).toBe('day.05');
    const [returned] = logOf(game).filter((e) => e.command === T.command.receiptCheck);
    expect(returned?.arg).toBe(number);
    expect(visibleText([returned!])).toBe(
      `${T.prompt} receipt.check ${number}\n{"result":"${DOCUMENT_ISSUES_UI.outcome.returned}","personnelId":"103"}`,
    );
    expectNoSecrets(game, logOf(game));

    // Day 5 從最新郵件附件（不限目前工作）修訂成 0102 → Day 6 下游核對一致 → 已解決
    const again = game.returns().find((r) => r.id === item.id);
    expect(again?.status).toBe('pending');
    expect(game.resubmitReturnStrict(item.id, game.editableReceiptId(item.id) ?? '', '0102')).toBe('ok');
    const resubmits = logOf(game).filter((e) => e.command === T.command.returnReview);
    expect(resubmits.map((e) => e.arg)).toEqual(['0102']);
    finishDay(game); // → Day 6
    expect(game.dayId()).toBe('day.06');
    const [resolved] = logOf(game).filter((e) => e.command === T.command.receiptCheck);
    expect(fieldsOf(resolved)).toEqual({
      [T.key.result]: JSON.stringify(DOCUMENT_ISSUES_UI.status.resolved),
      [T.key.personnelId]: JSON.stringify('0102'),
    });
    expect(visibleText(logOf(game))).not.toContain(item.id);
  });

  describe('withOperation（目前這件提交的逐階段輸出）', () => {
    function op(patch: Partial<OperationView>): OperationView {
      return {
        id: 1,
        kind: 'archive',
        taskId: game.taskId() ?? '',
        arg: '102',
        stage: 'received',
        trail: ['received'],
        failure: null,
        ...patch,
      };
    }

    it('處理中：最後多一筆待完成紀錄，指令參數是實際輸入，每個階段一行（格式檢查通過只是 status）', () => {
      const out = withOperation([], op({ stage: 'processing', trail: ['received', 'validating', 'validated', 'processing'] }), game.dayTasks());
      expect(out.length).toBe(1);
      const [e] = out;
      expect(e?.pending).toBe('running');
      expect(e?.command).toBe(T.command.archive);
      expect(e?.arg).toBe('102');
      expect(e?.fields).toEqual([]);
      expect(e?.trail?.map((s) => `${s.key}:${s.value}`)).toEqual([
        `${T.key.status}:${JSON.stringify(OPERATION_UI.received)}`,
        `${T.key.status}:${JSON.stringify(OPERATION_UI.validating)}`,
        `${T.key.status}:${JSON.stringify(OPERATION_UI.validated)}`,
        `${T.key.status}:${JSON.stringify(OPERATION_UI.processing)}`,
      ]);
      expect(OPERATION_UI.validated).toBe('格式檢查通過');
    });

    it('保存失敗：最後一行是「保存失敗」（可重試），沒有保存紀錄也不重複', () => {
      const out = withOperation([], op({ stage: 'failed', trail: ['received', 'validating', 'validated', 'processing', 'saving', 'failed'], failure: 'storage' }), game.dayTasks());
      expect(out.length).toBe(1);
      expect(out[0]?.pending).toBe('failed');
      expect(out[0]?.trail?.length).toBe(5);
      expect(fieldsOf(out[0])).toEqual({ [T.key.result]: JSON.stringify(OPERATION_UI.failed) });
      expect(out[0]?.retryable).toBeTrue();
    });

    it('規則不允許（例如附件已不是目前版本）：同樣記為保存失敗，但不可重試', () => {
      const out = withOperation([], op({ stage: 'failed', trail: ['received', 'validating', 'validated', 'processing', 'saving', 'failed'], failure: 'rejected' }), game.dayTasks());
      expect(out[0]?.pending).toBe('failed');
      expect(out[0]?.retryable).toBeFalse();
    });

    it('保存成功：階段行（含「已保存」）接在它產生的那筆紀錄上，參數與結果仍取保存快照', () => {
      archiveOne(game, 'B102', 'default_false', undefined, '102');
      const saved = logOf(game);
      const trail = ['received', 'validating', 'validated', 'processing', 'saving', 'done'] as const;
      const out = withOperation(saved, op({ stage: 'done', trail: [...trail] }), game.dayTasks());
      expect(out.length).toBe(saved.length);
      const last = out[out.length - 1];
      expect(last?.pending).toBeUndefined();
      expect(last?.arg).toBe('102');
      expect(last?.fields).toEqual(saved[saved.length - 1]!.fields);
      expect(last?.trail?.[trail.length - 1]).toEqual({ key: T.key.result, value: JSON.stringify(OPERATION_UI.done), type: 'string' });
      expectNoSecrets(game, out);
    });

    it('回覆提交不把選項 ID 當參數；不屬於今天工作的提交不顯示', () => {
      const reply = withOperation([], op({ kind: 'reply', arg: 'review', stage: 'saving', trail: ['received', 'saving'] }), game.dayTasks());
      expect(reply[0]?.command).toBe(T.command.reply);
      expect(reply[0]?.arg).toBeNull();
      expect(visibleText(reply)).not.toContain('review');
      expect(withOperation([], op({ taskId: 'task.other' }), game.dayTasks())).toEqual([]);
      expect(withOperation([], null, game.dayTasks())).toEqual([]);
    });
  });

  it('Day 6 欄位映射：import.submit 顯示列數、空白數與處理方式（人類文字）；M1 交付報告分開列出送件／本人回覆／窗口收件／待補', () => {
    // 一路保留缺漏：Day 6 的回覆欄讀保存資料，保留缺漏的列是空白
    playTo(game, 'day.06', () => 'request_review');
    expect(completeTask(game, 'request_review')).toBeTrue();
    expect(game.stage()).toBe('work'); // 之後還有交付報告
    const fm = game.save()!.taskProgress['task.day6.field-map'];
    const submitted = fm?.kind === 'field-map' ? fm.submitted : undefined;
    expect(completeTask(game, 'request_review')).toBeTrue();
    expect(game.stage()).toBe('end');
    const entries = logOf(game);
    expect(entries.map((e) => e.command)).toEqual([T.command.fieldMap, T.command.handoff, T.command.report, T.command.handoff]);
    expect(fieldsOf(entries[0])).toEqual({
      [T.key.rows]: String(submitted?.rowCount),
      [T.key.blank]: String(submitted?.affectedCount),
      [T.key.blankPolicy]: JSON.stringify(T.blank.review),
    });
    const report = game.report('task.day6.m1-report')!;
    expect(fieldsOf(entries[2])).toEqual({
      [T.key.delivered]: String(report.submissionCount),
      [T.key.replies]: String(report.replyCount),
      [T.key.receipts]: String(report.receiptCount),
      [T.key.pending]: String(report.pendingCount),
    });
    expectNoSecrets(game, entries);
  });

  /* ---------- R9：比對案件的紀錄 ---------- */

  const CASE = ALL_CASE_REVIEWS[0];
  for (const decision of CASE?.review.decisions ?? []) {
    it(`比對案件（${decision.id}）：紀錄玩家提交的編號、案件去向、依據文件標題與註記，不寫誰對誰錯`, () => {
      if (!CASE) throw new Error('內容沒有比對案件');
      playTo(game, CASE.dayId);
      archiveOne(game, CASE.recordKey, 'default_false', decision.id);
      const entries = logOf(game);
      expect(entries.length).toBe(1);
      const [entry] = entries;
      expect(entry?.command).toBe(T.command.archive);
      expect(entry?.arg).toBe(decision.archiveCode);
      const snapshot = game.archived(CASE.recordKey);
      expect(fieldsOf(entry)).toEqual({
        [T.key.check]: JSON.stringify(T.check.pass),
        [T.key.personnelId]: JSON.stringify(decision.archiveCode),
        [T.key.status]: JSON.stringify(snapshot ? archivedRefusalStatus(snapshot) : ''),
        [T.key.destination]: JSON.stringify(T.caseDestination[decision.destination]),
        [T.key.basis]: JSON.stringify(caseSourceDocument(decision.basisDocumentId).text.heading),
        [T.key.note]: JSON.stringify(decision.note),
      });
      const text = visibleText(entries);
      // 案件去向用案件自己的中性字（窗口待查 ≠ 資料覆核佇列）；不含決定／變體／案件 ID
      expect(text).not.toContain(T.destination.review);
      for (const d of CASE.review.decisions) expect(text).not.toContain(`"${d.id}"`);
      for (const v of CASE.review.receiptVariants) expect(text).not.toContain(v.id);
      expect(text).not.toContain(CASE.review.id);
      expect(text).not.toMatch(/正確|錯誤|對的|錯的/);
      expectNoSecrets(game, entries);
    });
  }

  it('同日一般紀錄的紀錄格式不變（沒有 basis／note）', () => {
    const c = ALL_CASE_REVIEWS[0];
    if (!c) throw new Error('內容沒有比對案件');
    playTo(game, c.dayId);
    const other = game.records().find((r) => r.key !== c.recordKey);
    if (!other) throw new Error('批次只有案件紀錄');
    archiveOne(game, other.key, 'default_false');
    const [entry] = logOf(game);
    expect(Object.keys(fieldsOf(entry))).toEqual([T.key.check, T.key.personnelId, T.key.status, T.key.destination]);
  });

  it('不屬於業務流程的事件（day.complete、夜間判定、聊天回覆）不產生紀錄', () => {
    const save = game.save()!;
    const events = [
      { id: 'x:0', kind: EVENT_KINDS.dayComplete, payload: { dayId: 'day.01' } },
      { id: 'x:1', kind: EVENT_KINDS.nightResolved, payload: { intervention: true } },
      { id: 'x:2', kind: EVENT_KINDS.chatReply, payload: { promptId: 'p', choiceId: 'c' } },
      // 找不到提交快照的歸檔事件也不輸出（不猜值）
      { id: 'x:3', kind: EVENT_KINDS.archive, payload: { key: 'B102', origin: 'review', batchId: 'batch.day01.archive' } },
    ];
    expect(buildExecutionLog({ events, save, tasks: game.dayTasks() })).toEqual([]);
  });

  it('R12 向同事詢問（help.request）與不認得的事件種類：不產生紀錄、不拋錯', () => {
    const save = game.save()!;
    const events = [
      { id: 'h:0', kind: EVENT_KINDS.helpRequest, payload: { dayId: 'day.01', requestId: 'request.refusal-record' } },
      { id: 'h:1', kind: 'future.kind', payload: null },
      { id: 'h:2', kind: 'another.kind', payload: 'text' },
    ];
    expect(() => buildExecutionLog({ events, save, tasks: game.dayTasks() })).not.toThrow();
    expect(buildExecutionLog({ events, save, tasks: game.dayTasks() })).toEqual([]);
  });
});
