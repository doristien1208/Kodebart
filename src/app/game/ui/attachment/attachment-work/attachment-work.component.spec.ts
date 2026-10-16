import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ALL_DOCUMENTS, taskHeading } from '../../../content/bundle';
import { MAIL_UI, TASKS_UI, WORKDAY_UI } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { CONTENT_LABELS } from '../../shared/presenters/work-document';
import { M1_SAVE_A, instantOperations, playM1To, settle } from '../../testing/play';
import { AttachmentWorkComponent } from './attachment-work.component';

/**
 * 附件關聯工作（M1 §2B）：目前文件顯示對象的來源與玩家採用值；候選附件可開啟、並排查閱；
 * 只驗必要欄位（引用要選附件），不擋選錯；送出後顯示保存的送件摘要、可交付。
 */

const ATTACH_D4 = 'task.day4.m1-attachment';
const DOC_0314_WINDOW = 'doc.day4.m1-0314-window';
const DOC_0521_REPLY = 'doc.day4.m1-0521-reply';
const INTERNAL = /task\.|record\.|doc\.|batch\.|day\.0|mail\.|\b(true|false|null|undefined)\b/;

function boot(): GameStateService {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.returnValue(Promise.resolve(true));
  const game = TestBed.inject(GameStateService);
  game.newGame();
  return game;
}

/** 玩到 Day 4（Save A：0314 輸入 0341），不先做歸檔，直接選附件關聯工作。 */
function toAttachment(): GameStateService {
  const game = boot();
  playM1To(game, 'day.04', M1_SAVE_A);
  expect(game.selectTask(ATTACH_D4)).toBeTrue();
  return game;
}

function render(): ComponentFixture<AttachmentWorkComponent> {
  const f = TestBed.createComponent(AttachmentWorkComponent);
  f.autoDetectChanges(true);
  f.detectChanges();
  return f;
}

