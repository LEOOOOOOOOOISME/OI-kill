#include "game_engine.h"
#include "auth.h"
#include <algorithm>
#include <chrono>

using namespace std::chrono;

// 全局随机
std::mt19937& rng() {
    static std::mt19937 gen(std::random_device{}());
    return gen;
}
int randInt(int low, int high) {
    return std::uniform_int_distribution<>(low, high)(rng());
}
std::string randSuit() {
    static const char* suits[] = {"spade","club","heart","diamond"};
    return suits[randInt(0,3)];
}
std::string suitEmoji(const std::string& s) {
    if (s == "spade") return "♠";
    if (s == "club") return "♣";
    if (s == "heart") return "♥";
    if (s == "diamond") return "♦";
    return s;
}

std::map<std::string, std::string> evoMap = {
    {"做法假了","实锤"}, {"WA","样例全过"}, {"CCF捐款","CCF金牌"},
    {"对拍","WC对决"}, {"抄袭代码","暴力抄袭"}, {"请家长","退学警告"},
    {"O2优化","O3优化"}, {"线段树","主席树"}, {"并查集","路径压缩"},
    {"重构","系统重构"},
    // ===== v3.0 新进化 =====
    {"咖啡","浓缩咖啡"},           // 伤害加成+2, 濒死回复2
    {"数据加强","数据爆炸"},       // AOE打不出牌受2伤
    {"评测机抽风","评测机暴走"},   // AOE打不出WA受2伤
    {"特判","一票否决"},           // 抵消后摸1
    {"手写快排","模板库"},         // 1张手牌当做法假了
    {"评测机连发","评测机超频"},   // 攻击范围+1
    {"管理员权限","root权限"},     // 被WA抵消时弃1令其无效
    {"玄学判题","玄学大师"},       // 红桃或方块均视为WA
    {"黑名单","全员拉黑"},         // 黑色AC无效且失去时摸1
    {"AC保护","金牌保护"}          // 失去时回复2
    // 注: 需求.txt 第十章进化表无"暴力枚举→剪枝优化", 已移除 (一致性修复)
};

// 进化/基础卡名归一化后判定辅助: 实锤=进化做法假了, 样例全过=进化WA
static bool isAcCard(const Card& c) { return c.name == "做法假了" || c.name == "实锤"; }
static bool isWaCard(const Card& c) { return c.name == "WA" || c.name == "样例全过"; }

std::string Card::symbol() const {
    static std::map<std::string,std::string> sym = {
        {"spade","♠"},{"club","♣"},{"heart","♥"},{"diamond","♦"}
    };
    return sym[suit] + std::to_string(number) + " " + name + (evolved ? "(E)" : "");
}
bool Card::isBlack() const { return suit == "spade" || suit == "club"; }
bool Card::isRed() const { return suit == "heart" || suit == "diamond"; }

// ----------------------------- Room 成员函数 -----------------------------
Player& Room::getPlayer(int pid) {
    // BUG-002: 越界防御 - 客户端可能传入非法索引, 越界读取会崩溃服务器
    if (pid < 0 || pid >= (int)players.size()) {
        static Player dummy;  // 返回一个安全的空玩家 (调用方应检查 name 是否为空)
        static bool inited = false;
        if (!inited) { dummy.id = -1; dummy.name = "无效目标"; dummy.alive = false; inited = true; }
        return dummy;
    }
    return players[pid];
}
bool Room::isAlive(int pid) const {
    if (pid < 0 || pid >= (int)players.size()) return false;  // BUG-002
    return players[pid].alive;
}

void Room::addLog(const std::string& msg) {
    log.push_back("[R" + std::to_string(roundCount) + "] " + msg);
    if (log.size() > 50) log.erase(log.begin());
}

Card Room::drawCard() {
    if (deck.empty()) {
        if (discard.empty()) {
            // BUG-404: 双堆皆空 → 返回空卡标记(id=0,name=""), 调用方(摸牌阶段)检测后跳过, 不产生垃圾卡
            Card empty;
            empty.name = "__EMPTY__";
            return empty;
        }
        deck.swap(discard);
        discard.clear();
        shuffleDeck();
        addLog("牌堆重洗");
    }
    Card c = deck.back();
    deck.pop_back();
    return c;
}

void Room::shuffleDeck() {
    std::shuffle(deck.begin(), deck.end(), rng());
}

void Room::discardCard(Card& c) { discard.push_back(c); }

void Room::discardFromHand(Player& p, int idx) {
    if (idx < 0 || idx >= (int)p.hand.size()) return;
    Card c = p.hand[idx];
    p.hand.erase(p.hand.begin() + idx);
    discardCard(c);
}

int Room::distanceBetween(int from, int to) {
    if (!isAlive(from) || !isAlive(to)) return 999;
    std::vector<int> alive;
    for (auto& p : players) if (p.alive) alive.push_back(p.id);
    auto it1 = std::find(alive.begin(), alive.end(), from);
    auto it2 = std::find(alive.begin(), alive.end(), to);
    int idx1 = it1 - alive.begin(), idx2 = it2 - alive.begin();
    int d = std::min(std::abs(idx1 - idx2), (int)alive.size() - std::abs(idx1 - idx2));
    if (getPlayer(from).mount_off) d = std::max(1, d - 1);
    if (getPlayer(to).mount_def) d += 1;
    return d;
}

int Room::attackRange(Player& p) {
    if (p.weapon) {
        const std::string& w = p.weapon->name;
        if (w == "树状数组" || w == "评测机连发") return 1;
        if (w == "线段树" || w == "莫队算法" || w == "管理员权限" || w == "双指针" || w == "冷数据" ||
            w == "评测机超频" || w == "root权限") return 2;
        if (w == "平衡树" || w == "暴力枚举" || w == "剪枝优化" || w == "手写快排" || w == "模板库" || w == "不死心") return 3;
        if (w == "放手一搏") return 4;
        if (w == "拔网线") return 5;
        if (w == "主席树") return 5;   // 线段树进化: 攻击范围+3 (原2 → 5)
    }
    return 1;
}

bool Room::canAttack(int from, int to) {
    if (from == to) return false;
    if (!isAlive(from) || !isAlive(to)) return false;
    return distanceBetween(from, to) <= attackRange(players[from]);
}

void Room::equipCard(Player& p, Card& c) {
    if (c.type != WEAPON && c.type != ARMOR && c.type != MOUNT_OFF && c.type != MOUNT_DEF) return;
    Card*& slot = (c.type == WEAPON) ? p.weapon : (c.type == ARMOR) ? p.armor :
                  (c.type == MOUNT_OFF) ? p.mount_off : p.mount_def;
    if (slot) {
        // 失去旧防具时结算防具离场效果 (AC保护回复1/金牌保护回复2/全员拉黑摸1)
        if (c.type == ARMOR) loseArmorEffect(p, *slot);
        auto it = std::find_if(p.equip.begin(), p.equip.end(), [&](std::unique_ptr<Card>& eq){ return eq && eq->id == slot->id; });
        if (it != p.equip.end()) {
            discardCard(**it);
            p.equip.erase(it);
            slot = nullptr;
        }
    }
    auto it = std::find_if(p.hand.begin(), p.hand.end(), [&](Card& hc){ return hc.id == c.id; });
    if (it != p.hand.end()) {
        Card copied = *it;
        p.equip.push_back(std::unique_ptr<Card>(new Card(copied)));
        p.hand.erase(it);
        (c.type == WEAPON ? p.weapon : c.type == ARMOR ? p.armor :
         c.type == MOUNT_OFF ? p.mount_off : p.mount_def) = p.equip.back().get();
        addLog(p.name + " 装备了 " + c.name);
    }
}

// 防具离场效果: AC保护(失去回复1) / 金牌保护(失去回复2) / 全员拉黑(失去摸1)
void Room::loseArmorEffect(Player& p, Card& eq) {
    if (eq.name == "AC保护") {
        p.hp = std::min(p.max_hp, p.hp + 1);
        addLog("🦁 " + p.name + " 失去【AC保护】，回复1点体力");
    } else if (eq.name == "金牌保护") {
        p.hp = std::min(p.max_hp, p.hp + 2);
        addLog("🦁 " + p.name + " 失去【金牌保护】，回复2点体力");
    } else if (eq.name == "全员拉黑") {
        p.hand.push_back(drawCard());
        addLog("🖤 " + p.name + " 失去【全员拉黑】，摸1张牌");
    }
}

