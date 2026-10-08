import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DAY_DIRECTORY } from './day-directory';
import { GameStateService } from './game-state.service';
import { SAVE_KEY } from './save-repository';
import { WorkOperationsService } from './work-operations.service';
import { isMailDelivered } from '../core/rules';
import { isValidSave } from '../core/save-schema';
import { AttachmentInput } from '../core/workday';
import { FieldMapProgress, MailRecord, Save } from '../core/types';
import { M1_SAVE_A, M1_SAVE_B, doM1Task, instantOperations, playM1Day, playM1To, playM1UntilKind, settle } from '../ui/testing/play';

/**
 * M1 工作日的整合規格（正式內容、正式 DAY_DIRECTORY、真實 localStorage）：
 * 歸檔 → 附件關聯 → 批次轉換 → Day 6 欄位映射與交付報告 → 隔日回條，下游一律讀玩家實際保存的資料。
 */

const ATTACH_D4 = 'task.day4.m1-attachment';
const TRANSFORM_D4 = 'task.day4.m1-transform';
const ATTACH_D5 = 'task.day5.m1-attachment';
const TRANSFORM_D5 = 'task.day5.m1-transform';
const FIELD_MAP_D6 = 'task.day6.field-map';
const REPORT_D6 = 'task.day6.m1-report';
const DOC_0314_WINDOW = 'doc.day4.m1-0314-window';
const DOC_0521_REPLY = 'doc.day4.m1-0521-reply';
const M1_PACK = 'mail.m1-workday';

const SAVE_A = M1_SAVE_A;
const SAVE_B = M1_SAVE_B;

/** 重建 injector（重新讀 localStorage）；提交流程不等演出節奏。 */
function boot(): GameStateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.returnValue(Promise.resolve(true));
  return TestBed.inject(GameStateService);
}

function save(game: GameStateService): Save {
  const s = game.save();
  if (!s) throw new Error('沒有存檔');
  return s;
}

const doTask = doM1Task;
const playDay = playM1Day;
const playTo = playM1To;

function newGame(): GameStateService {
  localStorage.clear();
  const game = boot();
  game.newGame();
  return game;
}

function mailIdsOf(s: Save, dayId: string): string[] {
  return s.mailbox.filter((m) => m.packId === M1_PACK && m.dayId === dayId).map((m) => m.id);
}

function fieldMapRow(s: Save, rowId: string): Readonly<Record<string, unknown>> | undefined {
  const p = s.taskProgress[FIELD_MAP_D6] as FieldMapProgress | undefined;
  return p?.submitted?.rows.find((r) => r.id === rowId)?.values;
}

