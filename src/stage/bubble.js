/**
 * 对话气泡（DOM 浮层）。
 *
 * 位置与尺寸都按「漫画式短句气泡」定：
 *   - 贴在头的左上/右上外角（设置里可切），不压脸；
 *   - 短句用大字（20px 起），字多一点逐档降到 14px，框最宽约 250px；
 *   - 只在极端长文本时才长高/滚动（正常走 phrases.js 的预设短句，不该触发）。
 *
 * 气泡只负责「显示」，说什么由调用方（phrases.js / agent-link）决定。
 */

import { pickPhrase } from './phrases.js'

const FONT_STEPS = [
  [12, 20],   // ≤12 字：20px（漫画泡泡的「大字」档）
  [26, 18],
  [48, 16],
  [90, 15],
  [Infinity, 14],
]

export function createBubble({ el, anchor, side = 'right', corner = false, onSpeak = null }) {
  if (!el) throw new Error('bubble: 缺少容器')
  el.classList.add('bubble')
  let visible = false
  let lastText = ''
  let lastKey = ''
  let hideTimer = 0
  let anchorSide = side === 'left' ? 'left' : 'right'
  // 气泡占用锁：agent 在干活时锁住，别的来源（待机台词 / 互动台词 / 外部 say）说不进去
  let lockOwner = null
  // 与窗口/角色同一比例：窗口变大，气泡的字号、内边距、尾巴一起变大
  let scale = 1
  el.style.setProperty('--bs', '1')

  const viewport = () => ({ w: window.innerWidth, h: window.innerHeight })

  /** 按字数选字号 */
  const fontFor = (len) => {
    for (const [max, px] of FONT_STEPS) if (len <= max) return px
    return 13
  }

  /**
   * 排版：紧凑漫画泡泡。宽度上限按窗口窄算（≈250px），字号按字数降档；
   * 只在极端长文本时才让它长高/滚动 —— 正常走预设短句，不该出现滚动。
   */
  function layout(text) {
    const vp = viewport()
    const maxH = Math.max(96 * scale, vp.h * 0.26)
    el.style.maxWidth = `${Math.round(Math.min(268 * scale, vp.w * 0.62))}px`
    el.style.maxHeight = `${Math.round(maxH)}px`

    const len = Array.from(text).length
    let fs = Math.round(fontFor(len) * scale * 10) / 10
    el.style.fontSize = `${fs}px`
    el.style.overflowY = 'visible'
    el.style.height = 'auto'

    // 极长文本兜底（预设短句一般到不了这里）
    let guard = 0
    const floor = 13 * scale
    while (el.scrollHeight > maxH && fs > floor && guard++ < 8) {
      fs = Math.round((fs - 1) * 10) / 10
      el.style.fontSize = `${fs}px`
    }
    if (el.scrollHeight > maxH) {
      el.style.height = `${Math.round(maxH)}px`
      el.style.overflowY = 'auto'
    }
    return { fs, maxH }
  }

  /**
   * 漫画式定位：泡泡贴在「头的右上方 / 左上方」外角，不压脸。
   *   右侧：左边缘落在头的 right 外一点点；左侧镜像。
   * 放不下自动翻边；顶部空间不够就往头侧下方挪。
   */
  function place() {
    const a = anchor?.()
    const vp = viewport()
    const w = el.offsetWidth || 200
    const h = el.offsetHeight || 60
    let side = anchorSide
    let x, y
    if (corner) {
      // 默认形态：贴窗口右上角（选左侧就贴左上角）。
      // 留白按窗口高度给（约 2.5%），窗框收窄后气泡跟着往里、不贴边。
      const PAD = Math.round(Math.max(10, vp.h * 0.025))
      x = side === 'right' ? vp.w - w - PAD : PAD
      y = PAD
    } else if (a) {
      const offset = Math.max(4, Math.round(w * 0.06))
      const gap = 6
      const fitsRight = a.right + offset + w <= vp.w - gap
      const fitsLeft = a.left - offset - w >= gap
      // 先按设置里选的那一侧放；那一侧放不下再翻另一侧；两边都放不下面就居中挂在头顶。
      // 窗口是「刚好包住角色」的，头侧往往真的没有气泡的宽度，居中兜底比硬贴边好看。
      if (side === 'right' && fitsRight) x = a.right + offset
      else if (side === 'left' && fitsLeft) x = a.left - offset - w
      else if (fitsLeft) { side = 'left'; x = a.left - offset - w }
      else if (fitsRight) { side = 'right'; x = a.right + offset }
      else {
        side = 'center'
        // 气泡比窗口还宽时只能靠缩放，这里只保证不越界
        x = (a.left + a.right) / 2 - w / 2
      }
      // 泡泡底边略高于头顶（留出点点尾巴的高度）
      y = a.top - h - 22
      if (y < 6) y = a.top + 10
    } else {
      x = vp.w / 2 - w / 2
      y = vp.h * 0.16
    }
    x = Math.max(6, Math.min(vp.w - w - 6, x))
    y = Math.max(6, Math.min(vp.h - h - 6, y))
    el.style.left = `${Math.round(x)}px`
    el.style.top = `${Math.round(y)}px`
    el.dataset.anchor = corner ? `corner-${side}` : side
    // 尾巴点点的方向：点点要指向角色。
    //   贴角模式：气泡在窗口顶部、角色在下面 → 点点朝下（above = 点点在气泡底边外侧）
    //   跟随模式：按气泡在头顶上方还是下方决定
    el.dataset.side = (corner || (a && y + h + 2 <= a.top)) ? 'above' : 'below'
  }

  return {
    /** 换文字（不闪不重建）；state 用来染色：thinking / working / waiting / success / error */
    set(text, { state: st } = {}) {
      const t = String(text ?? '')
      if (st) el.dataset.state = st
      if (t === lastText) { if (visible) place(); return }
      lastText = t
      el.textContent = t
      el.classList.toggle('empty', t.length === 0)
      if (visible) { layout(t); place() }
    },
    show(text, opts = {}) {
      // 被锁住时：只有锁的主人能改字（防止待机台词 / 互动台词把 agent 的进度顶掉）
      if (lockOwner && opts.owner !== lockOwner) return
      const changed = text != null && String(text) !== lastText
      if (text != null) this.set(text, opts)
      visible = true
      el.classList.add('on')
      layout(lastText)
      place()
      // 冒泡时让她动嘴：按字数估一个时长（含标点停顿），看起来像在念这句话
      if (changed && lastText) {
        try { onSpeak?.(lastText) } catch {}
      }
      // 量完再定一次位（首帧字号还没生效时高度会差一点）
      requestAnimationFrame(() => { if (visible) place() })
    },
    hide() {
      visible = false
      el.classList.remove('on')
      // 气泡收起来就闭嘴，别让嘴一直动
      try { onSpeak?.(null) } catch {}
    },
    /** 说一句预设台词（key 见 phrases.js：thinking / working / waiting / success / error / head / hand …） */
    say(key, { ms = 0, owner = null } = {}) {
      if (lockOwner && owner !== lockOwner) return null
      const line = pickPhrase(key, lastKey === key ? lastText : '')
      lastKey = key
      this.show(line, { state: key, owner })
      if (ms > 0) {
        clearTimeout(hideTimer)
        hideTimer = setTimeout(() => { if (lastKey === key) this.hide() }, ms)
      }
      return line
    },
    /** 占用气泡（agent 干活期间）：别人说不进来，直到 unlock */
    lock(owner = 'agent') { lockOwner = owner },
    unlock(owner = 'agent') { if (lockOwner && owner === lockOwner) lockOwner = null },
    get locked() { return lockOwner },
    /** 位置依赖角色位置，角色一动（拖窗口/换尺寸）就重排 */
    reposition() { if (visible) place() },
    /** 挂在头的左侧还是右侧（设置里可切） */
    setSide(s) {
      anchorSide = s === 'left' ? 'left' : 'right'
      if (visible) place()
    },
    /** 与窗口/角色联动的比例（窗口缩放时由 renderer 调用） */
    setScale(s) {
      const next = Math.min(2.5, Math.max(0.4, Number(s) || 1))
      if (Math.abs(next - scale) < 0.002) return
      scale = next
      el.style.setProperty('--bs', String(scale))
      if (visible) { layout(lastText); place() }
    },
    get scale() { return scale },
    get side() { return anchorSide },
    get visible() { return visible },
    get text() { return lastText },
    state() { return { visible, text: lastText, state: el.dataset.state ?? null, w: el.offsetWidth, h: el.offsetHeight, fs: parseFloat(el.style.fontSize) || 0, scroll: el.style.overflowY === 'auto' } },
  }
}
