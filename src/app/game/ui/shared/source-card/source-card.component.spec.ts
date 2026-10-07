import { TestBed } from '@angular/core/testing';
import { recordsOfTask, tasksOfDay } from '../../../content/bundle';
import { RECORD_STATUS, SOURCE_CARD } from '../../../content/text';
import { SourceRecord } from '../../../core/types';
import { SourceCardComponent } from './source-card.component';

/** R7 §6.2：拒絕紀錄在畫面上一律是 recordStatus 文字，不是 true／false／null。 */

function record(refusal: boolean | null, refusalApplies: boolean): SourceRecord {
  return { key: 'K1', name: null, code: '0001', refusal, refusalApplies };
}

function render(r: SourceRecord): HTMLElement {
  const fixture = TestBed.createComponent(SourceCardComponent);
  fixture.componentRef.setInput('record', r);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

/** 來源卡的 dt／dd 依畫面順序配對。 */
function rows(el: HTMLElement): Array<[string, string]> {
  const dts = Array.from(el.querySelectorAll('dt'));
  const dds = Array.from(el.querySelectorAll('dd'));
  return dts.map((dt, i) => [dt.textContent?.trim() ?? '', dds[i]?.textContent?.trim() ?? '']);
}

/** 缺漏說明的文字；沒有顯示時為 null。 */
function noteOf(el: HTMLElement): string | null {
  return el.querySelector('[data-source-missing-note]')?.textContent?.trim() ?? null;
}

describe('SourceCardComponent', () => {
  const cases: Array<[boolean | null, boolean, string]> = [
    [null, false, RECORD_STATUS.notApplicable],
    [true, true, RECORD_STATUS.refused],
    [false, true, RECORD_STATUS.notRefused],
    [null, true, RECORD_STATUS.missing],
  ];
  for (const [refusal, applies, expected] of cases) {
    it(`refusal=${String(refusal)}、applies=${String(applies)} → ${expected}`, () => {
      const el = render(record(refusal, applies));
      const dds = el.querySelectorAll('dd');
      expect(dds[dds.length - 1]?.textContent?.trim()).toBe(expected);
      expect(el.textContent).not.toMatch(/\b(true|false|null)\b/);
    });
  }

  /* ---------- R12：拒絕紀錄所指的安排項目 ---------- */

  it('適用拒絕紀錄：拒絕紀錄前顯示「安排項目：後續聯繫安排」，姓名、編號與拒絕紀錄原值不變', () => {
    const el = render({ key: 'B102', name: null, code: '0102', refusal: null, refusalApplies: true });
    expect(SOURCE_CARD.arrangement).toBe('安排項目');
    expect(SOURCE_CARD.arrangementValue).toBe('後續聯繫安排');
    expect(rows(el)).toEqual([
      [SOURCE_CARD.name, SOURCE_CARD.nameUnregistered],
      [SOURCE_CARD.code, '0102'],
      [SOURCE_CARD.arrangement, SOURCE_CARD.arrangementValue],
      [SOURCE_CARD.refusal, RECORD_STATUS.missing],
    ]);
  });

  it('不適用拒絕紀錄：不顯示安排項目', () => {
    const el = render({ key: 'H17', name: '林予安', code: 'H-17', refusal: null, refusalApplies: false });
    expect(rows(el)).toEqual([
      [SOURCE_CARD.name, '林予安'],
      [SOURCE_CARD.code, 'H-17'],
      [SOURCE_CARD.refusal, RECORD_STATUS.notApplicable],
    ]);
    expect(el.querySelector('[data-source-arrangement]')).toBeNull();
    expect(el.textContent).not.toContain(SOURCE_CARD.arrangementValue);
  });

  it('Day 1 各筆來源：只有適用拒絕紀錄的紀錄顯示安排項目', () => {
    const records = tasksOfDay('day.01')
      .filter((t) => t.kind === 'archive')
      .flatMap((t) => recordsOfTask(t.id));
    expect(records.some((r) => r.refusalApplies)).toBeTrue();
    expect(records.some((r) => !r.refusalApplies)).toBeTrue();
    for (const r of records) {
      const el = render(r);
      const arrangement = el.querySelector('[data-source-arrangement]');
      expect(arrangement?.textContent?.trim() ?? null)
        .withContext(r.key)
        .toBe(r.refusalApplies ? SOURCE_CARD.arrangementValue : null);
      expect(el.textContent?.includes(SOURCE_CARD.arrangement)).withContext(r.key).toBe(r.refusalApplies);
    }
  });

  /* ---------- R12：來源未附拒絕紀錄的說明 ---------- */

  it('缺漏說明：只有適用且未提供時顯示「來源未附回覆紀錄。」；不適用／已拒絕／未拒絕不顯示', () => {
    expect(cases.map(([refusal, applies]) => noteOf(render(record(refusal, applies))))).toEqual([
      null,
      null,
      null,
      SOURCE_CARD.missingNote,
    ]);
  });

  it('缺漏說明接在清單後、以 aria-describedby 連到拒絕紀錄的值；值仍是「未提供」，dt／dd 一一配對、沒有空 dt', () => {
    const el = render(record(null, true));
    const dts = Array.from(el.querySelectorAll('dt'));
    const dds = Array.from(el.querySelectorAll('dd'));
    const value = dds[dds.length - 1];
    const note = el.querySelector('[data-source-missing-note]');
    expect(dts.length).toBe(dds.length);
    expect(dts.every((dt) => (dt.textContent?.trim() ?? '') !== '')).toBeTrue();
    expect(value?.textContent?.trim()).toBe(RECORD_STATUS.missing);
    expect(note?.id).toBeTruthy();
    expect(value?.getAttribute('aria-describedby')).toBe(note?.id ?? '');
    expect(note?.previousElementSibling?.tagName).toBe('DL');
    expect(note?.classList.contains('text-muted')).toBeTrue();
  });

  it('非缺漏狀態的拒絕紀錄值沒有 aria-describedby', () => {
    for (const [refusal, applies] of cases.slice(0, 3)) {
      const dds = render(record(refusal, applies)).querySelectorAll('dd');
      expect(dds[dds.length - 1]?.hasAttribute('aria-describedby'))
        .withContext(`${String(refusal)}/${String(applies)}`)
        .toBeFalse();
    }
  });
});
