import { CaseDocument, CaseworkPlan, citationOf } from '../../../core/casework';
import { caseFolderView, casePreviewJson } from './case-folder';

const REQUEST: CaseDocument = {
  id: 'doc.day8.m2-r27-request',
  version: 0,
  heading: 'R-27｜服務安排申請節錄',
  fields: [
    { label: '對象編號', value: '0742' },
    { label: '補充備註', value: '上午不方便，若有下午時段請先通知。' },
  ],
};
const LIST: CaseDocument = {
  id: 'doc.day8.m2-r27-list',
  version: 0,
  heading: 'R-27｜代理窗口安排清單',
  fields: [
    { label: '對象編號', value: '0742' },
    { label: '預排時段', value: '10:30' },
  ],
};
const SLOT_ID = 'doc.day8.m2-r27-slot';

const PLAN: CaseworkPlan = {
  caseId: 'case.day9.m2-r27-packet',
  taskId: 'task.day9.m2-r27-packet',
  variant: 'citation-packet',
  documentIds: [REQUEST.id, LIST.id, SLOT_ID],
  bindingIds: [],
  inquiryId: null,
  minimumCitations: 1,
  choices: [
    { id: 'standard', output: { variant: 'citation-packet', route: 'standard-packet' } },
    { id: 'manual-read', output: { variant: 'citation-packet', route: 'manual-read-packet' } },
  ],
};

/** 查詢附件（SLOT）尚未送達：document 查詢回傳 null。 */
const CTX = { document: (id: string) => [REQUEST, LIST].find((d) => d.id === id) ?? null, sourceAttached: true };

describe('case-folder presenter', () => {
  it('只列可開的文件；未送達的查詢附件不出現', () => {
    const view = caseFolderView(PLAN, { citations: [] }, CTX);
    expect(view.sources.map((s) => s.heading)).toEqual(['R-27｜服務安排申請節錄', 'R-27｜代理窗口安排清單']);
    expect(view.error).toBe('needCitation');
  });

  it('引用的欄位標示 cited，送件包依加入順序列出快照', () => {
    const citations = [citationOf(LIST, 1)!, citationOf(REQUEST, 1)!];
    const view = caseFolderView(PLAN, { citations, choiceId: 'standard' }, CTX);
    expect(view.sources[0]?.fields.map((f) => f.cited)).toEqual([false, true]);
    expect(view.sources[1]?.fields.map((f) => f.cited)).toEqual([false, true]);
    expect(view.packet.map((p) => [p.heading, p.label, p.value, p.stale])).toEqual([
      ['R-27｜代理窗口安排清單', '預排時段', '10:30', false],
      ['R-27｜服務安排申請節錄', '補充備註', '上午不方便，若有下午時段請先通知。', false],
    ]);
    expect(view.error).toBeNull();
  });

  it('引用的文件版本或內容已不同：保留快照並標示需重新引用', () => {
    const old = { ...citationOf(LIST, 1)!, value: '09:30' };
    const view = caseFolderView(PLAN, { citations: [old], choiceId: 'standard' }, CTX);
    expect(view.packet[0]?.value).toBe('09:30');
    expect(view.packet[0]?.stale).toBeTrue();
    expect(view.error).toBe('invalidCitation');
  });

  it('預覽 JSON：輸出只含引用的欄位，不印文件 ID，也不按選項補上未引用的備註', () => {
    const json = casePreviewJson(PLAN, { citations: [citationOf(LIST, 1)!], choiceId: 'standard' }, CTX);
    const output = JSON.parse(json.output);
    expect(output).toEqual({
      route: 'standard-packet',
      packet: [{ document: 'R-27｜代理窗口安排清單', field: '預排時段', value: '10:30' }],
    });
    for (const text of [json.input, json.decision, json.output]) {
      expect(text).not.toContain('doc.');
      expect(text).not.toContain('上午不方便');
    }
    expect(JSON.parse(json.decision)).toEqual({
      action: { route: 'standard-packet' },
      citations: [{ document: 'R-27｜代理窗口安排清單', version: 0, field: '預排時段' }],
    });
  });

  it('沒有選處理方式時 action 為 null', () => {
    const json = casePreviewJson(PLAN, { citations: [] }, CTX);
    expect(JSON.parse(json.decision).action).toBeNull();
    expect(JSON.parse(json.output)).toEqual({ packet: [] });
  });
});
