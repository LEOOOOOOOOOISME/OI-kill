/* ============================================================================
 * OI杀 v4.0 · src/ai/difficulty.js — 难度与节奏表 (P3-5)
 * 纯数据模块 + 小型采样助手, 零依赖。
 * 挂载: 共享命名空间 OIKill.ai.difficulty (浏览器后续在 index.html 追加脚本加载;
 *       Node 经 require 直接使用, 命名空间同步挂载)。
 * 导出: DIFFICULTY / get / thinkDelay / respDelay / gapDelay / hesitateDelay /
 *       willErr / willRandomTarget
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const me = NS.ai = NS.ai || {};

  /* 三档难度(P3-5 规格):
   *   easy   = 近似随机 + 长延迟(低身份策略/低保留)
   *   normal = 启发式 + 身份策略 + 威胁模型(轻度)
   *   hard   = 评分 + 威胁模型 + 更优保留决策 + 期望值响应
   * 人形化节奏(recon-02 P3-5): 绝不瞬发 —
   *   thinkMs/respMs/gapMs: 思考/响应/同回合动作间隔(ms 区间)
   *   hesitatePct/hesitateMs: 偶发"犹豫"停顿(响应前多停 1~2s)
   * 字段说明:
   *   errPct            犯错率(打出次优/跳过良机)
   *   randomPickPct     动作/目标随机选择率(easy≈近似随机)
   *   retentionBias     保留价值牌(WA/桃/咖啡/特判/卖队友)倾向 0..1
   *   useIdentityPolicy 是否启用身份策略(反贼集火等)
   *   useThreatModel    是否启用威胁模型选目标
   *   dodgeHpThreshold  体力≤此值时优先出闪
   *   overflowDodge     手牌溢出时出闪
   *   counterValue      特判保留权重(响应决策用)
   *   evDepth           响应期望值估算深度(0=阈值, 1=EV, 2=EV+资源账)
   */
  const DIFFICULTY = {
    easy: {
      label: '简单', thinkMs: [800, 2500], respMs: [800, 2000], gapMs: [250, 900],
      hesitatePct: 0.12, hesitateMs: [1000, 2000],
      errPct: 0.30, randomPickPct: 0.65, retentionBias: 0.25,
      useIdentityPolicy: false, useThreatModel: false,
      dodgeHpThreshold: 2, overflowDodge: true, counterValue: 0.2, evDepth: 0,
    },
    normal: {
      label: '普通', thinkMs: [800, 2500], respMs: [800, 2000], gapMs: [250, 900],
      hesitatePct: 0.08, hesitateMs: [800, 1800],
      errPct: 0.12, randomPickPct: 0.18, retentionBias: 0.6,
      useIdentityPolicy: true, useThreatModel: true,
      dodgeHpThreshold: 3, overflowDodge: true, counterValue: 0.55, evDepth: 1,
    },
    hard: {
      label: '困难', thinkMs: [800, 1500], respMs: [800, 1500], gapMs: [200, 700],
      hesitatePct: 0.05, hesitateMs: [600, 1400],
      errPct: 0.03, randomPickPct: 0.02, retentionBias: 0.9,
      useIdentityPolicy: true, useThreatModel: true,
      dodgeHpThreshold: 4, overflowDodge: true, counterValue: 0.9, evDepth: 2,
    },
  };

  /* 取难度表: 接受 'easy'|'normal'|'hard' 或直接传表对象; 未知值回落 normal */
  function get(difficulty) {
    if (difficulty && typeof difficulty === 'object') return difficulty;
    return DIFFICULTY[difficulty] || DIFFICULTY.normal;
  }

  function _rnd(rnd) { return (typeof rnd === 'function') ? rnd : Math.random; }
  function _in(r, range) { return range[0] + Math.floor(r() * (range[1] - range[0] + 1)); }

  /* 行动思考延迟(ms) */
  function thinkDelay(difficulty, rnd) { return _in(_rnd(rnd), get(difficulty).thinkMs); }
  /* 响应思考延迟(ms) */
  function respDelay(difficulty, rnd) { return _in(_rnd(rnd), get(difficulty).respMs); }
  /* 同回合动作间隔(ms) */
  function gapDelay(difficulty, rnd) { return _in(_rnd(rnd), get(difficulty).gapMs); }
  /* 偶发"犹豫"停顿(ms; 0=不犹豫) */
  function hesitateDelay(difficulty, rnd) {
    const d = get(difficulty), r = _rnd(rnd);
    return r() < d.hesitatePct ? _in(r, d.hesitateMs) : 0;
  }
  /* 是否犯错(打出次优/跳过) */
  function willErr(difficulty, rnd) { return _rnd(rnd)() < get(difficulty).errPct; }
  /* 是否随机选目标/动作 */
  function willRandomTarget(difficulty, rnd) { return _rnd(rnd)() < get(difficulty).randomPickPct; }

  const api = { DIFFICULTY, get, thinkDelay, respDelay, gapDelay, hesitateDelay, willErr, willRandomTarget };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  me.difficulty = api;
})(typeof window !== 'undefined' ? window : globalThis);
