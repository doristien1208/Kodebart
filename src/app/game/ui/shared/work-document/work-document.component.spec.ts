import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MAIL_UI, WORKDAY_UI, attachmentVersionLabel } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { M1_SAVE_A, M1_SAVE_B, instantOperations, playM1To, settle } from '../../testing/play';
import { DocumentRef } from '../presenters/work-document';
import { WorkDocumentComponent } from './work-document.component';

/**
 * 文件視窗內容（M1）：附件關聯版本從回條開啟；只有被退回的最新版本出現修訂表單，
 * 舊版本與已送出待核對的版本唯讀；修訂保存為新版本，原送件留存。批次副本有 input／rule／output 與對照。
 */

const ATTACH_D4 = 'task.day4.m1-attachment';
const DOC_0314_WINDOW = 'doc.day4.m1-0314-window';
const DOC_0521_REPLY = 'doc.day4.m1-0521-reply';

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

function render(ref: DocumentRef): ComponentFixture<WorkDocumentComponent> {
  const f = TestBed.createComponent(WorkDocumentComponent);
  f.componentRef.setInput('ref', ref);
  f.autoDetectChanges(true);
  f.detectChanges();
  return f;
}

function el(f: ComponentFixture<WorkDocumentComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function text(node: Element | null | undefined): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function link(versionIndex: number): DocumentRef {
  return { kind: 'attachment-link', taskId: ATTACH_D4, versionIndex };
}

describe('WorkDocumentComponent（M1 文件視窗）', () => {
  afterEach(() => localStorage.clear());

  it('退回的最新版本：顯示「目前版本」與修訂表單；送出修訂後原視窗變歷史版本、唯讀，新版本待核對且唯讀', async () => {
    const game = boot();
    playM1To(game, 'day.05', M1_SAVE_A);
    const first = render(link(0));
    expect(el(first).querySelector('[data-work-document]')?.getAttribute('data-work-document')).toBe('link');
    expect(text(el(first).querySelector('[data-wd-state]'))).toBe(MAIL_UI.current);
    expect(text(el(first).querySelector('[data-wd-version]'))).toBe(attachmentVersionLabel(0));
    expect(el(first).querySelector('[data-wd-attached]')).not.toBeNull();
    expect(el(first).querySelector('[data-wd-revision] app-attachment-form')).not.toBeNull();

    // 沒選附件就引用 → 提示；選 0314 窗口回條後送出修訂
    el(first).querySelector<HTMLButtonElement>('[data-attachment-submit="reference"]')?.click();
    await settle();
    expect(text(el(first).querySelector('[data-attachment-error]'))).toBe(WORKDAY_UI.chooseAttachment);
    el(first).querySelectorAll<HTMLInputElement>('[data-attachment-candidate] input[type="radio"]')[0]?.click();
    first.detectChanges();
    expect(game.attachmentProgress(ATTACH_D4).draft).toEqual({ documentId: DOC_0314_WINDOW });
    el(first).querySelector<HTMLButtonElement>('[data-attachment-submit="reference"]')?.click();
    await settle();
    first.detectChanges();

    const versions = game.attachmentProgress(ATTACH_D4).versions;
    expect(versions.map((v) => v.document?.id)).toEqual([DOC_0521_REPLY, DOC_0314_WINDOW]);
    expect(text(el(first).querySelector('[data-wd-state]'))).toBe(MAIL_UI.historical);
    expect(el(first).querySelector('[data-wd-revision]')).toBeNull();

    const second = render(link(1));
    expect(text(el(second).querySelector('[data-wd-version]'))).toBe(attachmentVersionLabel(1));
    expect(text(el(second).querySelector('[data-wd-state]'))).toBe(MAIL_UI.awaiting);
    expect(el(second).querySelector('[data-wd-revision]')).toBeNull();
  });

  it('並排查閱（修訂中）：目前版本與全部候選附件一起並排', () => {
    const game = boot();
    playM1To(game, 'day.05', M1_SAVE_A);
    expect(game.attachmentStatus(ATTACH_D4)).toBe('returned');
    const f = render(link(0));
    el(f).querySelector<HTMLButtonElement>('[data-attachment-compare]')?.click();
    expect(TestBed.inject(MailAttachmentService).openRefs()).toEqual([
      link(0),
      { kind: 'case-source', documentId: DOC_0314_WINDOW },
      { kind: 'case-source', documentId: DOC_0521_REPLY },
    ]);
  });

  it('核對相符的版本沒有修訂表單；不存在的版本顯示「找不到」', () => {
    const game = boot();
    playM1To(game, 'day.05', M1_SAVE_B);
    expect(game.attachmentStatus(ATTACH_D4)).toBe('resolved');
    const ok = render(link(0));
    expect(text(el(ok).querySelector('[data-wd-state]'))).toBe(MAIL_UI.resolved);
    expect(el(ok).querySelector('[data-wd-revision]')).toBeNull();
    const lost = render(link(5));
    expect(text(el(lost).querySelector('[data-wd-missing]'))).toBe(MAIL_UI.missingAttachment);
  });

  it('批次副本：逐列表格、input／rule／output 三欄與 true／false／null 對照', () => {
    const game = boot();
    playM1To(game, 'day.05', M1_SAVE_B);
    expect(game.transformProgress('task.day4.m1-transform').submitted).toBeDefined();
    const f = render({ kind: 'batch-output', taskId: 'task.day4.m1-transform' });
    expect(el(f).querySelectorAll('[data-batch-row]').length).toBe(3);
    expect(el(f).querySelector('[data-batch-json-input]')).not.toBeNull();
    expect(el(f).querySelector('[data-batch-json-rule]')).not.toBeNull();
    expect(el(f).querySelector('[data-batch-json-output]')).not.toBeNull();
    expect(el(f).querySelectorAll('[data-batch-legend] li').length).toBe(3);
    expect(el(f).querySelectorAll('[data-batch-counts] dd').length).toBe(3);
  });
});
