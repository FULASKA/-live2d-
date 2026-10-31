/**
 * DSH 联动：把桥接插件写的「工作状态」翻译成气泡台词 + 表情 + 小动作。
 *
 * 状态语义（与 dsh-live2d-bridge / dsh-xiaoke 一致）：
 *   thinking / working / result / waiting / success / error，null = 空闲。
 *
 * 三条约束：
 *   1. 只动自己的 source（'agent'）：用户手动点的表情、切换装不会被我们撤掉；
 *   2. 同一档不反复刷气泡（只有状态真的变了才说话），避免每 400ms 轮询说一遍；
 *   3. 终态（success/error）说完几秒自己收起，回到待机，不长期糊在脸上。
 */

const EXPR_OF = {
  thinking: '屑屑眼',
  waiting: '＞＜',
  error: '流冷汗',
  success: '爱心眼',
}

const HIDE_AFTER_MS = { success: 4600, error: 6000, result: 2200 }

export function createAgentLink({ bubble, layers, expressions = [], poses, life } = {}) {
  let lastState = '__init__'
  let lastAt = 0
  let hideTimer = 0
  let enabled = true

  const defOf = (name) => expressions.find((e) => e.name === name)

  function clearExpression() {
    try { layers?.removeSource('agent') } catch {}
  }

  function setExpression(name) {
    clearExpression()
    if (!name) return
    const def = defOf(name)
    if (!def) return
    try { layers?.addExpression(name, def.params, { source: 'agent', fade: 0.24 }) } catch {}
  }

  function scheduleHide(ms) {
    clearTimeout(hideTimer)
    if (!ms) return
    hideTimer = setTimeout(() => {
      bubble?.hide()
      // 终态收起时顺手把表情也撤掉，回到待机
      clearExpression()
    }, ms)
  }

  function apply(snap) {
    if (!enabled) return
    const state = snap?.state ?? null
    const at = Number(snap?.at || 0)
    if (state === lastState && at === lastAt) return
    lastState = state
    lastAt = at

    if (!state) {
      clearExpression()
      scheduleHide(1200)
      return
    }

    setExpression(EXPR_OF[state] || null)
    bubble?.say(state)
    // 状态一变，耳朵扑棱一下（小动作，不抢气泡）
    try { life?.flap(Math.random() < 0.5 ? 'L' : 'R', 0.8) } catch {}

    scheduleHide(HIDE_AFTER_MS[state] || 0)

    // 收工的时候顺手竖个手指：只有这一档配动作，其他档留给用户交互
    if (state === 'success' && poses) {
      try { poses.set('竖手指', 320) } catch {}
      setTimeout(() => { try { poses.release(320) } catch {} }, 2400)
    }
  }

  return {
    apply,
    /** 关掉联动（设置里可做开关；关掉后不再动表情，气泡也不弹） */
    setEnabled(v) {
      enabled = !!v
      if (!enabled) { clearExpression(); bubble?.hide() }
    },
    get enabled() { return enabled },
    state() { return { enabled, lastState, lastAt } },
  }
}
