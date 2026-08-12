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
    // 退役选手回忆
    if (target.profession == "退役选手") {
        Card judge = drawCard();
        if (judge.suit == "spade") {
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
        if (judge.suit == "heart") {
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
    if (gameOver) { phase = GAME_OVER; addLog("游戏结束：" + winner); }
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
        if (p.depression > 0 && (p.hp < p.max_hp || p.hand.size() < 3)) {
            if (p.hp < p.max_hp) { p.hp = std::min(p.max_hp, p.hp+1); addLog(p.name + " 使用颓废回复1体力"); p.depression--; }
            else { for(int i=0;i<2;++i) p.hand.push_back(drawCard()); addLog(p.name + " 使用颓废摸2牌"); p.depression--; }
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

    // 内部攻击函数（AC代码与神犇碾压）
    auto performAcAttack = [&](Card& usedCard, bool isVirtual = false) -> bool {
        if (targets.size() != 1) return false;
        int tgt = targets[0];
        if (!canAttack(pid, tgt)) return false;
        if (player.acUsedThisTurn >= player.acLimit) return false;
        bool forceHit = false;
        if (player.profession == "毒瘤出题人" && !player.usedKangThisTurn) {
            player.usedKangThisTurn = true;
            Card judge = drawCard();
            if (judge.suit == "spade") { forceHit = true; addLog(player.name + "【卡常】判定♠，此杀不可被闪"); }
        }
        Player& target = getPlayer(tgt);
        std::vector<int> waCards;
        if (!forceHit) {
            for (size_t i=0; i<target.hand.size(); ++i) if (target.hand[i].name == "WA") waCards.push_back(i);
            if (target.armor && target.armor->name == "并查集") {
                for (size_t i=0; i<target.hand.size(); ++i) if (target.hand[i].name != "WA") waCards.push_back(i);
            }
        }
        if (!waCards.empty()) {
            json ctx = {{"attacker", pid}, {"card_id", usedCard.id}, {"virtual", isVirtual}};
            startResponse("response_wa", tgt, waCards, ctx);
            result["pending"] = "wait_response";
            return true;
        }
        // 直接命中
        if (!isVirtual) discardFromHand(player, cardIdx);
        int dmg = 1;
        if (player.bossDmgBoost) dmg += 1;
        dealDamage(player, target, dmg, true);
        player.acUsedThisTurn++;
        // 树状数组看牌
        if (player.weapon && player.weapon->name == "树状数组") {
            json view; for (auto& c : target.hand) view.push_back(c.symbol());
            result["view_hand"] = {{"target", tgt}, {"cards", view}};
        }
        if (dmg > 0 && player.evoTotal < 3 && player.evoTurn < 1 && !usedCard.evolved) {
            player.evoCandidates.push_back(usedCard.id);
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
        result["success"] = true;
        return true;
    };

    // AC代码
    if (card.name == "AC代码") return performAcAttack(card, false);
    // 神犇碾压
    if (player.profession == "神犇" && card.isBlack() && card.name != "AC代码") {
        addLog(player.name + "【碾压】将 " + card.symbol() + " 当作AC使用");
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

bool Room::processResponse(int pid, const json& msg, json& result) {
    if (!pending || pending->targetPlayer != pid) return false;
    std::string type = pending->type;
    // 闪避响应
    if (type == "response_wa") {
        int cardIdx = msg.value("card_index", -1);
        int attacker = pending->context["attacker"];
        int cardId = pending->context["card_id"];
        bool virtualCard = pending->context.value("virtual", false);
        Player& att = getPlayer(attacker);
        if (cardIdx < 0) {
            auto it = std::find_if(att.hand.begin(), att.hand.end(), [&](Card& c){ return c.id == cardId; });
            if (it != att.hand.end()) {
                Card usedCard = *it;
                att.hand.erase(it); discardCard(usedCard);
                Player& target = getPlayer(pid);
                int dmg = 1; if (att.bossDmgBoost) dmg+=1;
                dealDamage(att, target, dmg, true);
                att.acUsedThisTurn++;
                if (dmg>0 && att.evoTotal<3 && att.evoTurn<1 && !usedCard.evolved) att.evoCandidates.push_back(usedCard.id);
            }
            clearPending(); result["success"]=true; return true;
        }
        Player& target = getPlayer(pid);
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
        if (it != att.hand.end()) discardFromHand(att, it - att.hand.begin());
        if (!isUnionFind && target.evoTotal<3 && target.evoTurn<1 && !waCard.evolved) target.evoCandidates.push_back(waCard.id);
        clearPending(); result["success"]=true; return true;
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