import { RECORDS, TOTAL_RECORDS, recordLabel } from './records';
import { DAY1, OVERNIGHT } from './text';

/**
 * KB-P1-02：畫面文案不得寫死筆數。
 * 這裡只驗文字產生器本身，總筆數由呼叫端從資料集合傳入。
 */

describe('DAY1 文案依總筆數產生', () => {
  it('progress 同時吃 count 與 total', () => {
    expect(DAY1.progress(0, 3)).toBe('0 / 3 已處理');
    expect(DAY1.progress(7, 12)).toBe('7 / 12 已處理');
    expect(DAY1.progress(12, 12)).toBe('12 / 12 已處理');
  });

  it('progress 不含寫死的 3：total 換成 12 後字串跟著換', () => {
    expect(DAY1.progress(1, 12)).not.toContain('/ 3 ');
  });

  it('progress 帶目前資料集合時，total 就是 RECORDS.length', () => {
    expect(DAY1.progress(0, TOTAL_RECORDS)).toBe(`0 / ${RECORDS.length} 已處理`);
  });

  it('footerPending 依 total 產生，不再寫死「三筆」', () => {
    expect(DAY1.footerPending(3)).toBe('完成 3 筆資料後即可交接。');
    expect(DAY1.footerPending(12)).toBe('完成 12 筆資料後即可交接。');
    expect(DAY1.footerPending(12)).not.toContain('三');
  });

  it('佇列狀態一律有文字，不只靠顏色', () => {
    expect(DAY1.queuePending).toBe('待處理');
    expect(DAY1.queueDone).toBe('已完成');
    expect(DAY1.queueDoneMark).toBe('✓');
  });
});

describe('OVERNIGHT.count 依已歸檔筆數補零', () => {
  it('個位數補零到兩位', () => {
    expect(OVERNIGHT.count(0)).toBe('00');
    expect(OVERNIGHT.count(3)).toBe('03');
    expect(OVERNIGHT.count(9)).toBe('09');
  });

  it('兩位數照原樣', () => {
    expect(OVERNIGHT.count(10)).toBe('10');
    expect(OVERNIGHT.count(12)).toBe('12');
  });

  it('三位數不截斷', () => {
    expect(OVERNIGHT.count(120)).toBe('120');
  });
});

describe('recordLabel', () => {
  it('有姓名顯示姓名，沒有則顯示人員編號', () => {
    expect(recordLabel({ key: 'X', name: '林予安', code: 'H-17', refusal: null, refusalApplies: false })).toBe('林予安');
    expect(recordLabel({ key: 'Y', name: null, code: '0102', refusal: null, refusalApplies: true })).toBe('0102');
  });

  it('目前每一筆資料都有可辨識的識別', () => {
    for (const r of RECORDS) {
      expect(recordLabel(r).length).toBeGreaterThan(0);
    }
  });
});

describe('TOTAL_RECORDS', () => {
  it('等於資料集合長度，而不是固定值', () => {
    expect(TOTAL_RECORDS).toBe(RECORDS.length);
  });
});
