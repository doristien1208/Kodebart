import { Save, Stage } from '../core/types';

/** 每個通用階段對應的唯一畫面路徑；stage guard 據此導正。路徑名稱沿用既有 URL。 */
export function routeForStage(stage: Stage): '/work' | '/overnight' | '/morning' | '/end' {
  switch (stage) {
    case 'work':
      return '/work';
    case 'wrap':
      return '/overnight';
    case 'morning':
      return '/morning';
    case 'end':
      return '/end';
  }
}

/**
 * 存檔目前應在的畫面（R12）：入職前情尚未完成 → /onboarding（刷新、繼續遊戲都回到原段落）；
 * 否則依通用階段。封面「繼續遊戲」與 stage guard 都用這裡。
 */
export function routeForSave(save: Pick<Save, 'stage' | 'onboarding'>): '/onboarding' | ReturnType<typeof routeForStage> {
  return save.onboarding.complete ? routeForStage(save.stage) : '/onboarding';
}
