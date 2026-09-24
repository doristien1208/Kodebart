import { RECORD_STATUS } from '../../../content/text';
import { SourceRecord } from '../../../core/types';
import { archivedRefusalStatus, sourceRefusalStatus } from './record-status';

/** R7 §6.2：拒絕紀錄在畫面上一律是 recordStatus 文字，不是 true／false／null。 */

function record(refusal: boolean | null, refusalApplies: boolean): SourceRecord {
  return { key: 'K1', name: null, code: '0001', refusal, refusalApplies };
}

describe('sourceRefusalStatus', () => {
  it('不適用／已拒絕／未拒絕／未提供四種狀態各自對應', () => {
    expect(sourceRefusalStatus(record(null, false))).toBe(RECORD_STATUS.notApplicable);
    expect(sourceRefusalStatus(record(true, true))).toBe(RECORD_STATUS.refused);
    expect(sourceRefusalStatus(record(false, true))).toBe(RECORD_STATUS.notRefused);
    expect(sourceRefusalStatus(record(null, true))).toBe(RECORD_STATUS.missing);
  });
});

describe('archivedRefusalStatus', () => {
  it('依 origin 與值對應', () => {
    expect(archivedRefusalStatus({ origin: 'defaulted', refusal: false })).toBe(RECORD_STATUS.defaultedNotRefused);
    expect(archivedRefusalStatus({ origin: 'review', refusal: null })).toBe(RECORD_STATUS.unconfirmed);
    expect(archivedRefusalStatus({ origin: 'source', refusal: true })).toBe(RECORD_STATUS.sourceRefused);
    expect(archivedRefusalStatus({ origin: 'source', refusal: false })).toBe(RECORD_STATUS.sourceNotRefused);
    expect(archivedRefusalStatus({ origin: 'source', refusal: null })).toBe(RECORD_STATUS.notApplicable);
  });
});
