/**
 * 封面環境動態（KB-02-03）：右側窗外落雨與走廊燈光閃爍。
 *
 * 這是與框架無關的繪圖迴圈，不依賴 Angular。呼叫端負責決定何時 start／stop，
 * 並在離開畫面時呼叫 destroy()。停用時 rAF 會真的被取消，不是只把畫面藏起來。
 *
 * 參數集中在下方兩個常數，供試玩後調整；目前值為克制版本，不做恐怖特效。
 */

/** 落雨參數。速度與長度為 CSS px（長度另依 depth 縮放）。 */
export const RAIN = {
  /** 傾斜角度（度）；正值代表往左下傾斜。 */
  angleDeg: 8,
  minSpeed: 420,
  maxSpeed: 760,
  minLength: 12,
  maxLength: 26,
  minAlpha: 0.1,
  maxAlpha: 0.26,
  lineWidth: 1.1,
  /** 每多少 CSS px² 一滴；數字越大越稀疏。 */
  areaPerDrop: 1800,
  minDrops: 24,
  maxDrops: 140,
} as const;

/** 走廊燈光參數。基礎亮度做慢速呼吸，另外偶爾出現短促閃爍。 */
export const CORRIDOR_LIGHT = {
  baseOpacity: 0.42,
  breathAmplitude: 0.1,
  breathHz: 0.22,
  /** 兩次閃爍之間的間隔（毫秒）。 */
  minGapMs: 3500,
  maxGapMs: 8000,
  /** 單次閃爍長度（毫秒）。 */
  minFlickerMs: 90,
  maxFlickerMs: 220,
  /** 閃爍時亮度掉到原本的幾成。 */
  minDip: 0.35,
  maxDip: 0.7,
  /** 單次閃爍內的明暗切換次數。 */
  steps: 4,
} as const;

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  alpha: number;
}

const between = (min: number, max: number) => min + Math.random() * (max - min);

export class CoverAmbience {
  private readonly ctx: CanvasRenderingContext2D | null;
  private drops: Drop[] = [];
  private width = 0;
  private height = 0;
  private frame: number | null = null;
  private lastTs = 0;
  private elapsed = 0;
  private nextFlickerAt = 0;
  private flickerStart = 0;
  private flickerEnd = 0;
  private flickerDip = 1;
  /** 由呼叫端提供已解析的色票（取自 CSS token，不在此硬寫色碼）。 */
  private color = 'rgb(210, 231, 237)';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly light: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d');
    this.nextFlickerAt = between(CORRIDOR_LIGHT.minGapMs, CORRIDOR_LIGHT.maxGapMs);
  }

  /** 由 CSS token 解析出的雨滴顏色，例如 getComputedStyle(canvas).color。 */
  setColor(resolved: string): void {
    if (resolved.trim()) this.color = resolved.trim();
  }

  /** 設定雨層的 CSS 尺寸；backing store 依 devicePixelRatio 放大（上限 2）。 */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    const dpr = Math.min(Math.max(devicePixelRatio, 1), 2);
    this.width = Math.max(cssWidth, 0);
    this.height = Math.max(cssHeight, 0);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.seed();
  }

  get running(): boolean {
    return this.frame !== null;
  }

  start(): void {
    if (this.frame !== null || this.width <= 0 || this.height <= 0) return;
    this.lastTs = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  /** 取消 rAF 並清空畫面；停用時不留下任何排程。 */
  stop(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.ctx?.clearRect(0, 0, this.width, this.height);
    this.light.style.opacity = '0';
  }

  destroy(): void {
    this.stop();
    this.drops = [];
  }

  private seed(): void {
    const area = this.width * this.height;
    const count = Math.round(
      Math.min(Math.max(area / RAIN.areaPerDrop, RAIN.minDrops), RAIN.maxDrops),
    );
    this.drops = Array.from({ length: count }, () => this.spawn(true));
  }

  /** depth 0＝遠（慢、短、暗），1＝近（快、長、亮），用來製造景深。 */
  private spawn(initial: boolean): Drop {
    const depth = Math.random();
    const speed = RAIN.minSpeed + depth * (RAIN.maxSpeed - RAIN.minSpeed);
    const radians = (RAIN.angleDeg * Math.PI) / 180;
    const len = RAIN.minLength + depth * (RAIN.maxLength - RAIN.minLength);
    return {
      // 往左傾，因此左邊界外也要有補充空間
      x: between(-0.12 * this.width, 1.05 * this.width),
      y: initial ? Math.random() * this.height : between(-0.25 * this.height, -len),
      vx: -Math.sin(radians) * speed,
      vy: Math.cos(radians) * speed,
      len,
      alpha: RAIN.minAlpha + depth * (RAIN.maxAlpha - RAIN.minAlpha),
    };
  }

  private readonly tick = (ts: number): void => {
    if (this.frame === null) return;
    // 分頁切回來時 ts 會跳很大，夾住避免雨滴瞬移
    const dt = this.lastTs === 0 ? 0 : Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;
    this.elapsed += dt * 1000;

    this.drawRain(dt);
    this.updateLight();

    this.frame = requestAnimationFrame(this.tick);
  };

  private drawRain(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineWidth = RAIN.lineWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.color;

    for (let i = 0; i < this.drops.length; i++) {
      const drop = this.drops[i];
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;
      if (drop.y - drop.len > this.height || drop.x + drop.len < 0) {
        this.drops[i] = this.spawn(false);
        continue;
      }
      const speed = Math.hypot(drop.vx, drop.vy) || 1;
      const tailX = drop.x - (drop.vx / speed) * drop.len;
      const tailY = drop.y - (drop.vy / speed) * drop.len;
      ctx.globalAlpha = drop.alpha;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(drop.x, drop.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private updateLight(): void {
    const breath =
      CORRIDOR_LIGHT.baseOpacity +
      CORRIDOR_LIGHT.breathAmplitude *
        Math.sin((this.elapsed / 1000) * 2 * Math.PI * CORRIDOR_LIGHT.breathHz);

    if (this.elapsed >= this.nextFlickerAt && this.elapsed >= this.flickerEnd) {
      this.flickerStart = this.elapsed;
      this.flickerEnd = this.elapsed + between(CORRIDOR_LIGHT.minFlickerMs, CORRIDOR_LIGHT.maxFlickerMs);
      this.flickerDip = between(CORRIDOR_LIGHT.minDip, CORRIDOR_LIGHT.maxDip);
      this.nextFlickerAt =
        this.flickerEnd + between(CORRIDOR_LIGHT.minGapMs, CORRIDOR_LIGHT.maxGapMs);
    }

    let factor = 1;
    if (this.elapsed < this.flickerEnd) {
      const progress = (this.elapsed - this.flickerStart) / (this.flickerEnd - this.flickerStart);
      // 階梯式明暗切換，讀起來是閃爍而不是淡出
      factor = Math.floor(progress * CORRIDOR_LIGHT.steps) % 2 === 0 ? this.flickerDip : 1;
    }

    this.light.style.opacity = (breath * factor).toFixed(3);
  }
}
