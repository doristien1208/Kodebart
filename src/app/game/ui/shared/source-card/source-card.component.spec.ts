import { TestBed } from '@angular/core/testing';
import { RECORD_STATUS } from '../../../content/text';
import { SourceRecord } from '../../../core/types';
import { SourceCardComponent } from './source-card.component';

/** R7 §6.2：拒絕紀錄在畫面上一律是 recordStatus 文字，不是 true／false／null。 */

function record(refusal: boolean | null, refusalApplies: boolean): SourceRecord {
  return { key: 'K1', name: null, code: '0001', refusal, refusalApplies };
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
      const fixture = TestBed.createComponent(SourceCardComponent);
      fixture.componentRef.setInput('record', record(refusal, applies));
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const dds = el.querySelectorAll('dd');
      expect(dds[dds.length - 1]?.textContent?.trim()).toBe(expected);
      expect(el.textContent).not.toMatch(/\b(true|false|null)\b/);
    });
  }
});
