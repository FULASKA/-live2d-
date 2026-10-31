/**
 * 嘴 —— 待机呼吸微动 + 说话音节 + 情绪抿动。
 *
 * 这个模型的 model3.json 里 LipSync 组是**空的**，也就是说整条渲染链上
 * 没有任何东西会驱动嘴（表情包都是静态参数），这是它看起来「像贴图」的主因之一。
 * 可用参数（cdi3 实测，全部归一化）：
 *   ParamMouthOpenY [0,1]   ParamMouthForm [-1,1]   MouthSmile_L/R [0,1]
 *   Mouthpucker [0,1]       MouthFunnel [0,1]       ParamTongueUpDown/Width
 * 另外模型有 LipPhysics1~3 物理输出 —— 嘴自带次级弹性，喂进去的小变化会被放大成「肉感」。
 *
 * 写点 beforeModelUpdate，且用**加性**写：表情层先写，我们只在其上加，
 * 所以「＞＜」「流泪」这类表情不会被嘴的待机微动顶掉。
 *
 * 接 TTS 的方式：stage.mouth.speak(0..1) 每帧喂能量即可（音频 analyser 或词级包络）。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createMouth({ param, options = {} } = {}) {
  const cfg = {
    breathOpen: 0.055,   // 呼吸带来的开合幅度
    breathHz: 0.22,      // 呼吸频率（与 ParamBreath 同数量级）
    talkOpen: 0.72,      // 说话时的开合幅度
    attack: 18,          // 说话音量跟随速度（1/s）
    release: 6,
    sylMin: 0.08,        // 音节最短时长（秒）
    sylMax: 0.18,
    smileAmp: 0.07,      // 嘴角微动
    formAmp: 0.05,       // 嘴形微动
    formTalk: 0.45,      // 说话时口型左右变化幅度（元音不同 → 嘴形不同）
    funnelTalk: 0.5,     // 说话时出现「圆唇」音的概率与幅度
    ...options,
  }

  const ranges = new Map()
  const rng = (id) => {
    let r = ranges.get(id)
    if (r === undefined) { const i = param.info(id); r = i ? [i.min, i.max] : null; ranges.set(id, r) }
    return r
  }
  const add = (id, delta) => {
    if (!delta) return
    const r = rng(id)
    if (!r) return
    const cur = param.get(id)
    if (cur == null) return
    param.set(id, clamp(cur + delta, r[0], r[1]))
  }

  let t = 0
  let phase = Math.random() * Math.PI * 2
  let level = 0          // 当前说话能量
  let levelTarget = 0
  let syl = 0            // 当前音节强度
  let sylT = 0
  let sylForm = 0        // 当前音节的嘴形偏移（元音不同）
  let sylFunnel = 0      // 当前音节的圆唇
  let open = 0.02        // 当前开合（平滑后）
  let talking = false
  // 情绪覆盖：分区互动触发（嫌弃/晕/被挠痒），在待机嘴上叠一层，带淡入淡出
  let mood = null        // { open, form, smile, funnel, pucker, t0, ms }

  /**
   * 临时情绪嘴形。字段都用「相对待机嘴的偏移」表示，没写的项保持不变。
   * @param {{open?:number, form?:number, smile?:number, funnel?:number, pucker?:number}} spec
   * @param {number} ms 持续时间（含淡入淡出）
   */
  function setMood(spec = {}, ms = 2600) {
    mood = { ...spec, t0: performance.now(), ms: Math.max(300, ms) }
  }
  function clearMood() { mood = null }

  /** 说话能量 0..1（每帧喂；不喂则自动衰减到 0） */
  function speak(v) { levelTarget = clamp(Number(v) || 0, 0, 1) }
  function stop() { levelTarget = 0 }

  // 「假装说话」：气泡出现时自己编一段能量包络（有音节、有停顿），不用外部喂音频
  let talkUntil = 0
  function talk(ms = 1200) {
    talkUntil = Math.max(talkUntil, performance.now() + Math.max(200, Number(ms) || 0))
  }

  function apply(dtMs = 1000 / 60) {
    const dt = clamp(dtMs / 1000, 0.001, 0.12)
    t += dt
    phase += dt * Math.PI * 2 * cfg.breathHz

    // 气泡说话：用两段不同周期拼出「音节 + 换气停顿」，比匀速开合自然
    if (performance.now() < talkUntil) {
      const syllable = Math.abs(Math.sin(t * 11.5)) * 0.55 + Math.abs(Math.sin(t * 23.1)) * 0.25
      const pause = Math.sin(t * 2.3) > 0.86            // 偶尔咽口气
      levelTarget = pause ? 0.04 : clamp(0.35 + syllable, 0, 1)
    } else if (levelTarget > 0.03 && !performance.now() < talkUntil) {
      levelTarget = 0
    }

    // 音量跟随：起音快、收音慢，像真人在说
    const k = 1 - Math.exp(-(levelTarget > level ? cfg.attack : cfg.release) * dt)
    level += (levelTarget - level) * k
    talking = level > 0.03

    // 音节：说话时每隔 80~180ms 换一次口型强度
    if (talking) {
      sylT -= dt
      if (sylT <= 0) {
        sylT = cfg.sylMin + Math.random() * (cfg.sylMax - cfg.sylMin)
        syl = 0.35 + Math.random() * 0.65
        // 每个音节换个口型：元音不同，嘴形/圆唇也跟着变，才不像「一张一合」
        sylForm = (Math.random() * 2 - 1) * cfg.formTalk
        sylFunnel = Math.random() < 0.4 ? cfg.funnelTalk * (0.5 + Math.random() * 0.5) : 0
      }
    } else {
      syl *= Math.exp(-dt * 8)
      sylForm *= Math.exp(-dt * 8)
      sylFunnel *= Math.exp(-dt * 8)
    }

    // 呼吸层：轻轻开合，静止时也有细微动作
    const breath = cfg.breathOpen * (0.5 + 0.5 * Math.sin(phase))
    const want = breath + level * cfg.talkOpen * syl
    open += (want - open) * (1 - Math.exp(-dt * 14))

    add('ParamMouthOpenY', open)
    // 嘴角与嘴形：让静止状态不是一条直线
    add('MouthSmile_L', cfg.smileAmp * (0.5 + 0.5 * Math.sin(phase * 0.7 + 0.4)))
    add('MouthSmile_R', cfg.smileAmp * (0.5 + 0.5 * Math.sin(phase * 0.7 + 0.9)))
    add('ParamMouthForm', cfg.formAmp * Math.sin(phase * 0.9 + 1.1) + sylForm * level * 0.7)
    add('MouthFunnel', sylFunnel * level * 0.8)

    // 情绪层：淡入 140ms / 保持 / 淡出 320ms
    if (mood) {
      const age = performance.now() - mood.t0
      if (age >= mood.ms) mood = null
      else {
        const inK = Math.min(1, age / 140)
        const outK = Math.min(1, Math.max(0, (mood.ms - age) / 320))
        const k = Math.min(inK, outK)
        if (mood.open) add('ParamMouthOpenY', mood.open * k)
        if (mood.form) add('ParamMouthForm', mood.form * k)
        if (mood.smile) { add('MouthSmile_L', mood.smile * k); add('MouthSmile_R', mood.smile * k) }
        if (mood.funnel) add('MouthFunnel', mood.funnel * k)
        if (mood.pucker) add('Mouthpucker', mood.pucker * k)
      }
    }
  }

  return {
    apply, speak, stop, talk, setMood, clearMood,
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    state: () => ({ level: Math.round(level * 100) / 100, open: Math.round(open * 1000) / 1000, syl: Math.round(syl * 100) / 100, talking, mood: !!mood }),
  }
}
