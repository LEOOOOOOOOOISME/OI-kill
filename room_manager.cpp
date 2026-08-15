#include "room_manager.h"
#include <algorithm>

// ============================================================================
//  room_manager.cpp - OI杀 房间管理
//  - createRoom: 建房间并初始化一局游戏对局板 (Player 槽位/身份/职业/手牌)
//  - addPlayer/removePlayer: 把用户名关联到对局板的槽位
// ============================================================================

std::shared_ptr<Room> RoomManager::createRoom(int numPlayers, bool isPublic,
                                              const std::string& password,
                                              const std::string& name,
                                              const std::string& host) {
    std::lock_guard<std::mutex> lock(mtx);
    int maxPlayers = numPlayers;
    if (maxPlayers < 3) maxPlayers = 3;
    if (maxPlayers > 9) maxPlayers = 9;

    auto room = std::make_shared<Room>();
    room->id = nextRoomId++;
    room->nextCardId = 10000;

    // ---- 初始化牌堆 ----
    auto addCards = [&](const std::string& cname, CardType t, int count) {
        for (int i = 0; i < count; ++i) {
            room->deck.push_back(Card(room->nextCardId++, cname, randSuit(), randInt(1, 13), t));
        }
    };
    // ---- 基本牌 (63) ----
    addCards("做法假了", BASIC_ATTACK, 27);
    addCards("WA", BASIC_DODGE, 18);
    addCards("CCF捐款", BASIC_HEAL, 12);
    addCards("咖啡", BASIC_HEAL, 6);          // 酒: 下张做法假了伤害+1 / 濒死自救
    // ---- 武器 (13) ----
    addCards("树状数组", WEAPON, 1);
    addCards("线段树", WEAPON, 1);
    addCards("平衡树", WEAPON, 1);
    addCards("莫队算法", WEAPON, 1);
    addCards("评测机连发", WEAPON, 1);       // 诸葛连弩: 无次数限制
    addCards("管理员权限", WEAPON, 1);       // 青釭剑: 无视防具
    addCards("双指针", WEAPON, 1);           // 雌雄双股剑: 按手牌数摸/弃
    addCards("冷数据", WEAPON, 1);           // 寒冰剑: 伤害改为弃2
    addCards("暴力枚举", WEAPON, 1);         // 贯石斧: 弃2强制命中
    addCards("手写快排", WEAPON, 1);         // 丈八蛇矛: 2张手牌当杀
    addCards("不死心", WEAPON, 1);           // 青龙偃月刀: 被闪再出杀
    addCards("放手一搏", WEAPON, 1);         // 方天画戟: 最后手牌时3目标
    addCards("拔网线", WEAPON, 1);           // 麒麟弓: 命中弃坐骑
    // ---- 防具 (6) ----
    addCards("并查集", ARMOR, 1);
    addCards("记忆化搜索", ARMOR, 1);
    addCards("玄学判题", ARMOR, 1);          // 八卦阵: 判定红桃当WA
    addCards("黑名单", ARMOR, 1);            // 仁王盾: 黑色杀无效
    addCards("防火墙", ARMOR, 1);            // 藤甲: 免疫AOE, 暴力事件受伤+1
    addCards("AC保护", ARMOR, 1);            // 白银狮子: 受伤至多1, 失去回1
    // ---- 坐骑 (10) ----
    addCards("快速读入", MOUNT_OFF, 5);
    addCards("内存屏障", MOUNT_DEF, 5);
    addCards("对拍", FUNC, 7);
    addCards("爆零", FUNC, 3);
    addCards("停课集训", FUNC, 2);
    addCards("摸鱼", FUNC, 5);
    addCards("抄袭代码", FUNC, 5);
    addCards("请家长", FUNC, 3);
    addCards("O2优化", FUNC, 3);
    addCards("重构", FUNC, 2);
    addCards("模拟赛", FUNC, 1);
    addCards("女装直播", FUNC, 1);
    addCards("手动测评", FUNC, 1);
    addCards("封神", FUNC, 1);
    // 新增锦囊牌: 评测机裁决(TLE/MLE/CE)与OI名梗牌
    addCards("TLE", FUNC, 3);        // 超时: 目标本回合不能使用主动技能
    addCards("MLE", FUNC, 2);        // 内存超限: 目标本回合手牌上限-2
    addCards("CE", FUNC, 2);         // 编译错误: 目标本回合不能使用锦囊
    addCards("骗分", FUNC, 2);       // 回复1点体力
    addCards("申诉", FUNC, 2);       // 从弃牌堆获得1张牌
    addCards("玄学优化", FUNC, 2);   // 目标摸2张
    addCards("卡评测机", FUNC, 1);   // 目标受1点不可闪避伤害
    addCards("板子", FUNC, 1);       // 摸2张并回复1点体力
    addCards("压轴题", FUNC, 1);     // 目标摸1张再弃1张
    // ===== v3.0 新增锦囊牌: AOE / 反制 / 延时锦囊 / OI梗 =====
    addCards("数据加强", FUNC, 2);          // 南蛮入侵: 全员出AC否则1伤
    addCards("评测机抽风", FUNC, 2);        // 万箭齐发: 全员出WA否则1伤
    addCards("CCF放水", FUNC, 1);           // 桃园结义: 全员回1
    addCards("题解大会", FUNC, 1);          // 五谷丰登: 翻等同人数牌轮流选
    addCards("特判", FUNC, 4);              // 无懈可击: 抵消锦囊效果
    addCards("找代打", FUNC, 2);            // 借刀杀人: 令持械者攻击他人
    addCards("链式前向星", FUNC, 2);        // 铁索连环: 横置传导伤害
    addCards("UB", FUNC, 1);                // 闪电: 延时判定黑桃2~9受3伤
    addCards("水群", FUNC, 2);              // 乐不思蜀: 延时非红桃跳过出牌
    addCards("断网", FUNC, 2);              // 兵粮寸断: 延时非梅花跳过摸牌
    addCards("代码审计", FUNC, 3);          // 火攻: 同花色弃牌造成1伤
    // 新增彩蛋牌
    addCards("面向数据编程", SPECIAL_EASTER, 1); // 所有存活角色各摸1张
    addCards("随机种子", SPECIAL_EASTER, 1);     // 摸2张再随机弃1张
    addCards("女装求AC", SPECIAL_EASTER, 1);
    addCards("我样例过了！", SPECIAL_EASTER, 1);
    addCards("评测机崩溃", SPECIAL_EASTER, 1);
    addCards("原题大战", SPECIAL_EASTER, 1);
    addCards("学长讲题", SPECIAL_EASTER, 1);
    addCards("退役失败", SPECIAL_EASTER, 1);
    room->shuffleDeck();

    // ---- 分配身份 ----
    std::vector<std::string> identities;
    if (maxPlayers == 4) {
        identities = {"Au选手", "Ag选手", "摸鱼怪", "反贼"};
    } else if (maxPlayers == 5) {
        identities = {"Au选手", "Ag选手", "反贼", "反贼", "摸鱼怪"};
    } else if (maxPlayers == 3) {
        identities = {"Au选手", "摸鱼怪", "反贼"};
    } else {
        identities.push_back("Au选手");
        identities.push_back("Ag选手");
        identities.push_back("摸鱼怪");
        for (int i = 3; i < maxPlayers; ++i) identities.push_back("反贼");
    }
    std::shuffle(identities.begin(), identities.end(), rng());

    // v3.0: 19 种职业随机抽取
    std::vector<std::string> profs = {
        "萌新","蒟蒻","划水怪","神犇","毒瘤出题人",
        "退役选手","金牌教练","女装大佬","传奇Au选手",
        "学长","评测姬","打表狂魔","玄学选手",
        "键盘侠","抄题解选手","压线选手","水群怪","爆零选手","图灵奖得主"
    };
    // 随机抽取 maxPlayers 个职业分配, 使19种职业都有机会登场
    std::shuffle(profs.begin(), profs.end(), rng());
    profs.resize(maxPlayers);

    for (int i = 0; i < maxPlayers; ++i) {
        Player p;
        p.id = i;
        p.name = "等待加入";
        p.identity = identities[i % identities.size()];
        p.profession = profs[i % profs.size()];
        int baseHp = 4;
        if (p.profession == "毒瘤出题人" || p.profession == "女装大佬" || p.profession == "评测姬" ||
            p.profession == "水群怪" || p.profession == "图灵奖得主") baseHp = 3;
        else if (p.profession == "退役选手") baseHp = 5;
        p.max_hp = baseHp;
        p.hp = baseHp;
        if (p.profession == "图灵奖得主") p.handLimitBonus = 1;  // 被动: 手牌上限+1
        if (p.identity == "Au选手") { p.max_hp += 1; p.hp = p.max_hp; }
        if (p.identity == "摸鱼怪") p.depression = 3;
        room->players.push_back(std::move(p));   // BUG-001: Player 含 unique_ptr, 需移动
    }

    // 发初始手牌 (每人4张)
    for (auto& p : room->players) {
        for (int i = 0; i < 4; ++i) p.hand.push_back(room->drawCard());
    }

    room->currentTurn = 0;
    room->roundCount = 1;
    room->phase = Room::ROUND_START;
    // BUG-209 修复: 不在创建时推进回合 (未满员会挂出异常pending/摸牌), 由满员 resetForStart 启动
    // room->nextPhase();

    rooms[room->id] = room;

    // ---- 记录房间元信息 ----
    RoomInfo info;
    info.id = room->id;
    info.isPublic = isPublic;
    info.playerLimit = maxPlayers;
    info.name = name.empty() ? ("房间#" + std::to_string(room->id)) : name;
    info.password = password;   // 修复: 公开房间也可设密码 (留空=无密码); 私密房间密码必填
    info.host = host;
    roomInfos[room->id] = info;

    return room;
}

