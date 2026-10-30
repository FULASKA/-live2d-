/**
 * 抚摸（滑动）反馈 —— 头跟着手的位移摆，不再是自动正弦。
 *
 * 规格（用户定稿）：触发滑动后，按**鼠标位移的 50%** 摆头，交互感更强、实现也更直白。
 *   - 位移按「半个窗口」归一化，满半窗 = 1；乘 0.5 再乘最大角度（30°）
 *   - 写 ParamAngleZ / ParamAngleY（还带一点身体），AngleZ 正 = 往左歪，所以取负号才「朝手」
 *   - 松手回落（releasePerSec），不会僵在歪头姿势
 *
 * 只对**头部**生效：之前胸/腰/腿也给增益，摸胸整个人会弹，属于误触（bug）。
 * 写点仍然是 beforeModelUpdate，纯加性，不影响 gaze 与表情层。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** 只有头（脸捏脸区走的是捏脸那条路，不在这里） */
const REGION_GAIN = { 头: 1 }

export function createPetSway({ param, options = {} } = {}) {
  const cfg = {
    gain: 1,          // 面板滑杆 0..3
    maxAngle: 30,     // 参数满量程角度（ParamAngleX/Y/Z 都是 ±30）
    ratio: 0.5,       // 位移的 50% 转成角度
    follow: 14,       // 跟手速度（1/s）
    releasePerSec: 6, // 松手回落速度
    bodyRatio: 0.22,  // 身体跟一点，别整块木头
    ...options,
  }

  let armed = false
  let tx = 0          // 目标（归一化 -1..1）
  let ty = 0
  let cx = 0          // 平滑后
  let cy = 0
  let last = { z: 0, y: 0 }

  const add = (id, delta) => {
    if (!delta) return
    const info = param.info(id)
    if (!info) return
    param.set(id, clamp(param.get(id) + delta, info.min, info.max))
  }

  /** 按住头开始（也用于「只有头生效」的判定） */
  function start(regionName) {
    if (!cfg.gain) return false
    if (!REGION_GAIN[regionName]) return false
    armed = true
    tx = 0
    ty = 0
    return true
  }

  /** 滑动过程中累计位移（像素）；按半个窗口归一化 */
  function move(dxPx, dyPx, w, h) {
    if (!armed) return
    const nx = clamp(dxPx / Math.max(1, w / 2), -1, 1)
    const ny = clamp(dyPx / Math.max(1, h / 2), -1, 1)
    tx = clamp(tx + nx * cfg.ratio, -1, 1)
    ty = clamp(ty + ny * cfg.ratio, -1, 1)
  }

  function release() {
    armed = false
    tx = 0
    ty = 0
  }

  function apply(dtMs = 1000 / 60) {
    const dt = Math.max(1, dtMs) / 1000
    const k = 1 - Math.exp(-(armed ? cfg.follow : cfg.releasePerSec) * dt)
    cx += (tx - cx) * k
    cy += (ty - cy) * k
    if (!armed && Math.abs(cx) < 0.003 && Math.abs(cy) < 0.003) {
      cx = 0
      cy = 0
      last = { z: 0, y: 0 }
      return
    }
    const amp = cfg.maxAngle * cfg.gain
    const z = clamp(-cx * amp, -cfg.maxAngle, cfg.maxAngle)
    const y = clamp(-cy * amp, -cfg.maxAngle, cfg.maxAngle)
    last = { z: +z.toFixed(2), y: +y.toFixed(2) }
    add('ParamAngleZ', z)
    add('ParamAngleY', y)
    add('ParamBodyAngleZ', z * cfg.bodyRatio)
  }

  return {
    start,
    move,
    release,
    apply,
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    state: () => ({ armed, target: { x: +tx.toFixed(2), y: +ty.toFixed(2) }, cur: { x: +cx.toFixed(2), y: +cy.toFixed(2) }, last: { ...last } }),
  }
}
