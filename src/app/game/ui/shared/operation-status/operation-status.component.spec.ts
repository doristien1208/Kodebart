import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OPERATION_UI } from '../../../content/text';
import { OperationView } from '../../../state/work-operations.service';
import { OperationStatusComponent } from './operation-status.component';

/** R10 §3：表單旁的提交階段只呈現傳入的 operation；寫入失敗才有「重試」。 */

function op(patch: Partial<OperationView>): OperationView {
  return { id: 1, kind: 'archive', taskId: 't', arg: '102', stage: 'received', trail: ['received'], failure: null, ...patch };
}

describe('OperationStatusComponent', () => {
  let fixture: ComponentFixture<OperationStatusComponent>;
  let ref: ComponentRef<OperationStatusComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    fixture = TestBed.createComponent(OperationStatusComponent);
    ref = fixture.componentRef;
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('沒有提交時狀態區存在但沒有內容', () => {
    ref.setInput('operation', null);
    fixture.detectChanges();
    const region = el().querySelector('[role="status"]');
    expect(region?.getAttribute('aria-label')).toBe(OPERATION_UI.ariaLabel);
    expect(region?.textContent?.trim()).toBe('');
  });

  it('依序列出經過的階段，最後一個為目前階段；「格式檢查通過」與「已保存」照內容文字', () => {
    ref.setInput('operation', op({ stage: 'done', trail: ['received', 'validating', 'validated', 'processing', 'saving', 'done'] }));
    fixture.detectChanges();
    const items = Array.from(el().querySelectorAll('li')).map((li) => li.textContent?.trim());
    expect(items).toEqual([
      OPERATION_UI.received,
      OPERATION_UI.validating,
      OPERATION_UI.validated,
      OPERATION_UI.processing,
      OPERATION_UI.saving,
      OPERATION_UI.done,
    ]);
    expect(el().querySelector('[aria-current="step"]')?.textContent).toContain(OPERATION_UI.done);
    expect(el().textContent).not.toContain(OPERATION_UI.retry);
  });

  it('寫入失敗：顯示保存失敗、說明與重試；結構不符時不提供重試', () => {
    const retried = jasmine.createSpy('retry');
    ref.instance.retry.subscribe(retried);
    ref.setInput('operation', op({ stage: 'failed', trail: ['received', 'validating', 'validated', 'processing', 'saving', 'failed'], failure: 'storage' }));
    fixture.detectChanges();
    expect(el().textContent).toContain(OPERATION_UI.failed);
    expect(el().textContent).toContain(OPERATION_UI.failedHint);
    const button = Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === OPERATION_UI.retry);
    button?.click();
    expect(retried).toHaveBeenCalledTimes(1);

    ref.setInput('operation', op({ stage: 'failed', trail: ['received', 'validating', 'failed'], failure: 'invalid' }));
    fixture.detectChanges();
    expect(el().textContent).toContain(OPERATION_UI.failedHint);
    expect(el().querySelector('button')).toBeNull();
  });

  it('規則不允許（例如附件已不是目前版本）：說明狀態已變更、沒有套用，不提供重試', () => {
    ref.setInput('operation', op({ stage: 'failed', trail: ['received', 'validating', 'validated', 'processing', 'saving', 'failed'], failure: 'rejected' }));
    fixture.detectChanges();
    expect(el().textContent).toContain(OPERATION_UI.rejectedHint);
    expect(el().textContent).not.toContain(OPERATION_UI.failedHint);
    expect(el().querySelector('button')).toBeNull();
  });
});