void RoomManager::closeRoom(int id) {
    std::lock_guard<std::mutex> lock(mtx);
    rooms.erase(id);
    roomInfos.erase(id);
}

json RoomManager::getRoomsStatus() {
    std::lock_guard<std::mutex> lock(mtx);
    json arr = json::array();
    for (auto& kv : rooms) {
        std::shared_ptr<Room> room = kv.second;
        json rj;
        rj["id"] = room->id;
        rj["player_count"] = (int)room->players.size();
        rj["alive_count"] = (int)std::count_if(room->players.begin(), room->players.end(),
                              [](const Player& p){ return p.alive; });
        rj["current_turn"] = room->currentTurn;
        rj["round"] = room->roundCount;
        rj["phase"] = (int)room->phase;
        rj["event"] = room->activeEvent;
        rj["game_over"] = room->gameOver;
        rj["winner"] = room->winner;
        // 补充房间元信息
        RoomInfo& info = roomInfos[kv.first];
        rj["room_name"] = info.name;
        rj["is_public"] = info.isPublic;
        rj["limit"] = info.playerLimit;
        rj["host"] = info.host;
        rj["started"] = info.started || room->gameOver;
        rj["player_names"] = json::array();
        for (auto& p : room->players) rj["player_names"].push_back(p.name);
        arr.push_back(rj);
    }
    return arr;
}