int Room::dealDamage(Player& source, Player& target, int dmg, bool isAttack, bool isCardEffect) {
    if (dmg <= 0) return 0;
    // 管理员权限/root权限: 无视防具 (需求 Q16: 黑名单/防火墙/AC保护/玄学判题/记忆化搜索全部失效)
    bool ignoreArmor = isAttack && source.weapon &&
        (source.weapon->name == "管理员权限" || source.weapon->name == "root权限");
    // 评测机事件
    if (isAttack) {
        if (activeEvent == "毒瘤评测机") dmg = std::max(0, dmg - 1);
        else if (activeEvent == "暴力评测机") dmg += 1;
    }
    // 传奇Au觉醒·传奇不朽: 本局剩余时间造成的所有伤害+1 (需求 8.9, 不含自伤)
    if (source.bossDmgBoost && source.id != target.id) dmg += 1;
    // 防火墙: 暴力评测机事件期间受伤+1
    if (!ignoreArmor && target.armor && target.armor->name == "防火墙" && activeEvent == "暴力评测机") {
        dmg += 1;
    }
    // 判定花色辅助: 手动测评可强制下一次判定为红/黑
    auto effectiveSuit = [&](Card& judge) -> std::string {
        if (!forcedJudgeColor.empty()) {
            std::string s = (forcedJudgeColor == "red") ? "heart" : "spade";
            addLog("【手动测评】判定花色强制为" + std::string(s=="heart"?"红色":"黑色"));
            forcedJudgeColor.clear();
            return s;
        }
        return judge.suit;
    };
    // 退役选手回忆
    if (target.profession == "退役选手") {
        Card judge = drawCard();
        std::string jSuit = effectiveSuit(judge);
        if (jSuit == "spade") {
            dmg = std::max(0, dmg - 1);
            target.preventDamageCount++;
            addLog(target.name + "【回忆】判定♠，减伤1点");
            if (target.preventDamageCount >= 2 && !target.awakened) {
                target.awakened = true;
                addLog(target.name + " 觉醒：老兵不死，回复2体力并摸2牌");
                target.hp = std::min(target.max_hp, target.hp + 2);
                for (int i=0;i<2;++i) target.hand.push_back(drawCard());
            }
        }
    }
    // 记忆化搜索防具 (管理员权限无视)
    if (!ignoreArmor && target.armor && target.armor->name == "记忆化搜索") {
        Card judge = drawCard();
        std::string jSuit = effectiveSuit(judge);
        if (jSuit == "heart") {
            dmg = std::max(0, dmg - 1);
            addLog(target.name + "【记忆化搜索】判定♥减伤");
        }
    }
    // 评测姬·测评（受伤判定, 红桃减伤1, 累计2次觉醒）
    if (target.profession == "评测姬") {
        Card judge = drawCard();
        std::string jSuit = judge.suit;
        if (!forcedJudgeColor.empty()) { jSuit = (forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
        if (jSuit == "heart") {
            dmg = std::max(0, dmg - 1);
            target.judgeDefCount++;
            addLog(target.name + "【测评】判定♥减伤1（评测姬护体，" + std::to_string(target.judgeDefCount) + "次）");
        }
    }
    // 玄学选手·玄学（每回合第一次受伤判定, 红桃免伤, 累计2次觉醒）
    if (target.profession == "玄学选手" && !target.xuanxueUsedThisTurn) {
        target.xuanxueUsedThisTurn = true;
        Card judge = drawCard();
        std::string jSuit = judge.suit;
        if (!forcedJudgeColor.empty()) { jSuit = (forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
        if (jSuit == "heart") {
            dmg = 0;
            target.judgeDefCount++;
            addLog("🔮 " + target.name + "【玄学】判定♥，玄学免伤（" + std::to_string(target.judgeDefCount) + "次）");
        }
    }
    // BUG-106: 压线过移至濒死救援链最后 (见下方), 此处不再提前拦截
    // ===== v3.0: AC保护 (每次受到伤害至多为1; 失去时回复1; 金牌保护失去回复2) =====
    if (!ignoreArmor && target.armor && (target.armor->name == "AC保护" || target.armor->name == "金牌保护") && dmg > 1) {
        target.acBaoHuTriggered = true;
        target.acBaoHuCount++;   // BUG-129: 进化计数
        addLog("🛡️ " + target.name + "【" + target.armor->name + "】伤害上限为1点(触发" + std::to_string(target.acBaoHuCount) + "次)");
        // 进化候选: 触发3次后防具本体进候选 (需求: AC保护→金牌保护)
        if (target.armor->name == "AC保护" && !target.armor->evolved &&
            target.acBaoHuCount >= 3 && target.evoTotal < 3 && target.evoTurn < 1) {
            if (std::find(target.evoCandidates.begin(), target.evoCandidates.end(), target.armor->id) == target.evoCandidates.end())
                target.evoCandidates.push_back(target.armor->id);
        }
        dmg = 1;
    }
    // 传奇Au不败（每回合一次防止卡牌效果伤害）
    if (target.profession == "传奇Au选手" && !target.usedUndefeatedThisTurn && isCardEffect) {
        target.usedUndefeatedThisTurn = true;
        addLog(target.name + "【不败】防止了伤害");
        return 0;
    }
    if (dmg > 0) {
        // 管理员权限进化计数: 无视防具命中累计2次 (需求: 管理员权限→root权限)
        if (isAttack && source.weapon && source.weapon->name == "管理员权限" && !source.weapon->evolved &&
            target.armor && source.id != target.id) {
            source.adminHitCount++;
            if (source.adminHitCount >= 2 && source.evoTotal < 3 && source.evoTurn < 1) {
                if (std::find(source.evoCandidates.begin(), source.evoCandidates.end(), source.weapon->id) == source.evoCandidates.end())
                    source.evoCandidates.push_back(source.weapon->id);
            }
        }
        target.hp -= dmg;
        addLog(target.name + " 受到 " + std::to_string(dmg) + " 点伤害");
        source.damageDealtThisTurn += dmg;
        if (target.hp <= 0) {
            // 蒟蒻退役
            if (target.profession == "蒟蒻" && !target.retireUsed) {
                target.retireUsed = true;
                target.hand.clear();
                for (auto& eq : target.equip) discardCard(*eq);
                target.equip.clear();
                target.weapon = target.armor = target.mount_off = target.mount_def = nullptr;
                target.hp = 1;
                addLog(target.name + "【退役】弃所有牌，回复1体力");
                if (!target.awakened) {
                    target.awakened = true;
                    target.max_hp += 1;
                    target.hp = std::min(target.max_hp, target.hp + 1);
                    addLog(target.name + " 觉醒：退役是不可能的");
                }
            }
            // 颓废标记
            else if (target.depression > 0 && target.hp <= 0) {
                target.depression--;
                target.hp = 1;
                addLog(target.name + " 使用颓废标记避免死亡");
            }
            // 金牌教练谈心 (BUG-138: 若有教练且有手牌, 自动救 - 需求原为可选择, 保持自动但先于咖啡)
            else {
                for (auto& p : players) {
                    if (p.profession == "金牌教练" && !p.usedMentor && !p.hand.empty()) {
                        discardFromHand(p, p.hand.size()-1);
                        target.hp = 1;
                        p.usedMentor = true;
                        addLog(p.name + "【谈心】救活 " + target.name);
                        if (!p.awakened) {
                            p.awakened = true;
                            addLog(p.name + " 觉醒：名师出高徒");
                            for (auto* person : {&p, &target}) {
                                auto it = std::find_if(discard.begin(), discard.end(), [](Card& c){return c.name=="做法假了";});
                                if (it != discard.end()) { person->hand.push_back(*it); discard.erase(it); }
                                else person->hand.push_back(drawCard());
                            }
                        }
                        break;
                    }
                }
                // BUG-139 修复: 咖啡自救在谈心之后 (需求顺序: 退役→颓废→谈心→咖啡→压线过)
                if (target.hp <= 0 && !target.coffeeUsedThisTurn) {
                    auto coffee = std::find_if(target.hand.begin(), target.hand.end(), [](Card& c){ return c.name == "咖啡"; });
                    if (coffee != target.hand.end()) {
                        target.coffeeUsedThisTurn = true;   // BUG-140: 每回合限1次
                        bool evolved = coffee->evolved;
                        int heal = evolved ? 2 : 1;
                        discardFromHand(target, (int)(coffee - target.hand.begin()));
                        target.hp = heal;
                        addLog("☕ " + target.name + " 濒死喝咖啡续命，回复" + std::to_string(heal) + "点体力");
                    }
                }
                // BUG-106 修复: 压线过是救援链最后手段(第5位): 退役→颓废→谈心→咖啡→压线过
                if (target.hp <= 0 && target.profession == "压线选手" && !target.yaxianThisTurn) {
                    target.yaxianThisTurn = true;
                    target.yaxianCount++;
                    addLog("📏 " + target.name + "【压线过】致命伤改为剩1血！(累计" + std::to_string(target.yaxianCount) + "次)");
                    if (target.yaxianCount >= 3 && !target.awakened) {
                        target.awakened = true;
                        target.max_hp += 1;
                        // BUG-107 修复: 觉醒"体力上限+1并回复1" → 压线后1血+回复1 = 2血
                        target.hp = std::min(target.max_hp, 2);
                        addLog("🏅 " + target.name + " 觉醒：卡线Au！体力上限+1并回复1");
                    } else {
                        target.hp = 1;
                    }
                }
                if (target.hp <= 0) {
                    target.alive = false;
                    // BUG-003 修复: 阵亡弃置全部手牌和装备进弃牌堆 (需求 7.1)
                    for (auto& c : target.hand) discardCard(c);
                    target.hand.clear();
                    for (auto& eq : target.equip) discardCard(*eq);
                    target.equip.clear();
                    target.weapon = target.armor = target.mount_off = target.mount_def = nullptr;
                    target.delayArea.clear();  // 判定区延时锦囊一并弃置
                    addLog(target.name + " 死亡");
                    checkVictory();
                }
            }
        }
        // 暴力评测机反噬
        if (isAttack && activeEvent == "暴力评测机") {
            dealDamage(source, source, 1, false, false);
            addLog("暴力评测机反噬，" + source.name + "受到1点伤害");
        }
        // ===== 链式前向星: 伤害传导 (横置角色受到任何伤害时, 其他横置角色各受等量伤害, 然后全部重置) =====
        if (target.chained) {
            std::vector<int> chainTargets;
            for (auto& pl : players) if (pl.alive && pl.id != target.id && pl.chained) chainTargets.push_back(pl.id);
            target.chained = false;
            for (int oid : chainTargets) getPlayer(oid).chained = false;
            if (!chainTargets.empty()) {
                addLog("🔗 链式前向星传导！" + std::to_string(dmg) + " 点伤害传导至 " +
                       std::to_string((int)chainTargets.size()) + " 名横置角色，链上节点一损俱损");
                for (int oid : chainTargets) dealDamage(source, getPlayer(oid), dmg, false, true);
            }
        }
    }
    return dmg;
}

void Room::checkVictory() {
    int auCount=0, agCount=0, rebelCount=0, spyCount=0;
    for (auto& p : players) {
        if (!p.alive) continue;
        if (p.identity == "Au选手") auCount++;
        else if (p.identity == "Ag选手") agCount++;
        else if (p.identity == "反贼") rebelCount++;
        else if (p.identity == "摸鱼怪") spyCount++;
    }
    if (auCount == 0) {
        gameOver = true;
        // 摸鱼怪(内奸)胜利: 主公阵亡时, 场上除内奸外没有其他存活玩家
        if (spyCount > 0 && rebelCount == 0 && agCount == 0) winner = "摸鱼怪获胜！";
        // BUG-145 修复: 主公死且没有反贼存活(如主公死于AOE/自伤) → 反贼已全灭, 忠臣阵营获胜
        else if (rebelCount == 0) winner = "忠臣阵营获胜！";
        else winner = "反贼获胜！";
    }
    else if (rebelCount == 0 && spyCount == 0 && (auCount>0||agCount>0)) {
        gameOver = true; winner = "忠臣阵营获胜！";
    }
    if (gameOver) {
        phase = GAME_OVER;
        addLog("游戏结束：" + winner);
        // 本局囧闻
        int awakens = 0;
        for (auto& p : players) if (p.awakened) awakens++;
        std::string jiwen = "【本局囧闻】本局共触发 " + std::to_string(awakens) + " 次觉醒";
        if (awakens >= 3) jiwen += "，觉醒遍地开花，考场变修罗场";
        else if (awakens > 0) jiwen += "，有人悄悄进化了";
        else jiwen += "，无人觉醒，咸鱼本鱼";
        jiwen += " · 本局事件：" + activeEvent;
        addLog(jiwen);
    }
}

void Room::clearPending() { pending.reset(); }

// 待响应超时自动结算 (默认按"放弃"处理), 避免某玩家不操作导致整局卡死
void Room::resolvePendingTimeout() {
    if (!pending) return;
    if (steady_clock::now() < pending->deadline) return;
    std::string type = pending->type;
    int pid = pending->targetPlayer;
    addLog("⏳ " + getPlayer(pid).name + " 超时未响应，自动结算");
    json msg;
    json res;
    if (type == "response_wa" || type == "WAIT_EXAM_AC") {
        msg["card_index"] = -1; // 放弃闪避 → 命中 / 模拟赛 → 受1伤
        processResponse(pid, msg, res);
    } else if (type == "AOE_AC" || type == "AOE_WA") {
        msg["card_index"] = -2; // 不打出响应牌 → 受伤害
        processResponse(pid, msg, res);
    } else if (type == "WAIT_DEPRESSION") {
        msg["choice"] = "none";
        processResponse(pid, msg, res);
    } else if (type == "WAIT_DUEL_SELF" || type == "WAIT_DUEL_TARGET") {
        // 对拍超时未出AC → 视为放弃, 受1伤 (WC对决: 2伤); 走完整伤害流程(濒死链)
        json dctx = pending->context;
        int duelId = dctx.value("duel_card", -1);
        int dmg = 1;
        for (auto& c : discard) if (c.id == duelId) { dmg = c.evolved ? 2 : 1; break; }
        int oppId = (type == "WAIT_DUEL_SELF") ? dctx.value("target", -1) : dctx.value("initiator", -1);
        clearPending();
        Player& p = getPlayer(pid);
        if (oppId >= 0 && isAlive(oppId)) dealDamage(getPlayer(oppId), p, dmg, false, true);
        addLog(p.name + " 对拍超时未出AC，受到" + std::to_string(dmg) + "点伤害");
    } else if (type == "WAIT_FORCE_HIT" || type == "WAIT_BU_SI_XIN") {
        // 超时视为放弃强制命中/不死心; 多目标攻击继续结算剩余目标 (BUG-109)
        json savedCtx = pending->context;
        clearPending();
        resolveAcRemaining(pid, savedCtx);
    } else if (type == "WAIT_DAIDANG_WA") {
        // 找代打受害方超时 → 受1伤
        json dctx = pending->context;
        int attId = dctx.value("attacker", -1);
        clearPending();
        if (attId >= 0 && isAlive(attId)) dealDamage(getPlayer(attId), getPlayer(pid), 1, true);
    } else if (type == "WAIT_TJ") {
        // 特判门超时 → 视为不抵消, 继续询问/恢复原锦囊
        msg["card_index"] = -1;
        processResponse(pid, msg, res);
    } else if (type == "WAIT_COLD_DATA") {
        // 冷数据超时 → 正常造成伤害, 继续剩余目标
        json cctx = pending->context;
        int tgt = cctx.value("target", -1);
        int cdmg = cctx.value("base_dmg", 1);
        clearPending();
        if (tgt >= 0 && isAlive(tgt)) dealDamage(getPlayer(pid), getPlayer(tgt), cdmg, true);
        resolveAcRemaining(pid, cctx);
    } else if (type == "WAIT_MODUI") {
        // 莫队算法超时 → 不额外攻击, 继续剩余目标
        json mctx = pending->context;
        clearPending();
        resolveAcRemaining(pid, mctx);
    } else if (type == "WAIT_SUIYUAN") {
        // 划水怪随缘超时 → 默认随缘 (摸1+弃牌堆1基本)
        msg["choice"] = "suiyuan";
        processResponse(pid, msg, res);
    } else if (type == "WAIT_O2_CARD") {
        clearPending(); // 超时未选AC, O2优化作废
    } else if (type == "evolution_select") {
        getPlayer(pid).evoCandidates.clear();
        clearPending();
        nextPhase();
    } else {
        clearPending();
    }
}

void Room::startResponse(const std::string& type, int target, std::vector<int> valid, json ctx) {
    pending.reset(new Pending());
    pending->type = type;
    pending->targetPlayer = target;
    pending->validCards = valid;
    pending->context = ctx;
    pending->deadline = steady_clock::now() + seconds(15);
}

void Room::checkAwakenings() {
    for (auto& p : players) {
        if (p.awakened) continue;
        if (p.profession == "萌新" && p.hp <= 2) {
            p.awakened = true; addLog(p.name + " 觉醒：我还能学！");
        }
        if (p.profession == "划水怪" && p.noDamageRounds >= 2) {
            p.awakened = true; addLog(p.name + " 觉醒：终极摸鱼");
            for (int i=0;i<3;++i) p.hand.push_back(drawCard());
        }
        // 学长·听懂了就怪了: 讲题3次后觉醒
        if (p.profession == "学长" && p.teachCount >= 3) {
            p.awakened = true; addLog("📖 " + p.name + " 觉醒：听懂了就怪了！");
            for (int i=0;i<2;++i) p.hand.push_back(drawCard());
        }
        // 评测姬·评测机之心: 测评防伤2次后觉醒
        if (p.profession == "评测姬" && p.judgeDefCount >= 2) {
            p.awakened = true; addLog("🧪 " + p.name + " 觉醒：评测机之心！");
            for (int i=0;i<2;++i) p.hand.push_back(drawCard());
        }
        // 打表狂魔·表过样例: 打表3次后觉醒
        if (p.profession == "打表狂魔" && p.tableCount >= 3) {
            p.awakened = true; addLog("📊 " + p.name + " 觉醒：表过样例！");
            for (int i=0;i<3;++i) p.hand.push_back(drawCard());
        }
        // 玄学选手·玄学优化: 玄学免伤2次后觉醒
        if (p.profession == "玄学选手" && p.judgeDefCount >= 2) {
            p.awakened = true; addLog("🔮 " + p.name + " 觉醒：玄学优化！");
            for (int i=0;i<2;++i) p.hand.push_back(drawCard());
        }
    }
}

// ----------------------------- 阶段推进 -----------------------------
void Room::nextPhase() {
    if (gameOver) { phase = GAME_OVER; return; }
    switch (phase) {
    case ROUND_START: {
        Player& p = getPlayer(currentTurn);
        p.evoCandidates.clear();
        // 摸鱼怪·颓废: 回合开始时询问玩家选择 (回复1体力 / 摸2牌 / 不使用)
        if (p.depression > 0 && !p.depressionAsked) {
            p.depressionAsked = true;
            startResponse("WAIT_DEPRESSION", p.id, {}, {});
            return; // 等待玩家响应后再继续回合
        }
        // BUG-141 修复: "每回合"被动在自己的回合开始时重置 (如玄学选手/传奇Au不败/AC保护)
        p.xuanxueUsedThisTurn = false;
        p.usedUndefeatedThisTurn = false;
        p.acBaoHuTriggered = false;
        p.yaxianThisTurn = false;
        p.coffeeUsedThisTurn = false;
        if (p.profession == "蒟蒻" && p.hand.empty()) { p.hand.push_back(drawCard()); addLog(p.name + "【抱大腿】空手摸1"); }
        if (p.profession == "退役选手" && p.hp > 1) { p.hp--; for(int i=0;i<2;++i) p.hand.push_back(drawCard()); addLog(p.name + "【挣扎】扣1血摸2"); }
        // BUG-143: 全员卡常解除判定放回合开始最后 (需求4.1第4步: 颓废/抱大腿/挣扎之后)
        if (!banWABy.empty() && p.name == banWABy) {
            banWANextTurn = false; banWABy.clear();
            addLog("全员卡常效果结束");
        }
        phase = JUDGE; nextPhase(); break;
    }
    case JUDGE: {
        Player& p = getPlayer(currentTurn);
        // v3.0: 先结算判定区延时锦囊 (UB/水群/断网)
        judgeDelayArea(p);
        phase = DRAW; nextPhase(); break;
    }
    case DRAW: {
        Player& p = getPlayer(currentTurn);
        if (p.skipDraw) {
            p.skipDraw = false;
            addLog(p.name + "【断网】跳过摸牌阶段");
            phase = PLAY;
            if (p.skipPlayRounds > 0) { p.skipPlayRounds--; phase = DISCARD; nextPhase(); }
            break;
        }
        // 划水怪·随缘 (可替换): 由玩家选择"摸1+弃牌堆1基本"或"摸2" (需求 4.3)
        if (p.profession == "划水怪") {
            bool hasBasic = false;
            for (auto& c : discard) if (c.type == BASIC_ATTACK || c.type == BASIC_DODGE || c.type == BASIC_HEAL) { hasBasic = true; break; }
            if (hasBasic) {
                startResponse("WAIT_SUIYUAN", p.id, {}, {});
                return;
            }
        }
        int drawNum = 2;
        if (p.profession == "萌新" && p.awakened) drawNum++;
        for (int i=0; i<drawNum; ++i) {
            Card dc = drawCard();
            // BUG-404: 牌堆耗尽(空卡标记), 跳过不入手牌
            if (dc.name == "__EMPTY__") { addLog(p.name + " 牌堆与弃牌堆均已耗尽，无牌可摸"); break; }
            // BUG-121: 彩蛋牌抽到即直接触发, 不进入手牌
            if (dc.type == SPECIAL_EASTER) {
                addLog("🎉 " + p.name + " 抽到彩蛋牌【" + dc.name + "】，立即生效");
                triggerEaster(p, dc);
                continue;
            }
            p.hand.push_back(dc);
        }
        addLog(p.name + " 摸 " + std::to_string(drawNum) + " 张牌");
        phase = PLAY;
        if (p.skipPlayRounds > 0) { p.skipPlayRounds--; phase = DISCARD; nextPhase(); }
        break;
    }
    case PLAY: break;
    case DISCARD: {
        Player& p = getPlayer(currentTurn);
        int limit = p.hp + p.handLimitMod + p.handLimitBonus;  // MLE: -2; 图灵奖得主: +1~+3
        if (limit < 0) limit = 0;
        while ((int)p.hand.size() > limit) discardFromHand(p, p.hand.size()-1);
        addLog(p.name + " 弃牌至 " + std::to_string(limit));
        phase = END; nextPhase(); break;
    }
    case END: {
        Player& p = getPlayer(currentTurn);
        if (p.profession == "划水怪" && p.damageDealtThisTurn == 0) {
            p.hand.push_back(drawCard());
            if (!p.hand.empty()) discardFromHand(p, p.hand.size()-1);
            addLog(p.name + "【摸鱼】摸1弃1");
        }
        // BUG-108 修复: 只按当前回合玩家结算"连续未造成伤害" (需求指自己的回合), 其他玩家仅清伤害计数
        int pDealt = p.damageDealtThisTurn;   // 先记录当前回合玩家本回合造成的伤害
        for (auto& pl : players) pl.damageDealtThisTurn = 0;
        if (pDealt == 0) p.noDamageRounds++; else p.noDamageRounds = 0;
        // ===== 进化条件结算 (需求第十章; 回合结束时判定) =====
        // 咖啡 → 浓缩咖啡: 使用咖啡后本回合造成过伤害
        if (p.coffeeUsedPlayPhase && pDealt > 0 && p.evoTotal < 3 && p.evoTurn < 1) {
            for (auto it = discard.begin(); it != discard.end(); ++it) {
                if (it->name == "咖啡" && !it->evolved) {
                    if (std::find(p.evoCandidates.begin(), p.evoCandidates.end(), it->id) == p.evoCandidates.end())
                        p.evoCandidates.push_back(it->id);
                    break;
                }
            }
        }
        // 线段树 → 主席树: 装备后连续3个自己回合造成伤害
        if (p.weapon && p.weapon->name == "线段树") {
            if (pDealt > 0) p.streakDmg++; else p.streakDmg = 0;
            if (p.streakDmg >= 3 && !p.weapon->evolved && p.evoTotal < 3 && p.evoTurn < 1) {
                if (std::find(p.evoCandidates.begin(), p.evoCandidates.end(), p.weapon->id) == p.evoCandidates.end())
                    p.evoCandidates.push_back(p.weapon->id);
            }
        } else p.streakDmg = 0;
        // 评测机连发 → 评测机超频: 装备后连续3个回合使用做法假了
        if (p.weapon && p.weapon->name == "评测机连发") {
            if (p.acUsedThisTurn > 0) p.streakAcUse++; else p.streakAcUse = 0;
            if (p.streakAcUse >= 3 && !p.weapon->evolved && p.evoTotal < 3 && p.evoTurn < 1) {
                if (std::find(p.evoCandidates.begin(), p.evoCandidates.end(), p.weapon->id) == p.evoCandidates.end())
                    p.evoCandidates.push_back(p.weapon->id);
            }
        } else p.streakAcUse = 0;
        if (p.profession == "金牌教练") {
            std::vector<int> others;
            for (auto& o : players) if (o.alive && o.id != p.id) others.push_back(o.id);
            if (!others.empty()) {
                int target = others[randInt(0, others.size()-1)];
                p.hand.push_back(drawCard()); getPlayer(target).hand.push_back(drawCard());
                addLog(p.name + "【集训】与 " + getPlayer(target).name + " 各摸1");
            }
        }
        checkAwakenings();
        if (!p.evoCandidates.empty() && p.evoTotal < 3) {
            tryEvolutionSelect(p);
            return;
        }
        int next = (currentTurn + 1) % players.size();
        while (!isAlive(next)) next = (next + 1) % players.size();
        currentTurn = next;
        roundCount++;
        Card eventCard = drawCard();
        activeEvent = (eventCard.suit == "spade") ? "毒瘤评测机" : (eventCard.suit == "club") ? "暴力评测机" :
                      (eventCard.suit == "heart") ? "慈善评测机" : "随机评测机";
        addLog("事件：" + activeEvent);
        for (auto& pl : players) {
            pl.usedSkillsThisTurn.clear(); pl.evoTurn = 0; pl.acUsedThisTurn = 0;
            pl.acLimit = 1; pl.usedUndefeatedThisTurn = false; pl.usedKangThisTurn = false;
            pl.usedAskThisTurn = false; pl.usedSkirtThisTurn = false;
            pl.akioiActive = false; pl.yanyaCountThisTurn = 0; pl.akAllActive = false;
            pl.examThisTurn = false; pl.depressionAsked = false;
            pl.skillBlocked = false; pl.handLimitMod = 0; pl.noTrickThisTurn = false;
            pl.xuanxueUsedThisTurn = false;
            // v3.0 回合重置
            pl.coffeeBoost = false; pl.yunDuanUsed = false; pl.acBaoHuTriggered = false;
            pl.yaxianThisTurn = false; pl.skipDraw = false;
            pl.coffeeUsedThisTurn = false;   // BUG-140: 咖啡每回合限1次
            pl.coffeeUsedPlayPhase = false;  // 浓缩咖啡进化条件按回合清
            pl.extraEvo = 0;                 // 系统重构: 每回合额外进化次数清空
        }
        phase = ROUND_START; nextPhase(); break;
    }
    default: break;
    }
}

void Room::tryEvolutionSelect(Player& p) {
    json cands = json::array();
    std::vector<int> foundCids;   // 仍存在的候选 (用于清理失效候选)
    for (int cid : p.evoCandidates) {
        // 候选可能位于: 弃牌堆 / 手牌 / 装备区 (装备卡原地进化, 如线段树/评测机连发/管理员权限/玄学判题/黑名单/AC保护)
        auto it = std::find_if(discard.begin(), discard.end(), [&](Card& c){ return c.id == cid; });
        std::string cname;
        if (it != discard.end()) cname = it->name;
        else {
            auto hi = std::find_if(p.hand.begin(), p.hand.end(), [&](Card& c){ return c.id == cid; });
            if (hi != p.hand.end()) cname = hi->name;
            else {
                for (auto& eq : p.equip) if (eq && eq->id == cid) { cname = eq->name; break; }
            }
        }
        if (cname.empty()) continue;   // 候选牌已不存在 → 视为失效, 不展示
        foundCids.push_back(cid);
        std::string evoName = evoMap.count(cname) ? evoMap[cname] : cname;
        cands.push_back({{"id", cid}, {"name", cname}, {"evo", evoName}});
    }
    // 清理已失效的候选, 避免残留导致每回合空弹
    for (size_t i = p.evoCandidates.size(); i-- > 0; ) {
        if (std::find(foundCids.begin(), foundCids.end(), p.evoCandidates[i]) == foundCids.end())
            p.evoCandidates.erase(p.evoCandidates.begin() + i);
    }
    if (!cands.empty()) {
        startResponse("evolution_select", p.id, {}, {{"candidates", cands}});
    } else {
        p.evoCandidates.clear();
        nextPhase();
    }
}

bool Room::useCard(int pid, int cardIdx, std::vector<int> targets, json& result) {
    Player& player = getPlayer(pid);
    if (cardIdx < 0 || cardIdx >= (int)player.hand.size()) return false;
    Card& card = player.hand[cardIdx];

    // BUG-130 修复: 进化卡名归一化为基础卡名, 使进化后的功能牌可正常使用 (效果按 evolved 标记增强)
    static const std::map<std::string,std::string> evoUnmap = {
        {"实锤","做法假了"}, {"样例全过","WA"}, {"CCF金牌","CCF捐款"}, {"WC对决","对拍"},
        {"暴力抄袭","抄袭代码"}, {"退学警告","请家长"}, {"O3优化","O2优化"}, {"主席树","线段树"},
        {"路径压缩","并查集"}, {"系统重构","重构"}, {"浓缩咖啡","咖啡"}, {"数据爆炸","数据加强"},
        {"评测机暴走","评测机抽风"}, {"一票否决","特判"}, {"模板库","手写快排"}, {"评测机超频","评测机连发"},
        {"root权限","管理员权限"}, {"剪枝优化","暴力枚举"}, {"玄学大师","玄学判题"}, {"全员拉黑","黑名单"},
        {"金牌保护","AC保护"}
    };
    auto evoIt = evoUnmap.find(card.name);
    if (evoIt != evoUnmap.end()) {
        card.name = evoIt->second;   // 归一化, evolved 标记保留用于效果增强
        card.evolved = true;
    }

    if (card.type == WEAPON || card.type == ARMOR || card.type == MOUNT_OFF || card.type == MOUNT_DEF) {
        equipCard(player, card); result["success"] = true; return true;
    }

    // BUG-147 修复: 统一目标合法性校验 (不能指定阵亡玩家; 白名单卡允许指定自己)
    if (!targets.empty()) {
        static const std::set<std::string> selfOkCards = {
            "CCF放水","题解大会","摸鱼","板子","咖啡","重构","申诉","手动测评","面向数据编程","随机种子","UB","评测机崩溃","原题大战","我样例过了！","退役失败","骗分"
        };
        bool isAoe = (card.name == "数据加强" || card.name == "评测机抽风" || card.name == "女装直播");
        if (!isAoe && !selfOkCards.count(card.name)) {
            for (int t : targets) {
                if (t < 0 || t >= (int)players.size() || !isAlive(t)) {
                    result["error"] = "无效目标（目标已阵亡或不存在）";
                    return false;
                }
            }
        }
    }

    // CE(编译错误): 本回合不能使用锦囊牌
    if (card.type == FUNC && player.noTrickThisTurn) {
        result["error"] = "被 CE（编译错误），本回合不能使用锦囊牌";
        return false;
    }

    // ===== 特判门 (需求 9.3/Q13: 普通锦囊可被受影响角色用【特判】抵消; 延时锦囊/彩蛋/装备/技能不可抵消) =====
    static const std::set<std::string> tjCounterable = {
        "对拍","爆零","停课集训","抄袭代码","请家长","O2优化","卡评测机","压轴题",
        "TLE","MLE","CE","玄学优化","代码审计","找代打","女装直播","封神"
    };
    bool tjResumed = tjResume;
    std::set<int> tjCounted = tjCountered;
    tjResume = false; tjCountered.clear();
    if (!tjResumed && card.type == FUNC && card.name != "特判" && tjCounterable.count(card.name)) {
        // 收集受影响的其他角色
        std::vector<int> tjs;
        if (targets.empty() && card.name == "女装直播") {
            for (auto& pl : players) if (pl.alive && pl.id != pid) tjs.push_back(pl.id);
        } else {
            for (int t : targets) if (t != pid && isAlive(t)) tjs.push_back(t);
        }
        int firstAsk = -1;
        for (size_t i = 0; i < tjs.size(); ++i) {
            Player& tt = getPlayer(tjs[i]);
            bool hasTj = false;
            for (auto& x : tt.hand) if (x.name == "特判" || x.name == "一票否决") { hasTj = true; break; }
            if (hasTj) { firstAsk = (int)i; break; }
        }
        if (firstAsk >= 0) {
            tjOwner = pid; tjCardIdx = cardIdx; tjTargets = tjs; tjAskPos = firstAsk;
            startResponse("WAIT_TJ", tjs[firstAsk], {}, {{"card_name", card.name}, {"owner", pid}});
            result["pending"] = "tj_gate";
            return true;
        }
    }
    if (tjResumed && !tjCounted.empty()) {
        bool multiPart = (card.name == "女装直播" || card.name == "封神");
        if (!multiPart) {
            // 单目标锦囊/找代打: 被特判抵消 → 整张锦囊失效 (锦囊仍消耗)
            addLog("⚖️ " + player.name + " 的【" + card.name + "】被特判抵消，效果失效");
            discardFromHand(player, cardIdx);
            result["success"] = true;
            return true;
        }
    }

    // 被动技能: 萌新·问问题 / 女装大佬·女装 (成为卡牌唯一目标时摸1牌, 每回合限一次)
    if (targets.size() == 1 && targets[0] != pid) {
        Player& tg = getPlayer(targets[0]);
        if (tg.profession == "萌新" && !tg.usedAskThisTurn && !gameOver) {
            tg.usedAskThisTurn = true;
            tg.hand.push_back(drawCard());
            addLog(tg.name + "【问问题】成为卡牌唯一目标，摸1牌");
        }
        if (tg.profession == "女装大佬" && !tg.usedSkirtThisTurn && card.type == FUNC && !gameOver) {
            tg.usedSkirtThisTurn = true;
            tg.hand.push_back(drawCard());
            addLog(tg.name + "【女装】成为锦囊目标，摸1牌");
        }
    }

    // 内部攻击函数（做法假了与神犇碾压）
    auto performAcAttack = [&](Card& usedCard, bool isVirtual = false) -> bool {
        if (targets.empty()) return false;
        // 提前缓存引用指向的值, 避免 discardFromHand 后悬挂引用
        int usedCardId = usedCard.id;
        bool usedCardEvolved = usedCard.evolved;
        bool usedCardBlack = usedCard.isBlack();   // 缓存, 避免discard后悬垂引用
        // 神犇觉醒·AK全场: 一张AC可指定任意数量目标(万箭齐发, 无视WA)
        bool akAll = player.akAllActive && targets.size() > 1;
        // 次数限制 (慈善评测机: 无次数; 评测机连发武器: 无次数)
        bool noLimit = (activeEvent == "慈善评测机") || (player.weapon && player.weapon->name == "评测机连发");
        if (!akAll && player.acUsedThisTurn >= player.acLimit && !noLimit) return false;
        // BUG-101/136 修复: 出杀即计次(无论是否被抵消/多目标只计1次)
        if (!akAll) player.acUsedThisTurn++;
        bool ignoreWA = (activeEvent == "毒瘤评测机"); // 毒瘤评测机: AC无视WA
        // 毒瘤出题人·卡常(每回合限一次, 判定♠才不可被闪)
        bool kachangForce = false;
        if (player.profession == "毒瘤出题人" && !player.usedKangThisTurn) {
            player.usedKangThisTurn = true;
            Card judge = drawCard();
            std::string jSuit = judge.suit;
            if (!forcedJudgeColor.empty()) { jSuit = (forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
            if (jSuit == "spade") {
                kachangForce = true;
                player.kachangSuccess++;
                addLog(player.name + "【祖传卡常】判定♠，此做法假了不可被闪 (成功" + std::to_string(player.kachangSuccess) + "次)");
                // 觉醒·全员卡常: 卡常成功2次后, 其他角色下回合不能用WA
                if (player.kachangSuccess >= 2 && !player.awakened) {
                    player.awakened = true;
                    banWANextTurn = true; banWABy = player.name;
                    addLog("⚡ " + player.name + " 觉醒：全员卡常！你的常数，我来守护！其他角色下回合不能使用WA");
                }
            } else {
                addLog(player.name + "【祖传卡常】判定" + suitEmoji(jSuit) + "，未能卡常");
            }
        }
        int baseDmg = 1;
        if (usedCardEvolved) baseDmg += 1;   // 实锤(进化做法假了): 伤害+1 (需求第十章)
        if (player.akioiActive) baseDmg += 1;   // 神犇·AKIOI: 这些杀伤害+1
        // 传奇不朽+1 已在 dealDamage 中统一结算 (所有伤害), 此处不再重复
        // BUG-137 修复: 咖啡加成作用于整张杀(所有目标), 循环外一次性消费
        bool coffeeApplied = player.coffeeBoost;
        if (player.coffeeBoost) { baseDmg += player.coffeeBoostDmg; addLog("☕ " + player.name + " 咖啡强化，伤害+" + std::to_string(player.coffeeBoostDmg)); player.coffeeBoost = false; }
        bool discarded = false;
        for (size_t ti = 0; ti < targets.size(); ++ti) {
            int tgt = targets[ti];
            if (tgt == pid || !isAlive(tgt)) continue;
            if (!akAll && !canAttack(pid, tgt)) continue;
            Player& target = getPlayer(tgt);
            int dmg = baseDmg;
            // 随机评测机: 成为AC目标时判定, 红桃=视为WA, 黑桃=伤害+1
            if (activeEvent == "随机评测机") {
                Card judge = drawCard();
                std::string jSuit = judge.suit;
                if (!forcedJudgeColor.empty()) { jSuit=(forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
                if (jSuit == "heart") { addLog(target.name + "【随机评测机】判定♥，视为使用了WA，闪避成功"); continue; }
                if (jSuit == "spade") { dmg += 1; addLog(target.name + "【随机评测机】判定♠，伤害+1"); }
            }
            // 管理员权限/root权限(无视防具)
            bool ignoreArmor = (player.weapon && (player.weapon->name == "管理员权限" || player.weapon->name == "root权限"));
            // 黑名单/全员拉黑防具: 黑色做法假了(含神犇碾压黑色牌)对你无效 (管理员权限/root权限无视防具)
            if (target.armor && (target.armor->name == "黑名单" || target.armor->name == "全员拉黑") && usedCardBlack && !ignoreArmor) {
                // 黑名单进化计数 (需求: 黑名单→全员拉黑, 防住黑色做法假了累计2次)
                if (target.armor->name == "黑名单" && !target.armor->evolved) {
                    target.blacklistBlockCount++;
                    if (target.blacklistBlockCount >= 2 && target.evoTotal < 3 && target.evoTurn < 1) {
                        if (std::find(target.evoCandidates.begin(), target.evoCandidates.end(), target.armor->id) == target.evoCandidates.end())
                            target.evoCandidates.push_back(target.armor->id);
                    }
                }
                addLog("🖤 " + target.name + "【" + target.armor->name + "】黑色做法假了对我不生效");
                continue;
            }
            std::vector<int> waCards;
            if (!kachangForce && !ignoreWA && !akAll) {
                for (size_t i=0; i<target.hand.size(); ++i) if (isWaCard(target.hand[i])) waCards.push_back((int)i);
                if (target.armor && target.armor->name == "并查集" && !ignoreArmor) {
                    for (size_t i=0; i<target.hand.size(); ++i) if (!isWaCard(target.hand[i])) waCards.push_back((int)i);
                }
                // 路径压缩(进化并查集): 弃1张与攻击牌同花色的手牌即可当WA
                if (target.armor && target.armor->name == "路径压缩" && !ignoreArmor) {
                    for (size_t i=0; i<target.hand.size(); ++i)
                        if (target.hand[i].suit == usedCard.suit) waCards.push_back((int)i);
                }
                if (target.armor && (target.armor->name == "玄学判题" || target.armor->name == "玄学大师") && !ignoreArmor) {
                    waCards.push_back(-1); // -1 表示"判定代替WA"
                }
            }
            if (!waCards.empty()) {
                // BUG-109 修复: 保存剩余目标列表, 响应结算后继续处理 (多目标攻击如放手一搏/AK全场)
                // BUG-110 修复: 保存随机评测机/其他已计算的加成, 响应后按最终伤害结算
                std::vector<int> remain;
                for (size_t rt = ti + 1; rt < targets.size(); ++rt) remain.push_back(targets[rt]);
                json ctx = {{"attacker", pid}, {"card_id", usedCardId}, {"virtual", isVirtual},
                            {"remain", remain}, {"base_dmg", baseDmg}, {"coffee_applied", coffeeApplied},
                            {"extra_dmg", dmg - baseDmg}, {"ac_suit", usedCard.suit}, {"black", usedCardBlack}};   // BUG-110 + 路径压缩同花色
                startResponse("response_wa", tgt, waCards, ctx);
                result["pending"] = "wait_response";
                return true; // 等待目标响应后由 processResponse 继续
            }
            // 冷数据武器: 造成伤害时可防止此伤害, 改为弃置目标2张牌 (可选项, 需求5.3)
            if (player.weapon && player.weapon->name == "冷数据" && dmg > 0) {
                player.yunDuanUsed = true;
                if (!isVirtual && !discarded) { discardFromHand(player, cardIdx); discarded = true; }
                std::vector<int> remain;
                for (size_t rt = ti + 1; rt < targets.size(); ++rt) remain.push_back(targets[rt]);
                json cctx = {{"target", tgt}, {"base_dmg", dmg}, {"remain", remain}};
                startResponse("WAIT_COLD_DATA", pid, {}, cctx);
                result["pending"] = "cold_data";
                return true; // 等待攻击者选择
            }
            // 直接命中
            if (!isVirtual && !discarded) { discardFromHand(player, cardIdx); discarded = true; }
            dealDamage(player, target, dmg, true);
            // 树状数组看牌
            if (player.weapon && player.weapon->name == "树状数组") {
                json view; for (auto& c : target.hand) view.push_back(c.symbol());
                result["view_hand"] = {{"target", tgt}, {"cards", view}};
            }
            // 双指针武器: 命中后按手牌数摸/弃 (需求: 多于→摸1; 少于→弃1; 相等无事发生)
            if (player.weapon && player.weapon->name == "双指针") {
                if ((int)target.hand.size() > (int)player.hand.size()) {
                    player.hand.push_back(drawCard());
                    addLog(player.name + "【双指针】目标手牌更多，你摸1张");
                } else if ((int)target.hand.size() < (int)player.hand.size() && !target.hand.empty()) {
                    discardFromHand(target, (int)target.hand.size()-1);
                    addLog(target.name + "【双指针】手牌更少，弃1张");
                }
            }
            // 拔网线武器: 命中弃置目标1张坐骑
            if (player.weapon && player.weapon->name == "拔网线") {
                Card* mount = target.mount_off ? target.mount_off : target.mount_def;
                if (mount) {
                    auto mit = std::find_if(target.equip.begin(), target.equip.end(), [&](std::unique_ptr<Card>& c){ return c && c->id==mount->id; });
                    if (mit != target.equip.end()) { discardCard(**mit); target.equip.erase(mit);
                        (mount==target.mount_off? target.mount_off : target.mount_def) = nullptr; }
                    addLog("🕸️ " + player.name + "【拔网线】弃置 " + target.name + " 的坐骑");
                }
            }
            if (dmg > 0 && player.evoTotal < 3 && player.evoTurn < 1 && !usedCardEvolved) {
                if (isVirtual) {
                    if (usedCard.name == "做法假了") {
                        // 手写快排/模板库打出的虚拟AC命中 → 进化候选指向武器本体 (需求: 手写快排→模板库)
                        if (std::find(player.evoCandidates.begin(), player.evoCandidates.end(), usedCardId) == player.evoCandidates.end())
                            player.evoCandidates.push_back(usedCardId);
                    } else {
                        // BUG-142 修复: 碾压(虚拟AC)命中 → 进化候选指向弃牌堆的【做法假了】, 而非底层黑色牌
                        auto acDisc = std::find_if(discard.begin(), discard.end(), [](Card& c){ return c.name == "做法假了" && !c.evolved; });
                        if (acDisc != discard.end() &&
                            std::find(player.evoCandidates.begin(), player.evoCandidates.end(), acDisc->id) == player.evoCandidates.end())
                            player.evoCandidates.push_back(acDisc->id);
                    }
                } else {
                    player.evoCandidates.push_back(usedCardId);
                }
            }
            // 莫队算法: 命中后可额外攻击另一名可攻击目标 (可选项, 需求5.3)
            if (player.weapon && player.weapon->name == "莫队算法" && dmg > 0) {
                std::vector<int> validExtra;
                for (auto& p : players) if (p.alive && p.id != tgt && canAttack(pid, p.id)) validExtra.push_back(p.id);
                if (!validExtra.empty()) {
                    std::vector<int> remain;
                    for (size_t rt = ti + 1; rt < targets.size(); ++rt) remain.push_back(targets[rt]);
                    json mctx = {{"target", tgt}, {"valid", validExtra}, {"base_dmg", dmg}, {"remain", remain}};
                    startResponse("WAIT_MODUI", pid, {}, mctx);
                    result["pending"] = "modui";
                    return true; // 等待攻击者选择是否额外攻击
                }
            }
        }
        if (akAll) {
            player.akAllActive = false;
            addLog("⚡ " + player.name + "【AK全场】万箭齐发！我不是在虐菜，是在出数据。");
        }
        result["success"] = true;
        return true;
    };

    // 做法假了
    if (card.name == "做法假了") {
        // 神犇觉醒·AK全场: 下一张做法假了可指定任意数量目标
        if (player.akAllActive && targets.size() > 1) {
            // 任意数量目标
        }
        // 放手一搏(方天画戟): 若此AC是你最后1张手牌, 可指定至多3名角色
        else if (player.weapon && player.weapon->name == "放手一搏" && (int)player.hand.size() == 1) {
            if (targets.empty() || targets.size() > 3) return false;
        } else if (targets.size() != 1) {
            return false;
        }
        return performAcAttack(card, false);
    }
    // 神犇碾压 (黑色牌当做法假了; 非AK全场时只能指定1名目标)
    if (player.profession == "神犇" && card.isBlack() && card.name != "做法假了") {
        if (!player.akAllActive && targets.size() != 1) {
            result["error"] = "碾压只能指定1名目标（觉醒AK全场后可指定任意数量）";
            return false;
        }
        player.yanyaCountThisTurn++;
        addLog(player.name + "【碾压】将 " + card.symbol() + " 当作AC使用 (本回合" + std::to_string(player.yanyaCountThisTurn) + "张)");
        // 觉醒·AK全场: 同一回合碾压打出2张以上AC
        if (player.yanyaCountThisTurn >= 2 && !player.awakened) {
            player.awakened = true;
            player.akAllActive = true;
            addLog("⚡ " + player.name + " 觉醒：AK全场！本回合下一张AC可指定任意数量目标");
        }
        return performAcAttack(card, true);
    }
    // WA: 只能作为攻击响应打出, 不能在出牌阶段直接使用
    if (card.name == "WA" || card.name == "样例全过") {
        result["error"] = "【WA】是闪避牌，只能在被【做法假了】攻击时打出响应，不能在出牌阶段使用";
        return false;
    }
    // CCF捐款 (进化CCF金牌: 回复2并摸1; 需求第十章修订: 累计使用3次)
    if (card.name == "CCF捐款") {
        bool cEvo = card.evolved;
        int cId = card.id;
        if (player.hp == player.max_hp) { result["error"] = "体力已满，无法使用【CCF捐款】"; return false; }
        discardFromHand(player, cardIdx);
        int heal = cEvo ? 2 : 1;
        player.hp = std::min(player.max_hp, player.hp + heal);
        if (cEvo) {
            player.hand.push_back(drawCard());
            addLog("🏅 " + player.name + " 使用【CCF金牌】回复2点体力并摸1张（捐款到位，金牌到手）");
        } else {
            addLog("💸 " + player.name + " 使用【CCF捐款】回复1点体力（向CCF捐款换1分）");
            // 进化条件: 累计使用3次 → CCF金牌
            player.ccfDonateCount++;
            if (player.ccfDonateCount >= 3 && player.evoTotal < 3 && player.evoTurn < 1) {
                if (std::find(player.evoCandidates.begin(), player.evoCandidates.end(), cId) == player.evoCandidates.end())
                    player.evoCandidates.push_back(cId);
            }
        }
        result["success"] = true; return true;
    }
    // 摸鱼
    if (card.name == "摸鱼") {
        discardFromHand(player, cardIdx);
        for(int i=0;i<2;++i) player.hand.push_back(drawCard());
        addLog(player.name + " 使用摸鱼摸2牌");
        result["success"] = true; return true;
    }
    // 对拍（完整互怼）
    if (card.name == "对拍") {
        if (targets.size() != 1) return false;
        int tgt = targets[0];
        bool duelEvo = card.evolved;   // WC对决: 败者受2伤
        discardFromHand(player, cardIdx);
        // 先检查发起者手中是否有AC (含进化实锤)
        auto selfAC = std::find_if(player.hand.begin(), player.hand.end(), isAcCard);
        if (selfAC == player.hand.end()) {
            // 发起者无AC，直接受伤 (WC对决: 2伤)
            dealDamage(getPlayer(tgt), player, duelEvo ? 2 : 1, false, true);
            addLog(player.name + " 对拍无AC，受到" + std::to_string(duelEvo ? 2 : 1) + "点伤害");
            result["success"] = true; return true;
        }
        // 发起者有AC，要求其选择一张AC打出 (BUG-126: 记录对拍卡id用于获胜进化候选)
        std::vector<int> acIdxs;
        for (size_t i=0; i<player.hand.size(); ++i) if (isAcCard(player.hand[i])) acIdxs.push_back(i);
        json ctx = {{"target", tgt}, {"initiator", pid}, {"duel_card", card.id}};
        startResponse("WAIT_DUEL_SELF", pid, acIdxs, ctx);
        result["pending"] = "duel_self_ac";
        return true;
    }
    // 请家长
    if (card.name == "请家长") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        bool jEvo = card.evolved;   // 退学警告: 目标额外弃1张手牌, 否则受1点伤害
        discardFromHand(player, cardIdx);
        if (target.weapon || target.armor || target.mount_off || target.mount_def) {
            Card* eq = target.weapon ? target.weapon : target.armor ? target.armor :
                       target.mount_off ? target.mount_off : target.mount_def;
            auto it = std::find_if(target.equip.begin(), target.equip.end(), [&](std::unique_ptr<Card>& c){ return c && c->id==eq->id; });
            if (it != target.equip.end()) {
                if (eq->type == ARMOR) loseArmorEffect(target, **it);
                discardCard(**it); target.equip.erase(it);
                (eq==target.weapon ? target.weapon : eq==target.armor ? target.armor :
                 eq==target.mount_off ? target.mount_off : target.mount_def) = nullptr;
                addLog(target.name + " 被请家长弃置装备");
                // 退学警告(进化): 目标额外弃1张手牌, 否则受1点伤害 (需求第十章)
                if (jEvo) {
                    if (!target.hand.empty()) {
                        discardFromHand(target, (int)target.hand.size()-1);
                        addLog("⚠️ " + target.name + "【退学警告】额外弃1张手牌");
                    } else {
                        dealDamage(player, target, 1, false, true);
                        addLog("⚠️ " + target.name + "【退学警告】无手牌可弃，受到1点伤害");
                    }
                }
                if (player.evoTotal<3 && player.evoTurn<1 && !jEvo) player.evoCandidates.push_back(card.id);
            }
        } else {
            dealDamage(player, target, 1, false, true);
        }
        result["success"] = true; return true;
    }
    // O2优化: 先检查手中有无可打出的做法假了, 再弃牌 (避免无AC时白丢)
    if (card.name == "O2优化") {
        std::vector<int> acIdxs;
        for (size_t i=0; i<player.hand.size(); ++i) {
            if (isAcCard(player.hand[i]) || (player.profession=="神犇"&&player.hand[i].isBlack())) acIdxs.push_back(i);
        }
        if (acIdxs.empty()) { result["error"] = "手中没有【做法假了】可用（O2优化落空）"; return false; }
        bool o2Evo = card.evolved;   // O3优化: 伤害+2且无视距离
        discardFromHand(player, cardIdx);
        json o2ctx = {{"o2_evolved", o2Evo}};
        startResponse("WAIT_O2_CARD", pid, acIdxs, o2ctx);
        result["pending"] = "select_o2_card"; return true;
    }
    // 传奇Au封神
    if (card.name == "封神" && player.profession == "传奇Au选手" && !player.usedSealThisGame) {
        if (targets.empty() || targets.size()>2) return false;
        discardFromHand(player, cardIdx);
        player.usedSealThisGame = true;
        // 被特判抵消的目标不受影响 (需求 9.3)
        for (int t : targets) if (isAlive(t) && !tjCounted.count(t)) dealDamage(player, getPlayer(t), 1, false, true);
        // 觉醒·传奇不朽: 首次使用封神后, 本局剩余时间所有伤害+1
        if (!player.awakened) {
            player.awakened = true;
            player.bossDmgBoost = true;
            addLog("⚡ " + player.name + " 觉醒：传奇不朽！本局剩余时间造成的所有伤害+1");
        }
        addLog(player.name + "【封神】造成伤害");
        result["success"] = true; return true;
    }
    // 女装大佬直播
    if (card.name == "直播" && player.profession == "女装大佬") {
        if (targets.size()!=1) return false;
        int redIdx = -1;
        for (size_t i=0;i<player.hand.size();++i) if (player.hand[i].isRed()) { redIdx = i; break; }
        if (redIdx < 0) return false;
        discardFromHand(player, redIdx);
        startResponse("WAIT_LIVE_TARGET", pid, {}, {{"target", targets[0]}});
        result["pending"] = "live_steal"; return true;
    }
    // 毒瘤出原题
    if (card.name == "出原题" && player.profession == "毒瘤出题人") {
        if (targets.size()!=1) return false;
        discardFromHand(player, cardIdx);
        Player& target = getPlayer(targets[0]);
        if (!target.hand.empty()) {
            int idx = randInt(0, target.hand.size()-1);
            discardFromHand(target, idx);
            target.hand.push_back(drawCard());
            addLog(player.name + "【出原题】弃置 " + target.name + " 一张手牌，其摸1");
        }
        result["success"] = true; return true;
    }
    // 停课集训
    if (card.name == "停课集训") {
        if (targets.size()!=1) return false;
        discardFromHand(player, cardIdx);
        getPlayer(targets[0]).skipPlayRounds = 1;
        addLog(getPlayer(targets[0]).name + " 下回合跳过出牌");
        result["success"] = true; return true;
    }
    // 爆零: 弃置目标一张手牌
    if (card.name == "爆零") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        if (!target.hand.empty()) {
            int idx = randInt(0, (int)target.hand.size()-1);
            discardFromHand(target, idx);
            addLog(target.name + " 被爆零，弃置一张手牌");
        } else { addLog(target.name + " 无手牌可弃，爆零落空"); }
        result["success"] = true; return true;
    }
    // 抄袭代码: 获得目标一张装备牌(无装备则偷手牌); 进化后=暴力抄袭(偷任意一张)
    if (card.name == "抄袭代码") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        bool evolved = card.evolved;
        discardFromHand(player, cardIdx);
        bool stole = false;
        if (!target.hand.empty() && (evolved || target.equip.empty())) {
            int idx = randInt(0, (int)target.hand.size()-1);
            player.hand.push_back(target.hand[idx]);
            addLog(player.name + (evolved?"【暴力抄袭】":"【抄袭代码】") + "获得 " + target.name + " 的手牌 " + target.hand[idx].symbol());
            target.hand.erase(target.hand.begin()+idx);
            stole = true;
        } else if (!target.equip.empty()) {
            int idx = randInt(0, (int)target.equip.size()-1);
            Card eq = *target.equip[idx];
            if (target.weapon && target.weapon->id == eq.id) target.weapon = nullptr;
            if (target.armor && target.armor->id == eq.id) target.armor = nullptr;
            if (target.mount_off && target.mount_off->id == eq.id) target.mount_off = nullptr;
            if (target.mount_def && target.mount_def->id == eq.id) target.mount_def = nullptr;
            if (eq.type == ARMOR) loseArmorEffect(target, eq);
            target.equip.erase(target.equip.begin()+idx);
            // BUG-135 修复: 自己已有同类装备时先弃置旧的 (含离场效果), 再装备偷来的
            Card* ownSlot = eq.type==WEAPON?player.weapon:eq.type==ARMOR?player.armor:eq.type==MOUNT_OFF?player.mount_off:player.mount_def;
            if (ownSlot) {
                auto oit = std::find_if(player.equip.begin(), player.equip.end(), [&](std::unique_ptr<Card>& c){ return c && c->id==ownSlot->id; });
                if (oit != player.equip.end()) {
                    if (eq.type == ARMOR) loseArmorEffect(player, **oit);
                    discardCard(**oit);
                    player.equip.erase(oit);
                }
            }
            player.equip.push_back(std::unique_ptr<Card>(new Card(eq)));
            Card* eqRef = player.equip.back().get();
            if (eqRef->type==WEAPON) player.weapon=eqRef;
            else if (eqRef->type==ARMOR) player.armor=eqRef;
            else if (eqRef->type==MOUNT_OFF) player.mount_off=eqRef;
            else if (eqRef->type==MOUNT_DEF) player.mount_def=eqRef;
            addLog(player.name + "【抄袭代码】获得 " + target.name + " 的装备 " + eq.name);
            stole = true;
        } else { addLog(player.name + " 抄袭代码落空，目标无牌可偷"); }
        if (stole && player.evoTotal<3 && player.evoTurn<1 && !evolved) player.evoCandidates.push_back(card.id);
        result["success"] = true; return true;
    }
    // 重构: 从弃牌堆获得一张牌; 系统重构(进化): 从弃牌堆选1张牌进化加入手牌, 本回合可额外进化1次
    if (card.name == "重构") {
        bool rEvo = card.evolved;
        discardFromHand(player, cardIdx);
        if (rEvo) {
            // 系统重构 (需求第十章): 从弃牌堆选1张牌进化并加入手牌 (简化: 自动取第一张可进化牌)
            player.extraEvo++;   // 本回合可额外进化1次
            for (auto it = discard.begin(); it != discard.end(); ++it) {
                if (evoMap.count(it->name) && !it->evolved && it->name != "重构") {
                    Card ev = *it;
                    ev.name = evoMap[ev.name]; ev.evolved = true; ev.id = nextCardId++;
                    discard.erase(it);
                    player.hand.push_back(ev);
                    player.evoTotal++;
                    addLog("🔧 " + player.name + "【系统重构】从弃牌堆进化出 " + ev.name);
                    break;
                }
            }
        } else if (!discard.empty()) {
            int idx = randInt(0, (int)discard.size()-1);
            Card got = discard[idx];
            discard.erase(discard.begin()+idx);
            player.hand.push_back(got);
            addLog(player.name + "【重构】从弃牌堆获得 " + got.symbol());
            if (player.evoTotal<3 && player.evoTurn<1) player.evoCandidates.push_back(card.id);
        } else { addLog("弃牌堆为空，重构落空"); }
        result["success"] = true; return true;
    }
    // 模拟赛 (金牌教练专属): 目标必须打出AC否则受1伤 (逐个询问)
    if (card.name == "模拟赛" && player.profession == "金牌教练" && !player.examThisTurn) {
        if (targets.size()>3) return false;   // BUG-149: 允许空选 (至多3名)
        discardFromHand(player, cardIdx);
        player.examThisTurn = true;
        std::vector<int> valid;
        for (int t : targets) if (isAlive(t) && t != pid) valid.push_back(t);
        if (valid.empty()) { result["success"] = true; return true; }
        json ctx = {{"exam_targets", valid}, {"exam_idx", 0}, {"owner", pid}};
        Player& first = getPlayer(valid[0]);
        std::vector<int> acIdxs;
        for (size_t i=0;i<first.hand.size();++i) if (isAcCard(first.hand[i])) acIdxs.push_back(i);
        startResponse("WAIT_EXAM_AC", valid[0], acIdxs, ctx);
        result["pending"] = "exam_ac";
        return true;
    }
    // 女装直播 (女装大佬专属): 所有角色摸1, 其他角色弃1, 你获得其中一张 (被特判抵消的角色不受影响)
    if (card.name == "女装直播" && player.profession == "女装大佬") {
        discardFromHand(player, cardIdx);
        for (auto& p : players) if (p.alive && !tjCounted.count(p.id)) p.hand.push_back(drawCard());
        std::vector<Card> dropped;
        for (auto& p : players) {
            if (p.alive && p.id != pid && !tjCounted.count(p.id) && !p.hand.empty()) {
                int di = randInt(0, (int)p.hand.size()-1);
                dropped.push_back(p.hand[di]);
                addLog(p.name + " 弃置 " + p.hand[di].symbol());
                p.hand.erase(p.hand.begin()+di);
            }
        }
        if (!dropped.empty()) {
            int pick = randInt(0, (int)dropped.size()-1);
            Card got = dropped[pick];
            player.hand.push_back(got);
            // BUG-120 修复: 其余被弃置的牌进弃牌堆 (不凭空消失)
            for (size_t di = 0; di < dropped.size(); ++di) {
                if ((int)di != pick) discardCard(dropped[di]);
            }
            addLog(player.name + "【女装直播】获得 " + got.symbol() + "，其余" + std::to_string((int)dropped.size()-1) + "张进弃牌堆");
        }
        addLog("📺 " + player.name + " 直播女装，在线发牌！");
        result["success"] = true; return true;
    }
    // 手动测评: 弃1牌, 选择下一次判定花色为红/黑
    if (card.name == "手动测评") {
        discardFromHand(player, cardIdx);
        startResponse("WAIT_JUDGE_COLOR", pid, {}, {});
        result["pending"] = "judge_color";
        return true;
    }
    // 评测机崩溃 (彩蛋): 弃牌堆AC移回牌堆重洗, 所有玩家失去1体力
    if (card.name == "评测机崩溃") {
        discardFromHand(player, cardIdx);
        int moved = 0;
        for (size_t i = discard.size(); i-- > 0; ) {
            if (discard[i].name == "做法假了") { deck.push_back(discard[i]); discard.erase(discard.begin()+i); moved++; }
        }
        shuffleDeck();
        addLog("💥 Ctrl+C 都救不了你们！评测机崩溃，" + std::to_string(moved) + "张AC被移回牌堆");
        for (auto& p : players) if (p.alive) dealDamage(player, p, 1, false, true);
        result["success"] = true; return true;
    }
    // 女装求AC (彩蛋): 目标必须给你一张手牌, 否则你回复1体力
    if (card.name == "女装求AC") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        if (!target.hand.empty()) {
            int idx = randInt(0, (int)target.hand.size()-1);
            player.hand.push_back(target.hand[idx]);
            addLog(target.name + " 被女装求AC，给了 " + player.name + " 一张手牌 " + target.hand[idx].symbol());
            target.hand.erase(target.hand.begin()+idx);
        } else {
            player.hp = std::min(player.max_hp, player.hp+1);
            addLog(target.name + " 无手牌可给，" + player.name + " 回复1体力");
        }
        result["success"] = true; return true;
    }
    // 彩蛋牌
    if (card.name == "我样例过了！") {
        discardFromHand(player, cardIdx);
        bool hasAC = std::any_of(player.hand.begin(), player.hand.end(), isAcCard);
        if (!hasAC) { for(int i=0;i<2;++i) player.hand.push_back(drawCard()); addLog(player.name + " 样例过了，摸2牌"); }
        else {
            auto it = std::find_if(player.hand.begin(), player.hand.end(), isAcCard);
            discardFromHand(player, it - player.hand.begin());
            addLog(player.name + " 弃置一张做法假了");
        }
        result["success"] = true; return true;
    }
    if (card.name == "原题大战") {
        discardFromHand(player, cardIdx);
        for (auto& p : players) {
            if (!p.alive || p.hand.empty()) continue;
            auto maxIt = std::max_element(p.hand.begin(), p.hand.end(), [](Card& a, Card& b){ return a.number < b.number; });
            addLog(p.name + " 弃置 " + maxIt->symbol());
            discardFromHand(p, maxIt - p.hand.begin());
        }
        result["success"] = true; return true;
    }
    if (card.name == "学长讲题") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        for(int i=0;i<2;++i) target.hand.push_back(drawCard());
        auto waIt = std::find_if(discard.begin(), discard.end(), [](Card& c){ return c.name == "WA"; });
        if (waIt != discard.end()) { player.hand.push_back(*waIt); discard.erase(waIt); }
        else { player.hand.push_back(drawCard()); }
        addLog(player.name + " 使用学长讲题，目标摸2，自己得WA");
        result["success"] = true; return true;
    }
    if (card.name == "退役失败") {
        discardFromHand(player, cardIdx);
        for (auto& p : players) {
            if (!p.alive) continue;
            if (p.hp == 1) { p.hp = std::min(p.max_hp, 2); addLog(p.name + " 回复1体力"); }
            else if (p.hp == p.max_hp) { dealDamage(player, p, 1, false, true); addLog(p.name + " 受到1点伤害"); }
        }
        result["success"] = true; return true;
    }
    // ===== 新增: 评测机裁决牌 =====
    // TLE: 目标本回合不能使用主动技能
    if (card.name == "TLE") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        target.skillBlocked = true;
        addLog("⏱️ " + target.name + " 被 TLE！本回合不能使用主动技能");
        result["success"] = true; return true;
    }
    // MLE: 目标本回合手牌上限-2
    if (card.name == "MLE") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        target.handLimitMod = -2;
        addLog("🧠 " + target.name + " 被 MLE！本回合手牌上限-2");
        result["success"] = true; return true;
    }
    // CE: 目标本回合不能使用锦囊牌
    if (card.name == "CE") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        target.noTrickThisTurn = true;
        addLog("💢 " + target.name + " 被 CE（编译错误）！本回合不能使用锦囊牌");
        result["success"] = true; return true;
    }
    // 骗分: 回复1点体力
    if (card.name == "骗分") {
        if (player.hp == player.max_hp) { result["error"] = "体力已满，无法使用【骗分】"; return false; }
        discardFromHand(player, cardIdx);
        player.hp = std::min(player.max_hp, player.hp+1);
        addLog(player.name + " 使用骗分，回复1点体力（骗到1分）");
        result["success"] = true; return true;
    }
    // 申诉: 从弃牌堆获得1张牌
    if (card.name == "申诉") {
        discardFromHand(player, cardIdx);
        if (!discard.empty()) {
            int idx = randInt(0, (int)discard.size()-1);
            Card got = discard[idx];
            discard.erase(discard.begin()+idx);
            player.hand.push_back(got);
            addLog(player.name + "【申诉】从弃牌堆找回了 " + got.symbol());
        } else { addLog("弃牌堆为空，申诉失败"); }
        result["success"] = true; return true;
    }
    // 玄学优化: 目标摸2张
    if (card.name == "玄学优化") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        target.hand.push_back(drawCard());
        target.hand.push_back(drawCard());
        addLog("🔮 " + target.name + " 获得玄学优化，摸2张（玄不改命，改的是数据）");
        result["success"] = true; return true;
    }
    // 卡评测机: 目标受1点不可闪避伤害 (锦囊效果, 触发传奇Au不败)
    if (card.name == "卡评测机") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        dealDamage(player, target, 1, false, true);
        addLog("💥 评测机被 " + player.name + " 卡死，" + target.name + " 受到1点不可闪避伤害");
        result["success"] = true; return true;
    }
    // 板子: 摸2张并回复1点体力
    if (card.name == "板子") {
        discardFromHand(player, cardIdx);
        player.hand.push_back(drawCard());
        player.hand.push_back(drawCard());
        if (player.hp < player.max_hp) { player.hp = std::min(player.max_hp, player.hp+1); addLog(player.name + " 掏出模板，摸2回1"); }
        else addLog(player.name + " 掏出模板，摸2张");
        result["success"] = true; return true;
    }
    // 压轴题: 目标摸1张再弃1张
    if (card.name == "压轴题") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        target.hand.push_back(drawCard());
        if (!target.hand.empty()) discardFromHand(target, (int)target.hand.size()-1);
        addLog(target.name + " 被压轴题难住，摸1弃1（压轴题只能写第一问）");
        result["success"] = true; return true;
    }
    // 面向数据编程 (彩蛋): 所有存活角色各摸1张
    if (card.name == "面向数据编程") {
        discardFromHand(player, cardIdx);
        for (auto& p : players) if (p.alive) p.hand.push_back(drawCard());
        addLog("📊 数据太水了！面向数据编程，所有角色各摸1张");
        result["success"] = true; return true;
    }
    // 随机种子 (彩蛋): 摸2张再随机弃1张
    if (card.name == "随机种子") {
        discardFromHand(player, cardIdx);
        player.hand.push_back(drawCard());
        player.hand.push_back(drawCard());
        if (!player.hand.empty()) discardFromHand(player, randInt(0, (int)player.hand.size()-1));
        addLog("🎲 " + player.name + " 随机种子发威，摸2弃1（玄学不可控）");
        result["success"] = true; return true;
    }
    // ===================== v3.0 新锦囊 =====================
    // 咖啡: 本回合下一张做法假了伤害+1; 或濒死自救(在useCard中仅出牌阶段使用)
    if (card.name == "咖啡") {
        bool cEvo = card.evolved;
        discardFromHand(player, cardIdx);
        player.coffeeBoost = true;
        player.coffeeBoostDmg = cEvo ? 2 : 1;
        addLog("☕ " + player.name + " 使用咖啡，本回合下一张做法假了伤害+" + std::to_string(player.coffeeBoostDmg) + "（咖啡续命）");
        // 进化条件: 使用咖啡后本回合造成过伤害 → 浓缩咖啡 (在回合结束判定, 此处仅标记)
        if (!cEvo) player.coffeeUsedPlayPhase = true;
        result["success"] = true; return true;
    }
    // 数据加强 (南蛮入侵): AOE, 全员出做法假了否则1伤
    if (card.name == "数据加强") {
        bool aoeEvo = card.evolved;   // 先缓存, 避免弃牌后悬垂引用
        discardFromHand(player, cardIdx);
        startAoe(pid, "数据加强", aoeEvo ? 2 : 1);
        result["success"] = true; return true;
    }
    // 评测机抽风 (万箭齐发): AOE, 全员出WA否则1伤
    if (card.name == "评测机抽风") {
        bool aoeEvo2 = card.evolved;
        discardFromHand(player, cardIdx);
        startAoe(pid, "评测机抽风", aoeEvo2 ? 2 : 1);
        result["success"] = true; return true;
    }
    // CCF放水 (桃园结义): 全员回复1
    if (card.name == "CCF放水") {
        discardFromHand(player, cardIdx);
        for (auto& p : players) if (p.alive && p.hp < p.max_hp) p.hp++;
        addLog("💧 CCF 放水！所有角色回复1点体力");
        result["success"] = true; return true;
    }
    // 题解大会 (五谷丰登): 翻开等同存活人数张牌, 从自己开始轮流选1张 (BUG-122: 改为玩家选择)
    if (card.name == "题解大会") {
        discardFromHand(player, cardIdx);
        std::vector<int> alive;
        for (auto& p : players) if (p.alive) alive.push_back(p.id);
        int n = (int)alive.size();
        json revealedJ = json::array();
        std::vector<Card> revealed;
        for (int i=0;i<n;++i) { Card c = drawCard(); if (c.name == "__EMPTY__") break; revealed.push_back(c); revealedJ.push_back(c.symbol()); }
        addLog("📚 题解大会！翻开 " + std::to_string((int)revealed.size()) + " 张牌，轮流选题解");
        // 从使用者开始按行动顺序选 (BUG-122: 逐人发pending选择)
        int startIdx = -1;
        for (size_t i=0;i<alive.size();++i) if (alive[i]==pid) { startIdx=(int)i; break; }
        // 保存题解大会状态到Room (用于多轮选牌)
        harvestPlayers = alive;
        harvestStart = startIdx;
        harvestStep = 0;
        harvestCards = revealed;
        if (harvestCards.empty()) { result["success"] = true; return true; }
        // 发给第一个玩家选 (BUG-122: context携带可选牌符号供前端渲染)
        int firstP = harvestPlayers[harvestStart % (int)harvestPlayers.size()];
        json harvestInfo = json::array();
        for (size_t i=0;i<harvestCards.size();++i) harvestInfo.push_back(harvestCards[i].symbol());
        json ctx = {{"harvest_owner", pid}, {"harvest_cards", harvestInfo}};
        startResponse("WAIT_HARVEST", firstP, {}, ctx);
        result["pending"] = "harvest";
        return true;
    }
    // 特判 (无懈可击): 反制锦囊, 只能在锦囊结算时响应使用 (如AOE结算时抵消)
    if (card.name == "特判") {
        result["error"] = "【特判】只能在锦囊结算时响应使用（如【数据加强】【评测机抽风】结算时抵消），不能在出牌阶段单独打出";
        return false;
    }
    // 找代打 (借刀杀人): 令一名装备武器的角色对其攻击范围内另一名角色使用AC, 否则获得其武器
    if (card.name == "找代打") {
        if (targets.size()!=2) { result["error"] = "请选择 持械角色 与 攻击目标"; return false; }
        int armed = targets[0], victim = targets[1];
        Player& armedP = getPlayer(armed);
        if (!armedP.weapon) { result["error"] = "目标没有武器"; return false; }
        if (!canAttack(armed, victim)) { result["error"] = "攻击目标不在其攻击范围内"; return false; }
        discardFromHand(player, cardIdx);
        // 持械者若有AC(含实锤), 自动对其使用 (BUG-113: 受害方可有WA响应窗口)
        auto acIt = std::find_if(armedP.hand.begin(), armedP.hand.end(), isAcCard);
        if (acIt != armedP.hand.end()) {
            Card ac = *acIt;
            armedP.hand.erase(acIt); discardCard(ac);
            addLog(armedP.name + "【找代打】被迫对 " + getPlayer(victim).name + " 使用做法假了");
            // 受害方WA响应 (含样例全过/并查集/路径压缩)
            std::vector<int> waCards;
            Player& vp = getPlayer(victim);
            for (size_t i=0; i<vp.hand.size(); ++i) if (isWaCard(vp.hand[i])) waCards.push_back((int)i);
            if (vp.armor && vp.armor->name == "并查集")
                for (size_t i=0; i<vp.hand.size(); ++i) if (!isWaCard(vp.hand[i])) waCards.push_back((int)i);
            if (vp.armor && vp.armor->name == "路径压缩")
                for (size_t i=0; i<vp.hand.size(); ++i) if (vp.hand[i].suit == ac.suit) waCards.push_back((int)i);
            if (!waCards.empty()) {
                startResponse("WAIT_DAIDANG_WA", victim, waCards, {{"attacker", armed}, {"ac_suit", ac.suit}});
                result["pending"] = "daidang_wa";
                return true;  // 等待受害方响应
            }
            dealDamage(armedP, getPlayer(victim), 1, true);
        } else {
            // 不使用者, 你获得其武器 (违反5.4: 获得武器时若已有武器需先弃旧装备)
            Card* w = armedP.weapon;
            auto wit = std::find_if(armedP.equip.begin(), armedP.equip.end(), [&](std::unique_ptr<Card>& c){ return c && c->id==w->id; });
            if (wit != armedP.equip.end()) {
                Card got = **wit;
                armedP.equip.erase(wit);
                armedP.weapon = nullptr;
                if (player.weapon) {
                    auto oit = std::find_if(player.equip.begin(), player.equip.end(), [&](std::unique_ptr<Card>& c){ return c && c->id==player.weapon->id; });
                    if (oit != player.equip.end()) { discardCard(**oit); player.equip.erase(oit); }
                    player.weapon = nullptr;
                }
                player.equip.push_back(std::unique_ptr<Card>(new Card(got)));
                player.weapon = player.equip.back().get();
                addLog("🎮 " + player.name + "【找代打】获得 " + armedP.name + " 的武器 " + got.name);
            }
        }
        result["success"] = true; return true;
    }
    // 链式前向星 (铁索连环): 横置至多2名角色; 可重铸(弃此牌摸1) BUG-117
    if (card.name == "链式前向星") {
        if (targets.empty()) {
            // BUG-117 修复: 重铸 - 弃此牌摸1 (无目标时)
            discardFromHand(player, cardIdx);
            player.hand.push_back(drawCard());
            addLog(player.name + " 重铸链式前向星，弃此牌摸1张");
            result["success"] = true; return true;
        }
        if (targets.size()>2) { result["error"] = "选择1~2名角色"; return false; }
        discardFromHand(player, cardIdx);
        for (int t : targets) {
            if (!isAlive(t)) continue;
            Player& tg = getPlayer(t);
            tg.chained = !tg.chained;
            addLog("🔗 " + tg.name + (tg.chained ? " 被链式前向星横置！" : " 被重置"));
        }
        result["success"] = true; return true;
    }
    // 代码审计 (火攻): 目标展示1张手牌, 你弃1张同花色手牌则造成1伤
    if (card.name == "代码审计") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        if (target.hand.empty()) { discardFromHand(player, cardIdx); addLog("目标无手牌，代码审计落空"); result["success"]=true; return true; }
        discardFromHand(player, cardIdx);
        startResponse("WAIT_AUDIT_REVEAL", targets[0], {}, {{"owner", pid}});
        result["pending"] = "audit_reveal";
        return true;
    }
    // 延时锦囊: UB/水群/断网 → 挂入目标判定区
    if (card.name == "UB" || card.name == "水群" || card.name == "断网") {
        if (card.name == "UB" && targets.empty()) targets.push_back(pid); // 闪电默认挂自己判定区
        if (targets.size()!=1) { result["error"] = "请选择1名目标"; return false; }
        int tgt = targets[0];
        if (!isAlive(tgt)) return false;
        Player& tg = getPlayer(tgt);
        // UB: 只能放在自己判定区 (闪电规则)
        if (card.name == "UB" && tgt != pid) { result["error"] = "UB只能放在自己的判定区（闪电）"; return false; }
        // 移除手中卡并复制到判定区
        Card d = card;
        d.id = nextCardId++;
        discardFromHand(player, cardIdx);
        tg.delayArea.push_back(d);
        if (card.name == "UB") addLog("⚡ " + player.name + " 将【UB】放在自己判定区（未定义行为，随时可能爆炸）");
        else if (card.name == "水群") addLog("💧 " + tg.name + " 被【水群】挂起，可能跳过出牌阶段");
        else addLog("📡 " + tg.name + " 被【断网】挂起，可能跳过摸牌阶段");
        result["success"] = true; return true;
    }
    // 手写快排 (丈八蛇矛): 将2张手牌当做法假了使用; 模板库(进化)只需1张。
    // 走完整攻击流程: 目标可打出【WA】闪避、黑名单可免疫、事件/进化正常结算
    if (card.name == "手写快排" || card.name == "模板库") {
        if (targets.size()!=1) return false;
        int need = (card.name == "模板库") ? 1 : 2;
        if ((int)player.hand.size() < need) { result["error"] = "手牌不足，无法当做法假了使用"; return false; }
        // 先拷贝字段再弃牌, 避免悬垂引用
        int vcId = card.id; std::string vcSuit = card.suit; int vcNum = card.number;
        std::string vcName = card.name;
        discardFromHand(player, cardIdx);
        for (int i=1;i<need;++i) discardFromHand(player, (int)player.hand.size()-1);
        Card virtualAc(vcId, "做法假了", vcSuit, vcNum, BASIC_ATTACK);
        // 虚拟AC不携带 evolved 标记: 模板库效果是"1张手牌即可当做法假了", 不应获得实锤的伤害+1
        virtualAc.evolved = false;
        addLog("⚡ " + player.name + "【" + (vcName=="模板库"?"模板库":"手写快排") + "】将" + std::to_string(need) + "张手牌当做法假了使用");
        return performAcAttack(virtualAc, true);
    }
    // 其他未实现卡牌
    result["error"] = "未实现的卡牌";
    return false;
}

