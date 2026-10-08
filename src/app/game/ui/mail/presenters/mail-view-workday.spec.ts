import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MAIL_UI, WORKDAY_UI, workdayMailTemplate } from '../../../content/text';
import { MailRecord, Save } from '../../../core/types';
import { DAY_DIRECTORY } from '../../../state/day-directory';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { DocumentRef, documentTitle } from '../../shared/presenters/work-document';
import { M1_SAVE_A, M1_SAVE_B, instantOperations, playM1To } from '../../testing/play';
import { MailView, buildMailViews, mailView } from './mail-view';

/**
 * M1 延後回條的郵件 presenter：主旨／內文來自內容包模板；附件名為文件視窗標題；
 * 附件關聯版本有可修訂／歷史狀態，其他附件只供查閱；批次回條附逐列表格（待補清單只列待補列）；
 * 模板或附件找不到時標示，不丟例外、不改開最新版本。
 */

const PACK = 'mail.m1-workday';
const ATTACH_D4 = 'task.day4.m1-attachment';
const DOC_0314_WINDOW = 'doc.day4.m1-0314-window';
const INTERNAL = /return\.|mail\.|task\.|batch\.|record\.|doc\.|day\.0|#\d|\b(true|false|null|undefined)\b/;

function newGame(): GameStateService {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.returnValue(Promise.resolve(true));
  const game = TestBed.inject(GameStateService);
  game.newGame();
  return game;
}

function saveOf(game: GameStateService): Save {
  const s = game.save();
  if (!s) throw new Error('沒有存檔');
  return s;
}

function label(game: GameStateService): (ref: DocumentRef) => string {
  return (ref) => documentTitle(ref, game.save(), DAY_DIRECTORY);
}

function viewOf(game: GameStateService, mailId: string): MailView {
  const mail = saveOf(game).mailbox.find((m) => m.id === mailId);
  if (!mail) throw new Error(`沒有郵件 ${mailId}`);
  return mailView(mail, game.returns(), game.isMailRead(mail.id), saveOf(game), label(game));
}

function visibleText(v: MailView): string {
  return [
    v.sender,
    v.subject,
    ...v.lines,
    v.received,
    ...v.attachments.flatMap((a) => [a.label, a.stateText]),
    ...(v.table ? [...v.table.columns, ...v.table.rows.flat()] : []),
  ].join('\n');
}

describe('mail-view presenter（M1 延後回條）', () => {
  afterEach(() => localStorage.clear());

  it('附件對象不符：主旨與內文照模板；附件關聯為目前可修訂（待處理），來源附件只供查閱；不含內部 ID', () => {
    const game = newGame();
    playM1To(game, 'day.05', M1_SAVE_A);
    const v = viewOf(game, 'mail.day5.m1-wrong-attachment');
    const template = workdayMailTemplate(PACK, 'wrong-attachment');
    expect(v.failed).toBeFalse();
    expect(v.sender).toBe('資料作業窗口');
    expect(v.subject).toBe(template?.subject ?? '?');
    expect(v.lines).toEqual([...(template?.lines ?? [])]);
    expect(v.attachments.map((a) => [a.state, a.stateText])).toEqual([
      ['current', MAIL_UI.current],
      ['reference', ''],
    ]);
    expect(v.pending).toBeTrue();
    expect(v.table).toBeNull();
    expect(visibleText(v)).not.toMatch(INTERNAL);

    // 修訂送出後：這封信的附件變歷史版本、不再待處理
    expect(game.reviseAttachmentStrict(ATTACH_D4, 0, { choiceId: 'reference', documentId: DOC_0314_WINDOW })).toBe('ok');
    const after = viewOf(game, 'mail.day5.m1-wrong-attachment');
    expect(after.attachments[0]?.state).toBe('historical');
    expect(after.attachments[0]?.stateText).toBe(MAIL_UI.historical);
    expect(after.pending).toBeFalse();
  });

  it('窗口收件與待補清單：批次回條的表格依保存的輸出；待補清單只列待補列', () => {
    const game = newGame();
    playM1To(game, 'day.05', M1_SAVE_B);
    const window = viewOf(game, 'mail.day5.m1-window-only');
    const awaiting = viewOf(game, 'mail.day5.m1-awaiting');
    const c = WORKDAY_UI.columns;
    expect(window.table?.columns).toEqual([c.code, c.value, c.origin, c.status]);
    expect(window.table?.rows.length).toBe(3);
    expect(awaiting.table?.rows.length).toBeGreaterThan(0);
    expect(awaiting.table?.rows.every((r) => r[3] === WORKDAY_UI.rowStatus.pending)).toBeTrue();
    expect(awaiting.table?.rows.length).toBeLessThan(window.table?.rows.length ?? 0);
    // 窗口收件回條引用的是玩家送出的那個附件版本（只供查閱）
    expect(window.attachments.map((a) => a.ref.kind)).toEqual(['batch-output', 'attachment-link']);
    expect(window.attachments.every((a) => a.state === 'reference')).toBeTrue();
    expect(window.pending).toBeFalse();
    for (const v of [window, awaiting]) expect(visibleText(v)).not.toMatch(INTERNAL);
  });

  it('找不到：模板或郵件包不存在 → 讀取失敗；附件關聯版本不存在 → 「找不到」；未知日不丟例外', () => {
    const game = newGame();
    playM1To(game, 'day.05', M1_SAVE_A);
    const s = saveOf(game);
    const base: MailRecord = { id: 'mail.test', packId: PACK, templateId: 'version', dayId: 'day.05', attachments: [] };
    expect(mailView(base, [], false, s).failed).toBeFalse();
    expect(mailView({ ...base, templateId: 'removed' }, [], false, s).failed).toBeTrue();
    expect(mailView({ ...base, packId: 'mail.removed' }, [], false, s).failed).toBeTrue();
    expect(mailView({ ...base, dayId: 'day.99' }, [], false, s).received).toBe('');

    const lost = mailView(
      { ...base, attachments: [{ kind: 'attachment-link', taskId: ATTACH_D4, versionIndex: 9 }, { kind: 'attachment-link', taskId: 'task.removed', versionIndex: 0 }] },
      [],
      false,
      s,
      label(game),
    );
    expect(lost.attachments.map((a) => [a.state, a.stateText])).toEqual([
      ['missing', MAIL_UI.missingAttachment],
      ['missing', MAIL_UI.missingAttachment],
    ]);
    expect(lost.attachments.map((a) => a.label)).toEqual([MAIL_UI.missingAttachment, MAIL_UI.missingAttachment]);
    expect(lost.pending).toBeFalse();
    // 批次輸出找不到：不附表格
    expect(mailView({ ...base, templateId: 'batch', attachments: [{ kind: 'batch-output', taskId: 'task.removed' }] }, [], false, s).table).toBeNull();
  });

  it('收件匣排序：新的在前，退件回條與 M1 回條混排；只列已送達的郵件', () => {
    const game = newGame();
    playM1To(game, 'day.06', M1_SAVE_B);
    const views = buildMailViews(game.mailbox(), game.returns(), (id) => game.isMailRead(id), saveOf(game), label(game));
    expect(views.length).toBe(game.mailbox().length);
    expect(views.every((v) => !v.failed)).toBeTrue();
    const days = views.map((v) => v.received);
    expect(days[0]).not.toBe(days[days.length - 1]);
    for (const v of views) expect(visibleText(v)).not.toMatch(INTERNAL);
  });
});
