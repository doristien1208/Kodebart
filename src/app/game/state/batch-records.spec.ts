import { BATCH_DAY01_ARCHIVE, DAY_01, DAY_02 } from '../core';
import { RECORDS } from '../content/records';
import { recordsForBatch, recordsOfDay } from './batch-records';

/**
 * KB-R4-05：完成條件與存檔驗證必須以「該批次自己的資料集合」為範圍。
 * 這裡確認相容層回傳的是按日／按批次收斂的集合，而不是全域扁平清單。
 */
describe('batch-records', () => {
  it('recordsOfDay 回傳該日自己的紀錄', () => {
    const day1 = recordsOfDay(DAY_01);
    expect(day1.length).toBeGreaterThan(0);
    expect(day1.map((r) => r.key).sort()).toEqual(RECORDS.map((r) => r.key).sort());
  });

  it('第二日目前沒有自己的歸檔紀錄', () => {
    expect(recordsOfDay(DAY_02)).toEqual([]);
  });

  it('編號以字串回傳，前導零不會消失', () => {
    const b102 = recordsOfDay(DAY_01).find((r) => r.key === 'B102');
    expect(b102?.code).toBe('0102');
    expect(typeof b102?.code).toBe('string');
  });

  it('recordsForBatch 對已知批次回傳該批次的集合', () => {
    expect(recordsForBatch(BATCH_DAY01_ARCHIVE).map((r) => r.key).sort()).toEqual(
      recordsOfDay(DAY_01).map((r) => r.key).sort(),
    );
  });

  it('未知批次回傳空集合，不會誤用全域資料表', () => {
    expect(recordsForBatch('batch.day07.unknown')).toEqual([]);
  });

  it('回傳的物件不是 content 內部物件的別名（不可被呼叫端改壞）', () => {
    const a = recordsOfDay(DAY_01);
    const b = recordsOfDay(DAY_01);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0]).toEqual(b[0]);
  });
});
