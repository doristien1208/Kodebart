import { recordsOfTask } from '../../../content/bundle';
import { ArchivedRecord, MailAttachment, ReturnCase, Save } from '../../../core/types';
import { attachmentDocument, recordNameOf } from './attachment-view';

/**
 * 附件文件的紀錄姓名（R12）：取自該案原批次已保存的提交快照（ArchivedRecord.source.name），不查目前內容檔——
 * 內容改稿或移除原工作後，舊附件的姓名不變；缺快照時安全地給空值，不丟例外、不退回目前內容。
 */

const BATCH = 'batch.day01.archive';
const TASK = 'task.day1.archive';
const KEY = 'B102';
/** 測試用的保存姓名（目前內容的 B102 沒有登記姓名）。 */
const SAVED_NAME = '提交時的姓名';

function returnCase(patch: Partial<ReturnCase> = {}): ReturnCase {
  const id = `return.day1-code-audit.${KEY}`;
  return {
    id,
    auditId: 'day1-code-audit',
    batchId: BATCH,
    recordKey: KEY,
    archiveTaskId: TASK,
    reviewTaskId: 'task.day2.reconcile',
    sourceCode: '0102',
    submittedCode: '102',
    reviewedCode: '102',
    disposition: 'release',
    reason: 'code-mismatch',
    notifyDayId: 'day.03',
    status: 'pending',
    dueDayId: 'day.04',
    versions: [],
    receipts: [{ id: `${id}#0`, kind: 'returned', dayId: 'day.03', versionIndex: null, code: '102', reason: 'code-mismatch' }],
    ...patch,
  };
}

function archived(name: string | null): ArchivedRecord {
  return { archiveCode: '102', refusal: false, origin: 'defaulted', source: { name, code: '0102', refusal: null, refusalApplies: true } };
}

/** 原批次只有一筆提交（key 的快照姓名為 name）。 */
function batchesWith(name: string | null, key = KEY): Save['batches'] {
  return { [BATCH]: { archived: { [key]: archived(name) }, drafts: {} } };
}

function refOf(item: ReturnCase): MailAttachment {
  const receipt = item.receipts[0];
  if (!receipt) throw new Error('沒有回條');
  return { kind: 'return-receipt', caseId: item.id, receiptId: receipt.id, versionIndex: receipt.versionIndex };
}

function contentName(key: string): string | null | undefined {
  return recordsOfTask(TASK).find((r) => r.key === key)?.name;
}

describe('attachment-view presenter：紀錄姓名取自提交快照（R12）', () => {
  it('保存姓名與目前內容不同：顯示保存值，不查目前內容', () => {
    expect(contentName(KEY)).not.toBe(SAVED_NAME);
    const item = returnCase();
    expect(recordNameOf(item, batchesWith(SAVED_NAME))).toBe(SAVED_NAME);
    expect(attachmentDocument([item], batchesWith(SAVED_NAME), refOf(item))?.name).toBe(SAVED_NAME);
  });

  it('保存時來源未登記姓名（null）：仍是 null（畫面顯示「未登記」），不拿目前內容的姓名補上', () => {
    expect(contentName('H17')).toBeTruthy();
    expect(recordNameOf(returnCase({ recordKey: 'H17' }), batchesWith(null, 'H17'))).toBeNull();
  });

  it('原工作已從內容移除：仍顯示保存值', () => {
    const item = returnCase({ archiveTaskId: 'task.removed' });
    expect(recordNameOf(item, batchesWith(SAVED_NAME))).toBe(SAVED_NAME);
    expect(attachmentDocument([item], batchesWith(SAVED_NAME), refOf(item))?.name).toBe(SAVED_NAME);
  });

  it('缺快照（沒有原批次或該筆提交）：安全顯示空值，其餘欄位照常', () => {
    const item = returnCase();
    expect(recordNameOf(item, {})).toBe('');
    expect(recordNameOf(item, batchesWith(SAVED_NAME, 'B607'))).toBe('');
    expect(recordNameOf(returnCase({ batchId: 'batch.removed', archiveTaskId: 'task.removed' }), batchesWith(SAVED_NAME))).toBe('');
    const doc = attachmentDocument([item], {}, refOf(item));
    expect(doc?.name).toBe('');
    expect(doc?.sourceCode).toBe('0102');
    expect(doc?.submittedCode).toBe('102');
    expect(doc?.checkedCode).toBe('102');
  });
});
