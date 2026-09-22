import { Draft, SourceRecord, ValidationResult } from './types';

/** 欄位訊息：只說明作業要求，不暗示道德立場。 */
export const VALIDATION_MESSAGES = {
  codeRequired: '請填寫人員編號。',
  codeMismatch: '請依來源資料填寫人員編號。',
  policyRequired: '請選擇缺少拒絕紀錄時的處理方式。',
} as const;

/**
 * 驗證一筆草稿是否可以歸檔。
 * - 人員編號必填，且需與來源資料一致（忽略大小寫與前後空白，保存時採用來源原字串）。
 * - 適用拒絕紀錄且來源未附時，必須選擇公司允許的處理方式：
 *   default_false → 寫入 false／defaulted；request_review → 保留 null／review。
 * 無效輸入只回傳錯誤，不改存檔、不懲罰角色。
 */
export function validateRecord(record: SourceRecord, draft: Draft): ValidationResult {
  const raw = draft.value.trim();

  if (raw === '') {
    return { ok: false, error: VALIDATION_MESSAGES.codeRequired };
  }
  if (raw.toUpperCase() !== record.code.toUpperCase()) {
    return { ok: false, error: VALIDATION_MESSAGES.codeMismatch };
  }

  // 一律保存來源原字串，0102 不會變成 102。
  const code = record.code;

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
