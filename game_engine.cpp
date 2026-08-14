#include "game_engine.h"
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

std::map<std::string, std::string> evoMap = {
    {"AC代码","AK代码"}, {"WA","完美防御"}, {"RE","大紫荆花"},
    {"对拍","WC对决"}, {"抄袭代码","暴力抄袭"}, {"请家长","退学警告"},
    {"O2优化","O3优化"}, {"线段树","主席树"}, {"并查集","路径压缩"},
    {"重构","系统重构"}
};

std::string Card::symbol() const {
    static std::map<std::string,std::string> sym = {
        {"spade","♠"},{"club","♣"},{"heart","♥"},{"diamond","♦"}
    };
    return sym[suit] + std::to_string(number) + " " + name + (evolved ? "(E)" : "");
}
bool Card::isBlack() const { return suit == "spade" || suit == "club"; }
bool Card::isRed() const { return suit == "heart" || suit == "diamond"; }

// ----------------------------- Room 成员函数 -----------------------------
Player& Room::getPlayer(int pid) { return players[pid]; }
bool Room::isAlive(int pid) const { return players[pid].alive; }

void Room::addLog(const std::string& msg) {
    log.push_back("[R" + std::to_string(roundCount) + "] " + msg);
    if (log.size() > 50) log.erase(log.begin());
}

Card Room::drawCard() {
    if (deck.empty()) {
        if (discard.empty()) return Card();
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
        if (p.weapon->name == "树状数组") return 1;
        if (p.weapon->name == "线段树" || p.weapon->name == "莫队算法") return 2;
        if (p.weapon->name == "平衡树") return 3;
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
        auto it = std::find_if(p.equip.begin(), p.equip.end(), [&](Card& eq){ return eq.id == slot->id; });
        if (it != p.equip.end()) {
            discardCard(*it);
            p.equip.erase(it);
        }
    }
    auto it = std::find_if(p.hand.begin(), p.hand.end(), [&](Card& hc){ return hc.id == c.id; });
    if (it != p.hand.end()) {
        p.equip.push_back(*it);
        p.hand.erase(it);
        (c.type == WEAPON ? p.weapon : c.type == ARMOR ? p.armor :
         c.type == MOUNT_OFF ? p.mount_off : p.mount_def) = &p.equip.back();
        addLog(p.name + " 装备了 " + c.name);
    }
}

int Room::dealDamage(Player& source, Player& target, int dmg, bool isAttack, bool isCardEffect) {
    if (dmg <= 0) return 0;
    // 评测机事件
    if (isAttack) {
        if (activeEvent == "毒瘤评测机") dmg = std::max(0, dmg - 1);
        else if (activeEvent == "暴力评测机") dmg += 1;
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
    // 记忆化搜索防具
    if (target.armor && target.armor->name == "记忆化搜索") {
        Card judge = drawCard();
        std::string jSuit = effectiveSuit(judge);
        if (jSuit == "heart") {
            dmg = std::max(0, dmg - 1);
            addLog(target.name + "【记忆化搜索】判定♥减伤");
        }
    }
    // 传奇Au不败（每回合一次防止卡牌效果伤害）
    if (target.profession == "传奇Au选手" && !target.usedUndefeatedThisTurn && isCardEffect) {
        target.usedUndefeatedThisTurn = true;
        addLog(target.name + "【不败】防止了伤害");
        return 0;
    }
    if (dmg > 0) {
        target.hp -= dmg;
        addLog(target.name + " 受到 " + std::to_string(dmg) + " 点伤害");
        source.damageDealtThisTurn += dmg;
        if (target.hp <= 0) {
            // 蒟蒻退役
            if (target.profession == "蒟蒻" && !target.retireUsed) {
                target.retireUsed = true;
                target.hand.clear();
                for (auto& eq : target.equip) discardCard(eq);
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
            // 金牌教练谈心
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
                                auto it = std::find_if(discard.begin(), discard.end(), [](Card& c){return c.name=="AC代码";});
                                if (it != discard.end()) { person->hand.push_back(*it); discard.erase(it); }
                                else person->hand.push_back(drawCard());
                            }
                        }
                        break;
                    }
                }
                if (target.hp <= 0) {
                    target.alive = false;
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
    if (auCount == 0) { gameOver = true; winner = "反贼获胜！"; }
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
    }
}