describe('M1 工作日（整合）', () => {
  afterEach(() => localStorage.clear());

  describe('兩份存檔：差異來自保存的資料', () => {
    it('A（錯編號＋錯附件＋部門預設）可提交並傳到下游；B（保留缺漏）的輸出、待補量、隔日郵件不同', () => {
      const a = newGame();
      playTo(a, 'end', SAVE_A);
      const sa = save(a);
      const b = newGame();
      playTo(b, 'end', SAVE_B);
      const sb = save(b);
      expect(isValidSave(sa, DAY_DIRECTORY)).toBeTrue();
      expect(isValidSave(sb, DAY_DIRECTORY)).toBeTrue();

      // Day 4 附件關聯：保存不可變的附件快照與玩家實際採用的編號
      const linkA = a.attachmentProgress(ATTACH_D4).versions[0];
      expect(linkA).toEqual(
        jasmine.objectContaining({ choiceId: 'reference', attachedCode: '0521', subjectCode: '0341', sourceCode: '0314', evidence: 'reply' }),
      );
      expect(linkA?.document?.id).toBe(DOC_0521_REPLY);
      const linkB = b.attachmentProgress(ATTACH_D4).versions[0];
      expect(linkB).toEqual(jasmine.objectContaining({ attachedCode: '0314', subjectCode: '0314', evidence: 'receipt' }));

      // Day 4 批次：0314 列讀保存的編號與附件；A 被 0521 的回覆帶成「無」並交付，B 的窗口收件不是本人回覆 → 待補
      const rowA = a.transformProgress(TRANSFORM_D4).submitted?.rows.find((r) => r.id === 'row.0314');
      const rowB = b.transformProgress(TRANSFORM_D4).submitted?.rows.find((r) => r.id === 'row.0314');
      expect(rowA).toEqual(jasmine.objectContaining({ adoptedCode: '0341', sourceCode: '0314', value: false, valueOrigin: 'reply', status: 'delivered' }));
      expect(rowA?.attachment?.attachedCode).toBe('0521');
      expect(rowB).toEqual(jasmine.objectContaining({ adoptedCode: '0314', value: null, valueOrigin: 'held', status: 'pending' }));
      expect(rowB?.attachment?.evidence).toBe('receipt');
      const outA = a.transformProgress(TRANSFORM_D4).submitted;
      const outB = b.transformProgress(TRANSFORM_D4).submitted;
      expect(outA?.policy).toBe('departmentDefault');
      expect(outB?.policy).toBe('review');
      expect(outA?.pendingCount).toBe(0);
      expect(outB?.pendingCount).toBeGreaterThan(0);

      // Day 5 回條：A 指出附件對象不符；B 是窗口收件與待補
      expect(mailIdsOf(sa, 'day.05')).toContain('mail.day5.m1-wrong-attachment');
      expect(mailIdsOf(sa, 'day.05')).not.toContain('mail.day5.m1-window-only');
      expect(mailIdsOf(sa, 'day.05')).not.toContain('mail.day5.m1-awaiting');
      expect(mailIdsOf(sb, 'day.05')).toEqual(jasmine.arrayContaining(['mail.day5.m1-window-only', 'mail.day5.m1-awaiting']));
      expect(mailIdsOf(sb, 'day.05')).not.toContain('mail.day5.m1-wrong-attachment');
      expect(a.attachmentStatus(ATTACH_D4)).toBe('returned');
      expect(b.attachmentStatus(ATTACH_D4)).toBe('resolved');

      // Day 6 欄位映射的資料列讀保存的編號（A 的 0341 照原樣傳下去，不自動改正）
      expect(fieldMapRow(sa, 'row.0314')?.['personnel-code']).toBe('0341');
      expect(fieldMapRow(sb, 'row.0314')?.['personnel-code']).toBe('0314');

      // Day 6 報告：送件、本人回覆、窗口收件、待補各自計數；流程成功不等於本人回覆
      const repA = a.report(REPORT_D6);
      const repB = b.report(REPORT_D6);
      expect(repA?.rows.find((r) => r.id === 'row.0314')?.evidence).toBe('mismatch');
      expect(repB?.rows.find((r) => r.id === 'row.0314')?.evidence).toBe('receipt');
      expect([repA?.submissionCount, repA?.replyCount, repA?.receiptCount, repA?.pendingCount]).toEqual([8, 1, 0, 0]);
      expect([repB?.submissionCount, repB?.replyCount, repB?.receiptCount, repB?.pendingCount]).toEqual([1, 1, 1, 7]);
    });

    it('Day 5 的紙本交接：引用電子回條或保留缺漏都能送件；Day 6 回條附上玩家實際送出的版本', () => {
      for (const choice of [
        { choiceId: 'reference', documentId: 'doc.day5.m1-electronic-receipt' },
        { choiceId: 'review' },
      ] as AttachmentInput[]) {
        const game = newGame();
        playTo(game, 'day.06', { ...SAVE_B, attach: { ...SAVE_B.attach, [ATTACH_D5]: choice } });
        const v = game.attachmentProgress(ATTACH_D5).versions;
        expect(v.length).toBe(1);
        expect(v[0]?.choiceId).toBe(choice.choiceId as 'reference' | 'review');
        expect(v[0]?.destination).toBe(choice.choiceId === 'review' ? 'review' : 'archive');
        const paper = save(game).mailbox.find((m) => m.id === 'mail.day6.m1-paper');
        expect(paper?.attachments[0]).toEqual({ kind: 'attachment-link', taskId: ATTACH_D5, versionIndex: 0 });
      }
    });
  });

  describe('附件修訂：舊版本唯讀、最新可修、未修持續退回', () => {
    it('A 在 Day 5 收到退回：只有最新版本可修訂；仍選錯 → Day 6 再退一次（.r1）；選對 → 不再退回，舊快照不變', () => {
      const game = newGame();
      playTo(game, 'day.05', SAVE_A);
      const before = game.attachmentProgress(ATTACH_D4);
      const outputBefore = game.transformProgress(TRANSFORM_D4).submitted;
      expect(before.checks).toEqual([{ versionIndex: 0, dayId: 'day.05', outcome: 'returned' }]);
      const mail = save(game).mailbox.find((m) => m.id === 'mail.day5.m1-wrong-attachment');
      expect(mail?.attachments).toEqual([
        { kind: 'attachment-link', taskId: ATTACH_D4, versionIndex: 0 },
        { kind: 'case-source', documentId: DOC_0521_REPLY },
      ]);

      // 不是可修訂的版本序號 → rejected，存檔不變
      const s0 = game.save();
      expect(game.reviseAttachmentStrict(ATTACH_D4, 1, { choiceId: 'reference', documentId: DOC_0314_WINDOW })).not.toBe('ok');
      expect(game.save()).toBe(s0);

      // 仍選錯：新增修訂 1，原送件保留
      expect(game.reviseAttachmentStrict(ATTACH_D4, 0, { choiceId: 'reference', documentId: DOC_0521_REPLY })).toBe('ok');
      const revised = game.attachmentProgress(ATTACH_D4);
      expect(revised.versions.length).toBe(2);
      expect(revised.versions[0]).toEqual(before.versions[0] as never);
      expect(revised.versions[1]).toEqual(jasmine.objectContaining({ index: 1, dayId: 'day.05', checkDayId: 'day.06', attachedCode: '0521' }));
      expect(game.attachmentStatus(ATTACH_D4)).toBe('awaiting');
      // 已送出的修訂不能再改（舊版本與待核對的版本都唯讀）
      expect(game.reviseAttachmentStrict(ATTACH_D4, 0, { choiceId: 'reference', documentId: DOC_0314_WINDOW })).not.toBe('ok');
      expect(game.reviseAttachmentStrict(ATTACH_D4, 1, { choiceId: 'reference', documentId: DOC_0314_WINDOW })).not.toBe('ok');
      // 已交付的批次輸出是快照：之後修訂附件不改寫它
      expect(game.transformProgress(TRANSFORM_D4).submitted).toEqual(outputBefore as never);

      playTo(game, 'day.06', SAVE_A); // 天數照常前進，不會卡在同一天
      expect(game.attachmentStatus(ATTACH_D4)).toBe('returned');
      expect(save(game).mailbox.filter((m) => m.id.startsWith('mail.day5.m1-wrong-attachment')).map((m) => [m.id, m.dayId])).toEqual([
        ['mail.day5.m1-wrong-attachment', 'day.05'],
        ['mail.day5.m1-wrong-attachment.r1', 'day.06'],
      ]);

      // 選對：送出修訂 2（Day 6 是最後一個工作日，不再排核對）
      expect(game.reviseAttachmentStrict(ATTACH_D4, 1, { choiceId: 'reference', documentId: DOC_0314_WINDOW })).toBe('ok');
      const last = game.attachmentProgress(ATTACH_D4).versions[2];
      expect(last).toEqual(jasmine.objectContaining({ index: 2, attachedCode: '0314', checkDayId: null }));
      expect(game.attachmentStatus(ATTACH_D4)).toBe('submitted');
      expect(isValidSave(save(game), DAY_DIRECTORY)).toBeTrue();
    });

    it('保留缺漏送覆核：沒有可比對的附件，不排核對、不寄退回', () => {
      const game = newGame();
      playTo(game, 'day.05', { ...SAVE_A, attach: { [ATTACH_D4]: { choiceId: 'review' } } });
      expect(game.attachmentProgress(ATTACH_D4).versions[0]).toEqual(
        jasmine.objectContaining({ choiceId: 'review', destination: 'review', document: null, checkDayId: null }),
      );
      expect(game.attachmentStatus(ATTACH_D4)).toBe('submitted');
      expect(mailIdsOf(save(game), 'day.05')).not.toContain('mail.day5.m1-wrong-attachment');
      // 保留送覆核的那一列不帶附件依據
      const row = game.transformProgress(TRANSFORM_D4).submitted?.rows.find((r) => r.id === 'row.0314');
      expect(row?.attachment).toBeNull();
      expect(row?.heldForReview).toBeTrue();
    });
  });

  describe('刷新續接', () => {
    it('附件草稿、批次策略與預覽、已寄郵件與送達時機在重新載入後都相同，不重擲', () => {
      let game = newGame();
      playTo(game, 'day.04', SAVE_A);
      playM1UntilKind(game, 'attachment', SAVE_A);
      game.markTaskOpened();
      game.setAttachmentDraft(ATTACH_D4, { choiceId: 'reference', documentId: DOC_0314_WINDOW });
      const mailbox = save(game).mailbox;

      game = boot();
      expect(game.taskId()).toBe(ATTACH_D4);
      expect(game.attachmentProgress(ATTACH_D4).draft).toEqual({ choiceId: 'reference', documentId: DOC_0314_WINDOW });
      expect(game.attachmentProgress(ATTACH_D4).opened).toBeTrue();
      expect(save(game).mailbox).toEqual(mailbox as MailRecord[]);
      expect(game.submitAttachmentStrict({ choiceId: 'reference', documentId: DOC_0314_WINDOW })).toBe('ok');
      expect(game.attachmentProgress(ATTACH_D4).draft).toBeUndefined();
      expect(game.completeWork()).toBeTrue();

      playM1UntilKind(game, 'transform', SAVE_A);
      game.setTransformPolicy('review');
      expect(game.previewTransform()).toBeTrue();
      game = boot();
      expect(game.transformProgress(TRANSFORM_D4)).toEqual(jasmine.objectContaining({ policy: 'review', previewed: true, previewedOnce: true }));
      expect(game.submitTransformStrict()).toBe('ok');
      expect(game.completeWork()).toBeTrue();

      playDay(game, SAVE_A);
      game.advanceDay();
      const day5 = save(game).mailbox;
      game = boot();
      expect(save(game).mailbox).toEqual(day5 as MailRecord[]);
      expect(game.attachmentProgress(ATTACH_D4).checks.length).toBe(1); // 核對只做一次
    });
  });

  describe('一般回條的送達時機', () => {
    it("'first-task' 的回條：到班與當日第一次交付前不顯示；當日交付後、或隔天起才在收件匣", () => {
      const game = newGame();
      playTo(game, 'day.05', SAVE_B); // 剛開工：今天還沒有任何交付
      const mail: MailRecord = { id: 'mail.test', packId: M1_PACK, templateId: 'window-only', dayId: 'day.05', attachments: [], deliverAfter: 'first-task' };
      const start = save(game);
      expect(isMailDelivered({ ...start, stage: 'morning' }, DAY_DIRECTORY, mail)).toBeFalse();
      expect(isMailDelivered(start, DAY_DIRECTORY, mail)).toBeFalse();
      doTask(game, SAVE_B);
      expect(isMailDelivered(save(game), DAY_DIRECTORY, mail)).toBeTrue();
      expect(isMailDelivered({ ...start, dayId: 'day.06', stage: 'morning' }, DAY_DIRECTORY, mail)).toBeTrue();
      // 收件匣只列已送達的：存檔裡 'first-task' 的回條，交付前不在 mailbox()
      const delayed = start.mailbox.filter((m) => m.deliverAfter === 'first-task' && m.dayId === 'day.05').map((m) => m.id);
      for (const id of delayed) expect(game.mailbox().some((m) => m.id === id)).toBeTrue();
    });
  });

  describe('防重交', () => {
    it('附件送件、批次交付、報告交付：連點第二次被擋，事件與版本只有一筆', async () => {
      const game = newGame();
      const ops = TestBed.inject(WorkOperationsService);
      let release: () => void = () => undefined;
      ops.wait = () => new Promise<void>((resolve) => (release = resolve));
      const drain = async (p: Promise<boolean>): Promise<boolean> => {
        for (let i = 0; i < 10; i++) {
          release();
          await settle();
        }
        return p;
      };
      const count = (kind: string) => save(game).events.filter((e) => e.kind === kind).length;

      playTo(game, 'day.04', SAVE_A);
      playM1UntilKind(game, 'attachment', SAVE_A);
      const input: AttachmentInput = { choiceId: 'reference', documentId: DOC_0314_WINDOW };
      const first = ops.submitAttachment(input, '0314');
      expect(await ops.submitAttachment(input, '0314')).toBeFalse();
      expect(await drain(first)).toBeTrue();
      expect(await drain(ops.submitAttachment(input, '0314'))).toBeFalse();
      expect(count('attachment.submit')).toBe(1);
      expect(game.attachmentProgress(ATTACH_D4).versions.length).toBe(1);
      expect(game.completeWork()).toBeTrue();

      playM1UntilKind(game, 'transform', SAVE_A);
      game.setTransformPolicy('departmentDefault');
      game.previewTransform();
      const t1 = ops.submitTransform();
      expect(await ops.submitTransform()).toBeFalse();
      expect(await drain(t1)).toBeTrue();
      expect(await drain(ops.submitTransform())).toBeFalse();
      expect(count('transform.submit')).toBe(1);
      expect(game.completeWork()).toBeTrue();

      playTo(game, 'day.06', SAVE_A);
      playM1UntilKind(game, 'report', SAVE_A);
      game.generateReport();
      const r1 = ops.submitReport();
      expect(await ops.submitReport()).toBeFalse();
      expect(await drain(r1)).toBeTrue();
      expect(await drain(ops.submitReport())).toBeFalse();
      expect(count('report.submit')).toBe(1);
    });
  });

  describe('舊存檔（v11）續接', () => {
    /** 把現行存檔改寫成 M1 之前的 v11：拿掉 M1 的進度、事件、郵件與已讀。 */
    function toV11(s: Save): Record<string, unknown> {
      const m1Task = (id: string) => id.includes('.m1-');
      const m1Mail = new Set(s.mailbox.filter((m) => m.packId === M1_PACK).map((m) => m.id));
      return {
        ...JSON.parse(JSON.stringify(s)),
        version: 11,
        taskProgress: Object.fromEntries(Object.entries(s.taskProgress).filter(([id]) => !m1Task(id))),
        events: s.events.filter((e) => !/^(attachment|transform|report)\./.test(e.kind) && !m1Task(String((e.payload as { taskId?: string })?.taskId ?? ''))),
        mailbox: s.mailbox.filter((m) => !m1Mail.has(m.id)),
        readMail: s.readMail.filter((id) => !m1Mail.has(id)),
        waivedTasks: s.waivedTasks.filter((id) => !m1Task(id)),
      };
    }

    it('Day 5 工作中的 v11 存檔：升 v12、保留歷史／草稿／已讀／時間；前幾天的新工作免補，當天新工作照常可做，能玩到結束', () => {
      const game = newGame();
      // B102 輸入 102 → 有退件郵件與已讀可以保留
      playTo(game, 'day.03', { ...SAVE_B, codes: { B102: '102' } });
      playTo(game, 'day.05', SAVE_B);
      const receipt = save(game).mailbox.find((m) => m.packId !== M1_PACK);
      expect(receipt).toBeDefined();
      game.markMailRead([receipt!.id]);
      const record = game.records()[0]!;
      game.updateDraft(record.key, { value: '07', policy: 'request_review' });
      const current = save(game);
      const legacy = toV11({ ...current, taskId: 'task.day5.archive' });
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));

      const restored = boot();
      const s = save(restored);
      expect(s.version).toBe(12);
      expect(restored.dayId()).toBe('day.05');
      expect(restored.taskId()).toBe('task.day5.archive');
      // 歷史、已讀、草稿、時間、seed 原樣保留
      expect(s.seed).toBe(current.seed);
      expect(s.night).toEqual(current.night);
      expect(s.readMail).toContain(receipt!.id);
      expect(restored.draft(record.key).value).toBe('07');
      expect(s.events).toEqual(legacy['events'] as never);
      expect(s.batches).toEqual(current.batches);
      expect(s.chatReplies).toEqual(current.chatReplies);
      expect(s.returns).toEqual(current.returns);
      // 已過的 Day 4 新工作免補；Day 5 的新工作照常排入
      expect(s.waivedTasks).toEqual(jasmine.arrayContaining([ATTACH_D4, TRANSFORM_D4]));
      expect(s.waivedTasks).not.toContain(ATTACH_D5);
      expect(restored.dayTasks().map((t) => t.taskId)).toEqual(jasmine.arrayContaining([ATTACH_D5, TRANSFORM_D5]));
      expect(JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}').version).toBe(12);

      playTo(restored, 'end', SAVE_B);
      const end = save(restored);
      expect(isValidSave(end, DAY_DIRECTORY)).toBeTrue();
      // Day 4 沒有批次輸出：Day 6 的 0314 列用歸檔保存的值；報告照常建立
      expect(restored.transformProgress(TRANSFORM_D4).submitted).toBeUndefined();
      expect(fieldMapRow(end, 'row.0314')?.['personnel-code']).toBe('0314');
      expect(restored.report(REPORT_D6)).not.toBeNull();
    });
  });
});
