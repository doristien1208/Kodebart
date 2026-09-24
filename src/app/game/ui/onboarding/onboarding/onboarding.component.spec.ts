import { Component } from '@angular/core';
import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, Routes, provideRouter } from '@angular/router';
import { ONBOARDING, onboardingContractIndex } from '../../../content/bundle';
import { OnboardingContractStep, OnboardingLineStep } from '../../../content/schema';
import { COVER, ONBOARDING_UI, STORAGE, onboardingLoggingIn } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { GameStateService } from '../../../state/game-state.service';
import { SaveRepository } from '../../../state/save-repository';
import { splitGraphemes } from '../presenters/onboarding-text';
import { OnboardingComponent } from './onboarding.component';

/**
 * R12 §6：入職前情與簽名（/onboarding）。
 * 逐字／補完／前進（點擊、Enter、Space）、動態關閉、合約一次顯示、背景點擊與欄位按鍵不送出、
 * 中文輸入法組字、名字檢查、儲存失敗重試、刷新續接、登入後預載桌面再導向 /work。
 */

const P = ONBOARDING.presentation;
const STEPS = ONBOARDING.steps;
const LAST = STEPS.length - 1;
const CONTRACT = STEPS[onboardingContractIndex] as OnboardingContractStep;
const SIG = CONTRACT.signature;
const lineText = (i: number) => (STEPS[i] as OnboardingLineStep).text;

@Component({ selector: 'app-desktop-stub', template: '' })
class DesktopStubComponent {}

interface Harness {
  game: GameStateService;
  navigated: string[];
  /** 依序記錄「預載桌面」與「導向」，確認載入完成才導向。 */
  calls: string[];
}

function boot(): Harness {
  TestBed.resetTestingModule();
  const calls: string[] = [];
  const routes: Routes = [
    { path: 'onboarding', component: DesktopStubComponent },
    {
      path: 'work',
      loadComponent: () => {
        calls.push('load /work');
        return Promise.resolve(DesktopStubComponent);
      },
    },
  ];
  TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  const navigated: string[] = [];
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.callFake((url) => {
    navigated.push(String(url));
    calls.push('navigate ' + String(url));
    return Promise.resolve(true);
  });
  return { game: TestBed.inject(GameStateService), navigated, calls };
}

function render(): ComponentFixture<OnboardingComponent> {
  const f = TestBed.createComponent(OnboardingComponent);
  f.detectChanges();
  return f;
}

const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
const q = <T extends HTMLElement = HTMLElement>(f: ComponentFixture<unknown>, sel: string): T | null => el(f).querySelector<T>(sel);
const typed = (f: ComponentFixture<unknown>) => q(f, '[data-onboarding-typed]')?.textContent ?? '';
const hint = (f: ComponentFixture<unknown>) => q(f, '[data-onboarding-hint]')?.textContent?.trim() ?? '';
const stepOf = (h: Harness) => h.game.onboarding()?.step;

function clickStage(f: ComponentFixture<unknown>): void {
  q(f, '[data-onboarding-stage]')!.click();
  f.detectChanges();
}

function key(f: ComponentFixture<unknown>, k: string, init: KeyboardEventInit = {}, target: EventTarget = document): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  f.detectChanges();
  return e;
}

/** 動態開啟時一段打完所需的時間。 */
const typingMs = (i: number) => splitGraphemes(lineText(i)).length * P.characterIntervalMs;

function toContract(h: Harness): void {
  for (let i = 1; i <= onboardingContractIndex; i++) expect(h.game.advanceOnboarding(i)).toBeTrue();
}

function typeName(f: ComponentFixture<unknown>, value: string): HTMLInputElement {
  const input = q<HTMLInputElement>(f, '[data-signature-input]')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  f.detectChanges();
  return input;
}

function submit(f: ComponentFixture<unknown>): void {
  q(f, '[data-signature-submit]')!.click();
  f.detectChanges();
}

const errorText = (f: ComponentFixture<unknown>) => q(f, '[data-signature-error]')?.textContent?.trim() ?? '';