// ----------------------------- 阶段推进 -----------------------------
void Room::nextPhase() {
    if (gameOver) { phase = GAME_OVER; return; }
    switch (phase) {
    case ROUND_START: {
        Player& p = getPlayer(currentTurn);
        p.evoCandidates.clear();
        // 全员卡常(毒瘤觉醒): 效果持续到毒瘤出题人自己的下一个回合开始
        if (!banWABy.empty() && p.name == banWABy) {
            banWANextTurn = false; banWABy.clear();
            addLog("全员卡常效果结束");
        }
        // 摸鱼怪·颓废: 回合开始时询问玩家选择 (回复1体力 / 摸2牌 / 不使用)
        if (p.depression > 0 && !p.depressionAsked) {
            p.depressionAsked = true;
            startResponse("WAIT_DEPRESSION", p.id, {}, {});
            return; // 等待玩家响应后再继续回合
        }
        if (p.profession == "蒟蒻" && p.hand.empty()) { p.hand.push_back(drawCard()); addLog(p.name + "【抱大腿】空手摸1"); }
        if (p.profession == "退役选手" && p.hp > 1) { p.hp--; for(int i=0;i<2;++i) p.hand.push_back(drawCard()); addLog(p.name + "【挣扎】扣1血摸2"); }
        phase = JUDGE; nextPhase(); break;
    }
    case JUDGE: phase = DRAW; nextPhase(); break;
    case DRAW: {
        Player& p = getPlayer(currentTurn);
        if (p.profession == "划水怪" && !discard.empty()) {
            p.hand.push_back(drawCard());
            auto it = std::find_if(discard.begin(), discard.end(), [](Card& c){ return c.type == BASIC_ATTACK || c.type == BASIC_DODGE || c.type == BASIC_HEAL; });
            if (it != discard.end()) { p.hand.push_back(*it); discard.erase(it); addLog(p.name + "【随缘】摸1+弃牌堆1基本"); }
            else { p.hand.push_back(drawCard()); addLog(p.name + "【随缘】摸2"); }
        } else {
            int drawNum = 2;
            if (p.profession == "萌新" && p.awakened) drawNum++;
            for (int i=0; i<drawNum; ++i) p.hand.push_back(drawCard());
            addLog(p.name + " 摸 " + std::to_string(drawNum) + " 张牌");
        }
        phase = PLAY;
        if (p.skipPlayRounds > 0) { p.skipPlayRounds--; phase = DISCARD; nextPhase(); }
        break;
    }
    case PLAY: break;
    case DISCARD: {
        Player& p = getPlayer(currentTurn);
        int limit = p.hp;
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
        for (auto& pl : players) {
            if (pl.damageDealtThisTurn == 0) pl.noDamageRounds++; else pl.noDamageRounds = 0;
            pl.damageDealtThisTurn = 0;
        }
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
        }
        phase = ROUND_START; nextPhase(); break;
    }
    default: break;
    }
}