// 房间满员时调用: 回收所有牌重新洗入牌堆, 重置玩家状态并重新发4张初始手牌,
// 对局从第1轮正式开始 (修复: 未满员前不允许出牌, 满员后才开始公平对局)
void Room::resetForStart() {
    // 回收手牌/装备/弃牌堆回牌堆
    for (auto& p : players) {
        for (auto& c : p.hand) deck.push_back(c);
        p.hand.clear();
        for (auto& eq : p.equip) deck.push_back(*eq);
        p.equip.clear();
    }
    for (auto& c : discard) deck.push_back(c);
    discard.clear();
    shuffleDeck();
    // 重置所有玩家状态并重新发4张
    for (auto& p : players) {
        p.weapon = p.armor = p.mount_off = p.mount_def = nullptr;
        p.hp = p.max_hp;
        p.alive = true;
        p.depression = (p.identity == "摸鱼怪") ? 3 : 0;
        p.awakened = false;
        p.noDamageRounds = 0;
        p.damageDealtThisTurn = 0;
        p.skipPlayRounds = 0;
        p.retireUsed = false;
        p.preventDamageCount = 0;
        p.usedMentor = false;
        p.liveViewCount = 0;
        p.usedSealThisGame = false;
        p.evoCandidates.clear();
        p.evoTotal = 0;
        p.evoTurn = 0;
        p.acUsedThisTurn = 0;
        p.acLimit = 1;
        p.usedUndefeatedThisTurn = false;
        p.usedKangThisTurn = false;
        p.usedSkillsThisTurn.clear();
        p.bossDmgBoost = false;
        p.usedAskThisTurn = false;
        p.usedSkirtThisTurn = false;
        p.akioiActive = false;
        p.yanyaCountThisTurn = 0;
        p.akAllActive = false;
        p.kachangSuccess = 0;
        p.examThisTurn = false;
        p.depressionAsked = false;
        // v3.0 重置
        p.delayArea.clear();
        p.chained = false;
        p.coffeeBoost = false;
        p.coffeeBoostDmg = 1;
        p.kouhaiCount = p.chaotijieCount = p.yaxianCount = p.shuiqunCount = p.baolingCount = 0;
        p.usedDianjiThisGame = false;
        p.yaxianThisTurn = false;
        p.handLimitBonus = (p.profession == "图灵奖得主") ? 1 : 0;
        p.yunDuanUsed = false;
        p.acBaoHuTriggered = false;
        p.skipDraw = false;
        // 进化条件计数重置
        p.streakDmg = p.streakAcUse = 0;
        p.adminHitCount = p.xuanxueJudgeCount = p.blacklistBlockCount = p.unionFindBlockCount = 0;
        p.coffeeUsedPlayPhase = false;
        p.extraEvo = 0;
        p.ccfDonateCount = 0;
        for (int i = 0; i < 4; ++i) p.hand.push_back(drawCard());
    }
    currentTurn = 0;
    roundCount = 1;
    activeEvent = "?";
    pending.reset();
    gameOver = false;
    winner.clear();
    log.clear();
    phase = ROUND_START;
    addLog("房间满员，游戏开始！");
    nextPhase();
}

