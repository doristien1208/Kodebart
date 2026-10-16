import {
  CaseChoiceOutput,
  CaseCitation,
  CaseDocument,
  CaseworkInput,
  CaseworkInputError,
  CaseworkPlan,
  caseworkInputError,
  choiceOutputOf,
  sameCitationTarget,
} from '../../../core/casework';

/**
 * 案件檔案夾與送件包（M2）的純函式 presenter：來源與歷程、本次送件包、三段預覽。
 *
 * - 只列出目前可開的文件；未送達的查詢附件不出現在來源、送件包預覽或 JSON（由呼叫端的 document 查詢決定）。
 * - 送件包就是下游實際收到的內容：只含玩家引用的欄位快照，不按選項名稱補上未引用的段落。
 * - 輸出給畫面的文字不含文件 ID、seed 或 true／false／null；JSON 用文件標題與欄名辨識來源。
 */

export interface CaseFieldView {
  index: number;
  label: string;
  value: string;
  /** 這一欄（同一版本）已在送件包內。 */
  cited: boolean;
}

export interface CaseSourceView {
  documentId: string;
  version: number;
  heading: string;
  fields: readonly CaseFieldView[];
}

export interface CasePacketItemView {
  /** 穩定的追蹤鍵（文件、版本、欄位）；只供 track 使用，不顯示。 */
  key: string;
  documentId: string;
  version: number;
  fieldIndex: number;
  heading: string;
  label: string;
  value: string;
  /** 引用的文件已不可開或版本／內容已不同：交付前須移除後重新引用（快照原樣保留顯示）。 */
  stale: boolean;
}

export interface CaseFolderView {
  sources: readonly CaseSourceView[];
  packet: readonly CasePacketItemView[];
  choiceId: string | null;
  /** 程序驗證的結果；null＝可以交付。 */
  error: CaseworkInputError | null;
}

export interface CaseFolderContext {
  /** 目前可開的文件；未送達的查詢附件與未知 ID 回傳 null。 */
  document(documentId: string): CaseDocument | null;
  sourceAttached: boolean;
}

function citationKey(c: Pick<CaseCitation, 'documentId' | 'version' | 'fieldIndex'>): string {
  return `${c.documentId}@${c.version}#${c.fieldIndex}`;
}

function isStale(c: CaseCitation, doc: CaseDocument | null): boolean {
  const field = doc?.fields[c.fieldIndex];
  return !doc || !field || doc.version !== c.version || field.label !== c.label || field.value !== c.value;
}

/** 案件檔案夾：本案文件（依內容順序、只列可開的）、送件包與驗證狀態。 */
export function caseFolderView(plan: CaseworkPlan, input: CaseworkInput, ctx: CaseFolderContext): CaseFolderView {
  const sources: CaseSourceView[] = [];
  for (const documentId of plan.documentIds) {
    const doc = ctx.document(documentId);
    if (!doc) continue;
    sources.push({
      documentId: doc.id,
      version: doc.version,
      heading: doc.heading,
      fields: doc.fields.map((f, index) => ({
        index,
        label: f.label,
        value: f.value,
        cited: input.citations.some((c) => sameCitationTarget(c, { documentId: doc.id, version: doc.version, fieldIndex: index })),
      })),
    });
  }
  const packet = input.citations.map((c): CasePacketItemView => {
    const doc = ctx.document(c.documentId);
    return {
      key: citationKey(c),
      documentId: c.documentId,
      version: c.version,
      fieldIndex: c.fieldIndex,
      heading: doc?.heading ?? '',
      label: c.label,
      value: c.value,
      stale: !plan.documentIds.includes(c.documentId) || isStale(c, doc),
    };
  });
  return {
    sources,
    packet,
    choiceId: input.choiceId ?? null,
    error: caseworkInputError(plan, input, { document: ctx.document, sourceAttached: ctx.sourceAttached }),
  };
}

export interface CasePreviewJson {
  /** 來源：本案可開的文件與版本。 */
  input: string;
  /** 本次引用與處理：選項輸出與引用的欄位。 */
  decision: string;
  /** 交付輸出：下游實際收到的段落（只有引用的欄位）。 */
  output: string;
}

/**
 * 預覽的三段 JSON（來源／本次引用與處理／交付輸出）：鍵為技術名稱，值保留型別；
 * 文件以標題辨識，不印文件 ID。沒有選處理方式時 decision 的 route 為 null。
 */
export function casePreviewJson(plan: CaseworkPlan, input: CaseworkInput, ctx: CaseFolderContext): CasePreviewJson {
  const folder = caseFolderView(plan, input, ctx);
  const output = input.choiceId ? choiceOutputOf(plan, input.choiceId) : null;
  const action = output ? actionFields(output) : null;
  const sources = folder.sources.map((s) => ({ document: s.heading, version: s.version, fields: s.fields.length }));
  const citations = folder.packet.map((p) => ({ document: p.heading, version: p.version, field: p.label }));
  const packet = folder.packet.map((p) => ({ document: p.heading, field: p.label, value: p.value }));
  return {
    input: JSON.stringify(sources, null, 2),
    decision: JSON.stringify({ action, citations }, null, 2),
    output: JSON.stringify({ ...action, packet }, null, 2),
  };
}

/** 選項輸出去掉案件種類鍵（種類是內部分型，不是這次處理的內容）。 */
function actionFields(output: CaseChoiceOutput): Record<string, string | boolean | null> {
  const { variant: _variant, ...fields } = output;
  return fields;
}