void Room::tryEvolutionSelect(Player& p) {
    json cands = json::array();
    for (int cid : p.evoCandidates) {
        auto it = std::find_if(discard.begin(), discard.end(), [&](Card& c){ return c.id == cid; });
        if (it != discard.end()) {
            std::string evoName = evoMap.count(it->name) ? evoMap[it->name] : it->name;
            cands.push_back({{"id", cid}, {"name", it->name}, {"evo", evoName}});
        }
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

    if (card.type == WEAPON || card.type == ARMOR || card.type == MOUNT_OFF || card.type == MOUNT_DEF) {
        equipCard(player, card); result["success"] = true; return true;
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

    // 内部攻击函数（AC代码与神犇碾压）
    auto performAcAttack = [&](Card& usedCard, bool isVirtual = false) -> bool {
        if (targets.empty()) return false;
        // 提前缓存引用指向的值, 避免 discardFromHand 后悬挂引用
        int usedCardId = usedCard.id;
        bool usedCardEvolved = usedCard.evolved;
        // 神犇觉醒·AK全场: 一张AC可指定任意数量目标(万箭齐发, 无视WA)
        bool akAll = player.akAllActive && targets.size() > 1;
        // 次数限制 (慈善评测机: 出牌阶段AC无次数限制)
        if (!akAll && player.acUsedThisTurn >= player.acLimit && activeEvent != "慈善评测机") return false;
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
                addLog(player.name + "【卡常】判定♠，此杀不可被闪 (成功" + std::to_string(player.kachangSuccess) + "次)");
                // 觉醒·全员卡常: 卡常成功2次后, 其他角色下回合不能用WA
                if (player.kachangSuccess >= 2 && !player.awakened) {
                    player.awakened = true;
                    banWANextTurn = true; banWABy = player.name;
                    addLog("⚡ " + player.name + " 觉醒：全员卡常！你的常数，我来守护！其他角色下回合不能使用WA");
                }
            } else {
                addLog(player.name + "【卡常】判定" + jSuit + "，未能卡常");
            }
        }
        int baseDmg = 1;
        if (player.bossDmgBoost) baseDmg += 1;  // 传奇Au觉醒·传奇不朽: 本局剩余伤害+1
        if (player.akioiActive) baseDmg += 1;   // 神犇·AKIOI: 这些杀伤害+1
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
            std::vector<int> waCards;
            if (!kachangForce && !ignoreWA && !akAll) {
                for (size_t i=0; i<target.hand.size(); ++i) if (target.hand[i].name == "WA") waCards.push_back(i);
                if (target.armor && target.armor->name == "并查集") {
                    for (size_t i=0; i<target.hand.size(); ++i) if (target.hand[i].name != "WA") waCards.push_back(i);
                }
            }
            if (!waCards.empty()) {
                json ctx = {{"attacker", pid}, {"card_id", usedCardId}, {"virtual", isVirtual}};
                startResponse("response_wa", tgt, waCards, ctx);
                result["pending"] = "wait_response";
                return true; // 等待目标响应后由 processResponse 继续
            }
            // 直接命中
            if (!isVirtual && !discarded) { discardFromHand(player, cardIdx); discarded = true; }
            dealDamage(player, target, dmg, true);
            player.acUsedThisTurn++;
            // 树状数组看牌
            if (player.weapon && player.weapon->name == "树状数组") {
                json view; for (auto& c : target.hand) view.push_back(c.symbol());
                result["view_hand"] = {{"target", tgt}, {"cards", view}};
            }
            if (dmg > 0 && player.evoTotal < 3 && player.evoTurn < 1 && !usedCardEvolved) {
                player.evoCandidates.push_back(usedCardId);
            }
            // 莫队算法额外目标（简化：自动选择另一个可攻击目标）
            if (player.weapon && player.weapon->name == "莫队算法") {
                for (auto& p : players) {
                    if (p.alive && p.id != tgt && canAttack(pid, p.id)) {
                        addLog(player.name + "【莫队算法】额外攻击 " + p.name);
                        dealDamage(player, p, 1, true);
                        break;
                    }
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

    // AC代码
    if (card.name == "AC代码") return performAcAttack(card, false);
    // 神犇碾压
    if (player.profession == "神犇" && card.isBlack() && card.name != "AC代码") {
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
    // RE
    if (card.name == "RE") {
        if (player.hp == player.max_hp) return false;
        discardFromHand(player, cardIdx);
        player.hp = std::min(player.max_hp, player.hp+1);
        addLog(player.name + " 使用RE回复1体力");
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
        discardFromHand(player, cardIdx);
        // 先检查发起者手中是否有AC
        auto selfAC = std::find_if(player.hand.begin(), player.hand.end(), [](Card& c){ return c.name == "AC代码"; });
        if (selfAC == player.hand.end()) {
            // 发起者无AC，直接受伤
            dealDamage(getPlayer(tgt), player, 1, false);
            addLog(player.name + " 对拍无AC，受到1点伤害");
            result["success"] = true; return true;
        }
        // 发起者有AC，要求其选择一张AC打出
        std::vector<int> acIdxs;
        for (size_t i=0; i<player.hand.size(); ++i) if (player.hand[i].name == "AC代码") acIdxs.push_back(i);
        json ctx = {{"target", tgt}, {"initiator", pid}};
        startResponse("WAIT_DUEL_SELF", pid, acIdxs, ctx);
        result["pending"] = "duel_self_ac";
        return true;
    }
    // 请家长
    if (card.name == "请家长") {
        if (targets.size()!=1) return false;
        Player& target = getPlayer(targets[0]);
        discardFromHand(player, cardIdx);
        if (target.weapon || target.armor || target.mount_off || target.mount_def) {
            Card* eq = target.weapon ? target.weapon : target.armor ? target.armor :
                       target.mount_off ? target.mount_off : target.mount_def;
            auto it = std::find_if(target.equip.begin(), target.equip.end(), [&](Card& c){ return c.id==eq->id; });
            if (it != target.equip.end()) {
                discardCard(*it); target.equip.erase(it);
                (eq==target.weapon ? target.weapon : eq==target.armor ? target.armor :
                 eq==target.mount_off ? target.mount_off : target.mount_def) = nullptr;
                addLog(target.name + " 被请家长弃置装备");
                if (player.evoTotal<3 && player.evoTurn<1) player.evoCandidates.push_back(card.id);
            }
        } else {
            dealDamage(player, target, 1, false);
        }
        result["success"] = true; return true;
    }
    // O2优化
    if (card.name == "O2优化") {
        discardFromHand(player, cardIdx);
        std::vector<int> acIdxs;
        for (size_t i=0; i<player.hand.size(); ++i) {
            if (player.hand[i].name=="AC代码" || (player.profession=="神犇"&&player.hand[i].isBlack())) acIdxs.push_back(i);
        }
        if (!acIdxs.empty()) {
            startResponse("WAIT_O2_CARD", pid, acIdxs, {});
            result["pending"] = "select_o2_card"; return true;
        } else { addLog("无AC可用"); return false; }
    }
    // 传奇Au封神
    if (card.name == "封神" && player.profession == "传奇Au选手" && !player.usedSealThisGame) {
        if (targets.empty() || targets.size()>2) return false;
        discardFromHand(player, cardIdx);
        player.usedSealThisGame = true;
        for (int t : targets) if (isAlive(t)) dealDamage(player, getPlayer(t), 1, false, true);
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
            Card eq = target.equip[idx];
            if (target.weapon && target.weapon->id == eq.id) target.weapon = nullptr;
            if (target.armor && target.armor->id == eq.id) target.armor = nullptr;
            if (target.mount_off && target.mount_off->id == eq.id) target.mount_off = nullptr;
            if (target.mount_def && target.mount_def->id == eq.id) target.mount_def = nullptr;
            target.equip.erase(target.equip.begin()+idx);
            player.equip.push_back(eq);
            Card& eqRef = player.equip.back();
            if (eqRef.type==WEAPON) player.weapon=&eqRef;
            else if (eqRef.type==ARMOR) player.armor=&eqRef;
            else if (eqRef.type==MOUNT_OFF) player.mount_off=&eqRef;
            else if (eqRef.type==MOUNT_DEF) player.mount_def=&eqRef;
            addLog(player.name + "【抄袭代码】获得 " + target.name + " 的装备 " + eq.name);
            stole = true;
        } else { addLog(player.name + " 抄袭代码落空，目标无牌可偷"); }
        if (stole && player.evoTotal<3 && player.evoTurn<1 && !evolved) player.evoCandidates.push_back(card.id);
        result["success"] = true; return true;
    }
    // 重构: 从弃牌堆获得一张牌
    if (card.name == "重构") {
        discardFromHand(player, cardIdx);
        if (!discard.empty()) {
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
        if (targets.empty() || targets.size()>3) return false;
        discardFromHand(player, cardIdx);
        player.examThisTurn = true;
        std::vector<int> valid;
        for (int t : targets) if (isAlive(t) && t != pid) valid.push_back(t);
        if (valid.empty()) { result["success"] = true; return true; }
        json ctx = {{"exam_targets", valid}, {"exam_idx", 0}, {"owner", pid}};
        Player& first = getPlayer(valid[0]);
        std::vector<int> acIdxs;
        for (size_t i=0;i<first.hand.size();++i) if (first.hand[i].name=="AC代码") acIdxs.push_back(i);
        startResponse("WAIT_EXAM_AC", valid[0], acIdxs, ctx);
        result["pending"] = "exam_ac";
        return true;
    }
    // 女装直播 (女装大佬专属): 所有角色摸1, 其他角色弃1, 你获得其中一张
    if (card.name == "女装直播" && player.profession == "女装大佬") {
        discardFromHand(player, cardIdx);
        for (auto& p : players) if (p.alive) p.hand.push_back(drawCard());
        std::vector<Card> dropped;
        for (auto& p : players) {
            if (p.alive && p.id != pid && !p.hand.empty()) {
                int di = randInt(0, (int)p.hand.size()-1);
                dropped.push_back(p.hand[di]);
                addLog(p.name + " 弃置 " + p.hand[di].symbol());
                p.hand.erase(p.hand.begin()+di);
            }
        }
        if (!dropped.empty()) {
            Card got = dropped[randInt(0, (int)dropped.size()-1)];
            player.hand.push_back(got);
            addLog(player.name + "【女装直播】获得 " + got.symbol());
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
            if (discard[i].name == "AC代码") { deck.push_back(discard[i]); discard.erase(discard.begin()+i); moved++; }
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
        bool hasAC = std::any_of(player.hand.begin(), player.hand.end(), [](Card& c){ return c.name == "AC代码"; });
        if (!hasAC) { for(int i=0;i<2;++i) player.hand.push_back(drawCard()); addLog(player.name + " 样例过了，摸2牌"); }
        else {
            auto it = std::find_if(player.hand.begin(), player.hand.end(), [](Card& c){ return c.name=="AC代码"; });
            discardFromHand(player, it - player.hand.begin());
            addLog(player.name + " 弃置一张AC代码");
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
            if (p.hp == 1) { p.hp = 2; addLog(p.name + " 回复1体力"); }
            else if (p.hp == p.max_hp) { p.hp--; addLog(p.name + " 受到1点伤害"); }
        }
        result["success"] = true; return true;
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
        for (auto& eq : p.equip) deck.push_back(eq);
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
        int discarded = 0;
        for (size_t i = 0; i < player.hand.size() && discarded < 2; ) {
            if (player.hand[i].suit == pickSuit) { discardFromHand(player, (int)i); discarded++; }
            else ++i;
        }
        player.usedSkillsThisTurn.insert("chuyuanti");
        std::vector<int> tg;
        if (msg.contains("targets") && msg["targets"].is_array()) {
            json tar = msg["targets"];
            for (size_t i=0;i<tar.size();++i) tg.push_back((int)tar[i]);
        }
        if (tg.empty() || !isAlive(tg[0]) || tg[0] == pid) { result["error"] = "请选择有效目标"; return false; }
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
        discardFromHand(player, redIdx);
        player.usedSkillsThisTurn.insert("zhibo");
        std::vector<int> tg;
        if (msg.contains("targets") && msg["targets"].is_array()) {
            json tar = msg["targets"];
            for (size_t i=0;i<tar.size();++i) tg.push_back((int)tar[i]);
        }
        if (tg.empty() || !isAlive(tg[0]) || tg[0] == pid) { result["error"] = "请选择有效目标"; return false; }
        addLog("📺 " + player.name + "【直播】观看 " + getPlayer(tg[0]).name + " 的手牌");
        startResponse("WAIT_LIVE_TARGET", pid, {}, {{"target", tg[0]}});
        result["pending"] = "live_steal";
        return true;
    }
    result["error"] = "未知技能";
    return false;
}

bool Room::processResponse(int pid, const json& msg, json& result) {
    if (!pending || pending->targetPlayer != pid) return false;
    std::string type = pending->type;
    // 闪避响应
    if (type == "response_wa") {
        int cardIdx = msg.value("card_index", -1);
        int attacker = pending->context["attacker"];
        int cardId = pending->context["card_id"];
        Player& att = getPlayer(attacker);
        Player& target = getPlayer(pid);
        // 全员卡常(毒瘤觉醒): 其他角色不能使用WA, 视为放弃闪避
        bool waBanned = banWANextTurn && target.name != banWABy;
        if (cardIdx < 0 || waBanned) {
            auto it = std::find_if(att.hand.begin(), att.hand.end(), [&](Card& c){ return c.id == cardId; });
            if (it != att.hand.end()) {
                Card usedCard = *it;
                att.hand.erase(it); discardCard(usedCard);
                int dmg = 1; if (att.bossDmgBoost) dmg+=1;
                if (waBanned) addLog(target.name + " 被全员卡常，无法使用WA");
                dealDamage(att, target, dmg, true);
                att.acUsedThisTurn++;
                if (dmg>0 && att.evoTotal<3 && att.evoTurn<1 && !usedCard.evolved) att.evoCandidates.push_back(usedCard.id);
            }
            clearPending(); result["success"]=true; return true;
        }
        if (cardIdx >= (int)target.hand.size()) return false;
        Card& waCard = target.hand[cardIdx];
        bool isUnionFind = (target.armor && target.armor->name == "并查集" && waCard.name != "WA");
        if (!isUnionFind && waCard.name != "WA") return false;
        discardFromHand(target, cardIdx);
        addLog(target.name + (isUnionFind ? " 弃牌当闪" : " 使用 WA 抵消"));
        if (att.weapon && att.weapon->name == "线段树") {
            att.hand.push_back(drawCard()); addLog(att.name + "【线段树】摸1牌");
        }
        auto it = std::find_if(att.hand.begin(), att.hand.end(), [&](Card& c){ return c.id == cardId; });
        bool wasEvolved = (it != att.hand.end()) ? it->evolved : false;
        if (it != att.hand.end()) discardFromHand(att, it - att.hand.begin());
        // AK代码(进化): 被WA抵消时你摸1张牌
        if (wasEvolved) {
            att.hand.push_back(drawCard());
            addLog(att.name + "【AK代码】被抵消，摸1牌");
        }
        // 平衡树: 被闪可弃1牌强制命中
        if (att.weapon && att.weapon->name == "平衡树" && !att.hand.empty()) {
            discardFromHand(att, (int)att.hand.size()-1);
            addLog(att.name + "【平衡树】弃1牌强制命中！");
            int dmg = 1; if (att.bossDmgBoost) dmg+=1;
            dealDamage(att, target, dmg, true);
            att.acUsedThisTurn++;
            clearPending(); result["success"]=true; return true;
        }
        if (!isUnionFind && target.evoTotal<3 && target.evoTurn<1 && !waCard.evolved) target.evoCandidates.push_back(waCard.id);
        clearPending(); result["success"]=true; return true;
    }
    // 模拟赛 - 目标打出AC或受1伤 (逐个目标)
    else if (type == "WAIT_EXAM_AC") {
        json& ctx = pending->context;
        std::vector<int> tlist = ctx["exam_targets"].get<std::vector<int>>();
        int idx = ctx["exam_idx"];
        int owner = ctx["owner"];
        Player& tg = getPlayer(pid);
        int cIdx = msg.value("card_index", -1);
        bool played = false;
        if (cIdx >= 0 && cIdx < (int)tg.hand.size() && tg.hand[cIdx].name == "AC代码") {
            discardFromHand(tg, cIdx);
            addLog(tg.name + " 打出AC代码应对模拟赛");
            played = true;
        }
        if (!played) {
            dealDamage(getPlayer(owner), tg, 1, false);
            addLog(tg.name + " 无AC应对模拟赛，受到1点伤害");
        }
        idx++;
        if (idx < (int)tlist.size()) {
            ctx["exam_idx"] = idx;
            int nt = tlist[idx];
            Player& nt2 = getPlayer(nt);
            std::vector<int> acIdxs;
            for (size_t i=0;i<nt2.hand.size();++i) if (nt2.hand[i].name=="AC代码") acIdxs.push_back(i);
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
        auto it = std::find(p.evoCandidates.begin(), p.evoCandidates.end(), chosenId);
        if (it == p.evoCandidates.end()) return false;
        auto discIt = std::find_if(discard.begin(), discard.end(), [&](Card& c){ return c.id == chosenId; });
        if (discIt == discard.end()) return false;
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
    // O2选目标
    else if (type == "WAIT_O2_TARGET") {
        if (msg.contains("targets") && msg["targets"].is_array() && msg["targets"].size()==1) {
            int tgt = msg["targets"][0];
            if (!isAlive(tgt) || !canAttack(pid, tgt)) return false;
            dealDamage(getPlayer(pid), getPlayer(tgt), 2, true);
            clearPending(); result["success"]=true; return true;
        }
        return false;
    }
    // 对拍 - 发起者选择AC
    else if (type == "WAIT_DUEL_SELF") {
        int selfIdx = msg.value("card_index", -1);
        Player& p = getPlayer(pid);
        if (selfIdx < 0 || selfIdx >= (int)p.hand.size() || p.hand[selfIdx].name != "AC代码") return false;
        discardFromHand(p, selfIdx);
        addLog(p.name + " 对拍中打出一张AC代码");
        int target = pending->context["target"];
        Player& tgtPlayer = getPlayer(target);
        // 检查目标是否有AC
        std::vector<int> tgtAC;
        for (size_t i=0; i<tgtPlayer.hand.size(); ++i) if (tgtPlayer.hand[i].name == "AC代码") tgtAC.push_back(i);
        if (tgtAC.empty()) {
            // 目标无AC，目标受伤
            dealDamage(p, tgtPlayer, 1, false);
            addLog(tgtPlayer.name + " 对拍无AC，受到1点伤害");
            clearPending(); result["success"]=true; return true;
        }
        // 目标有AC，要求目标选择
        json ctx = {{"initiator", pid}, {"target", target}};
        startResponse("WAIT_DUEL_TARGET", target, tgtAC, ctx);
        result["pending"] = "duel_target_ac"; return true;
    }
    // 对拍 - 目标选择AC
    else if (type == "WAIT_DUEL_TARGET") {
        int tgtIdx = msg.value("card_index", -1);
        int target = pending->context["target"];
        Player& tgtPlayer = getPlayer(target);
        if (tgtIdx < 0 || tgtIdx >= (int)tgtPlayer.hand.size() || tgtPlayer.hand[tgtIdx].name != "AC代码") return false;
        discardFromHand(tgtPlayer, tgtIdx);
        addLog(tgtPlayer.name + " 对拍中打出一张AC代码，双方平局");
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
            addLog(getPlayer(pid).name + " 觉醒：公开处刑");
            std::vector<int> victims;
            for (auto& p : players) if (p.alive && p.id != pid) victims.push_back(p.id);
            if (!victims.empty()) {
                int vid = victims[randInt(0, victims.size()-1)];
                Player& v = getPlayer(vid);
                std::vector<int> redIdx;
                for (size_t i=0; i<v.hand.size(); ++i) if (v.hand[i].isRed()) redIdx.push_back(i);
                for (int idx : redIdx) discardFromHand(v, idx);
                addLog(v.name + " 的手牌被公开并弃置所有红色牌");
            }
        }
        clearPending();
        result["success"] = true;
        return true;
    }
    return false;
}

json Room::getStateJson(int viewerId) {
    json st;
    st["my_id"] = viewerId;
    st["phase"] = (int)phase;
    st["current_turn"] = currentTurn;
    st["event"] = activeEvent;
    st["log"] = log;
    st["game_over"] = gameOver;
    st["winner"] = winner;
    st["players"] = json::array();
    for (auto& p : players) {
        json pj;
        pj["id"] = p.id; pj["name"] = p.name; pj["hp"] = p.hp; pj["max_hp"] = p.max_hp;
        pj["alive"] = p.alive;
        pj["identity"] = (viewerId == p.id || players[viewerId].identity == "Au选手") ? p.identity : "?";
        pj["profession"] = p.profession;
        pj["hand_count"] = p.hand.size();
        pj["weapon"] = p.weapon ? p.weapon->name : "";
        pj["armor"] = p.armor ? p.armor->name : "";
        pj["mount_off"] = p.mount_off ? p.mount_off->name : "";
        pj["mount_def"] = p.mount_def ? p.mount_def->name : "";
        pj["depression"] = p.depression;
        pj["awakened"] = p.awakened;
        st["players"].push_back(pj);
    }
    Player& me = getPlayer(viewerId);
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
    if (pending && pending->targetPlayer == viewerId) {
        st["pending"] = {
            {"type", pending->type},
            {"valid_cards", pending->validCards},
            {"context", pending->context}
        };
        // 如果是女装直播等待选择，并且有hand_info，也传给前端
        if (pending->type == "WAIT_LIVE_TARGET" && pending->context.contains("hand_info")) {
            st["pending"]["hand_info"] = pending->context["hand_info"];
        }
    }
    return st;
}