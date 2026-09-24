import { TestBed } from '@angular/core/testing';
import { EXECUTION_LOG_UI, OPERATION_UI, WINDOWS_UI, WINDOW_SHELL_UI } from '../../../content/text';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { LogEntry } from '../presenters/execution-log';
import { EXECUTION_LOG_WINDOW_ID, ExecutionLogComponent, LOG_COMPACT_COUNT } from './execution-log.component';

/**
 * 系統作業紀錄的呈現：空狀態、指令列＋逐階段 JSON＋結果 JSON、唯讀（沒有輸入框）、浮動視窗外框、
 * 預設只露最新幾筆、保存失敗時提供重試。
 */
describe('ExecutionLogComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function render(entries: readonly LogEntry[]) {
    const fixture = TestBed.createComponent(ExecutionLogComponent);
    fixture.componentRef.setInput('entries', entries);
    fixture.componentRef.setInput('defaults', { x: 500, y: 300, width: 380, height: 288 });
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function handoff(i: number): LogEntry {
    return {
      id: `task.complete:${i}`,
      command: 'task.handoff',
      arg: null,
      fields: [
        { key: 'result', value: '"已交付"', type: 'string' },
        { key: 'items', value: String(i), type: 'number' },
      ],
    };
  }

  it('沒有紀錄時顯示中性空狀態；標題在視窗標題列，區域名稱是唯讀說明', () => {
    const { el } = render([]);
    expect(el.querySelector('[role="heading"]')?.textContent?.trim()).toBe(EXECUTION_LOG_UI.heading);
    expect(el.querySelector('[data-log-empty]')?.textContent?.trim()).toBe(EXECUTION_LOG_UI.empty);
    expect(el.querySelector('section')?.getAttribute('aria-label')).toBe(EXECUTION_LOG_UI.ariaLabel);
    expect(el.querySelector('[data-log-history]')).toBeNull();
  });

  it('每筆紀錄是一行指令與一行精簡 JSON；沒有任何輸入元件，按鈕只有視窗控制', () => {
    const { el } = render([
      {
        id: 'archive:0',
        command: 'archive.submit',
        arg: '0102',
        fields: [
          { key: 'check', value: '"通過"', type: 'string' },
          { key: 'personnelId', value: '"0102"', type: 'string' },
          { key: 'destination', value: '"資料覆核佇列"', type: 'string' },
        ],
      },
      handoff(3),
    ]);
    const entries = el.querySelectorAll('[data-log-entry]');
    expect(entries.length).toBe(2);
    expect(entries[0]?.querySelector('[data-log-command]')?.textContent).toBe('$ archive.submit 0102');
    expect(entries[0]?.querySelector('[data-log-output]')?.textContent).toBe(
      '{"check":"通過","personnelId":"0102","destination":"資料覆核佇列"}',
    );
    expect(entries[1]?.querySelector('[data-log-command]')?.textContent).toBe('$ task.handoff');
    expect(entries[1]?.querySelector('[data-log-output]')?.textContent).toBe('{"result":"已交付","items":3}');
    expect(el.querySelector('input, textarea, select, [contenteditable]')).toBeNull();
    const buttons = Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(buttons).toEqual([WINDOWS_UI.minimize, WINDOWS_UI.maximize, WINDOWS_UI.close]);
    expect(el.querySelector('[data-log-empty]')).toBeNull();
    expect(el.querySelector('[data-log-stage]')).toBeNull();
  });

  it('以固定 ID 註冊成浮動視窗，預設位置由 workbench 給', () => {
    render([]);
    expect(TestBed.inject(WindowManagerService).state(EXECUTION_LOG_WINDOW_ID)()).toEqual(
      jasmine.objectContaining({ title: EXECUTION_LOG_UI.heading, x: 500, y: 300, width: 380, height: 288, mode: 'normal' }),
    );
  });

  it('提交過程：指令列後每個階段一行 JSON，保存後接結果行', () => {
    const { el } = render([
      {
        id: 'archive:0',
        command: 'archive.submit',
        arg: '102',
        trail: [
          { key: 'status', value: JSON.stringify(OPERATION_UI.received), type: 'string' },
          { key: 'status', value: JSON.stringify(OPERATION_UI.validated), type: 'string' },
          { key: 'result', value: JSON.stringify(OPERATION_UI.done), type: 'string' },
        ],
        fields: [{ key: 'personnelId', value: '"102"', type: 'string' }],
      },
    ]);
    const stages = Array.from(el.querySelectorAll('[data-log-stage]')).map((s) => s.textContent);
    expect(stages).toEqual([
      `{"status":"${OPERATION_UI.received}"}`,
      `{"status":"${OPERATION_UI.validated}"}`,
      `{"result":"${OPERATION_UI.done}"}`,
    ]);
    expect(el.querySelector('[data-log-command]')?.textContent).toBe('$ archive.submit 102');
    expect(el.querySelector('[data-log-output]')?.textContent).toBe('{"personnelId":"102"}');
    expect(el.querySelector('[data-log-retry]')).toBeNull();
  });

  it('處理中的提交沒有結果行；保存失敗顯示說明與「重試」', () => {
    const running: LogEntry = {
      id: 'operation:1',
      command: 'archive.submit',
      arg: '102',
      trail: [{ key: 'status', value: JSON.stringify(OPERATION_UI.processing), type: 'string' }],
      fields: [],
      pending: 'running',
    };
    const { fixture, el } = render([running]);
    expect(el.querySelector('[data-log-entry]')?.getAttribute('data-log-pending')).toBe('running');
    expect(el.querySelector('[data-log-output]')).toBeNull();
    expect(el.querySelector('[data-log-retry]')).toBeNull();
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    fixture.componentRef.setInput('entries', [
      { ...running, pending: 'failed', fields: [{ key: 'result', value: JSON.stringify(OPERATION_UI.failed), type: 'string' }] },
    ]);
    fixture.detectChanges();
    expect(el.querySelector('[data-log-output]')?.textContent).toBe(`{"result":"${OPERATION_UI.failed}"}`);
    expect(el.querySelector('[data-log-failed]')?.textContent).toContain(OPERATION_UI.failedHint);
    const retry = el.querySelector<HTMLButtonElement>('[data-log-retry]');
    expect(retry?.textContent?.trim()).toBe(OPERATION_UI.retry);
    retry?.click();
    expect(retried).toBe(1);
  });

  it(`預設只露最新 ${LOG_COMPACT_COUNT} 筆；「顯示較早紀錄」展開全部、再按收合`, () => {
    const all = Array.from({ length: LOG_COMPACT_COUNT + 3 }, (_, i) => handoff(i + 1));
    const { fixture, el } = render(all);
    const shown = () =>
      Array.from(el.querySelectorAll('[data-log-output]')).map((o) => o.textContent ?? '');
    expect(LOG_COMPACT_COUNT).toBeGreaterThanOrEqual(3);
    expect(LOG_COMPACT_COUNT).toBeLessThanOrEqual(5);
    expect(shown().length).toBe(LOG_COMPACT_COUNT);
    // 最新一筆在最下面
    expect(shown()[LOG_COMPACT_COUNT - 1]).toContain(`"items":${all.length}`);
    const toggle = el.querySelector<HTMLButtonElement>('[data-log-history]');
    expect(toggle?.textContent?.trim()).toBe(WINDOW_SHELL_UI.history.show);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    toggle?.click();
    fixture.detectChanges();
    expect(shown().length).toBe(all.length);
    expect(toggle?.textContent?.trim()).toBe(WINDOW_SHELL_UI.history.hide);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    toggle?.click();
    fixture.detectChanges();
    expect(shown().length).toBe(LOG_COMPACT_COUNT);
  });

  it('紀錄窗內文有上限高度並在內部捲動（不把頁面撐長）', () => {
    const { el } = render(Array.from({ length: 3 }, (_, i) => handoff(i)));
    const body = el.querySelector<HTMLElement>('[data-window-body]');
    expect(body?.style.maxHeight).toBe('288px');
    expect(body ? getComputedStyle(body).overflowY : '').toBe('auto');
  });
});
