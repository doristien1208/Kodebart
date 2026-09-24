import { OnboardingSignature } from '../../../content/schema';
import { graphemeLength, normalizePlayerName } from '../../../core/validate';

/**
 * 入職前情的純函式（R12 §6）：逐字呈現的切字，以及簽名欄的檢查訊息。
 * 不讀狀態、不碰 DOM，元件與規格共用。
 */

/**
 * 依使用者可見字元（grapheme）切開文字：組合字、表情符號與膚色／ZWJ 序列都算一個字，
 * 逐字呈現時不會切出半個字。不支援 Intl.Segmenter 時退回 code point（與 core graphemeLength 一致）。
 */
export function splitGraphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Segmenter === 'function') {
    return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/**
 * 簽名欄的錯誤訊息；null＝可以送出。規則與 core normalizePlayerName 相同：
 * 去除首尾空白後必填 → signature.required；超過 signature.maxGraphemes 個使用者可見字元 → signature.tooLong
 * （以字素計，不以 maxlength 硬切）；其餘不被核心接受的名字（例如含控制字元）也回報 required。
 */
export function signatureError(raw: string, signature: OnboardingSignature): string | null {
  const name = raw.trim();
  if (name === '') return signature.required;
  if (graphemeLength(name) > signature.maxGraphemes) return signature.tooLong;
  return normalizePlayerName(raw) === null ? signature.required : null;
}
