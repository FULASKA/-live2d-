/**
 * 伪面捕驱动层 —— 把「我们知道的姿态」翻译成模型面捕捉取通道的语言。
 *
 * 背景（实测）：
 *   - 这个模型的 physics3 有 50 个输入参数、292 个输出。输入里权重最大的并不是我们一直在写的
 *     ParamAngleX/Y/Z，还有一整套 **AngleX/Y/Z（控制器）** 和 **PositionX/Y/Z**，
 *     以及 ParamBreath、LControl/RControl、JawOpen、EyeSmile 这些「面捕捉取才有值」的通道。
 *   - 我们只喂了 ParamAngle* 和 LeanInput，其余全是默认值 → 物理链条只有一小半在工作，
 *     头发/耳朵/裙摆的表现就是「僵」。
 *   - 单独测过：AngleZ 基本不影响画面（脸框 727→735），但能让耳朵甩 ±0.26 ——
 *     也就是说它是一条**只喂物理、不改变造型**的通道，正适合拿来驱动次级动画。
 *     ParamBreath 拉到 1 时，胸口 +0.1、前发 +0.06、裙摆 +0.03，整片上身会「呼吸」。
 *
 * 所以这层的职责：在物理之前，把这些通道按当前姿态写成「像面捕在跑」的值。
 * 位置通道写的是**跟随量**，物理读它的变化 → 身体/衣服的被动摆动就有了。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createCapture({ param, bus, options = {} } = {}) {
  const cfg = {
    breathHz: 0.19,      // 呼吸频率（次/秒的一半，慢一点更自然）
    breathBase: 0.5,     // 呼吸基线 0..1（原来 0.32 太浅，胸口几乎看不出来）
    breathAmp: 0.4,      // 呼吸振幅（0.1~0.9 摆动，胸口/前发/裙摆都跟着走）
    tiltGain: 1,         // AngleZ ← ParamAngleZ（纯物理通道：耳朵/发梢的主要驱动）
    pitchGain: 0.4,      // AngleY ← ParamAngleY（视觉上也绑了，所以只补一部分）
    yawGain: 0.4,        // AngleX ← ParamAngleX
    posGain: 1,          // PositionX/Y 跟随倍率
    jawFromMouth: 0.8,   // JawOpen ← 嘴张开
    ...options,
  }

  const ranges = new Map()
  const rng = (id) => {
    let r = ranges.get(id)
    if (r === undefined) {
      const i = param.info(id)
      // 不缓存「没查到」：首帧 Core 还没就绪时若缓存 null，这一路就永久失效
      r = i ? [i.min, i.max, i.default] : null
      if (r) ranges.set(id, r)
    }
    return r
  }
  const setIn = (id, v) => {
    const r = rng(id)
    if (!r) return
    param.set(id, clamp(v, r[0], r[1]))
  }
  // 姿态总线上的合成值优先：本轮头部/身体角度还没写进参数，但物理要吃的就是它
  const get = (id) => (bus ? bus.peek(id) : (param.get(id) ?? 0))

  let t = Math.random() * 10
  let breath = cfg.breathBase
  let mvx = 0
  let mvy = 0

  /** 窗口/角色的位移速度（px/s）：面捕里「头在画面中移动」会让身体和衣服被动摆 */
  function motion(vx = 0, vy = 0) {
    mvx = clamp(vx, -4000, 4000)
    mvy = clamp(vy, -4000, 4000)
  }

  /** 物理之前调用：把姿态翻译成面捕通道 */
  function apply(dtMs = 1000 / 60) {
    const dt = clamp(dtMs / 1000, 0.001, 0.12)
    t += dt

    // 1) 呼吸：胸口/头发/裙摆/耳朵的低频被动起伏，缺了它整片上身是静止的
    breath = cfg.breathBase + Math.sin(t * cfg.breathHz * Math.PI * 2) * cfg.breathAmp
    setIn('ParamBreath', breath)

    // 2) 头部倾斜 → AngleZ：画面几乎不动，但耳朵会被物理甩起来（实测 ±0.26）
    const az = get('ParamAngleZ')
    const ax = get('ParamAngleX')
    const ay = get('ParamAngleY')
    setIn('AngleZ', az * cfg.tiltGain)
    // 3) 俯仰/左右：AngleY/AngleX 视觉上也绑着，补一点点就够给物理加料
    setIn('AngleY', ay * cfg.pitchGain)
    setIn('AngleX', ax * cfg.yawGain)

    // 4) 位置通道：面捕会给「头在画面里的位置」，物理读它的变化 → 衣服/身体被动摆
    const rx = rng('ParamAngleX')
    const ry = rng('ParamAngleY')
    if (rx && ry) {
      // 角度 + 位移速度：拖动窗口时 Position 会变，物理读它的变化 → 衣服/身体被带着甩
      const pxMax = rng('PositionX')?.[1] ?? 1
      const pyMax = rng('PositionY')?.[1] ?? 1
      setIn('PositionX', (ax / (rx[1] || 30)) * pxMax * cfg.posGain + clamp(mvx * 0.01, -12, 12))
      setIn('PositionY', (ay / (ry[1] || 30)) * pyMax * cfg.posGain + clamp(mvy * 0.01, -12, 12))
    }

    // 5) 下巴：说话/张嘴时给物理一点力
    setIn('JawOpen', get('ParamMouthOpenY') * cfg.jawFromMouth)
  }

  return {
    apply, motion,
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    state: () => ({ breath: Math.round(breath * 100) / 100, angleZ: Math.round(get('AngleZ') * 10) / 10 }),
  }
}
