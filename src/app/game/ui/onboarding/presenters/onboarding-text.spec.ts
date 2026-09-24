import { ONBOARDING, onboardingContractIndex } from '../../../content/bundle';
import { OnboardingContractStep } from '../../../content/schema';
import { PLAYER_NAME_MAX } from '../../../core/validate';
import { signatureError, splitGraphemes } from './onboarding-text';

/** R12 §6：逐字切字與簽名欄檢查（純函式）。 */

const contract = ONBOARDING.steps[onboardingContractIndex] as OnboardingContractStep;
const sig = contract.signature;

describe('splitGraphemes（逐字呈現的切字）', () => {
  it('中文與引號逐字切開，合起來等於原文', () => {
    const text = '「恭喜你通過面試。」';
    const parts = splitGraphemes(text);
    expect(parts.length).toBe(10);
    expect(parts.join('')).toBe(text);
  });

  it('表情符號、ZWJ 序列與組合字各算一個字', () => {
    expect(splitGraphemes('👩‍💻')).toEqual(['👩‍💻']);
    expect(splitGraphemes('👍🏽a')).toEqual(['👍🏽', 'a']);
    expect(splitGraphemes('éx')).toEqual(['é', 'x']);
  });

  it('空字串沒有字', () => {
    expect(splitGraphemes('')).toEqual([]);
  });
});

describe('signatureError（簽名欄檢查）', () => {
  it('上限與 core PLAYER_NAME_MAX 一致', () => {
    expect(sig.maxGraphemes).toBe(PLAYER_NAME_MAX);
  });

  it('空白或只有空白 → 必填', () => {
    expect(signatureError('', sig)).toBe(sig.required);
    expect(signatureError('   　 ', sig)).toBe(sig.required);
  });

  it('24 個字可以；25 個字 → 太長（去除首尾空白後計算）', () => {
    expect(signatureError('王'.repeat(24), sig)).toBeNull();
    expect(signatureError('  ' + 'a'.repeat(24) + '  ', sig)).toBeNull();
    expect(signatureError('王'.repeat(25), sig)).toBe(sig.tooLong);
  });

  it('表情符號／組合字序列算一個字：24 個可以、25 個太長', () => {
    expect(signatureError('👩‍💻'.repeat(24), sig)).toBeNull();
    expect(signatureError('👩‍💻'.repeat(25), sig)).toBe(sig.tooLong);
    expect(signatureError('é'.repeat(24), sig)).toBeNull();
    expect(signatureError('é'.repeat(25), sig)).toBe(sig.tooLong);
  });

  it('中文、一般名字與看起來像 HTML 的字串都接受（之後只以文字呈現）', () => {
    for (const name of ['王小明', 'Alex Chen', '林 予安', '<b>x</b>', "O'Brien"]) {
      expect(signatureError(name, sig)).withContext(name).toBeNull();
    }
  });

  it('核心不接受的名字（含控制字元）不會被當成可送出', () => {
    expect(signatureError('王\t小明', sig)).toBe(sig.required);
  });
});