// 主动技能: 神犇·AKIOI / 毒瘤出题人·出原题
bool Room::useSkill(int pid, const std::string& skill, const json& msg, json& result) {
    Player& player = getPlayer(pid);
    if (!player.alive) { result["error"] = "已阵亡，无法使用技能"; return false; }
    // TLE: 被超时封印, 本回合不能使用主动技能
    if (player.skillBlocked) { result["error"] = "被 TLE，本回合不能使用主动技能"; return false; }
    // 学长·讲题: 弃1牌, 让一名其他角色摸1张
    if (skill == "jiangti" && player.profession == "学长") {
        if (player.usedSkillsThisTurn.count("jiangti")) { result["error"] = "本回合已使用过讲题"; return false; }
        if ((int)player.hand.size() < 1) { result["error"] = "手牌不足1张"; return false; }
        std::vector<int> tg;
        if (msg.contains("targets") && msg["targets"].is_array()) {
            json tar = msg["targets"];
            for (size_t i=0;i<tar.size();++i) tg.push_back((int)tar[i]);
        }
        if (tg.empty() || !isAlive(tg[0]) || tg[0] == pid) { result["error"] = "请选择有效目标"; return false; }
        player.usedSkillsThisTurn.insert("jiangti");
        discardFromHand(player, (int)player.hand.size()-1);
        getPlayer(tg[0]).hand.push_back(drawCard());
        player.teachCount++;
        addLog("📖 " + player.name + "【讲题】" + getPlayer(tg[0]).name + " 摸1张（听懂了就怪了，" + std::to_string(player.teachCount) + "次）");
        result["success"] = true; return true;
    }
    // 评测姬·重测: 弃1牌, 摸1张再弃1张
    if (skill == "ceping" && player.profession == "评测姬") {
        if (player.usedSkillsThisTurn.count("ceping")) { result["error"] = "本回合已使用过重测"; return false; }
        if ((int)player.hand.size() < 1) { result["error"] = "手牌不足1张"; return false; }
        player.usedSkillsThisTurn.insert("ceping");
        discardFromHand(player, (int)player.hand.size()-1);
        player.hand.push_back(drawCard());
        if (!player.hand.empty()) discardFromHand(player, (int)player.hand.size()-1);
        addLog("🧪 " + player.name + "【重测】摸1弃1（评测姬重新测评你的代码）");
        result["success"] = true; return true;
    }
    // 打表狂魔·打表: 弃2牌, 摸4张
    if (skill == "dabiao" && player.profession == "打表狂魔") {
        if (player.usedSkillsThisTurn.count("dabiao")) { result["error"] = "本回合已使用过打表"; return false; }
        if ((int)player.hand.size() < 2) { result["error"] = "手牌不足2张"; return false; }
        player.usedSkillsThisTurn.insert("dabiao");
        discardFromHand(player, (int)player.hand.size()-1);
        discardFromHand(player, (int)player.hand.size()-1);
        for (int i=0;i<4;++i) player.hand.push_back(drawCard());
        player.tableCount++;
        addLog("📊 " + player.name + "【打表】弃2摸4（表过样例，" + std::to_string(player.tableCount) + "次）");
        result["success"] = true; return true;
    }
    // 神犇·AKIOI: 弃2牌, 本回合可额外使用两张AC, 且这些杀伤害+1
    if (skill == "akioi" && player.profession == "神犇") {
        if (player.usedSkillsThisTurn.count("akioi")) { result["error"] = "本回合已使用过AKIOI"; return false; }
        if ((int)player.hand.size() < 2) { result["error"] = "手牌不足2张，无法使用AKIOI"; return false; }
        player.usedSkillsThisTurn.insert("akioi");
        discardFromHand(player, (int)player.hand.size()-1);
        discardFromHand(player, (int)player.hand.size()-1);
        player.acLimit += 2;
        player.akioiActive = true;
        addLog("⚡ " + player.name + "【AKIOI】弃2牌，本回合可额外使用2张AC且伤害+1");
        result["success"] = true;
        return true;
    }
    // 毒瘤出题人·出原题: 弃两张同花色, 观看并弃置目标一张手牌, 其摸1
    if (skill == "chuyuanti" && player.profession == "毒瘤出题人") {
        if (player.usedSkillsThisTurn.count("chuyuanti")) { result["error"] = "本回合已使用过出原题"; return false; }
        std::map<std::string,int> suitCount;
        for (auto& c : player.hand) suitCount[c.suit]++;
        std::string pickSuit;
        for (auto& kv : suitCount) if (kv.second >= 2) { pickSuit = kv.first; break; }
        if (pickSuit.empty()) { result["error"] = "需要弃两张同花色的手牌"; return false; }
        // BUG-125 修复: 先校验目标再弃牌
        std::vector<int> tg;
        if (msg.contains("targets") && msg["targets"].is_array()) {
            json tar = msg["targets"];
            for (size_t i=0;i<tar.size();++i) tg.push_back((int)tar[i]);
        }
        if (tg.empty() || !isAlive(tg[0]) || tg[0] == pid) { result["error"] = "请选择有效目标"; return false; }
        int discarded = 0;
        for (size_t i = 0; i < player.hand.size() && discarded < 2; ) {
            if (player.hand[i].suit == pickSuit) { discardFromHand(player, (int)i); discarded++; }
            else ++i;
        }
        player.usedSkillsThisTurn.insert("chuyuanti");
        Player& target = getPlayer(tg[0]);
        if (!target.hand.empty()) {
            int idx = randInt(0, (int)target.hand.size()-1);
            discardFromHand(target, idx);
            target.hand.push_back(drawCard());
            addLog(player.name + "【出原题】弃置 " + target.name + " 一张手牌，其摸1");
        } else { addLog(player.name + "【出原题】" + target.name + " 无手牌"); }
        result["success"] = true;
        return true;
    }
    // 女装大佬·直播: 弃一张红色牌, 观看一名角色手牌并获取其中一张
    if (skill == "zhibo" && player.profession == "女装大佬") {
        if (player.usedSkillsThisTurn.count("zhibo")) { result["error"] = "本回合已使用过直播"; return false; }
        int redIdx = -1;
        for (size_t i=0;i<player.hand.size();++i) if (player.hand[i].isRed()) { redIdx = (int)i; break; }
        if (redIdx < 0) { result["error"] = "需要弃一张红色手牌"; return false; }
        // BUG-125 修复: 先校验目标再弃牌
        std::vector<int> tg;
        if (msg.contains("targets") && msg["targets"].is_array()) {
            json tar = msg["targets"];
            for (size_t i=0;i<tar.size();++i) tg.push_back((int)tar[i]);
        }
        if (tg.empty() || !isAlive(tg[0]) || tg[0] == pid) { result["error"] = "请选择有效目标"; return false; }
        discardFromHand(player, redIdx);
        player.usedSkillsThisTurn.insert("zhibo");
        addLog("📺 " + player.name + "【直播】观看 " + getPlayer(tg[0]).name + " 的手牌");
        startResponse("WAIT_LIVE_TARGET", pid, {}, {{"target", tg[0]}});
        result["pending"] = "live_steal";
        return true;
    }
    // ===== v3.0 新职业技能 =====
    // 键盘侠·口嗨: 弃1牌, 令目标弃1张手牌 (觉醒后可指定2名)
    if (skill == "kouhai" && player.profession == "键盘侠") {
        if (player.usedSkillsThisTurn.count("kouhai")) { result["error"] = "本回合已使用过口嗨"; return false; }
        if (player.hand.empty()) { result["error"] = "手牌不足"; return false; }
        std::vector<int> tg;
        if (msg.contains("targets") && msg["targets"].is_array()) {
            json tar = msg["targets"];
            for (size_t i=0;i<tar.size();++i) tg.push_back((int)tar[i]);
        }
        int maxT = player.awakened ? 2 : 1;
        if (tg.empty() || (int)tg.size() > maxT) { result["error"] = "请选择1~" + std::to_string(maxT) + "名目标"; return false; }
        for (int t : tg) if (!isAlive(t) || t==pid) { result["error"] = "无效目标"; return false; }
        player.usedSkillsThisTurn.insert("kouhai");
        discardFromHand(player, (int)player.hand.size()-1);
        for (int t : tg) {
            Player& tt = getPlayer(t);
            if (!tt.hand.empty()) { discardFromHand(tt, (int)tt.hand.size()-1); addLog("⌨️ " + tt.name + " 被口嗨，弃1张手牌"); }
            else addLog("⌨️ " + tt.name + " 无手牌可弃");
        }
        player.kouhaiCount++;
        addLog("⌨️ " + player.name + "【口嗨】网络对线！(累计" + std::to_string(player.kouhaiCount) + "次)");
        if (player.kouhaiCount >= 3 && !player.awakened) {
            player.awakened = true;
            addLog("💬 " + player.name + " 觉醒：网络暴力！口嗨可指定两名角色");
            for (int i=0;i<2;++i) player.hand.push_back(drawCard());
        }
        result["success"] = true; return true;
    }
    // 抄题解选手·抄题解: 弃1牌, 观看牌堆顶3张取1张 (觉醒后看4取2)
    if (skill == "chaotijie" && player.profession == "抄题解选手") {
        if (player.usedSkillsThisTurn.count("chaotijie")) { result["error"] = "本回合已使用过抄题解"; return false; }
        if (player.hand.empty()) { result["error"] = "手牌不足"; return false; }
        player.usedSkillsThisTurn.insert("chaotijie");
        discardFromHand(player, (int)player.hand.size()-1);
        // BUG-122 修复: 观看牌堆顶并玩家选择 (不再随机)
        int look = player.awakened ? 4 : 3;
        int take = player.awakened ? 2 : 1;
        std::vector<Card> top;
        for (int i=0;i<look && !deck.empty();++i) { Card c = drawCard(); if (c.name == "__EMPTY__") break; top.push_back(c); }
        if (top.empty()) { addLog(player.name + " 牌堆为空，抄题解落空"); player.chaotijieCount++; result["success"]=true; return true; }
        json topInfo = json::array();
        for (auto& c : top) topInfo.push_back(c.symbol());
        startResponse("WAIT_CHAOTIJIE", pid, {}, {{"take", take}, {"cards", topInfo}});
        result["pending"] = "chaotijie_pick";
        return true;   // 选牌与觉醒在 processResponse WAIT_CHAOTIJIE 处理
        if (player.chaotijieCount >= 3 && !player.awakened) {
            player.awakened = true;
            addLog("📋 " + player.name + " 觉醒：Ctrl+C！抄题解可看4取2");
            for (int i=0;i<3;++i) player.hand.push_back(drawCard());
        }
        result["success"] = true; return true;
    }
    // 水群怪·水群: 弃1牌, 摸2再弃1 (觉醒后摸3)
    if (skill == "shuiqun" && player.profession == "水群怪") {
        if (player.usedSkillsThisTurn.count("shuiqun")) { result["error"] = "本回合已使用过水群"; return false; }
        if (player.hand.empty()) { result["error"] = "手牌不足"; return false; }
        player.usedSkillsThisTurn.insert("shuiqun");
        discardFromHand(player, (int)player.hand.size()-1);
        player.hand.push_back(drawCard());
        player.hand.push_back(drawCard());
        // BUG-134 修复: 觉醒后水群仍为摸2弃1 (觉醒奖励在觉醒时一次性摸3)
        if (!player.hand.empty()) discardFromHand(player, (int)player.hand.size()-1);
        player.shuiqunCount++;
        addLog("💧 " + player.name + "【水群】刷屏中！(累计" + std::to_string(player.shuiqunCount) + "次)");
        if (player.shuiqunCount >= 3 && !player.awakened) {
            player.awakened = true;
            addLog("🐉 " + player.name + " 觉醒：龙王！水群摸3张");
            for (int i=0;i<3;++i) player.hand.push_back(drawCard());
        }
        result["success"] = true; return true;
    }
    // 爆零选手·爆零: 弃1牌, 目标弃1张手牌 或 受1伤 (觉醒后伤害+1)
    if (skill == "baoling" && player.profession == "爆零选手") {
        if (player.usedSkillsThisTurn.count("baoling")) { result["error"] = "本回合已使用过爆零"; return false; }
        if (player.hand.empty()) { result["error"] = "手牌不足"; return false; }
        std::vector<int> tg;
        if (msg.contains("targets") && msg["targets"].is_array()) {
            json tar = msg["targets"];
            for (size_t i=0;i<tar.size();++i) tg.push_back((int)tar[i]);
        }
        if (tg.empty() || !isAlive(tg[0]) || tg[0]==pid) { result["error"] = "请选择有效目标"; return false; }
        player.usedSkillsThisTurn.insert("baoling");
        discardFromHand(player, (int)player.hand.size()-1);
        Player& tt = getPlayer(tg[0]);
        std::string mode = msg.value("mode", "discard");
        if (mode == "damage") {
            int d = player.awakened ? 2 : 1;
            dealDamage(player, tt, d, false, true);
            addLog("💥 " + player.name + "【爆零】令 " + tt.name + " 受到" + std::to_string(d) + "点伤害");
        } else {
            if (!tt.hand.empty()) { discardFromHand(tt, (int)tt.hand.size()-1); addLog("💥 " + tt.name + " 被爆零，弃1张手牌"); }
            else addLog("💥 " + tt.name + " 无手牌可弃，爆零落空");
        }
        player.baolingCount++;
        if (player.baolingCount >= 3 && !player.awakened) {
            player.awakened = true;
            addLog("💥 " + player.name + " 觉醒：稳定爆零！爆零伤害+1");
            for (int i=0;i<2;++i) player.hand.push_back(drawCard());
        }
        result["success"] = true; return true;
    }
    // 图灵奖得主·奠基 (限定技): 本局手牌上限+2
    if (skill == "dianji" && player.profession == "图灵奖得主") {
        if (player.usedDianjiThisGame) { result["error"] = "奠基已使用（限定技）"; return false; }
        player.usedDianjiThisGame = true;
        player.handLimitBonus += 2;
        if (!player.awakened) {
            player.awakened = true;
            addLog("🏆 " + player.name + " 觉醒：图灵机！奠基成功");
            for (int i=0;i<2;++i) player.hand.push_back(drawCard());
        }
        addLog("🏆 " + player.name + "【奠基】图灵完备！手牌上限+2（共+" + std::to_string(1+player.handLimitBonus) + "）");
        result["success"] = true; return true;
    }
    result["error"] = "未知技能";
    return false;
}

