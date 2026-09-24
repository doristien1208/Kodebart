import { Draft, SourceRecord, ValidationResult } from './types';

/** 欄位訊息：只說明作業要求，不暗示道德立場。 */
export const VALIDATION_MESSAGES = {
  codeRequired: '請填寫人員編號。',
  policyRequired: '請選擇缺少拒絕紀錄時的處理方式。',
} as const;

/**
 * 人員編號的型別規則（R10）：文字且不是空白。
 * 不比對來源、不檢查是否為已知人員、不限長度或前綴；不轉數字、不補零、不改大小寫。
 */
export function isValidCodeString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * 驗證一筆草稿是否可以歸檔（R10：只驗型別與必填）。
 * - 人員編號必須是文字且不是空白；照玩家輸入原樣保存（"0102"、"102"、"0103" 都合法）。
 *   與來源相同或不同走同一條成功流程；這裡不會暗中採用來源值（R11 起也沒有帶入按鈕）。
 * - 適用拒絕紀錄且來源未附時，必須選擇公司允許的處理方式：
 *   default_false → 寫入 false／defaulted；request_review → 保留 null／review。
 * 無效輸入只回傳錯誤，不改存檔、不懲罰角色。
 */
export function validateRecord(record: SourceRecord, draft: Draft): ValidationResult {
  if (!isValidCodeString(draft.value)) {
    return { ok: false, error: VALIDATION_MESSAGES.codeRequired };
  }
  const code = draft.value;

  if (!record.refusalApplies || record.refusal !== null) {
    return { ok: true, code, refusal: record.refusal, origin: 'source' };
  }
  if (!draft.policy) {
    return { ok: false, error: VALIDATION_MESSAGES.policyRequired };
  }
  return draft.policy === 'request_review'
    ? { ok: true, code, refusal: null, origin: 'review' }
    : { ok: true, code, refusal: false, origin: 'defaulted' };
}

/** 供預覽與 JSON 顯示：review 進覆核佇列，其餘進正式歸檔。 */
export function toPreview(result: { code: string; refusal: boolean | null; origin: string }) {
  return {
    personnel_code: result.code,
    refusal_record: result.refusal,
    destination: result.origin === 'review' ? 'review_queue' : 'archive',
  } as const;
}

/* ---------- 角色名（R12 入職簽名） ---------- */

/** 角色名最多幾個使用者可見字元（字素）。 */
export const PLAYER_NAME_MAX = 24;

/** 使用者可見字元數：以字素（grapheme）計，組合字與表情符號算一個；不支援 Segmenter 時以 code point 計。 */
export function graphemeLength(value: string): number {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Segmenter === 'function') {
    let n = 0;
    for (const _ of new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) n++;
    return n;
  }
  return Array.from(value).length;
}

/** 控制字元（含換行、Tab 與 C1）不能出現在名字裡。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * 角色名的正規化與檢查：去除首尾空白後必填、最多 PLAYER_NAME_MAX 個使用者可見字元、不可含控制字元。
 * 允許中文與一般名字（不套編號格式）；不改大小寫、不轉全半形。不合法回傳 null。
 * 名字一律以文字呈現（Angular 插值），不當 HTML。
 */
export function normalizePlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name === '' || CONTROL_CHARS.test(name)) return null;
  return graphemeLength(name) <= PLAYER_NAME_MAX ? name : null;
}
