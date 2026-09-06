/* ============================================================================
 * OI杀 v4.0 · src/ai/identity-policy.js — 身份策略 (P3-2)
 * 依据 recon-02 P3-2 与 requirement.txt 2.5/2.6/20.3:
 *   - 反贼: 压迫主公但不盲打 —— 首轮(+1费)先铺装备/攒牌; 主公护盾未破先拆盾/
 *     打守擂(爆零/抄袭代码优先级提升); 忠臣疑似暴露前先探明; 主公残血才集火。
 *   - 忠臣: 护主优先 —— 治疗/挡刀/护驾更积极; 主动拆反贼装备与延时牌; 必要时卖血保主。
 *   - 内奸: 平衡两方 —— 反贼占优帮主公方、主公方占优保留反贼; 绝不提前杀主公
 *     (胜利条件要求反贼先全灭); 保留颓废/治疗牌进 1v1; 终局单挑磨杀(单挑回血
 *     已降为每2回合1点, Fix-Balance R1)。
 *   - 主公: 自保流 —— 优先装备与治疗; 盲狙试探(打疑似反贼, 吃 -1 惩罚也在所不惜);
 *     善用护驾与首轮免伤窗口。
 * 无上帝视角: 阵营强弱/谁是忠臣均由 scorer.identityBelief 的公开信息推断;
 * 反贼存活数由 ID_TABLE - 已公开阵亡反贼数(规则推导)得到, 不读存活暗置身份。
 * 挂载: 共享命名空间 OIKill.ai.identityPolicy
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const nsEngine = NS.engine = NS.engine || {};
  const me = NS.ai = NS.ai || {};
  if (typeof module !== 'undefined' && module.exports) {
    require('../data/cards.js');
    require('../data/professions.js');
    require('../data/identities.js');
    if (!nsEngine.core) require('../engine/core.js');
    if (!me.scorer) require('./scorer.js');
  }
  const scorer = () => me.scorer;

  /* 盟重权重(0..1): 观察者视角下目标是我方成员的概率 */
  function allyWeight(g, pid, targetId) {
    const p = g.players[pid];
    const b = scorer().identityBelief(g, pid, targetId);
    if (p.identity === 'lord' || p.identity === 'loyal') return b.lord + b.loyal;
    if (p.identity === 'rebel') return b.rebel;
    return 0; // 内奸孤狼
  }

  /* 阵营强弱估计(公开信息 + 信念; 供内奸平衡两方) */
  function sideBalance(g, pid) {
    let lordSide = 0, rebelSide = 0;
    for (const q of g.players) {
      if (q.dead) continue;
      const b = scorer().identityBelief(g, pid, q.id);
      const hp = q.hp;
      lordSide += (b.lord + b.loyal) * hp;
      rebelSide += b.rebel * hp;
    }
    return { lordSide, rebelSide, rebelStrong: rebelSide > lordSide };
  }
  /* 场上是否仍有存活反贼(规则推导: 总反贼数 - 已公开阵亡反贼; 无上帝视角) */
  function rebelsAliveByRule(g) {
    const n = g.players.length;
    const tbl = nsData.identities.ID_TABLE[n] || [1, 1, 2, 1];
    const totalRebels = tbl[2];
    let knownDead = 0;
    for (const q of g.players) {
      if (!q.dead) continue;
      const deathLine = (g.log || []).find(l => l.txt.indexOf(q.name + ' 阵亡') >= 0);
      if (deathLine && deathLine.txt.indexOf('身份: 反贼') >= 0) knownDead++;
    }
    return totalRebels - knownDead > 0;
  }
  /* 主公护盾/守擂是否仍在(反贼拆盾优先级) */
  function lordShieldUp(g) {
    const lord = g.players.find(q => q.identity === 'lord');
    if (!lord || lord.dead) return false;
    const shieldFresh = lord.armor && lord.armor.key === 'aShield' && !lord.armorCount.shield;
    const hasGuard = (lord.units || []).some(u => nsData.cards.CARDS[u.key] && nsData.cards.CARDS[u.key].guard);
    return shieldFresh || hasGuard;
  }

  /* 身份策略表: 返回策略对象(见各字段注释; 供 heuristics 与自测使用) */
  function policyFor(g, pid) {
    const p = g.players[pid];
    const idn = p.identity;
    const lord = g.players.find(q => q.identity === 'lord');
    const lordAlive = lord && !lord.dead;
    const lordHp = lordAlive ? lord.hp : 0;
    const bal = sideBalance(g, pid);
    const rebelsAlive = rebelsAliveByRule(g);
    const round1 = g.round === 1;

    /* 反贼集火窗口: 主公残血(≤2)或盾破后低血且非首轮攒牌期
     * (P10a 调参: 原 ≤3/≤4/round≥3≤5 → 收紧为 ≤2/≤3/round≥4≤4, 反贼放缓集火节奏;
     *  Fix-Balance 迭代3: round≥4≤4 → round≥6≤3, 推迟反贼总攻主公的时点) */
    const focusNow = idn === 'rebel' && lordAlive &&
      (lordHp <= 2 || (lordHp <= 3 && !lordShieldUp(g)) || (g.round >= 6 && lordHp <= 3));
    const breakShieldFirst = idn === 'rebel' && lordAlive && lordShieldUp(g) && !focusNow;

    const policy = {
      identity: idn,
      /* 通用行动权重(相对值, 乘到动作分上) */
      weights: { attack: 1.0, heal: 0.85, equip: 0.9, unit: 0.8, trick: 0.85, skill: 0.7, fun: 0.7, retain: 0.6 },
      aggression: 0.5,        // 主动进攻倾向 0..1
      protectLord: 0,         // 护主倾向(护驾/为保主卖血)
      focusLord: 0,           // 集火主公倾向
      focusNow,               // 当前是否集火主公
      breakShieldFirst,       // 先拆主公护盾/打守擂
      probeLoyalists: 0,      // 反贼: 探明忠臣倾向
      buildFirst: 0,          // 反贼首轮: 铺装备/攒牌
      balancer: 0,            // 内奸: 平衡两方倾向
      hoardForDuel: 0,        // 内奸: 保留治疗/咖啡进单挑
      selfPreserve: 0.5,      // 自保倾向(治疗/装备优先级)
      blindProbe: 0,          // 主公: 盲狙试探(接受误伤忠臣 -1 惩罚)
      useGuardDodge: 0,       // 护驾/免伤窗口利用
      delayToThreat: true,    // 延时锦囊给最大威胁
      aoeThreshold: 2,        // 敌人数≥此值时开 AOE
      saveCounterFor: [],     // 特判保留清单(响应决策按此收紧)
      focusThreshold: 3,      // 主公体力≤此值 → 反贼集火
      firstRoundCostPenalty: idn === 'rebel' && round1, // 反贼首轮攻击/部署 +1 费
      retention: { dodge: 0.8, counter: 0.8, heal: 0.6, coffee: 0.8 }, // 保留倾向乘数
      attackPrio: () => 0,    // 占位, 下方按身份覆盖
    };

    switch (idn) {
      case 'rebel': {
        policy.aggression = 0.8;          // P10a: 0.85→0.8 (攻势放缓)
        policy.weights.attack = 0.8;      // P10a: 1.0→0.8 (攻击权重降, 反贼节奏放缓; Fix-Balance 迭代2的0.68已回退)
        policy.focusLord = 0.9;
        policy.probeLoyalists = 0.55;
        policy.buildFirst = round1 ? 0.8 : 0.1;
        policy.selfPreserve = 0.68;       // P10a: 0.55→0.68 (更倾向自保, 少无脑压)
        policy.saveCounterFor = ['skipPlay', 'delaySkipPlay', 'delaySkipDraw', 'o2', 'pierce'];
        policy.retention = { dodge: 0.8, counter: 0.8, heal: 0.5, coffee: 0.8 };
        policy.attackPrio = (tid) => {
          const q = g.players[tid];
          if (!q || q.dead) return 0;
          const b = scorer().identityBelief(g, pid, tid);
          if (tid === lord.id) {
            if (focusNow) return 3.2;                                   // 残血集火 (P10a: 4.2→3.2; 迭代2的2.9已回退)
            if (breakShieldFirst) return 2.2;                           // 破盾/打守擂优先 (P10a: 2.4→2.2)
            if (round1 && policy.buildFirst > 0.5) return -1.8;         // 首轮攒牌, 不盲打
            return 0.2;                                                 // P10a: 0.9→0.2 (非集火期不强压主公, 转去探忠)
          }
          return 1.2 * b.loyal + 0.7 * b.traitor - 1.6 * b.rebel;       // 探忠 (P10a: loyal 1.2, traitor 0.5→0.7)
        };
        break;
      }
      case 'loyal': {
        policy.aggression = 0.85;         // P10a: 0.75→0.85 (拆反贼更主动)
        policy.weights.attack = 1.05;     // P10a: 1.0→1.05
        policy.protectLord = 1.0;
        policy.useGuardDodge = 1.0;
        policy.selfPreserve = 0.75;
        policy.saveCounterFor = ['o2', 'pierce', 'skipPlay', 'delaySkipPlay', 'delaySkipDraw', 'duel', 'steal'];
        policy.retention = { dodge: 1.2, counter: 1.1, heal: 0.7, coffee: 0.6 };
        policy.attackPrio = (tid) => {
          if (tid === lord.id) return -99;                              // 绝不碰主公
          const b = scorer().identityBelief(g, pid, tid);
          // P10a: 残局(≤3人)解除"怕打错忠臣"冻结 —— 非主公目标必打(对忠臣而言非主公=敌)
          const late = g.players.filter(q => !q.dead).length <= 3;
          return 1.15 * b.rebel + 1.0 * b.traitor - (late ? 0.5 : 1.4) * b.loyal; // (迭代2的1.3已回退)
        };
        break;
      }
      case 'traitor': {
        policy.aggression = 0.7;   // Fix-Balance 迭代5: 0.5→0.7 (反贼占优时更主动帮主公方清反贼)
        policy.protectLord = 0.35;   // 仅用于"不杀主公"约束
        policy.balancer = 1.0;
        policy.hoardForDuel = 1.0;
        policy.selfPreserve = 0.45;  // P10a: 0.85→0.45 (自保大降, 内奸中盘更易被打残/打死)
        policy.aoeThreshold = 3;     // 避免误伤失衡
        policy.saveCounterFor = ['o2', 'pierce', 'harvest'];
        policy.retention = { dodge: 0.9, counter: 1.0, heal: 1.0, coffee: 1.0 }; // P10a: 1.5→1.0
        policy.attackPrio = (tid) => {
          if (tid === lord.id) {
            if (rebelsAlive) return -99;                                // 反贼未灭, 绝不杀主公
            return 1.2;                                                 // 单挑: 磨
          }
          const b = scorer().identityBelief(g, pid, tid);
          if (bal.rebelStrong) return 1.8 * b.rebel - 0.6 * b.loyal;    // 反贼占优 → 帮主公方 (P10a: 0.8→1.35; Fix-Balance 迭代5: 1.35→1.8, loyal -0.3→-0.6)
          return 0.2 * b.loyal - 0.3 * b.rebel;                         // 主公方占优 → 少杀忠臣, 少造单挑 (P10a: 0.55→0.2)
        };
        break;
      }
      case 'lord':
      default: {
        policy.aggression = 0.6;
        policy.selfPreserve = 1.0;
        policy.blindProbe = 0.7;
        policy.useGuardDodge = 0.9;
        policy.saveCounterFor = ['o2', 'pierce', 'skipPlay', 'delaySkipPlay', 'delaySkipDraw'];
        policy.retention = { dodge: 1.1, counter: 0.9, heal: 1.2, coffee: 0.8 };
        policy.attackPrio = (tid) => {
          const b = scorer().identityBelief(g, pid, tid);
          // P10a: 残局(≤3人)解除"怕打错忠臣"冻结 —— 宁可错打也不能坐视
          const late = g.players.filter(q => !q.dead).length <= 3;
          return 1.2 * b.rebel + 1.1 * b.traitor - (late ? 0.3 : 1.0) * b.loyal; // (Fix-Balance 迭代2的1.35/1.25已回退)
        };
        break;
      }
    }
    return policy;
  }

  /* 便捷: 策略对目标的攻击偏好加成 */
  function targetPreference(g, pid, targetId) {
    return policyFor(g, pid).attackPrio(targetId);
  }

  const api = { policyFor, sideBalance, rebelsAliveByRule, lordShieldUp, allyWeight, targetPreference };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  me.identityPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