describe('OnboardingComponent（入職前情與簽名）', () => {
  let h: Harness;

  beforeEach(() => {
    localStorage.clear();
    h = boot();
    TestBed.inject(SettingsService).setMotion(true);
    TestBed.inject(SettingsService).reducedMotion.set(false);
    h.game.newGame();
  });

  afterEach(() => localStorage.clear());

  it('黑底白字等呈現設定由入職包綁定為 CSS 自訂屬性；分頁標題為遊戲名稱', () => {
    const f = render();
    expect(el(f).style.getPropertyValue('--onboarding-bg')).toBe(P.background);
    expect(el(f).style.getPropertyValue('--onboarding-fg')).toBe(P.foreground);
    expect(TestBed.inject(Title).getTitle()).toBe(COVER.title);
    f.destroy();
  });

  it('逐字：每個使用者可見字元 characterIntervalMs；打字中點擊先補完整段，再點才前進', fakeAsync(() => {
    const f = render();
    const parts = splitGraphemes(lineText(0));
    expect(typed(f)).toBe('');
    expect(hint(f)).toBe(ONBOARDING_UI.reveal);
    tick(P.characterIntervalMs);
    f.detectChanges();
    expect(typed(f)).toBe(parts[0]);
    tick(P.characterIntervalMs * 2);
    f.detectChanges();
    expect(typed(f)).toBe(parts.slice(0, 3).join(''));

    clickStage(f);
    expect(typed(f)).toBe(lineText(0));
    expect(stepOf(h)).toBe(0);
    expect(hint(f)).toBe(ONBOARDING_UI.continue);

    clickStage(f);
    expect(stepOf(h)).toBe(1);
    expect(typed(f)).toBe('');
    tick(typingMs(1));
    f.detectChanges();
    expect(typed(f)).toBe(lineText(1));
    expect(hint(f)).toBe(ONBOARDING_UI.continue);
    // 打完不會自己前進
    tick(5000);
    expect(stepOf(h)).toBe(1);
    f.destroy();
  }));

  it('完整文字由常駐 live region 給輔助技術；未出現的字佔位（版面不跳動）；焦點在繼續提示', fakeAsync(() => {
    const f = render();
    tick(P.characterIntervalMs);
    f.detectChanges();
    expect(q(f, '[data-onboarding-line]')!.getAttribute('aria-hidden')).toBe('true');
    expect(q(f, '[data-onboarding-line]')!.textContent).toBe(lineText(0));
    const live = q(f, '[data-onboarding-announce]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe(lineText(0));
    // 換段後常駐的 live region 換成新段完整文字（同一個元素）
    clickStage(f);
    clickStage(f);
    expect(q(f, '[data-onboarding-announce]')).toBe(live);
    expect(live.textContent).toBe(lineText(1));
    expect(document.activeElement).toBe(q(f, '[data-onboarding-hint]'));
    f.destroy();
    discardPeriodicTasks();
  }));

  it('Enter 與 Space 同點擊：先補完、再前進；長按（repeat）與輸入法組字不推進', fakeAsync(() => {
    const f = render();
    const e1 = key(f, 'Enter');
    expect(e1.defaultPrevented).toBeTrue();
    expect(typed(f)).toBe(lineText(0));
    key(f, 'Enter', { repeat: true });
    key(f, 'Enter', { isComposing: true });
    expect(stepOf(h)).toBe(0);
    key(f, 'Enter');
    expect(stepOf(h)).toBe(1);

    // 焦點在繼續提示按鈕上時，Space 只推進一次（原生按鈕觸發被取消）
    const btn = q<HTMLButtonElement>(f, '[data-onboarding-hint]')!;
    const e2 = key(f, ' ', {}, btn);
    expect(e2.defaultPrevented).toBeTrue();
    expect(typed(f)).toBe(lineText(1));
    key(f, ' ', {}, q(f, '[data-onboarding-hint]')!);
    expect(stepOf(h)).toBe(2);
    // 其他按鍵、組合鍵不推進
    key(f, 'a');
    key(f, 'Enter', { ctrlKey: true });
    expect(typed(f)).toBe('');
    f.destroy();
  }));

  it('關閉動態或系統減少動態：整段直接顯示，仍由玩家逐段前進', fakeAsync(() => {
    const settings = TestBed.inject(SettingsService);
    settings.setMotion(false);
    let f = render();
    expect(typed(f)).toBe(lineText(0));
    expect(hint(f)).toBe(ONBOARDING_UI.continue);
    tick(5000);
    expect(stepOf(h)).toBe(0);
    clickStage(f);
    expect(stepOf(h)).toBe(1);
    expect(typed(f)).toBe(lineText(1));
    f.destroy();

    settings.setMotion(true);
    settings.reducedMotion.set(true);
    f = render();
    expect(typed(f)).toBe(lineText(1));
    f.destroy();

    // 打字途中關閉動態 → 立即補完
    settings.reducedMotion.set(false);
    f = render();
    expect(typed(f)).toBe('');
    settings.setMotion(false);
    f.detectChanges();
    expect(typed(f)).toBe(lineText(1));
    expect(stepOf(h)).toBe(1);
    f.destroy();
  }));

  it('合約段：標題、條款、頁尾與署名欄一次全部顯示（不逐字）；焦點在合約標題', fakeAsync(() => {
    toContract(h);
    const f = render();
    expect(q(f, '[data-onboarding-line]')).toBeNull();
    const text = el(f).textContent ?? '';
    expect(q(f, 'h1')!.textContent?.trim()).toBe(CONTRACT.heading);
    const clauses = Array.from(el(f).querySelectorAll('[data-contract-clauses] li')).map((li) => li.textContent?.trim());
    expect(clauses).toEqual(CONTRACT.clauses);
    expect(text).toContain(CONTRACT.footer);
    expect(text).toContain(SIG.label);
    const input = q<HTMLInputElement>(f, '[data-signature-input]')!;
    expect(input.placeholder).toBe(SIG.placeholder);
    expect(input.hasAttribute('maxlength')).toBeFalse();
    expect(q(f, '[data-signature-submit]')!.textContent?.trim()).toBe(SIG.submit);
    expect(el(f).querySelector('form')).toBeNull();
    expect(document.activeElement).toBe(q(f, 'h1'));
    f.destroy();
  }));

  it('合約段：背景點擊、Enter／Space 與欄位內 Enter（含輸入法組字）都不送出、不前進', fakeAsync(() => {
    toContract(h);
    const f = render();
    const input = typeName(f, '王小明');
    q(f, '[data-onboarding-contract]')!.click();
    q(f, '[data-signature]')!.click();
    f.detectChanges();
    key(f, 'Enter');
    key(f, ' ');
    input.focus();
    key(f, 'Enter', { isComposing: true, keyCode: 229 }, input);
    key(f, 'Enter', {}, input);
    key(f, ' ', {}, input);
    tick(100);
    f.detectChanges();
    expect(stepOf(h)).toBe(onboardingContractIndex);
    expect(h.game.profileName()).toBeNull();
    expect(q(f, '[data-signature-status]')!.textContent?.trim()).toBe('');
    expect(input.value).toBe('王小明');
    f.destroy();
  }));

  it('名字檢查：空白必填、24 字可以 25 字太長、表情符號算一個字；錯誤有文字與 aria-invalid', fakeAsync(() => {
    toContract(h);
    const f = render();
    const input = q<HTMLInputElement>(f, '[data-signature-input]')!;
    expect(input.getAttribute('aria-invalid')).toBe('false');

    submit(f);
    tick();
    expect(errorText(f)).toBe(SIG.required);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(q(f, '[data-signature-error]')!.id);
    expect(document.activeElement).toBe(input);

    typeName(f, '   ');
    submit(f);
    tick();
    expect(errorText(f)).toBe(SIG.required);
    expect(stepOf(h)).toBe(onboardingContractIndex);

    // 超過上限：輸入當下就提示，不硬切輸入
    typeName(f, '王'.repeat(25));
    expect(errorText(f)).toBe(SIG.tooLong);
    expect(input.value.length).toBe(25);
    submit(f);
    tick();
    expect(h.game.profileName()).toBeNull();

    typeName(f, '👩‍💻'.repeat(25));
    expect(errorText(f)).toBe(SIG.tooLong);
    typeName(f, '👩‍💻'.repeat(24));
    expect(errorText(f)).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('false');

    typeName(f, ' ' + '王'.repeat(24) + ' ');
    submit(f);
    expect(q(f, '[data-signature-status]')!.textContent?.trim()).toBe(ONBOARDING_UI.signing);
    tick();
    f.detectChanges();
    expect(h.game.profileName()).toBe('王'.repeat(24));
    expect(stepOf(h)).toBe(onboardingContractIndex + 1);
    expect(q(f, '[data-onboarding-contract]')).toBeNull();
    f.destroy();
    discardPeriodicTasks();
  }));

  it('簽「王小明」→ 簽名後旁白；名字只以文字呈現（<b>x</b> 不當 HTML）', fakeAsync(() => {
    toContract(h);
    let f = render();
    typeName(f, '<b>x</b>');
    submit(f);
    tick();
    f.detectChanges();
    expect(h.game.profileName()).toBe('<b>x</b>');
    expect(typed(f)).toBe('');
    tick(typingMs(onboardingContractIndex + 1));
    f.detectChanges();
    expect(typed(f)).toBe(lineText(onboardingContractIndex + 1));
    f.destroy();

    // 走到登入：名字以純文字出現在登入提示
    h.game.advanceOnboarding(LAST);
    f = render();
    clickStage(f);
    clickStage(f);
    const login = q(f, '[data-onboarding-login]')!;
    expect(login.textContent?.trim()).toBe(onboardingLoggingIn('<b>x</b>'));
    expect(login.querySelector('b')).toBeNull();
    flushMicrotasks();
    f.destroy();

    localStorage.clear();
    h = boot();
    h.game.newGame();
    toContract(h);
    f = render();
    typeName(f, '王小明');
    submit(f);
    tick();
    f.detectChanges();
    expect(h.game.profileName()).toBe('王小明');
    expect(h.game.displayName()).toBe('王小明');
    f.destroy();
    discardPeriodicTasks();
  }));

  it('儲存失敗：顯示保存失敗與重試、保留輸入、不前進；重試成功後前進', fakeAsync(() => {
    toContract(h);
    const repo = TestBed.inject(SaveRepository);
    const persist = spyOn(repo, 'persist').and.returnValue(STORAGE.writeIssue);
    const f = render();
    const input = typeName(f, '王小明');
    submit(f);
    tick();
    f.detectChanges();
    expect(q(f, '[data-signature-failed]')!.textContent).toContain(ONBOARDING_UI.saveFailed);
    expect(input.value).toBe('王小明');
    expect(stepOf(h)).toBe(onboardingContractIndex);
    expect(h.game.profileName()).toBeNull();

    persist.and.callThrough();
    const retry = Array.from(el(f).querySelectorAll('button')).find((b) => b.textContent?.trim() === ONBOARDING_UI.retry)!;
    retry.click();
    f.detectChanges();
    tick();
    f.detectChanges();
    expect(h.game.profileName()).toBe('王小明');
    expect(stepOf(h)).toBe(onboardingContractIndex + 1);
    f.destroy();
    discardPeriodicTasks();
  }));

  it('送出中再按不會重複送出', fakeAsync(() => {
    toContract(h);
    const sign = spyOn(h.game, 'signContractStrict').and.callThrough();
    const f = render();
    typeName(f, '王小明');
    submit(f);
    submit(f);
    expect(q(f, '[data-signature-submit]')!.getAttribute('aria-disabled')).toBe('true');
    tick();
    f.detectChanges();
    expect(sign).toHaveBeenCalledTimes(1);
    f.destroy();
    discardPeriodicTasks();
  }));

  it('刷新續接：回到存檔的段落並重新逐字；簽名後刷新不再出現合約、不重複簽名、seed 不變', fakeAsync(() => {
    const seed = h.game.save()!.seed;
    let f = render();
    for (let i = 0; i < 3; i++) {
      clickStage(f);
      clickStage(f);
    }
    expect(stepOf(h)).toBe(3);
    f.destroy();

    h = boot();
    expect(stepOf(h)).toBe(3);
    f = render();
    expect(typed(f)).toBe('');
    tick(typingMs(3));
    f.detectChanges();
    expect(typed(f)).toBe(lineText(3));
    f.destroy();

    h.game.advanceOnboarding(4);
    h.game.advanceOnboarding(5);
    expect(h.game.signContractStrict('王小明')).toBe('ok');
    h = boot();
    f = render();
    expect(q(f, '[data-onboarding-contract]')).toBeNull();
    expect(stepOf(h)).toBe(onboardingContractIndex + 1);
    expect(h.game.profileName()).toBe('王小明');
    expect(h.game.signContractStrict('別人')).toBe('noop');
    expect(h.game.profileName()).toBe('王小明');
    expect(h.game.save()!.seed).toBe(seed);
    f.destroy();
    discardPeriodicTasks();
  }));

  it('最後一段之後：完成入職 → 登入提示 → 預載桌面畫面 → 導向 /work', fakeAsync(() => {
    toContract(h);
    expect(h.game.signContractStrict('王小明')).toBe('ok');
    for (let i = onboardingContractIndex + 2; i <= LAST; i++) h.game.advanceOnboarding(i);
    const f = render();
    clickStage(f);
    expect(h.game.onboarding()!.complete).toBeFalse();
    clickStage(f);
    expect(h.game.onboarding()!.complete).toBeTrue();
    expect(q(f, '[data-onboarding-login]')!.textContent?.trim()).toBe(onboardingLoggingIn('王小明'));
    expect(q(f, '[data-onboarding-announce]')!.textContent).toBe(onboardingLoggingIn('王小明'));
    expect(q(f, '[data-onboarding-stage]')).toBeNull();
    flushMicrotasks();
    expect(h.calls).toEqual(['load /work', 'navigate /work']);
    // 登入中再按鍵不重複導向
    key(f, 'Enter');
    flushMicrotasks();
    expect(h.navigated).toEqual(['/work']);
    f.destroy();

    // 登入中刷新：存檔已完成入職，元件直接接著進桌面（stage guard 也會送到 /work）
    h = boot();
    const again = render();
    expect(q(again, '[data-onboarding-login]')).not.toBeNull();
    flushMicrotasks();
    expect(h.navigated).toEqual(['/work']);
    again.destroy();
  }));
});
