import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { taskHeading } from '../../../content/bundle';
import { FIELD_MAP_UI, WORKDAY_UI } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { CONTENT_LABELS } from '../../shared/presenters/work-document';
import { M1_SAVE_A, M1_SAVE_B, M1Choices, instantOperations, playM1To, playM1UntilKind, settle } from '../../testing/play';
import { TransformWorkComponent } from './transform-work.component';

/**
 * 批次轉換工作（M1 §2C）：輸入表讀前階段實際保存的編號與附件；缺漏需要選策略才能預覽；
 * 預覽在文件視窗開啟 input／rule／output；兩種策略的數量不同；交付後鎖定並可開啟批次副本。
 */

const TRANSFORM_D4 = 'task.day4.m1-transform';
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

function toTransform(c: M1Choices): GameStateService {
  const game = boot();
  playM1To(game, 'day.04', c);
  playM1UntilKind(game, 'transform', c);
  return game;
}

function render(): ComponentFixture<TransformWorkComponent> {
  const f = TestBed.createComponent(TransformWorkComponent);
  f.autoDetectChanges(true);
  f.detectChanges();
  return f;
}

function el(f: ComponentFixture<TransformWorkComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function text(node: Element | null | undefined): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function counts(f: ComponentFixture<TransformWorkComponent>): string[] {
  return Array.from(el(f).querySelectorAll('[data-transform-counts] dd')).map((d) => text(d));
}

function choose(f: ComponentFixture<TransformWorkComponent>, policy: string): void {
  el(f).querySelector<HTMLInputElement>(`[data-policy="${policy}"]`)?.click();
  f.detectChanges();
}

describe('TransformWorkComponent（M1 批次轉換）', () => {
  afterEach(() => localStorage.clear());

  it('輸入表讀保存的資料：Save A 的 0314 列顯示採用的 0341 與 0521 附件（對象不符）；不含內部 ID', () => {
    toTransform(M1_SAVE_A);
    const f = render();
    expect(text(el(f).querySelector('h3'))).toBe(taskHeading(TRANSFORM_D4));
    const rows = Array.from(el(f).querySelectorAll('[data-transform-row]')).map((r) => r.getAttribute('data-transform-row'));
    expect(rows).toEqual(['0341', '0521', '0716']);
    expect(text(el(f).querySelector('[data-transform-row="0341"]'))).toContain(WORKDAY_UI.evidence.mismatch);
    expect(el(f).querySelector('[data-transform-counts]')).toBeNull();
    expect(el(f).querySelector<HTMLButtonElement>('[data-transform-execute]')?.disabled).toBeTrue();
    expect(el(f).querySelector<HTMLButtonElement>('[data-deliver]')?.disabled).toBeTrue();
    expect(el(f).textContent ?? '').not.toMatch(INTERNAL);
  });

  it('有缺漏沒選策略 → 預覽提示需要處理方式；選策略後預覽在文件視窗開啟，兩種策略的數量不同', () => {
    const game = toTransform(M1_SAVE_B);
    const f = render();
    expect(game.transformMissing(TRANSFORM_D4)).toBeGreaterThan(0);
    expect(text(el(f).querySelector('[data-transform-policy]'))).toContain(WORKDAY_UI.missingMeaning);
    const labels = Array.from(el(f).querySelectorAll('[data-transform-policy] label')).map((l) => text(l));
    expect(labels).toEqual([CONTENT_LABELS.policy(TRANSFORM_D4)?.departmentDefault ?? '?', CONTENT_LABELS.policy(TRANSFORM_D4)?.review ?? '?']);

    el(f).querySelector<HTMLButtonElement>('[data-transform-preview]')?.click();
    f.detectChanges();
    expect(text(el(f).querySelector('[data-transform-error]'))).toBe(FIELD_MAP_UI.policyRequired);
    expect(game.transformProgress(TRANSFORM_D4).previewed).toBeFalse();

    choose(f, 'review');
    expect(el(f).querySelector('[data-transform-error]')).toBeNull();
    el(f).querySelector<HTMLButtonElement>('[data-transform-preview]')?.click();
    f.detectChanges();
    expect(TestBed.inject(MailAttachmentService).openRefs()).toEqual([{ kind: 'batch-preview', taskId: TRANSFORM_D4 }]);
    const review = counts(f);
    expect(Number(review[2])).toBeGreaterThan(0);

    // 換策略：預覽清除，要重新預覽才能執行
    choose(f, 'departmentDefault');
    expect(game.transformProgress(TRANSFORM_D4).previewed).toBeFalse();
    expect(el(f).querySelector<HTMLButtonElement>('[data-transform-execute]')?.disabled).toBeTrue();
    el(f).querySelector<HTMLButtonElement>('[data-transform-preview]')?.click();
    f.detectChanges();
    const filled = counts(f);
    expect(filled[2]).toBe('0');
    expect(filled).not.toEqual(review);
  });

  it('執行並交付：保存輸出快照、鎖定策略、可開啟批次副本；交付按鈕可用', async () => {
    const game = toTransform(M1_SAVE_B);
    const f = render();
    choose(f, 'review');
    el(f).querySelector<HTMLButtonElement>('[data-transform-preview]')?.click();
    f.detectChanges();
    el(f).querySelector<HTMLButtonElement>('[data-transform-execute]')?.click();
    await settle();
    f.detectChanges();
    expect(game.transformProgress(TRANSFORM_D4).submitted?.policy).toBe('review');
    expect(el(f).querySelector('[data-transform-done]')).not.toBeNull();
    expect(el(f).querySelector('[data-transform-policy]')).toBeNull();
    expect(el(f).querySelector('[data-transform-execute]')).toBeNull();
    expect(text(el(f).querySelector('[data-transform-open]'))).toBe(WORKDAY_UI.batchCopyLabel);
    el(f).querySelector<HTMLButtonElement>('[data-transform-open]')?.click();
    expect(TestBed.inject(MailAttachmentService).openRefs()).toContain({ kind: 'batch-output', taskId: TRANSFORM_D4 });
    expect(el(f).querySelector<HTMLButtonElement>('[data-deliver]')?.disabled).toBeFalse();
    expect(text(el(f).querySelector('.work-bar p'))).toBe(WORKDAY_UI.statusSent);
  });
});