bool Room::processResponse(int pid, const json& msg, json& result) {
    if (!pending || pending->targetPlayer != pid) return false;
    std::string type = pending->type;
    // ===== v3.0 AOE 响应: 数据加强(出AC) / 评测机抽风(出WA) =====
    if (type == "AOE_AC" || type == "AOE_WA") {
        Player& tg = getPlayer(pid);
        int owner = pending->context["owner"];
        int cIdx = msg.value("card_index", -2);
        // 特判抵消 (前端传 card_index=-3 表示用特判; 含进化一票否决)
        if (cIdx == -3) {
            auto tj = std::find_if(tg.hand.begin(), tg.hand.end(), [](Card& x){ return x.name == "特判" || x.name == "一票否决"; });
            if (tj != tg.hand.end()) {
                bool tjEvo = tj->evolved;
                if (!tjEvo && tg.evoTotal < 3 && tg.evoTurn < 1) {
                    if (std::find(tg.evoCandidates.begin(), tg.evoCandidates.end(), tj->id) == tg.evoCandidates.end())
                        tg.evoCandidates.push_back(tj->id);  // 一票否决进化候选
                }
                discardFromHand(tg, (int)(tj - tg.hand.begin()));
                // 一票否决(进化特判): 抵消后你摸1张
                if (tjEvo) {
                    tg.hand.push_back(drawCard());
                    addLog("🗳️ " + tg.name + "【一票否决】抵消锦囊后摸1张");
                }
            }
            addLog("⚖️ " + tg.name + " 使用特判抵消【" + std::string(pending->context["aoe"]) + "】对自己的效果");
            clearPending();
            stepAoe();
            result["success"]=true; return true;
        }
        bool dodged = false;
        if (type == "AOE_AC") {
            // 打出做法假了响应 (含进化实锤, 或手写快排 -2)
            if (cIdx >= 0 && cIdx < (int)tg.hand.size() && isAcCard(tg.hand[cIdx])) {
                discardFromHand(tg, cIdx); dodged = true;
                addLog(tg.name + " 打出做法假了响应【数据加强】");
            } else if (cIdx == -2 && tg.weapon && (tg.weapon->name=="手写快排"||tg.weapon->name=="模板库") && !tg.hand.empty()) {
                discardFromHand(tg, (int)tg.hand.size()-1); dodged = true;
                addLog(tg.name + " 使用武器响应【数据加强】");
            }
        } else {
            // 打出WA (含样例全过 / 并查集弃牌 / 玄学判题判定 -1)
            if (cIdx == -1 && tg.armor && (tg.armor->name=="玄学判题"||tg.armor->name=="玄学大师")) {
                Card judge = drawCard();
                std::string jSuit = judge.suit;
                if (!forcedJudgeColor.empty()) { jSuit=(forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
                bool pass = (jSuit=="heart") || (tg.armor->name=="玄学大师" && jSuit=="diamond");
                addLog("🔮 " + tg.name + "【玄学判题】判定" + suitEmoji(jSuit) + (pass?"，视为打出WA！":"，判定失败"));
                // 玄学判题进化计数 (需求: 玄学判题→玄学大师, 判定成功累计2次)
                if (pass && tg.armor->name == "玄学判题" && !tg.armor->evolved && tg.evoTotal < 3 && tg.evoTurn < 1) {
                    tg.xuanxueJudgeCount++;
                    if (tg.xuanxueJudgeCount >= 2) {
                        if (std::find(tg.evoCandidates.begin(), tg.evoCandidates.end(), tg.armor->id) == tg.evoCandidates.end())
                            tg.evoCandidates.push_back(tg.armor->id);
                    }
                }
                if (pass) dodged = true;
            } else if (cIdx >= 0 && cIdx < (int)tg.hand.size()) {
                Card& wc = tg.hand[cIdx];
                bool wcSample = (wc.name == "样例全过");
                bool isUF = (tg.armor && tg.armor->name=="并查集" && !isWaCard(wc));
                if (isWaCard(wc) || isUF) {
                    discardFromHand(tg, cIdx); dodged = true;
                    // 样例全过(进化WA): 抵消后摸1张并回复1点体力
                    if (wcSample) {
                        tg.hand.push_back(drawCard());
                        tg.hp = std::min(tg.max_hp, tg.hp + 1);
                        addLog("✅ " + tg.name + "【样例全过】抵消后摸1张并回复1点体力");
                    }
                    addLog(tg.name + (isUF?" 弃牌当闪响应【评测机抽风】":(wcSample?" 打出样例全过响应【评测机抽风】":" 打出WA响应【评测机抽风】")));
                }
            }
        }
        if (!dodged) {
            int dmg = pending->context.contains("dmg") ? (int)pending->context["dmg"] : 1;
            dealDamage(getPlayer(owner), tg, dmg, false, true);
            addLog(tg.name + " 未能响应【" + std::string(pending->context["aoe"]) + "】，受到" + std::to_string(dmg) + "点伤害");
        }
        clearPending();
        stepAoe();
        result["success"]=true; return true;
    }
    // BUG-111: 强制命中武器选择 (攻击者决定是否弃牌强制命中)
    if (type == "WAIT_FORCE_HIT") {
        Player& att = getPlayer(pid);
        int tgt = pending->context["target"];
        int cost = pending->context["cost"];
        bool doForce = msg.value("force", false);
        if (doForce && (int)att.hand.size() >= cost) {
            for (int i=0;i<cost;++i) discardFromHand(att, (int)att.hand.size()-1);
            addLog(att.name + "【" + std::string(pending->context["weapon"]) + "】弃" + std::to_string(cost) + "牌强制命中！");
            // base_dmg 已含 实锤+1/AKIOI/咖啡加成 (沿用攻击时的计算)
            int dmg = pending->context.value("base_dmg", 1);
            dealDamage(att, getPlayer(tgt), dmg, true);
        } else {
            addLog(att.name + " 放弃强制命中");
        }
        {
            json savedCtx = pending->context;
            clearPending();
            resolveAcRemaining(pid, savedCtx);
        }
        result["success"]=true; return true;
    }
    // BUG-111: 不死心 - 被闪后可选择再攻击
    if (type == "WAIT_BU_SI_XIN") {
        Player& att = getPlayer(pid);
        int tgt = pending->context["target"];
        bool reAttack = msg.value("force", false);
        if (reAttack) {
            auto nxtAC = std::find_if(att.hand.begin(), att.hand.end(), isAcCard);
            if (nxtAC != att.hand.end()) {
                bool nxtEvo = nxtAC->evolved;
                Card nxt = *nxtAC;
                att.hand.erase(nxtAC); discardCard(nxt);
                addLog(att.name + "【不死心】被闪后再出1张做法假了！");
                int dmg = 1; if (att.akioiActive) dmg+=1;
                if (nxtEvo) dmg += 1;   // 实锤+1
                dealDamage(att, getPlayer(tgt), dmg, true);
            }
        } else {
            addLog(att.name + " 放弃不死心追击");
        }
        {
            json savedCtx = pending->context;
            clearPending();
            resolveAcRemaining(pid, savedCtx);
        }
        result["success"]=true; return true;
    }
    // BUG-122: 抄题解 - 玩家选择要取的牌
    if (type == "WAIT_CHAOTIJIE") {
        Player& cur = getPlayer(pid);
        int take = pending->context.value("take", 1);
        json cardList = pending->context["cards"];
        // 收集玩家选择的索引 (card_index 为 -1 表示放弃/自动)
        std::vector<int> chosenIdxs;
        if (msg.contains("card_index")) {
            int ci = msg.value("card_index", -1);
            if (ci >= 0 && ci < (int)cardList.size()) chosenIdxs.push_back(ci);
        }
        if (msg.contains("card_idxs") && msg["card_idxs"].is_array()) {
            for (auto& v : msg["card_idxs"]) { int x = (int)v; if (x >= 0 && x < (int)cardList.size()) chosenIdxs.push_back(x); }
        }
        // 未选择足够时自动补
        // 由于牌已从牌堆抽出(在 context 的符号中), 需要重新取牌实现
        // 简化方案: 重新从牌堆取 look 张 (与之前一致), 玩家选择后取走
        // 这里用重新摸牌方式: 因为 pending 无法保存 Card 对象, 我们重新抽
        int look = take == 2 ? 4 : 3;
        std::vector<Card> top;
        for (int i=0;i<look && !deck.empty();++i) { Card c = drawCard(); if (c.name=="__EMPTY__") break; top.push_back(c); }
        if (top.empty()) { addLog(cur.name + " 牌堆为空"); clearPending(); result["success"]=true; return true; }
        std::vector<int> picks = chosenIdxs;
        // 取前 take 个有效索引
        int taken = 0;
        std::vector<size_t> toErase;
        for (int idx : picks) {
            if (taken >= take || idx >= (int)top.size()) continue;
            cur.hand.push_back(top[idx]);
            addLog("📋 " + cur.name + "【抄题解】取走 " + top[idx].symbol());
            toErase.push_back((size_t)idx);
            taken++;
        }
        // 不足 take 张时按顺序补
        for (size_t i=0; i<top.size() && taken < take; ++i) {
            if (std::find(toErase.begin(), toErase.end(), i) != toErase.end()) continue;
            cur.hand.push_back(top[i]);
            addLog("📋 " + cur.name + "【抄题解】取走 " + top[i].symbol());
            toErase.push_back(i);
            taken++;
        }
        for (size_t i = top.size(); i-- > 0; ) {
            if (std::find(toErase.begin(), toErase.end(), i) == toErase.end()) discardCard(top[i]);
        }
        cur.chaotijieCount++;
        if (cur.chaotijieCount >= 3 && !cur.awakened) {
            cur.awakened = true;
            addLog("📋 " + cur.name + " 觉醒：Ctrl+C！抄题解可看4取2");
            for (int i=0;i<3;++i) cur.hand.push_back(drawCard());
        }
        clearPending();
        result["success"]=true; return true;
    }
    // BUG-122: 题解大会 - 玩家选1张牌
    if (type == "WAIT_HARVEST") {
        int cIdx = msg.value("card_index", -1);
        Player& cur = getPlayer(pid);
        if (cIdx >= 0 && cIdx < (int)harvestCards.size()) {
            cur.hand.push_back(harvestCards[cIdx]);
            addLog(cur.name + " 从题解大会选择了 " + harvestCards[cIdx].symbol());
            harvestCards.erase(harvestCards.begin() + cIdx);
        } else {
            // 放弃选择(自动取最后一张)
            if (!harvestCards.empty()) {
                cur.hand.push_back(harvestCards.back());
                addLog(cur.name + " 从题解大会获得了 " + harvestCards.back().symbol());
                harvestCards.pop_back();
            }
        }
        harvestStep++;
        // 下一位
        if (harvestStep < (int)harvestPlayers.size() && !harvestCards.empty()) {
            int nextP = harvestPlayers[(harvestStart + harvestStep) % (int)harvestPlayers.size()];
            startResponse("WAIT_HARVEST", nextP, {}, {});
            result["pending"] = "harvest";
            return true;
        }
        // 剩余牌进弃牌堆
        for (auto& c : harvestCards) discardCard(c);
        harvestCards.clear(); harvestPlayers.clear();
        clearPending();
        result["success"]=true; return true;
    }
    // 找代打 - 受害方WA响应 (BUG-113)
    if (type == "WAIT_DAIDANG_WA") {
        int cardIdx = msg.value("card_index", -1);
        Player& v = getPlayer(pid);
        int attId = pending->context["attacker"];
        // 特判抵消找代打 (需求 9.3: 特判可抵消普通锦囊)
        if (cardIdx == -3) {
            auto tj = std::find_if(v.hand.begin(), v.hand.end(), [](Card& x){ return x.name == "特判" || x.name == "一票否决"; });
            if (tj != v.hand.end()) {
                bool tjEvo = tj->evolved;
                if (!tjEvo && v.evoTotal < 3 && v.evoTurn < 1) {
                    if (std::find(v.evoCandidates.begin(), v.evoCandidates.end(), tj->id) == v.evoCandidates.end())
                        v.evoCandidates.push_back(tj->id);
                }
                discardFromHand(v, (int)(tj - v.hand.begin()));
                if (tjEvo) { v.hand.push_back(drawCard()); addLog("🗳️ " + v.name + "【一票否决】抵消找代打后摸1张"); }
                addLog("⚖️ " + v.name + " 使用特判抵消【找代打】，免受攻击");
                clearPending(); result["success"]=true; return true;
            }
        }
        if (cardIdx >= 0 && cardIdx < (int)v.hand.size()) {
            Card& wc = v.hand[cardIdx];
            bool wcSample = (wc.name == "样例全过");
            bool isUF = false;
            if (!isWaCard(wc) && v.armor) {
                if (v.armor->name == "并查集") isUF = true;
                else if (v.armor->name == "路径压缩") {
                    std::string acSuit = pending->context.value("ac_suit", std::string(""));
                    if (wc.suit == acSuit) isUF = true;
                    else { addLog(v.name + "【路径压缩】需弃与攻击牌同花色的手牌"); return false; }
                }
            }
            if (isWaCard(wc) || isUF) {
                discardFromHand(v, cardIdx);
                if (wcSample) { v.hand.push_back(drawCard()); v.hp = std::min(v.max_hp, v.hp + 1); addLog("✅ " + v.name + "【样例全过】抵消后摸1张并回复1点体力"); }
                addLog(v.name + (isUF ? " 弃牌当闪响应找代打" : " 使用WA响应找代打"));
                clearPending(); result["success"]=true; return true;
            }
        }
        // 放弃闪避 → 受1伤
        dealDamage(getPlayer(attId), v, 1, true);
        addLog(v.name + " 未能响应找代打，受到1点伤害");
        clearPending(); result["success"]=true; return true;
    }
    // ===== 特判门响应: 目标选择是否用特判抵消普通锦囊 (需求 9.3/Q13) =====
    if (type == "WAIT_TJ") {
        int cIdx = msg.value("card_index", -1);
        Player& tg = getPlayer(pid);
        std::string cardName = pending->context.value("card_name", std::string("锦囊"));
        if (cIdx == -3) {
            auto tj = std::find_if(tg.hand.begin(), tg.hand.end(), [](Card& x){ return x.name == "特判" || x.name == "一票否决"; });
            if (tj != tg.hand.end()) {
                bool tjEvo = tj->evolved;
                int tjId = tj->id;
                if (!tjEvo && tg.evoTotal < 3 && tg.evoTurn < 1) {
                    if (std::find(tg.evoCandidates.begin(), tg.evoCandidates.end(), tjId) == tg.evoCandidates.end())
                        tg.evoCandidates.push_back(tjId);  // 一票否决进化候选
                }
                discardFromHand(tg, (int)(tj - tg.hand.begin()));
                if (tjEvo) { tg.hand.push_back(drawCard()); addLog("🗳️ " + tg.name + "【一票否决】抵消锦囊后摸1张"); }
                addLog("⚖️ " + tg.name + " 使用特判抵消【" + cardName + "】");
                tjCountered.insert(pid);
            }
        }
        // 询问下一位持有特判的目标
        int nextAsk = -1;
        for (size_t i = tjAskPos + 1; i < tjTargets.size(); ++i) {
            Player& t2 = getPlayer(tjTargets[i]);
            bool hasTj = false;
            for (auto& x : t2.hand) if (x.name == "特判" || x.name == "一票否决") { hasTj = true; break; }
            if (hasTj) { nextAsk = (int)i; break; }
        }
        if (nextAsk >= 0) {
            tjAskPos = nextAsk;
            startResponse("WAIT_TJ", tjTargets[nextAsk], {},
                          {{"card_name", cardName}, {"owner", pending->context.value("owner", -1)}});
            result["pending"] = "tj_gate";
            return true;
        }
        // 全部询问完毕: 恢复执行原锦囊 (带 tjResume 标记跳过特判门)
        int owner = pending->context.value("owner", -1);
        std::vector<int> origTargets = tjTargets;
        int origIdx = tjCardIdx;
        json res2;
        clearPending();
        if (owner >= 0 && owner < (int)players.size() && isAlive(owner) &&
            origIdx >= 0 && origIdx < (int)getPlayer(owner).hand.size()) {
            tjResume = true;
            useCard(owner, origIdx, origTargets, res2);
        } else {
            res2["error"] = "特判门恢复失败";
        }
        result = res2;
        return true;
    }
    // ===== 冷数据: 攻击者选择 防止伤害改弃2张 / 正常造成伤害 (需求5.3"可") =====
    if (type == "WAIT_COLD_DATA") {
        bool convert = msg.value("force", false);
        json ctx = pending->context;
        int tgt = ctx.value("target", -1);
        int dmg = ctx.value("base_dmg", 1);
        Player& att = getPlayer(pid);
        if (convert && tgt >= 0 && isAlive(tgt)) {
            Player& target = getPlayer(tgt);
            int discardCount = 0;
            for (int di = 0; di < 2 && !target.hand.empty(); ++di) {
                discardFromHand(target, (int)target.hand.size()-1); discardCount++;
            }
            addLog("🧊 " + att.name + "【冷数据】防止伤害，弃置 " + target.name + " " + std::to_string(discardCount) + " 张牌");
        } else if (tgt >= 0 && isAlive(tgt)) {
            dealDamage(att, getPlayer(tgt), dmg, true);
        }
        {
            json savedCtx = ctx;
            clearPending();
            resolveAcRemaining(pid, savedCtx);
        }
        result["success"]=true; return true;
    }
    // ===== 莫队算法: 攻击者选择是否额外攻击另一目标 (需求5.3"可") =====
    if (type == "WAIT_MODUI") {
        bool extra = msg.value("force", false);
        json ctx = pending->context;
        if (extra && msg.contains("targets") && msg["targets"].is_array() && msg["targets"].size() == 1) {
            int et = msg["targets"][0];
            if (isAlive(et) && et != pid && canAttack(pid, et)) {
                dealDamage(getPlayer(pid), getPlayer(et), 1, true);
                addLog(getPlayer(pid).name + "【莫队算法】额外攻击 " + getPlayer(et).name);
            }
        }
        {
            json savedCtx = ctx;
            clearPending();
            resolveAcRemaining(pid, savedCtx);
        }
        result["success"]=true; return true;
    }
    // ===== 划水怪·随缘: 玩家选择摸牌方式 (需求4.3"可替换") =====
    if (type == "WAIT_SUIYUAN") {
        Player& p = getPlayer(pid);
        std::string choice = msg.value("choice", std::string("suiyuan"));
        if (choice == "draw2") {
            p.hand.push_back(drawCard());
            p.hand.push_back(drawCard());
            addLog(p.name + "【随缘】选择摸2张");
        } else {
            p.hand.push_back(drawCard());
            auto it = std::find_if(discard.begin(), discard.end(), [](Card& c){ return c.type == BASIC_ATTACK || c.type == BASIC_DODGE || c.type == BASIC_HEAL; });
            if (it != discard.end()) { p.hand.push_back(*it); discard.erase(it); addLog(p.name + "【随缘】摸1+弃牌堆1基本"); }
            else { p.hand.push_back(drawCard()); addLog(p.name + "【随缘】弃牌堆无基本，摸2"); }
        }
        clearPending();
        phase = PLAY;
        if (p.skipPlayRounds > 0) { p.skipPlayRounds--; phase = DISCARD; }
        nextPhase();
        result["success"]=true; return true;
    }
    // 闪避响应
    if (type == "response_wa") {
        int cardIdx = msg.value("card_index", -1);
        int attacker = pending->context["attacker"];
        int cardId = pending->context["card_id"];
        Player& att = getPlayer(attacker);
        Player& target = getPlayer(pid);
        // 全员卡常(毒瘤觉醒): 其他角色不能使用WA, 视为放弃闪避
        bool waBanned = banWANextTurn && target.name != banWABy;
        // BUG-102/103 修复: -1 表示玄学判题判定(玄学判题/玄学大师均可), -2 表示明确放弃
        bool xuanxueJudge = (cardIdx == -1 && target.armor &&
                             (target.armor->name == "玄学判题" || target.armor->name == "玄学大师"));
        // 玄学判题进化(玄学大师): 红桃或方块均视为WA
        bool xuanxueMaster = (target.armor && target.armor->name == "玄学大师");
        if (cardIdx == -2 || (cardIdx < 0 && !xuanxueJudge && !waBanned)) {
            // 放弃闪避 → 命中 (多目标攻击: 继续结算剩余目标, BUG-109)
            json savedCtx0 = pending->context;
            bool hitEvo0 = false;
            auto it0 = std::find_if(att.hand.begin(), att.hand.end(), [&](Card& c){ return c.id == cardId; });
            if (it0 != att.hand.end()) { hitEvo0 = it0->evolved; Card used = *it0; att.hand.erase(it0); discardCard(used); }
            // base_dmg 已含 实锤+1/AKIOI/咖啡加成
            int dmg0 = savedCtx0.value("base_dmg", 1);
            if (savedCtx0.contains("extra_dmg")) dmg0 += (int)savedCtx0["extra_dmg"];
            if (waBanned) addLog(target.name + " 被全员卡常，无法使用WA");
            dealDamage(att, target, dmg0, true);
            if (dmg0>0 && att.evoTotal<3 && att.evoTurn<1 && !hitEvo0) att.evoCandidates.push_back(cardId);
            clearPending();
            resolveAcRemaining(attacker, savedCtx0);
            result["success"]=true; return true;
        }
        // 放弃闪避 → 命中
        auto finishHit = [&](bool wasEvolvedCard, bool forceDmg) {
            auto it = std::find_if(att.hand.begin(), att.hand.end(), [&](Card& c){ return c.id == cardId; });
            bool evo = (it != att.hand.end()) ? it->evolved : false;
            if (it != att.hand.end()) { Card used = *it; att.hand.erase(it); discardCard(used); }
            // base_dmg 已含 实锤+1/AKIOI/咖啡加成 (performAcAttack 与 resolveAcRemaining 均会带上)
            int dmg = (pending && pending->context.contains("base_dmg")) ? (int)pending->context["base_dmg"] : 1;
            // BUG-110: 恢复随机评测机黑桃+1等额外加成 (挂起响应前已计算)
            if (pending && pending->context.contains("extra_dmg")) dmg += (int)pending->context["extra_dmg"];
            if (waBanned) addLog(target.name + " 被全员卡常，无法使用WA");
            dealDamage(att, target, dmg, true);
            if (dmg>0 && att.evoTotal<3 && att.evoTurn<1 && !evo) att.evoCandidates.push_back(cardId);
        };
        if (cardIdx < 0 || waBanned) {
            finishHit(false, false);
            {
                json savedCtx = pending->context;
                clearPending();
                resolveAcRemaining(attacker, savedCtx);
            }
            result["success"]=true; return true;
        }
        if (cardIdx >= (int)target.hand.size()) return false;
        Card& waCard = target.hand[cardIdx];
        // BUG-130: 样例全过(进化WA)也能闪避
        bool isWA = isWaCard(waCard);
        bool waEvolved = waCard.evolved;   // 先缓存, 弃牌后引用失效
        bool isUnionFind = false;
        if (!isWA && target.armor) {
            if (target.armor->name == "并查集") isUnionFind = true;
            else if (target.armor->name == "路径压缩") {
                // 路径压缩(进化并查集): 需弃与攻击牌同花色的手牌
                std::string acSuit = pending->context.value("ac_suit", std::string(""));
                if (waCard.suit == acSuit) isUnionFind = true;
                else { addLog(target.name + "【路径压缩】需弃与攻击牌同花色的手牌"); return false; }
            }
        }
        if (!isUnionFind && !isWA) return false;
        // 并查集进化计数 (需求: 并查集→路径压缩, 用并查集成功抵消杀1次)
        if (isUnionFind && target.armor && target.armor->name == "并查集" && !target.armor->evolved &&
            target.unionFindBlockCount < 1 && target.evoTotal < 3 && target.evoTurn < 1) {
            target.unionFindBlockCount = 1;
            if (std::find(target.evoCandidates.begin(), target.evoCandidates.end(), target.armor->id) == target.evoCandidates.end())
                target.evoCandidates.push_back(target.armor->id);
        }
        discardFromHand(target, cardIdx);
        // 样例全过(进化WA): 抵消后摸1张并回复1点体力 (需求第十章)
        if (waEvolved) {
            target.hand.push_back(drawCard());
            target.hp = std::min(target.max_hp, target.hp + 1);
            addLog("✅ " + target.name + "【样例全过】抵消后摸1张并回复1点体力");
        }
        if (xuanxueJudge) {
            // 判定代替WA
            Card judge = drawCard();
            std::string jSuit = judge.suit;
            if (!forcedJudgeColor.empty()) { jSuit=(forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
            bool pass = (jSuit == "heart") || (xuanxueMaster && jSuit == "diamond");
            addLog("🔮 " + target.name + "【玄学判题】判定" + suitEmoji(jSuit) + (pass ? "，视为打出WA！" : "，判定失败"));
            // 玄学判题进化计数 (需求: 玄学判题→玄学大师, 判定成功累计2次)
            if (pass && target.armor && target.armor->name == "玄学判题" && !target.armor->evolved && target.evoTotal < 3 && target.evoTurn < 1) {
                target.xuanxueJudgeCount++;
                if (target.xuanxueJudgeCount >= 2) {
                    if (std::find(target.evoCandidates.begin(), target.evoCandidates.end(), target.armor->id) == target.evoCandidates.end())
                        target.evoCandidates.push_back(target.armor->id);
                }
            }
            if (!pass) { finishHit(false, false); clearPending(); result["success"]=true; return true; }
        } else {
            addLog(target.name + (isUnionFind ? " 弃牌当闪" : " 使用 WA 抵消"));
        }
        if (att.weapon && att.weapon->name == "线段树") {
            att.hand.push_back(drawCard()); addLog(att.name + "【线段树】摸1牌");
        }
        auto it = std::find_if(att.hand.begin(), att.hand.end(), [&](Card& c){ return c.id == cardId; });
        bool wasEvolved = (it != att.hand.end()) ? it->evolved : false;
        if (it != att.hand.end()) discardFromHand(att, it - att.hand.begin());
        // 实锤(进化): 被WA抵消时你摸1张牌
        if (wasEvolved) {
            att.hand.push_back(drawCard());
            addLog(att.name + "【实锤】被抵消，摸1牌");
        }
        // BUG-111 修复: 强制命中类武器改为"可选" - 发pending让攻击者选择 (含主席树/root权限)
        bool canForce = false;
        int forceCost = 0;
        if (att.weapon && att.weapon->name == "暴力枚举" && (int)att.hand.size() >= 2) { canForce = true; forceCost = 2; }
        if (att.weapon && att.weapon->name == "剪枝优化" && (int)att.hand.size() >= 1) { canForce = true; forceCost = 1; }
        if (att.weapon && att.weapon->name == "平衡树" && !att.hand.empty()) { canForce = true; forceCost = 1; }
        if (att.weapon && att.weapon->name == "主席树" && !att.hand.empty()) { canForce = true; forceCost = 1; }   // 主席树效果: AC被闪时可弃1牌令其无效
        if (att.weapon && att.weapon->name == "root权限" && !att.hand.empty()) { canForce = true; forceCost = 1; }
        if (canForce) {
            json fctx = {{"target", pid}, {"cost", forceCost}, {"weapon", att.weapon->name},
                         {"coffee_applied", pending->context.value("coffee_applied", false)},
                         {"evo", wasEvolved},
                         {"remain", pending->context.value("remain", json::array())},
                         {"base_dmg", pending->context.value("base_dmg", 1)}};
            startResponse("WAIT_FORCE_HIT", attacker, {}, fctx);
            result["pending"] = "force_hit";
            return true;   // 不清除pending, 等待攻击者决定
        }
        // 不死心武器: 被闪后可选择再攻击 (若手中有AC, 含实锤)
        if (att.weapon && att.weapon->name == "不死心") {
            auto nxtAC = std::find_if(att.hand.begin(), att.hand.end(), isAcCard);
            if (nxtAC != att.hand.end()) {
                json bctx = {{"target", pid},
                             {"remain", pending->context.value("remain", json::array())},
                             {"base_dmg", pending->context.value("base_dmg", 1)}};
                startResponse("WAIT_BU_SI_XIN", attacker, {}, bctx);
                result["pending"] = "bu_si_xin";
                return true;
            }
        }
        if (!isUnionFind && !xuanxueJudge && target.evoTotal<3 && target.evoTurn<1 && !waEvolved) target.evoCandidates.push_back(waCard.id);
        {
            json savedCtx = pending->context;   // BUG-109: 先保存ctx再清pending
            clearPending();
            resolveAcRemaining(attacker, savedCtx);
        }
        result["success"]=true; return true;
    }
    // 模拟赛 - 目标打出AC或受1伤 (逐个目标; 可用特判抵消)
    else if (type == "WAIT_EXAM_AC") {
        json& ctx = pending->context;
        std::vector<int> tlist = ctx["exam_targets"].get<std::vector<int>>();
        int idx = ctx["exam_idx"];
        int owner = ctx["owner"];
        Player& tg = getPlayer(pid);
        int cIdx = msg.value("card_index", -1);
        bool played = false;
        if (cIdx == -3) {
            // 特判抵消模拟赛对自己的效果 (需求 9.3)
            auto tj = std::find_if(tg.hand.begin(), tg.hand.end(), [](Card& x){ return x.name == "特判" || x.name == "一票否决"; });
            if (tj != tg.hand.end()) {
                bool tjEvo = tj->evolved;
                if (!tjEvo && tg.evoTotal < 3 && tg.evoTurn < 1) {
                    if (std::find(tg.evoCandidates.begin(), tg.evoCandidates.end(), tj->id) == tg.evoCandidates.end())
                        tg.evoCandidates.push_back(tj->id);
                }
                discardFromHand(tg, (int)(tj - tg.hand.begin()));
                if (tjEvo) { tg.hand.push_back(drawCard()); addLog("🗳️ " + tg.name + "【一票否决】抵消模拟赛后摸1张"); }
                addLog("⚖️ " + tg.name + " 使用特判抵消【模拟赛】对自己的效果");
                played = true;
            }
        } else if (cIdx >= 0 && cIdx < (int)tg.hand.size() && isAcCard(tg.hand[cIdx])) {
            discardFromHand(tg, cIdx);
            addLog(tg.name + " 打出做法假了应对模拟赛");
            played = true;
        }
        if (!played) {
            dealDamage(getPlayer(owner), tg, 1, false, true);
            addLog(tg.name + " 无AC应对模拟赛，受到1点伤害");
        }
        idx++;
        if (idx < (int)tlist.size()) {
            ctx["exam_idx"] = idx;
            int nt = tlist[idx];
            Player& nt2 = getPlayer(nt);
            std::vector<int> acIdxs;
            for (size_t i=0;i<nt2.hand.size();++i) if (isAcCard(nt2.hand[i])) acIdxs.push_back(i);
            startResponse("WAIT_EXAM_AC", nt, acIdxs, ctx);
            result["pending"] = "exam_ac"; return true;
        }
        clearPending(); result["success"]=true; return true;
    }
    // 手动测评 - 选择判定花色
    else if (type == "WAIT_JUDGE_COLOR") {
        std::string color = msg.value("color", std::string(""));
        if (color != "red" && color != "black") return false;
        forcedJudgeColor = color;
        addLog(getPlayer(pid).name + "【手动测评】下一次判定花色强制为" + (color=="red"?"红色":"黑色"));
        clearPending(); result["success"]=true; return true;
    }
    // 摸鱼怪·颓废 - 回合开始选择
    else if (type == "WAIT_DEPRESSION") {
        std::string choice = msg.value("choice", std::string("none"));
        Player& p = getPlayer(pid);
        if (p.depression > 0) {
            if (choice == "heal") { p.hp = std::min(p.max_hp, p.hp+1); p.depression--; addLog(p.name + " 使用颓废标记回复1体力"); }
            else if (choice == "draw") { p.hand.push_back(drawCard()); p.hand.push_back(drawCard()); p.depression--; addLog(p.name + " 使用颓废标记摸2牌"); }
            else { addLog(p.name + " 不使用颓废标记"); }
        }
        clearPending();
        nextPhase(); // 继续回合流程
        result["success"]=true; return true;
    }
    // 进化选择
    else if (type == "evolution_select") {
        int chosenId = msg.value("evo_card_id", -1);
        Player& p = getPlayer(pid);
        // BUG-128 修复: evo_card_id=-1 表示放弃, 清空候选并继续
        if (chosenId == -1) {
            addLog(p.name + " 放弃了本次进化选择");
            p.evoCandidates.clear();
            clearPending();
            nextPhase();
            result["success"]=true; return true;
        }
        auto it = std::find(p.evoCandidates.begin(), p.evoCandidates.end(), chosenId);
        if (it == p.evoCandidates.end()) return false;
        // BUG-127 修复: 每回合最多进化1次 (evoTurn 已是本回合计数; 系统重构可+1次)
        if (p.evoTurn >= 1 + p.extraEvo && p.evoTotal < 3) {
            addLog(p.name + " 本回合已进化过，剩余候选保留至下回合");
            p.evoCandidates.clear();   // 保守: 清除候选, 避免本回合再次弹窗
            clearPending();
            nextPhase();
            result["success"]=true; return true;
        }
        auto discIt = std::find_if(discard.begin(), discard.end(), [&](Card& c){ return c.id == chosenId; });
        if (discIt != discard.end()) {
            Card evo = *discIt;
            if (evoMap.count(evo.name)) { evo.name = evoMap[evo.name]; evo.evolved = true; evo.id = nextCardId++; }
            p.hand.push_back(evo);
            discard.erase(discIt);
            p.evoCandidates.erase(it);
            p.evoTotal++; p.evoTurn++;
            addLog(p.name + " 进化了 " + evo.name);
            clearPending();
            nextPhase();
            result["success"]=true; return true;
        }
        // 候选不在弃牌堆: 尝试手牌 / 装备区 (装备卡原地进化, 需求第十章)
        {
            auto hi = std::find_if(p.hand.begin(), p.hand.end(), [&](Card& c){ return c.id == chosenId; });
            if (hi != p.hand.end()) {
                Card evo = *hi;
                if (evoMap.count(evo.name)) { evo.name = evoMap[evo.name]; evo.evolved = true; evo.id = nextCardId++; }
                p.hand.erase(hi);
                p.hand.push_back(evo);
                p.evoCandidates.erase(it);
                p.evoTotal++; p.evoTurn++;
                addLog(p.name + " 进化了 " + evo.name);
                clearPending();
                nextPhase();
                result["success"]=true; return true;
            }
            Card* eqCard = nullptr;
            for (auto& eq : p.equip) if (eq && eq->id == chosenId) { eqCard = eq.get(); break; }
            if (eqCard && evoMap.count(eqCard->name)) {
                eqCard->name = evoMap[eqCard->name];
                eqCard->evolved = true;
                eqCard->id = nextCardId++;
                p.evoCandidates.erase(it);
                p.evoTotal++; p.evoTurn++;
                addLog(p.name + " 进化了 " + eqCard->name + "（装备区原地进化）");
                clearPending();
                nextPhase();
                result["success"]=true; return true;
            }
        }
        return false;
    }
    // O2选卡
    else if (type == "WAIT_O2_CARD") {
        int selIdx = msg.value("card_index", -1);
        Player& p = getPlayer(pid);
        if (selIdx<0 || selIdx>=(int)p.hand.size()) return false;
        Card& ac = p.hand[selIdx];
        discardFromHand(p, selIdx);
        addLog(p.name + " 使用O2打出 " + ac.symbol() + " 伤害+1");
        pending->type = "WAIT_O2_TARGET";
        pending->context["ac_name"] = ac.name;
        startResponse("WAIT_O2_TARGET", pid, {}, pending->context);
        result["pending"] = "select_o2_target"; return true;
    }
    // O2选目标 (O3优化: 伤害+2且无视距离; 咖啡加成生效)
    else if (type == "WAIT_O2_TARGET") {
        if (msg.contains("targets") && msg["targets"].is_array() && msg["targets"].size()==1) {
            int tgt = msg["targets"][0];
            if (!isAlive(tgt)) return false;
            bool o2Evo = pending->context.value("o2_evolved", false);
            if (!o2Evo && !canAttack(pid, tgt)) return false;   // O3优化无视距离
            Player& p = getPlayer(pid);
            int dmg = o2Evo ? 4 : 2;   // O3优化: 伤害+2 (共4)
            if (p.coffeeBoost) { dmg += p.coffeeBoostDmg; p.coffeeBoost = false; addLog("☕ 咖啡强化，O2伤害+" + std::to_string(p.coffeeBoostDmg)); }
            dealDamage(p, getPlayer(tgt), dmg, true);
            // O2优化进化: 使用后本回合造成过伤害 → O3优化
            if (p.damageDealtThisTurn > 0 && p.evoTotal < 3 && p.evoTurn < 1) {
                for (auto it = discard.begin(); it != discard.end(); ++it) {
                    if (it->name == "O2优化" && !it->evolved) {
                        if (std::find(p.evoCandidates.begin(), p.evoCandidates.end(), it->id) == p.evoCandidates.end())
                            p.evoCandidates.push_back(it->id);
                        break;
                    }
                }
            }
            clearPending(); result["success"]=true; return true;
        }
        return false;
    }
    // 对拍 - 发起者选择AC
    else if (type == "WAIT_DUEL_SELF") {
        int selfIdx = msg.value("card_index", -1);
        Player& p = getPlayer(pid);
        if (selfIdx < 0 || selfIdx >= (int)p.hand.size() || !isAcCard(p.hand[selfIdx])) return false;
        discardFromHand(p, selfIdx);
        addLog(p.name + " 对拍中打出一张做法假了");
        int target = pending->context["target"];
        Player& tgtPlayer = getPlayer(target);
        // WC对决(进化对拍): 败者受2伤
        int duelDmg = 1;
        int dId = pending->context.value("duel_card", -1);
        for (auto& c : discard) if (c.id == dId) { duelDmg = c.evolved ? 2 : 1; break; }
        // 检查目标是否有AC
        std::vector<int> tgtAC;
        for (size_t i=0; i<tgtPlayer.hand.size(); ++i) if (isAcCard(tgtPlayer.hand[i])) tgtAC.push_back(i);
        if (tgtAC.empty()) {
            // 目标无AC，目标受伤; 发起者对拍获胜 → 对拍卡进化候选 (BUG-126)
            dealDamage(p, tgtPlayer, duelDmg, false, true);
            addLog(tgtPlayer.name + " 对拍无AC，受到" + std::to_string(duelDmg) + "点伤害");
            if (pending->context.contains("duel_card") && p.evoTotal < 3 && p.evoTurn < 1) {
                int dcId = pending->context["duel_card"];
                if (std::find(p.evoCandidates.begin(), p.evoCandidates.end(), dcId) == p.evoCandidates.end())
                    p.evoCandidates.push_back(dcId);
            }
            clearPending(); result["success"]=true; return true;
        }
        // 目标有AC，要求目标选择
        json ctx = {{"initiator", pid}, {"target", target}, {"duel_card", dId}, {"duel_dmg", duelDmg}};
        startResponse("WAIT_DUEL_TARGET", target, tgtAC, ctx);
        result["pending"] = "duel_target_ac"; return true;
    }
    // 对拍 - 目标选择AC (放弃→受1伤/WC对决2伤)
    else if (type == "WAIT_DUEL_TARGET") {
        int tgtIdx = msg.value("card_index", -1);
        int target = pending->context["target"];
        Player& tgtPlayer = getPlayer(target);
        if (tgtIdx < 0) {
            // 放弃 → 目标受1伤 (WC对决: 2伤)
            int dmg = pending->context.value("duel_dmg", 1);
            dealDamage(getPlayer(pid), tgtPlayer, dmg, false, true);
            addLog(tgtPlayer.name + " 对拍放弃出AC，受到" + std::to_string(dmg) + "点伤害");
            clearPending(); result["success"]=true; return true;
        }
        if (tgtIdx >= (int)tgtPlayer.hand.size() || !isAcCard(tgtPlayer.hand[tgtIdx])) return false;
        discardFromHand(tgtPlayer, tgtIdx);
        addLog(tgtPlayer.name + " 对拍中打出一张做法假了，双方平局");
        clearPending(); result["success"]=true; return true;
    }
    // 女装直播 - 发送目标手牌或处理选择
    else if (type == "WAIT_LIVE_TARGET") {
        if (!msg.contains("card_index") && pending->context.find("hand_sent") == pending->context.end()) {
            // 第一次进入，发送目标手牌
            Player& target = getPlayer(pending->context["target"]);
            json handInfo = json::array();
            for (size_t i = 0; i < target.hand.size(); ++i) {
                handInfo.push_back({
                    {"index", i},
                    {"name", target.hand[i].name},
                    {"suit", target.hand[i].suit},
                    {"number", target.hand[i].number}
                });
            }
            pending->context["hand_info"] = handInfo;
            pending->context["hand_sent"] = true;
            result["pending"] = "live_steal_choose";
            result["hand_info"] = handInfo;
            return false; // 不清理pending
        }
        // 处理选择的卡牌
        int chosenIdx = msg.value("card_index", -1);
        Player& target = getPlayer(pending->context["target"]);
        if (chosenIdx < 0 || chosenIdx >= (int)target.hand.size()) return false;
        Card stolen = target.hand[chosenIdx];
        target.hand.erase(target.hand.begin() + chosenIdx);
        getPlayer(pid).hand.push_back(stolen);
        addLog(getPlayer(pid).name + " 直播偷取了 " + target.name + " 的 " + stolen.symbol());
        getPlayer(pid).liveViewCount++;
        if (getPlayer(pid).liveViewCount >= 2 && !getPlayer(pid).awakened) {
            getPlayer(pid).awakened = true;
            addLog(getPlayer(pid).name + " 觉醒：公开处刑！选择一名角色弃置其红色手牌");
            // BUG-123 修复: 目标由玩家选择 (发pending, 不清除)
            startResponse("WAIT_PUBLIC_EXEC", pid, {}, {});
            result["pending"] = "public_exec_choose";
            return true;   // 等待玩家选择目标, 不清理pending
        }
        clearPending();
        result["success"] = true;
        return true;
    }
    // BUG-123: 公开处刑 - 选择目标
    else if (type == "WAIT_PUBLIC_EXEC") {
        if (!msg.contains("targets") || !msg["targets"].is_array() || msg["targets"].size() != 1) return false;
        int vid = msg["targets"][0];
        if (vid == pid || !isAlive(vid)) return false;
        Player& v = getPlayer(vid);
        std::vector<int> redIdx;
        for (size_t i=0; i<v.hand.size(); ++i) if (v.hand[i].isRed()) redIdx.push_back((int)i);
        for (size_t k = redIdx.size(); k-- > 0; ) discardFromHand(v, redIdx[k]);
        addLog(v.name + " 被公开处刑，弃置所有红色手牌");
        clearPending();
        result["success"] = true;
        return true;
    }
    // ===== 代码审计: 目标展示手牌 (WAIT_AUDIT_REVEAL) =====
    else if (type == "WAIT_AUDIT_REVEAL") {
        Player& tg = getPlayer(pid);
        int owner = pending->context["owner"];
        if (tg.hand.empty()) { clearPending(); result["success"]=true; return true; }
        int revealIdx = msg.value("card_index", -1);
        if (revealIdx < 0 || revealIdx >= (int)tg.hand.size()) {
            // 前端先发一次带 hand 的响应来展示
            json handInfo = json::array();
            for (size_t i=0;i<tg.hand.size();++i) handInfo.push_back({{"index",(int)i},{"name",tg.hand[i].name},{"suit",tg.hand[i].suit}});
            result["pending"] = "audit_reveal";
            result["hand_info"] = handInfo;
            return false;
        }
        Card shown = tg.hand[revealIdx];
        addLog(tg.name + "【代码审计】展示了 " + shown.symbol());
        Player& ow = getPlayer(owner);
        // 使用者弃一张同花色手牌造成1伤
        auto same = std::find_if(ow.hand.begin(), ow.hand.end(), [&](Card& c){ return c.suit == shown.suit; });
        if (same != ow.hand.end()) {
            discardFromHand(ow, (int)(same - ow.hand.begin()));
            dealDamage(ow, tg, 1, false, true);
            addLog(ow.name + "【代码审计】弃同花色牌，对 " + tg.name + " 造成1点伤害");
        } else {
            addLog(ow.name + " 无同花色手牌，代码审计未能造成伤害");
        }
        clearPending(); result["success"]=true; return true;
    }
    return false;
}

// ===================== v3.0 AOE 结算 =====================
void Room::startAoe(int owner, const std::string& aoeName, int baseDmg) {
    aoeOwner = owner; aoeType = aoeName; aoeBaseDmg = baseDmg; aoeActive = true;
    aoeResponded.clear();
    addLog("📢 " + getPlayer(owner).name + " 使用【" + aoeName + "】！");
    stepAoe();
}

void Room::stepAoe() {
    if (!aoeActive) return;
    // AOE进化候选: 使用者本回合造成过伤害 → 数据加强→数据爆炸 / 评测机抽风→评测机暴走
    auto markAoeEvo = [&]() {
        Player& owner = getPlayer(aoeOwner);
        if (owner.damageDealtThisTurn <= 0 || owner.evoTotal >= 3 || owner.evoTurn >= 1) return;
        for (auto it = discard.begin(); it != discard.end(); ++it) {
            if (it->name == aoeType && !it->evolved) {
                if (std::find(owner.evoCandidates.begin(), owner.evoCandidates.end(), it->id) == owner.evoCandidates.end())
                    owner.evoCandidates.push_back(it->id);
                break;
            }
        }
    };
    // BUG-114 修复: 从使用者下家开始, 按行动顺序依次响应
    for (int step = 0; step < (int)players.size(); ++step) {
        int pid2 = (aoeOwner + 1 + step) % (int)players.size();
        if (pid2 == aoeOwner) continue;
        Player& p = players[pid2];
        if (!p.alive) continue;
        if (std::find(aoeResponded.begin(), aoeResponded.end(), p.id) != aoeResponded.end()) continue;
        aoeResponded.push_back(p.id);
        Player& target = p;
        // BUG-124 修复: AOE锦囊也是"锦囊目标", 触发 萌新·问问题 / 女装大佬·女装 被动 (每回合限1次)
        if (target.profession == "萌新" && !target.usedAskThisTurn && !gameOver) {
            target.usedAskThisTurn = true;
            target.hand.push_back(drawCard());
            addLog(target.name + "【问问题】成为AOE锦囊目标，摸1牌");
        }
        if (target.profession == "女装大佬" && !target.usedSkirtThisTurn && !gameOver) {
            target.usedSkirtThisTurn = true;
            target.hand.push_back(drawCard());
            addLog(target.name + "【女装】成为AOE锦囊目标，摸1牌");
        }
        // 防火墙: 免疫AOE锦囊伤害 (需求修订: 【暴力评测机】事件期间不免疫, 且伤害+1)
        if (activeEvent != "暴力评测机" && target.armor && (target.armor->name == "防火墙" || target.armor->name == "军用防火墙")) {
            addLog("🛡️ " + target.name + "【防火墙】免疫AOE伤害");
            continue;
        }
        if (aoeType == "数据加强") {
            // 需要打出做法假了 (含进化实锤, 手写快排武器可响应)
            std::vector<int> acIdxs;
            for (size_t i=0;i<target.hand.size();++i) if (isAcCard(target.hand[i])) acIdxs.push_back((int)i);
            if (target.weapon && target.weapon->name == "手写快排" && target.hand.size() >= 1) acIdxs.push_back(-2); // -2=手写快排响应
            if (target.weapon && target.weapon->name == "模板库" && target.hand.size() >= 1) acIdxs.push_back(-2);
            if (acIdxs.empty()) {
                // BUG-115: AOE伤害享受评测机事件 (毒瘤-1 / 暴力+1)
                int aoeDmg = aoeBaseDmg;
                if (activeEvent == "毒瘤评测机") aoeDmg = std::max(0, aoeDmg - 1);
                else if (activeEvent == "暴力评测机") aoeDmg += 1;
                dealDamage(getPlayer(aoeOwner), target, aoeDmg, false, true);
                addLog(target.name + " 无做法假了响应【数据加强】，受到" + std::to_string(aoeDmg) + "点伤害");
                markAoeEvo();
            } else {
                json ctx = {{"aoe","数据加强"},{"owner",aoeOwner}};
                startResponse("AOE_AC", target.id, acIdxs, ctx);
                return; // 等待响应
            }
        } else { // 评测机抽风
            std::vector<int> waIdxs;
            for (size_t i=0;i<target.hand.size();++i) if (isWaCard(target.hand[i])) waIdxs.push_back((int)i);
            if (target.armor && target.armor->name == "并查集") for (size_t i=0;i<target.hand.size();++i) waIdxs.push_back((int)i);
            if (target.armor && (target.armor->name=="玄学判题"||target.armor->name=="玄学大师")) waIdxs.push_back(-1); // 判定代替
            if (waIdxs.empty()) {
                // BUG-115: AOE伤害享受评测机事件
                int aoeDmg = aoeBaseDmg;
                if (activeEvent == "毒瘤评测机") aoeDmg = std::max(0, aoeDmg - 1);
                else if (activeEvent == "暴力评测机") aoeDmg += 1;
                dealDamage(getPlayer(aoeOwner), target, aoeDmg, false, true);
                addLog(target.name + " 无WA响应【评测机抽风】，受到" + std::to_string(aoeDmg) + "点伤害");
                markAoeEvo();
            } else {
                json ctx = {{"aoe","评测机抽风"},{"owner",aoeOwner}};
                startResponse("AOE_WA", target.id, waIdxs, ctx);
                return; // 等待响应
            }
        }
    }
    // 全部结算完成
    aoeActive = false;
    addLog("📢 【" + aoeType + "】结算完毕");
}

// 判定区延时锦囊结算: UB/水群/断网
void Room::judgeDelayArea(Player& p) {
    if (p.delayArea.empty()) return;
    // BUG-104 修复: 所有 erase 分支后 continue (不隐式 i++), 保证同区后续卡牌不被跳过
    for (size_t i = 0; i < p.delayArea.size(); ) {
        Card& d = p.delayArea[i];
        if (d.name == "UB") {
            Card judge = drawCard();
            std::string jSuit = judge.suit;
            if (!forcedJudgeColor.empty()) { jSuit=(forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
            bool boom = (jSuit=="spade" && judge.number>=2 && judge.number<=9);
            if (boom) {
                addLog("💥 " + p.name + "【UB】判定" + judge.symbol() + "（黑桃2~9），未定义行为爆炸！受到3点伤害");
                dealDamage(p, p, 3, false, true);
                p.delayArea.erase(p.delayArea.begin()+i);
                continue;  // BUG-104: 不 i++, 继续检查同位置(已被前移)
            } else {
                addLog("🟣 " + p.name + "【UB】判定" + judge.symbol() + "，未爆炸，传给下家");
                // BUG-105 修复: 下家判定区已有UB则继续传给再下家
                int next = (p.id + 1) % players.size();
                int guard = 0;
                while (!isAlive(next) || hasDelayCard(next, "UB")) { next = (next+1)%players.size(); if (++guard >= (int)players.size()) break; }
                if (guard < (int)players.size()) {
                    Card ub = p.delayArea[i];
                    p.delayArea.erase(p.delayArea.begin()+i);
                    getPlayer(next).delayArea.push_back(ub);
                    addLog("🟣 UB 传给 " + getPlayer(next).name);
                    continue;  // 转移后不 i++
                }
                // 所有人都已有UB(极端情况): 直接弃置
                discardCard(p.delayArea[i]);
                p.delayArea.erase(p.delayArea.begin()+i);
                continue;
            }
        } else if (d.name == "水群") {
            Card judge = drawCard();
            std::string jSuit = judge.suit;
            if (!forcedJudgeColor.empty()) { jSuit=(forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
            bool skip = (jSuit != "heart");
            addLog("💧 " + p.name + "【水群】判定" + judge.symbol() + (skip ? "，跳过出牌阶段" : "，水群失败"));
            if (skip) p.skipPlayRounds = 1;
            p.delayArea.erase(p.delayArea.begin()+i);
            continue;  // BUG-104
        } else if (d.name == "断网") {
            Card judge = drawCard();
            std::string jSuit = judge.suit;
            if (!forcedJudgeColor.empty()) { jSuit=(forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
            bool skip = (jSuit != "club");
            addLog("📡 " + p.name + "【断网】判定" + judge.symbol() + (skip ? "，跳过摸牌阶段" : "，断网失败"));
            if (skip) p.skipDraw = true;
            p.delayArea.erase(p.delayArea.begin()+i);
            continue;  // BUG-104
        } else {
            ++i;
        }
    }
}

// BUG-105 辅助: 判定区是否已有指定延时锦囊
bool Room::hasDelayCard(int pid, const std::string& name) {
    if (pid < 0 || pid >= (int)players.size()) return false;
    for (auto& d : players[pid].delayArea) if (d.name == name) return true;
    return false;
}

// BUG-121 修复: 彩蛋牌抽到即直接触发效果 (需求 9.4 "抽到时直接使用，效果不可被抵消")
// 返回 true 表示已触发并消耗该彩蛋牌
bool Room::triggerEaster(Player& p, Card& c) {
    if (c.type != SPECIAL_EASTER) return false;
    std::string nm = c.name;
    bool consumed = true;
    if (nm == "评测机崩溃") {
        int moved = 0;
        for (size_t i = discard.size(); i-- > 0; ) {
            if (discard[i].name == "做法假了") { deck.push_back(discard[i]); discard.erase(discard.begin()+i); moved++; }
        }
        shuffleDeck();
        addLog("💥 Ctrl+C 都救不了你们！评测机崩溃，" + std::to_string(moved) + "张AC被移回牌堆");
        // 一致性修复: 走完整伤害流程 (触发濒死/救援/阵亡/胜负判定, 需求7.1)
        for (auto& pl : players) if (pl.alive) dealDamage(p, pl, 1, false, true);
    } else if (nm == "女装求AC") {
        // 简化: 从最近的存活角色拿1张手牌, 否则自己回1
        for (auto& pl : players) {
            if (pl.alive && pl.id != p.id && !pl.hand.empty()) {
                int idx = randInt(0, (int)pl.hand.size()-1);
                p.hand.push_back(pl.hand[idx]);
                addLog(pl.name + " 被女装求AC，给了 " + p.name + " 一张手牌");
                pl.hand.erase(pl.hand.begin()+idx);
                return true;
            }
        }
        p.hp = std::min(p.max_hp, p.hp+1);
        addLog(p.name + " 女装求AC无人可给，回复1体力");
    } else if (nm == "我样例过了！") {
        bool hasAC = std::any_of(p.hand.begin(), p.hand.end(), isAcCard);
        if (!hasAC) { p.hand.push_back(drawCard()); p.hand.push_back(drawCard()); addLog(p.name + " 样例过了，摸2牌"); }
        else {
            // 一致性修复: 抽到路径有做法假了需弃1张 (需求9.4)
            auto it = std::find_if(p.hand.begin(), p.hand.end(), isAcCard);
            discardFromHand(p, (int)(it - p.hand.begin()));
            addLog(p.name + " 样例过了（有做法假了），弃1张做法假了");
        }
    } else if (nm == "原题大战") {
        for (auto& pl : players) {
            if (!pl.alive || pl.hand.empty()) continue;
            int maxNum = -1;
            std::vector<size_t> idxs;
            for (size_t i=0;i<pl.hand.size();++i) {
                if (pl.hand[i].number > maxNum) { maxNum = pl.hand[i].number; idxs.clear(); idxs.push_back(i); }
                else if (pl.hand[i].number == maxNum) idxs.push_back(i);
            }
            // BUG-118: 点数相同一起弃
            for (size_t k = idxs.size(); k-- > 0; ) discardFromHand(pl, (int)idxs[k]);
            addLog(pl.name + " 弃置点数最大(" + std::to_string(maxNum) + ")的手牌");
        }
    } else if (nm == "学长讲题") {
        for (auto& pl : players) if (pl.alive && pl.id != p.id) { pl.hand.push_back(drawCard()); pl.hand.push_back(drawCard()); break; }
        auto waIt = std::find_if(discard.begin(), discard.end(), [](Card& cc){ return cc.name == "WA"; });
        if (waIt != discard.end()) { p.hand.push_back(*waIt); discard.erase(waIt); }
        else p.hand.push_back(drawCard());
        addLog(p.name + " 学长讲题：一名角色摸2，自己得WA");
    } else if (nm == "退役失败") {
        for (auto& pl : players) {
            if (!pl.alive) continue;
            if (pl.hp == 1) { pl.hp = std::min(pl.max_hp, 2); addLog(pl.name + " 退役失败回光返照，回复1"); }
            else if (pl.hp == pl.max_hp) { dealDamage(p, pl, 1, false, true); addLog(pl.name + " 退役失败波及，失去1"); }
        }
    } else if (nm == "面向数据编程") {
        for (auto& pl : players) if (pl.alive) { pl.hand.push_back(drawCard()); if (pl.hand.back().type == SPECIAL_EASTER) triggerEaster(pl, pl.hand.back()); }
        addLog("📊 数据太水了！面向数据编程，所有角色各摸1张");
    } else if (nm == "随机种子") {
        p.hand.push_back(drawCard());
        p.hand.push_back(drawCard());
        if (!p.hand.empty()) discardFromHand(p, randInt(0, (int)p.hand.size()-1));
        addLog("🎲 " + p.name + " 随机种子发威，摸2弃1");
    } else {
        consumed = false;
    }
    return consumed;
}

bool Room::canUseWA(Player& p) {
    if (banWANextTurn && p.name != banWABy) return false;
    return true;
}

// BUG-109 修复: 多目标攻击(放手一搏/AK全场)中, 某目标WA响应结算后继续处理剩余目标
// 一致性修复: 中间目标有WA时, remain 必须携带"当前目标之后"的剩余目标 (原实现 remain 恒空导致后续目标全部不结算)
void Room::resolveAcRemaining(int attacker, const json& ctx) {
    if (!ctx.contains("remain")) return;
    std::vector<int> remain = ctx["remain"].get<std::vector<int>>();
    Player& att = getPlayer(attacker);
    if (!att.alive) return;
    int baseDmg = ctx.value("base_dmg", 1);
    bool ignoreWA = (activeEvent == "毒瘤评测机");
    for (size_t ri = 0; ri < remain.size(); ++ri) {
        int tgt = remain[ri];
        if (tgt == attacker || !isAlive(tgt)) continue;
        if (!canAttack(attacker, tgt)) continue;
        Player& target = getPlayer(tgt);
        int dmg = baseDmg;
        // 随机评测机判定
        if (activeEvent == "随机评测机") {
            Card judge = drawCard();
            std::string jSuit = judge.suit;
            if (!forcedJudgeColor.empty()) { jSuit=(forcedJudgeColor=="red")?"heart":"spade"; forcedJudgeColor.clear(); }
            if (jSuit == "heart") { addLog(target.name + "【随机评测机】判定♥，视为使用了WA，闪避成功"); continue; }
            if (jSuit == "spade") { dmg += 1; addLog(target.name + "【随机评测机】判定♠，伤害+1"); }
        }
        // 黑名单/全员拉黑: 黑色做法假了无效 (多目标虚拟攻击沿用出杀时的牌色标记)
        bool ignoreArmor = (att.weapon && (att.weapon->name == "管理员权限" || att.weapon->name == "root权限"));
        if (!ignoreWA && !ignoreArmor && target.armor &&
            (target.armor->name == "黑名单" || target.armor->name == "全员拉黑") && ctx.value("black", false)) {
            addLog("🖤 " + target.name + "【" + target.armor->name + "】免疫攻击");
            continue;
        }
        // WA响应: 若目标有WA则挂起响应, 结算后继续处理剩余目标
        std::vector<int> waCards;
        if (!ignoreWA) {
            for (size_t i=0; i<target.hand.size(); ++i) if (isWaCard(target.hand[i])) waCards.push_back((int)i);
            if (target.armor && target.armor->name == "并查集" && !ignoreArmor)
                for (size_t i=0; i<target.hand.size(); ++i) if (!isWaCard(target.hand[i])) waCards.push_back((int)i);
            if (target.armor && target.armor->name == "路径压缩" && !ignoreArmor) {
                std::string acSuit = ctx.value("ac_suit", std::string(""));
                for (size_t i=0; i<target.hand.size(); ++i)
                    if (target.hand[i].suit == acSuit) waCards.push_back((int)i);
            }
            if (target.armor && (target.armor->name == "玄学判题" || target.armor->name == "玄学大师") && !ignoreArmor) waCards.push_back(-1);
        }
        if (!waCards.empty()) {
            // 关键修复: 剩余目标列表 = 当前目标之后的目标 (原实现 remain 为空, 后续目标全部不结算)
            std::vector<int> remainNext;
            for (size_t rr = ri + 1; rr < remain.size(); ++rr) remainNext.push_back(remain[rr]);
            json newCtx = {{"attacker", attacker}, {"card_id", -1}, {"virtual", true},
                           {"remain", remainNext}, {"base_dmg", baseDmg}, {"black", ctx.value("black", false)},
                           {"ac_suit", ctx.value("ac_suit", std::string(""))},
                           {"extra_dmg", dmg - baseDmg}};
            startResponse("response_wa", tgt, waCards, newCtx);
            addLog("⏳ 多目标攻击继续: " + target.name + " 需响应WA");
            return;  // 等下次响应后继续
        }
        dealDamage(att, target, dmg, true);
    }
}

json Room::getStateJson(int viewerId) {
    resolvePendingTimeout(); // 待响应超时自动结算, 防止游戏卡死
    json st;
    st["my_id"] = viewerId;
    st["phase"] = (int)phase;
    st["current_turn"] = currentTurn;
    st["round"] = roundCount;
    st["event"] = activeEvent;
    // 评测机事件说明 (#0815-2)
    static std::map<std::string,std::string> eventDesc = {
        {"毒瘤评测机","所有【做法假了】伤害-1，但无视【WA】"},
        {"暴力评测机","所有【做法假了】伤害+1，但攻击命中后使用者自己也受1点伤害"},
        {"慈善评测机","所有人出牌阶段使用【做法假了】无次数限制"},
        {"随机评测机","每名角色成为【做法假了】目标时判定：红桃视为使用WA闪避；黑桃则伤害+1"},
        {"?","等待评测机事件…"}
    };
    st["event_desc"] = eventDesc.count(activeEvent) ? eventDesc[activeEvent] : "";
    st["ban_wa"] = banWANextTurn;
    st["log"] = log;
    st["game_over"] = gameOver;
    st["winner"] = winner;
    st["players"] = json::array();
    bool viewerValid = (viewerId >= 0 && viewerId < (int)players.size());
    std::string viewerIdentity = viewerValid ? players[viewerId].identity : "";
    for (auto& p : players) {
        json pj;
        pj["id"] = p.id; pj["name"] = p.name; pj["hp"] = p.hp; pj["max_hp"] = p.max_hp;
        pj["alive"] = p.alive;
        // BUG-146 修复: Au选手(主公)身份全场明置; 其余身份只有自己可见
        pj["identity"] = (viewerId == p.id || p.identity == "Au选手") ? p.identity : "?";
        pj["profession"] = p.profession;
        pj["hand_count"] = p.hand.size();
        pj["weapon"] = p.weapon ? p.weapon->name : "";
        pj["armor"] = p.armor ? p.armor->name : "";
        pj["mount_off"] = p.mount_off ? p.mount_off->name : "";
        pj["mount_def"] = p.mount_def ? p.mount_def->name : "";
        pj["depression"] = p.depression;
        pj["awakened"] = p.awakened;
        pj["chained"] = p.chained;
        pj["delay"] = json::array();
        for (auto& d : p.delayArea) pj["delay"].push_back(d.name);
        st["players"].push_back(pj);
    }
    if (!viewerValid) {
        st["my_hand"] = json::array();
        st["my_equip"] = json::array();
        return st;
    }
    Player& me = getPlayer(viewerId);
    // 彩蛋图鉴解锁 (#0816-4): 抽到(在手牌中)即触发解锁
    for (auto& c : me.hand) {
        if (c.type == SPECIAL_EASTER) AuthManager::instance().unlockEaster(me.name, c.name);
    }
    st["easter_unlocked"] = json::array();
    for (auto& nm : AuthManager::instance().easterUnlocked(me.name)) st["easter_unlocked"].push_back(nm);
    json hand = json::array();
    for (size_t i=0; i<me.hand.size(); i++) {
        auto& c = me.hand[i];
        hand.push_back({
            {"index", i}, {"id", c.id}, {"name", c.name},
            {"suit", c.suit}, {"number", c.number},
            {"evolved", c.evolved}, {"type", c.type}
        });
    }
    st["my_hand"] = hand;
    // 我的装备区 (#0815-3: 手牌/装备分开显示)
    json myEq = json::array();
    for (auto& eq : me.equip) {
        myEq.push_back({{"name", eq->name}, {"suit", eq->suit}, {"number", eq->number},
                        {"type", eq->type}, {"evolved", eq->evolved}});
    }
    st["my_equip"] = myEq;
    st["coffee_boost"] = me.coffeeBoost;
    st["ak_all_active"] = me.akAllActive;   // 神犇觉醒·AK全场: 前端据此启用多目标选择 (一致性修复)
    // ===== UI: 目标态/提示 (需求17.7/17.10): 本玩家可攻击的目标列表 =====
    json cat = json::array();
    for (auto& p : players) if (p.alive && p.id != viewerId && canAttack(viewerId, p.id)) cat.push_back(p.id);
    st["can_attack_targets"] = cat;
    // ===== UI: 牌堆/弃牌堆计数与弃牌堆内容 (需求17.7: 牌堆计数 + 弃牌堆可查看; 弃牌堆公开) =====
    st["deck_count"] = (int)deck.size();
    st["discard_count"] = (int)discard.size();
    json discArr = json::array();
    for (auto& c : discard) discArr.push_back(c.symbol());
    st["discard"] = discArr;
    if (pending && pending->targetPlayer == viewerId) {
        // ===== UI: 响应倒计时 (需求17.7: 限时提示) =====
        long long msLeft = duration_cast<milliseconds>(pending->deadline - steady_clock::now()).count();
        st["pending_timeout"] = (int)std::max(0LL, msLeft / 1000);
        st["pending"] = {
            {"type", pending->type},
            {"valid_cards", pending->validCards},
            {"context", pending->context}
        };
        // 女装直播偷牌 / 代码审计展示: 直接把手牌信息放进 pending, 前端无需额外请求 (#0815-1)
        if (pending->type == "WAIT_LIVE_TARGET" && pending->context.contains("target")) {
            Player& lt = getPlayer((int)pending->context["target"]);
            json hi = json::array();
            for (size_t i=0;i<lt.hand.size();++i)
                hi.push_back({{"index",(int)i},{"name",lt.hand[i].name},{"suit",lt.hand[i].suit},{"number",lt.hand[i].number}});
            st["pending"]["hand_info"] = hi;
        }
        if (pending->type == "WAIT_AUDIT_REVEAL") {
            Player& ar = getPlayer(viewerId);
            json hi = json::array();
            for (size_t i=0;i<ar.hand.size();++i)
                hi.push_back({{"index",(int)i},{"name",ar.hand[i].name},{"suit",ar.hand[i].suit},{"number",ar.hand[i].number}});
            st["pending"]["hand_info"] = hi;
        }
        // 旧逻辑: 如果上下文里已有 hand_info 也一并带出
        if (pending->type == "WAIT_LIVE_TARGET" && pending->context.contains("hand_info")) {
            st["pending"]["hand_info"] = pending->context["hand_info"];
        }
    }
    return st;
}