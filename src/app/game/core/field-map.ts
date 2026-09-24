import { FieldMapTaskPlan, FieldTarget, MappingRow } from './day-plan';
import { FieldMapSubmission, MappedValue, MissingPolicy } from './types';

/**
 * 欄位映射規則（R6 Day 6／R10）：純函式，不含玩家可見文字。
 *
 * R10：轉換、空白筆數與政策適用範圍一律依**玩家的對應**（assignments）計算。
 * 內容檔的 target.sourceId 只是預設／作者參照，不拿來擋下或矯正玩家的選擇：
 * 文字欄位之間「意義配錯」但型別可轉換時照樣可以提交，輸出就是依該對應轉出的結果。
 * 只擋結構問題：未填、來源重複（一對一）、布林目標遇到無法轉換的值、需要政策卻沒選。
 * 錯誤只回傳代碼，由 UI 對到 JSON 的一般欄位錯誤字串。
 */
export type FieldMapError =
  /** 有目標欄位尚未選擇來源。 */
  | 'incomplete'
  /** 同一個來源欄位被選了兩次以上。 */
  | 'duplicate'
  /** 布林目標所對應的來源欄位含有無法轉換的值（不是 trueValue／falseValue／空白）。 */
  | 'unconvertible'
  /** 有受空值影響的列，但尚未選擇處理方式。 */
  | 'policyRequired';

export type FieldMapCheck = { ok: true; result: FieldMapSubmission } | { ok: false; error: FieldMapError };

type Assignments = Readonly<Record<string, string>>;

/** 某列在某個目標欄位（依玩家選的來源）的原字串。 */
function rawValue(row: MappingRow, target: FieldTarget, assignments: Assignments): string {
  const source = assignments[target.id];
  return source === undefined ? '' : (row.values[source] ?? '');
}

/** 布林目標是否能轉換這個值：trueValue、falseValue 或空白（空白交給政策）。 */
function isConvertible(raw: string, target: FieldTarget): boolean {
  return target.convert !== 'boolean' || raw === '' || raw === target.trueValue || raw === target.falseValue;
}

/** 受空值影響的列：任一布林目標、依玩家對應讀到空白。 */
export function affectedRowIds(plan: FieldMapTaskPlan, assignments: Assignments): readonly string[] {
  const booleans = plan.targets.filter((t) => t.convert === 'boolean');
  return plan.rows.filter((row) => booleans.some((t) => rawValue(row, t, assignments) === '')).map((r) => r.id);
}

function convertValue(raw: string, target: FieldTarget, policy: MissingPolicy | null): MappedValue {
  if (target.convert === 'text') return raw;
  if (raw === '') return policy === 'default_false' ? false : null;
  if (raw === target.trueValue) return true;
  if (raw === target.falseValue) return false;
  // checkFieldMap 已先擋下無法轉換的值；這裡不會靜默當成 null。
  throw new Error(`Unconvertible value for ${target.id}`);
}

/** 依玩家的對應轉換一列；0102 等字串原樣保留。 */
export function convertRow(
  row: MappingRow,
  plan: FieldMapTaskPlan,
  assignments: Assignments,
  policy: MissingPolicy | null,
): Record<string, MappedValue> {
  const out: Record<string, MappedValue> = {};
  for (const target of plan.targets) {
    out[target.id] = convertValue(rawValue(row, target, assignments), target, policy);
  }
  return out;
}

/**
 * 驗證對應與政策；通過時回傳預覽／提交快照（依玩家對應）。
 * 檢查順序：未填 → 重複 → 無法轉換 → 缺政策。
 */
export function checkFieldMap(
  plan: FieldMapTaskPlan,
  assignments: Assignments,
  blankPolicy: MissingPolicy | undefined,
): FieldMapCheck {
  const chosen = plan.targets.map((t) => assignments[t.id] ?? '');
  if (chosen.some((s) => s === '' || !plan.sourceFieldIds.includes(s))) return { ok: false, error: 'incomplete' };
  if (new Set(chosen).size !== chosen.length) return { ok: false, error: 'duplicate' };
  const unconvertible = plan.targets.some((t) => plan.rows.some((row) => !isConvertible(rawValue(row, t, assignments), t)));
  if (unconvertible) return { ok: false, error: 'unconvertible' };

  const affected = affectedRowIds(plan, assignments);
  if (affected.length > 0 && !blankPolicy) return { ok: false, error: 'policyRequired' };
  const policy = affected.length > 0 ? (blankPolicy ?? null) : null;

  return {
    ok: true,
    result: {
      rowCount: plan.rows.length,
      affectedCount: affected.length,
      blankPolicy: policy,
      rows: plan.rows.map((row) => ({ id: row.id, values: convertRow(row, plan, assignments, policy) })),
    },
  };
}
