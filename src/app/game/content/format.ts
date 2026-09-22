/**
 * game/content/format：資料檔樣板的字串代入。
 *
 * 只做 `{name}` → 對應值的純字串取代，沒有運算式、條件或函式呼叫。
 * 資料檔因此不可能夾帶可執行邏輯：未列在參數中的 `{...}` 會原樣留下，
 * 並由 validate-content.ts 在測試階段擋下。
 */

/** 樣板中 placeholder 的樣式；只允許英數與底線。 */
export const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g;

/** 任何一組大括號；用來抓出不合法的 placeholder 寫法。 */
export const ANY_BRACE_PATTERN = /\{[^}]*\}/g;

export type FormatParams = Readonly<Record<string, string | number>>;

/** 取出樣板用到的 placeholder 名稱（去重、依出現順序）。 */
export function placeholders(template: string): string[] {
  const found: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = m[1];
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/** 代入參數；缺少的 placeholder 原樣保留，不丟例外，也不執行任何內容。 */
export function format(template: string, params: FormatParams): string {
  return template.replace(PLACEHOLDER_PATTERN, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
