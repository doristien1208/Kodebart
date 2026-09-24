import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LEGACY_PLAYER_NAME, onboardingContractIndex } from '../../../content/bundle';
import { COVER, NEW_GAME_DIALOG } from '../../../content/text';
import { Save } from '../../../core/types';
import { GameStateService } from '../../../state/game-state.service';
import { SAVE_KEY } from '../../../state/save-repository';
import { archiveFirst, finishTasks } from '../../testing/play';
import { CoverSceneComponent } from '../cover-scene/cover-scene.component';
import { CoverComponent } from './cover.component';

/**
 * R12 §6：封面接入職流程。開始遊戲先確認覆蓋（取消不動存檔）才建立新存檔並進 /onboarding；
 * 繼續遊戲依 routeForSave：入職未完成回 /onboarding，舊存檔（無姓名、入職視為完成）回工作階段。
 */

/** 場景層（背景圖、雨、繪圖迴圈）與本規格無關，換成空元件。 */
@Component({ selector: 'app-cover-scene', template: '' })
class CoverSceneStubComponent {}

interface Harness {
  game: GameStateService;
  navigated: string[];
}

function boot(): Harness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  TestBed.overrideComponent(CoverComponent, {
    remove: { imports: [CoverSceneComponent] },
    add: { imports: [CoverSceneStubComponent] },
  });
  const navigated: string[] = [];
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.callFake((url) => {
    navigated.push(String(url));
    return Promise.resolve(true);
  });
  return { game: TestBed.inject(GameStateService), navigated };
}

function render(): ComponentFixture<CoverComponent> {
  const f = TestBed.createComponent(CoverComponent);
  f.detectChanges();
  return f;
}

function button(f: ComponentFixture<unknown>, text: string): HTMLButtonElement {
  const b = Array.from((f.nativeElement as HTMLElement).querySelectorAll('button')).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`找不到按鈕「${text}」`);
  return b;
}

function click(f: ComponentFixture<unknown>, text: string): void {
  button(f, text).click();
  f.detectChanges();
}

const dialogOpen = (f: ComponentFixture<unknown>) =>
  Array.from((f.nativeElement as HTMLElement).querySelectorAll('dialog')).some((d) => d.open);

/** 現行存檔退回 R11（v10）形狀：沒有姓名、入職與郵件欄位。 */
function toV10(save: Save): Record<string, unknown> {
  const { issueDrafts: _d, mailbox: _m, readMail, helpRequests: _h, profile: _p, onboarding: _o, version: _v, ...rest } = save;
  return { ...rest, version: 10, readIssueReceipts: readMail.map((id) => id.replace(/^mail\./, '')) };
}

describe('CoverComponent（開始與繼續的導向）', () => {
  afterEach(() => localStorage.clear());

  beforeEach(() => localStorage.clear());

  it('沒有存檔：開始遊戲直接建立新存檔並進入職前情', () => {
    const h = boot();
    const f = render();
    click(f, COVER.start);
    expect(dialogOpen(f)).toBeFalse();
    expect(h.game.onboarding()).toEqual({ step: 0, complete: false });
    expect(h.game.profileName()).toBeNull();
    expect(h.navigated).toEqual(['/onboarding']);
    f.destroy();
  });

  it('已有存檔：先顯示覆蓋確認（存檔不變）；保留則不動，確認後才建立新存檔並進 /onboarding', () => {
    let h = boot();
    h.game.newGame();
    const old = h.game.save()!;
    h = boot();
    const f = render();

    click(f, COVER.start);
    expect(dialogOpen(f)).toBeTrue();
    expect(h.game.save()).toEqual(old);
    expect(localStorage.getItem(SAVE_KEY)).toBe(JSON.stringify(old));
    expect(h.navigated).toEqual([]);

    click(f, NEW_GAME_DIALOG.keep);
    expect(dialogOpen(f)).toBeFalse();
    expect(h.game.save()).toEqual(old);
    expect(h.navigated).toEqual([]);

    click(f, COVER.start);
    click(f, NEW_GAME_DIALOG.start);
    expect(dialogOpen(f)).toBeFalse();
    expect(h.game.save()).not.toEqual(old);
    expect(h.game.onboarding()).toEqual({ step: 0, complete: false });
    expect(h.navigated).toEqual(['/onboarding']);
    f.destroy();
  });

  it('繼續：入職未完成的存檔回到 /onboarding（原段落保留）', () => {
    let h = boot();
    h.game.newGame();
    h.game.advanceOnboarding(1);
    h.game.advanceOnboarding(2);
    h = boot();
    const f = render();
    click(f, COVER.continue);
    expect(h.navigated).toEqual(['/onboarding']);
    expect(h.game.onboarding()).toEqual({ step: 2, complete: false });
    f.destroy();
  });

  it('繼續：舊存檔（R11 v10，Day 1 工作中）遷移後入職視為完成、顯示「員工」，直接回 /work', () => {
    let h = boot();
    h.game.newGame();
    archiveFirst(h.game, 1);
    const v10 = toV10(h.game.save()!);
    localStorage.clear();
    localStorage.setItem(SAVE_KEY, JSON.stringify(v10));

    h = boot();
    expect(h.game.onboarding()).toEqual({ step: 0, complete: true });
    expect(h.game.displayName()).toBe(LEGACY_PLAYER_NAME);
    expect(h.game.stage()).toBe('work');
    const f = render();
    click(f, COVER.continue);
    expect(h.navigated).toEqual(['/work']);
    f.destroy();
  });

  it('繼續：已完成入職的存檔依 stage 回 /work；日結後回 /overnight', () => {
    let h = boot();
    h.game.newGame();
    for (let i = 1; i <= onboardingContractIndex; i++) h.game.advanceOnboarding(i);
    expect(h.game.signContractStrict('王小明')).toBe('ok');
    while (h.game.advanceOnboarding(h.game.onboarding()!.step + 1)) {
      /* 走到最後一段 */
    }
    expect(h.game.completeOnboarding()).toBeTrue();
    h = boot();
    let f = render();
    click(f, COVER.continue);
    expect(h.navigated).toEqual(['/work']);
    f.destroy();

    finishTasks(h.game);
    h = boot();
    f = render();
    click(f, COVER.continue);
    expect(h.navigated).toEqual(['/overnight']);
    f.destroy();
  });
});