function el(f: ComponentFixture<AttachmentWorkComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function text(node: Element | null | undefined): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function headingOf(id: string): string {
  const doc = ALL_DOCUMENTS.find((d) => d.id === id);
  return doc?.kind === 'case-source' ? doc.text.heading : '';
}

function deliver(f: ComponentFixture<AttachmentWorkComponent>): HTMLButtonElement | null {
  return el(f).querySelector<HTMLButtonElement>('[data-deliver]');
}

describe('AttachmentWorkComponent（M1 附件關聯）', () => {
  afterEach(() => localStorage.clear());

  it('目前文件：對象的來源與採用值（取自歸檔保存）、兩份候選附件；第一次開啟記下 opened；未送件不能交付', () => {
    const game = toAttachment();
    expect(game.attachmentProgress(ATTACH_D4).opened).toBeFalse();
    const f = render();
    expect(game.attachmentProgress(ATTACH_D4).opened).toBeTrue();
    expect(text(el(f).querySelector('h3'))).toBe(taskHeading(ATTACH_D4));
    expect(text(el(f).querySelector('[data-subject-source]'))).toBe('0314');
    expect(text(el(f).querySelector('[data-subject-adopted]'))).toBe('0341');
    const candidates = Array.from(el(f).querySelectorAll('[data-attachment-candidate]')).map((c) => text(c.querySelector('label')));
    expect(candidates).toEqual([headingOf(DOC_0314_WINDOW), headingOf(DOC_0521_REPLY)]);
    expect(el(f).querySelector('[data-attachment-evidence]')).toBeNull();
    expect(deliver(f)?.disabled).toBeTrue();
    expect(text(el(f).querySelector('.work-bar p'))).toBe(WORKDAY_UI.statusTodo);
    expect(el(f).textContent ?? '').not.toMatch(INTERNAL);
  });

  it('查閱：開啟送件副本、開啟來源、並排查閱（對象副本＋全部候選）', () => {
    toAttachment();
    const f = render();
    const docs = TestBed.inject(MailAttachmentService);
    el(f).querySelector<HTMLButtonElement>('[data-open-snapshot]')?.click();
    expect(docs.openRefs()).toEqual([{ kind: 'archive-copy', batchId: 'batch.day03.archive', recordKey: 'B314' }]);
    el(f).querySelectorAll<HTMLButtonElement>('[data-attachment-open]')[1]?.click();
    expect(docs.openRefs()[1]).toEqual({ kind: 'case-source', documentId: DOC_0521_REPLY });
    el(f).querySelector<HTMLButtonElement>('[data-attachment-compare]')?.click();
    expect(docs.openRefs()).toEqual([
      { kind: 'archive-copy', batchId: 'batch.day03.archive', recordKey: 'B314' },
      { kind: 'case-source', documentId: DOC_0521_REPLY },
      { kind: 'case-source', documentId: DOC_0314_WINDOW },
    ]);
  });

  it('選附件只存草稿並顯示「這份附件能證明什麼」；沒選就引用 → 提示、不寫入；選了別人的附件照樣可以送出', async () => {
    const game = toAttachment();
    const f = render();
    el(f).querySelector<HTMLButtonElement>('[data-attachment-submit="reference"]')?.click();
    await settle();
    expect(text(el(f).querySelector('[data-attachment-error]'))).toBe(WORKDAY_UI.chooseAttachment);
    expect(game.attachmentProgress(ATTACH_D4).versions).toEqual([]);

    const radio = el(f).querySelectorAll<HTMLInputElement>('[data-attachment-candidate] input[type="radio"]')[1];
    radio?.click();
    f.detectChanges();
    expect(game.attachmentProgress(ATTACH_D4).draft).toEqual({ documentId: DOC_0521_REPLY });
    expect(el(f).querySelector('[data-attachment-error]')).toBeNull();
    expect(el(f).querySelector('[data-attachment-evidence]')).not.toBeNull();

    el(f).querySelector<HTMLButtonElement>('[data-attachment-submit="reference"]')?.click();
    await settle();
    f.detectChanges();
    expect(game.attachmentProgress(ATTACH_D4).versions.map((v) => v.attachedCode)).toEqual(['0521']);
    expect(el(f).querySelector('app-attachment-form')).toBeNull();
    expect(text(el(f).querySelector('[data-attachment-method]'))).toBe(CONTENT_LABELS.choice(ATTACH_D4, 'reference'));
    expect(text(el(f).querySelector('[data-attachment-document]'))).toBe(headingOf(DOC_0521_REPLY));
    // 送出當下不公布對錯：只顯示等待下一工作日核對，沒有「對象不符」之類的提示
    expect(text(el(f).querySelector('[data-attachment-state]'))).toBe(MAIL_UI.awaiting);
    expect(el(f).textContent ?? '').not.toContain(WORKDAY_UI.evidence.mismatch);
    expect(text(el(f).querySelector('.work-bar p'))).toBe(WORKDAY_UI.statusSent);
    expect(deliver(f)?.disabled).toBeFalse();
    expect(text(deliver(f))).toBe(TASKS_UI.deliver);

    el(f).querySelector<HTMLButtonElement>('[data-open-link]')?.click();
    expect(TestBed.inject(MailAttachmentService).openRefs()).toContain({ kind: 'attachment-link', taskId: ATTACH_D4, versionIndex: 0 });
  });

  it('保留缺漏並送覆核：不需選附件；交付後換到下一件工作', async () => {
    const game = toAttachment();
    const f = render();
    el(f).querySelector<HTMLButtonElement>('[data-attachment-submit="review"]')?.click();
    await settle();
    f.detectChanges();
    expect(game.attachmentProgress(ATTACH_D4).versions[0]).toEqual(jasmine.objectContaining({ choiceId: 'review', destination: 'review', document: null }));
    expect(text(el(f).querySelector('[data-attachment-method]'))).toBe(CONTENT_LABELS.choice(ATTACH_D4, 'review'));
    expect(el(f).querySelector('[data-attachment-document]')).toBeNull();
    deliver(f)?.click();
    expect(game.taskId()).not.toBe(ATTACH_D4);
    expect(game.dayTasks().find((t) => t.taskId === ATTACH_D4)?.status).toBe('done');
  });
});
