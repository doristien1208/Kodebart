import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ARCHIVE_UI, SOURCE_CARD } from '../../../content/text';
import { MissingPolicy, SourceRecord } from '../../../core/types';
import { ArchiveCheckFormComponent } from './archive-check-form.component';

/**
 * R12（#7）缺漏處理：玩家選的是處理動作，不是猜來源的答案。legend 與兩個選項的主文字／hint 取自 ARCHIVE_UI，
 * radio 的 value 與送出的 MissingPolicy 仍是 default_false／request_review（預覽、結果與去向由狀態層決定）。
 */

/** 適用拒絕紀錄、來源未附（未提供）。 */
const MISSING: SourceRecord = { key: 'B102', name: null, code: '0102', refusal: null, refusalApplies: true };

function render(record: SourceRecord): ComponentFixture<ArchiveCheckFormComponent> {
  const fixture = TestBed.createComponent(ArchiveCheckFormComponent);
  fixture.componentRef.setInput('record', record);
  fixture.componentRef.setInput('draft', { value: '' });
  fixture.componentRef.setInput('archived', undefined);
  fixture.componentRef.setInput('fieldError', '');
  fixture.componentRef.setInput('preview', null);
  fixture.detectChanges();
  return fixture;
}

function el(fixture: ComponentFixture<ArchiveCheckFormComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('ArchiveCheckFormComponent：缺漏處理是處理動作（R12）', () => {
  it('legend 與兩個選項的主文字／hint 是核准文案；radio value 仍是 default_false／request_review', () => {
    const root = el(render(MISSING));
    expect(root.querySelector('fieldset legend')?.textContent).toContain(ARCHIVE_UI.missingLegend);
    const options = Array.from(root.querySelectorAll('fieldset label.radio')).map((label) => [
      label.querySelector<HTMLInputElement>('input[type="radio"]')?.value,
      Array.from(label.querySelectorAll('span.block')).map((s) => s.textContent?.trim()),
    ]);
    expect(options).toEqual([
      ['default_false', [ARCHIVE_UI.policyDefault, ARCHIVE_UI.policyDefaultHint]],
      ['request_review', [ARCHIVE_UI.policyReview, ARCHIVE_UI.policyReviewHint]],
    ]);
    expect([ARCHIVE_UI.missingLegend, ARCHIVE_UI.policyDefault, ARCHIVE_UI.policyReview]).toEqual([
      '處理缺漏方式',
      '套用部門預設並歸檔',
      '保留缺漏並送覆核',
    ]);
    // 同一畫面的來源卡標出「來源未附回覆紀錄。」
    expect(root.querySelector('[data-source-missing-note]')?.textContent?.trim()).toBe(SOURCE_CARD.missingNote);
  });

  it('點選兩個選項仍送出原本的 MissingPolicy（default_false／request_review）', () => {
    const fixture = render(MISSING);
    const emitted: MissingPolicy[] = [];
    fixture.componentInstance.policySelect.subscribe((p) => emitted.push(p));
    for (const value of ['default_false', 'request_review']) {
      const radio = el(fixture).querySelector<HTMLInputElement>(`input[name="policy"][value="${value}"]`);
      if (!radio) throw new Error(`找不到選項 ${value}`);
      radio.click();
      fixture.detectChanges();
    }
    expect(emitted).toEqual(['default_false', 'request_review']);
  });

  it('不需處理缺漏的紀錄（不適用／已拒絕／未拒絕）沒有這組選項，也沒有缺漏說明', () => {
    const others: SourceRecord[] = [
      { ...MISSING, refusalApplies: false },
      { ...MISSING, refusal: true },
      { ...MISSING, refusal: false },
    ];
    for (const record of others) {
      const root = el(render(record));
      const context = `${String(record.refusal)}/${String(record.refusalApplies)}`;
      expect(root.querySelector('fieldset')).withContext(context).toBeNull();
      expect(root.querySelector('[data-source-missing-note]')).withContext(context).toBeNull();
    }
  });
});