json RoomManager::getLobbyRooms() {
    std::lock_guard<std::mutex> lock(mtx);
    json arr = json::array();
    for (auto& kv : rooms) {
        std::shared_ptr<Room> room = kv.second;
        RoomInfo& info = roomInfos[kv.first];
        if (!info.isPublic) continue; // 私密房间不进大厅列表
        json rj;
        rj["id"] = room->id;
        rj["name"] = info.name;
        rj["is_public"] = true;
        rj["has_password"] = !info.password.empty();   // 前端据此决定是否弹密码框
        rj["player_limit"] = info.playerLimit;
        int joined = 0;
        for (auto& p : room->players) if (p.name != "等待加入") joined++;
        rj["joined"] = joined;
        rj["host"] = info.host;
        rj["started"] = info.started || room->gameOver;
        rj["full"] = (joined >= info.playerLimit);
        arr.push_back(rj);
    }
    return arr;
}

bool RoomManager::setRoomPublic(int id, bool isPublic) {
    std::lock_guard<std::mutex> lock(mtx);
    if (!roomInfos.count(id)) return false;
    roomInfos[id].isPublic = isPublic;
    return true;
}
bool RoomManager::setRoomPassword(int id, const std::string& pw) {
    std::lock_guard<std::mutex> lock(mtx);
    if (!roomInfos.count(id)) return false;
    roomInfos[id].password = pw;
    return true;
}
bool RoomManager::setRoomLimit(int id, int limit) {
    std::lock_guard<std::mutex> lock(mtx);
    if (!roomInfos.count(id)) return false;
    if (limit < 3 || limit > 9) return false;
    roomInfos[id].playerLimit = limit;
    return true;
}
bool RoomManager::renameRoom(int id, const std::string& name) {
    std::lock_guard<std::mutex> lock(mtx);
    if (!roomInfos.count(id)) return false;
    if (name.empty()) return false;
    roomInfos[id].name = name;
    return true;
}

