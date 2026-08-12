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
    addCards("AC代码", BASIC_ATTACK, 27);
    addCards("WA", BASIC_DODGE, 18);
    addCards("RE", BASIC_HEAL, 12);
    addCards("树状数组", WEAPON, 1);
    addCards("线段树", WEAPON, 1);
    addCards("平衡树", WEAPON, 1);
    addCards("莫队算法", WEAPON, 1);
    addCards("并查集", ARMOR, 2);
    addCards("记忆化搜索", ARMOR, 2);
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

    std::vector<std::string> profs = {
        "萌新","蒟蒻","划水怪","神犇","毒瘤出题人",
        "退役选手","金牌教练","女装大佬","传奇Au选手"
    };

    for (int i = 0; i < maxPlayers; ++i) {
        Player p;
        p.id = i;
        p.name = "等待加入";
        p.identity = identities[i % identities.size()];
        p.profession = profs[i % profs.size()];
        int baseHp = 4;
        if (p.profession == "毒瘤出题人" || p.profession == "女装大佬") baseHp = 3;
        else if (p.profession == "退役选手") baseHp = 5;
        p.max_hp = baseHp;
        p.hp = baseHp;
        if (p.identity == "Au选手") { p.max_hp += 1; p.hp = p.max_hp; }
        if (p.identity == "摸鱼怪") p.depression = 3;
        room->players.push_back(p);
    }

    // 发初始手牌 (每人4张)
    for (auto& p : room->players) {
        for (int i = 0; i < 4; ++i) p.hand.push_back(room->drawCard());
    }

    room->currentTurn = 0;
    room->roundCount = 1;
    room->phase = Room::ROUND_START;
    room->nextPhase();

    rooms[room->id] = room;

    // ---- 记录房间元信息 ----
    RoomInfo info;
    info.id = room->id;
    info.isPublic = isPublic;
    info.playerLimit = maxPlayers;
    info.name = name.empty() ? ("房间#" + std::to_string(room->id)) : name;
    info.password = isPublic ? "" : password;
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

    // 检查密码 (私密)
    if (!info.isPublic && !info.password.empty() && info.password != password) {
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
    return true;
}

bool RoomManager::removePlayer(int id, const std::string& username) {
    std::lock_guard<std::mutex> lock(mtx);
    if (!rooms.count(id)) return false;
    std::shared_ptr<Room> room = rooms[id];
    for (auto& p : room->players) {
        if (p.name == username) { p.name = "等待加入"; return true; }
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
