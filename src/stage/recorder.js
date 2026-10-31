/**
 * 动作录制 / 回放。
 *
 * 为什么录：动作调优时最缺的是「刚才那一秒，参数到底走到了哪儿」——
 * 靠肉眼截图猜不方便，所以每帧采一份参数快照，带上标记（状态变化 / 互动），存成 JSON 再回放对照。
 *
 * 采样点：beforeUpdate 的最后一刻（各层都写完、物理也算完），
 *   注意不能事后读 —— 引擎 update() 末尾 loadParameters() 会把参数还原，读到的是快照前的值。
 *
 * 回放：按时间顺序把录下的值钉回 layers.hold（物理输出参数默认跳过，免得和物理打架）。
 */

/** 默认录这些：我们自己驱动 / 会显著影响观感的通道 */
export const DEFAULT_IDS = [
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'HipAngleZ', 'LeanInput',
  'ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY',
  'ParamMouthOpenY', 'ParamMouthForm', 'MouthSmile_L', 'MouthSmile_R', 'MouthFunnel',
  'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLForm', 'ParamBrowRForm',
  'LEar1', 'REar1', 'FrontHairY1', 'SideHairY1', 'LateHairY1',
  'CheeckPuff', 'CheeckPuffL', 'CheeckPuffR',
  // 手臂链（举手/竖手指/狗尾草）
  'Movement1', 'Movement2', 'Movement3',
  'Param40', 'Param41', 'Param42', 'Param43', 'Param36', 'Param39',
  'Param56', 'Param57', 'Param59', 'Param60', 'Param61', 'Param62',
]

const round = (v) => Math.round(v * 10000) / 10000

export function createRecorder({ param, layers, isPhysicsOutput = () => false, ids = DEFAULT_IDS, fps = 60 } = {}) {
  let recording = null
  let playback = null
  let lastKey = null

  return {
    /** 每帧采样（调在 beforeUpdate 末尾）；未在录制时是空转 */
    sample(nowMs) {
      if (recording) {
        const t = nowMs - recording.t0
        if (t - recording.lastT >= 1000 / recording.fps - 0.5) {
          recording.lastT = t
          const values = {}
          for (const id of recording.ids) {
            const v = param.get(id)
            if (v == null) continue
            values[id] = round(v)
          }
          recording.frames.push([Math.round(t), values])
        }
      }
      if (playback) {
        const t = nowMs - playback.t0
        while (playback.i + 1 < playback.frames.length && playback.frames[playback.i + 1][0] <= t) playback.i += 1
        const frame = playback.frames[playback.i]
        if (frame) {
          for (const [id, v] of Object.entries(frame[1])) {
            if (isPhysicsOutput(id)) continue
            layers.hold(id, v)
          }
        }
        if (t > playback.duration + 120) {
          this.stopPlay()
        }
      }
    },

    start({ ids: customIds, fps: customFps } = {}) {
      const list = Array.isArray(customIds) && customIds.length ? customIds.filter((id) => param.get(id) != null) : ids
      recording = { t0: performance.now(), lastT: -1e9, fps: Number(customFps) || fps, ids: list, frames: [], marks: [] }
      playback = null
      return { ids: list.length, fps: recording.fps }
    },

    /** 打个标记：状态切换、点/摸这类事件，回放时能对齐 */
    mark(label) {
      if (!recording) return false
      recording.marks.push([Math.round(performance.now() - recording.t0), String(label)])
      return true
    },

    stop() {
      if (!recording) return null
      const r = recording
      recording = null
      const duration = r.frames.length ? r.frames[r.frames.length - 1][0] : 0
      return {
        name: '',
        fps: r.fps,
        duration,
        ids: r.ids,
        frames: r.frames,
        marks: r.marks,
      }
    },

    /** 回放录到的数据（data 就是 stop() 的返回） */
    play(data, { speed = 1 } = {}) {
      if (!data || !Array.isArray(data.frames) || !data.frames.length) return false
      playback = {
        t0: performance.now(),
        speed: speed || 1,
        i: 0,
        duration: data.frames[data.frames.length - 1][0],
        frames: data.frames,
        marks: data.marks || [],
        name: data.name || '',
      }
      return true
    },

    stopPlay() {
      if (!playback) return false
      // 回放结束时把钉住的参数放开，避免角色定格在最后一帧
      try { layers.clearHeld() } catch {}
      playback = null
      return true
    },

    get isRecording() { return !!recording },
    get isPlaying() { return !!playback },
    state() {
      return {
        recording: recording ? { frames: recording.frames.length, ids: recording.ids.length, fps: recording.fps } : null,
        playing: playback ? { frame: playback.i, total: playback.frames.length, name: playback.name } : null,
      }
    },
  }
}