int RoomManager::roomOfPlayer(const std::string& username) {
    std::lock_guard<std::mutex> lock(mtx);
    for (auto& kv : rooms) {
        for (auto& p : kv.second->players) {
            if (p.name == username) return kv.first;
        }
    }
    return -1;
}

bool RoomManager::addPlayer(int id, const std::string& username,
                            const std::string& password, std::string& err) {
    std::lock_guard<std::mutex> lock(mtx);
    if (!rooms.count(id)) { err = "房间不存在"; return false; }
    if (username.empty()) { err = "用户名为空"; return false; }

    std::shared_ptr<Room> room = rooms[id];
    RoomInfo& info = roomInfos[id];
    if (info.started) { err = "游戏已开始"; return false; }

    // 已在房间
    for (auto& p : room->players) if (p.name == username) return true;

    // 防止同一玩家同时处于多个房间 (#0815-9)
    for (auto& kv : rooms) {
        if (kv.first == id) continue;
        for (auto& p : kv.second->players) {
            if (p.name == username) { err = "你已在其他房间中，请先退出再加入/创建"; return false; }
        }
    }

    // 检查密码 (公开房间也可设密码; 密码为空则无需校验)
    if (!info.password.empty() && info.password != password) {
        err = "密码错误"; return false;
    }

    // 寻找空闲槽位
    int slot = -1;
    for (size_t i = 0; i < room->players.size(); ++i) {
        if (room->players[i].name == "等待加入") { slot = (int)i; break; }
    }
    if (slot < 0) { err = "房间已满"; return false; }

    room->players[slot].name = username;
    if (info.host.empty()) info.host = username;
    // 满员后自动开始对局 (公平重开: 所有人重新发4张牌, 从第1轮开始)
    int joined = 0;
    for (auto& p : room->players) if (p.name != "等待加入") joined++;
    if (joined >= info.playerLimit && !info.started) {
        info.started = true;
        room->resetForStart();
    }
    return true;
}

bool RoomManager::removePlayer(int id, const std::string& username) {
    std::lock_guard<std::mutex> lock(mtx);
    if (!rooms.count(id)) return false;
    std::shared_ptr<Room> room = rooms[id];
    for (auto& p : room->players) {
        if (p.name == username) {
            // BUG-004 修复: 游戏已开始后退出 → 视为阵亡(弃置牌, 退出对局), 不留"幽灵玩家"
            if (roomInfos[id].started && !room->gameOver) {
                for (auto& c : p.hand) room->discard.push_back(c);
                p.hand.clear();
                for (auto& eq : p.equip) room->discard.push_back(*eq);
                p.equip.clear();
                p.weapon = p.armor = p.mount_off = p.mount_def = nullptr;
                p.delayArea.clear();
                p.alive = false;
                p.name = username + "(已退出)";
                p.hp = 0;
                room->checkVictory();
                room->addLog(p.name + " 中途退出, 视为阵亡");
                return true;
            }
            // 未开局退出: 重置槽位为初始状态, 避免后续加入的玩家继承上一名玩家的手牌/装备
            p.name = "等待加入";
            for (auto& eq : p.equip) room->discard.push_back(*eq);
            p.equip.clear();
            p.weapon = p.armor = p.mount_off = p.mount_def = nullptr;
            p.hand.clear();
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
            // BUG-210 修复: 不重新发牌 (等满员后 resetForStart 统一发放, 避免牌堆凭空减少)
            // for (int i = 0; i < 4; ++i) p.hand.push_back(room->drawCard());
            return true;
        }
    }
    return false;
}

bool RoomManager::isRoomFull(int id) {
    std::lock_guard<std::mutex> lock(mtx);
    if (!rooms.count(id)) return false;
    std::shared_ptr<Room> room = rooms[id];
    int joined = 0;
    for (auto& p : room->players) if (p.name != "等待加入") joined++;
    return joined >= roomInfos[id].playerLimit;
}

bool RoomManager::canStart(int id) {
    std::lock_guard<std::mutex> lock(mtx);
    if (!rooms.count(id)) return false;
    RoomInfo& info = roomInfos[id];
    if (info.started) return false;
    int joined = 0;
    for (auto& p : rooms[id]->players) if (p.name != "等待加入") joined++;
    return joined >= 2 && joined >= info.playerLimit; // 满员才能开局
}
