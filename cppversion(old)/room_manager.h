#pragma once
#include "game_engine.h"
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <vector>
#include <string>
#include <nlohmann/json.hpp>

// 房间信息: 支持公开/私密、人数上限、房间密码、房主
struct RoomInfo {
    int id = 0;
    bool isPublic = true;       // true=公开, false=私密
    int playerLimit = 4;        // 目标人数 (3~9)
    std::string name = "房间";
    std::string password = "";  // 私密房间密码
    std::string host = "";      // 房主用户名
    bool started = false;
    std::vector<std::string> players; // 已加入的用户名
};

class RoomManager {
public:
    std::mutex mtx;
    std::map<int, std::shared_ptr<Room>> rooms;   // 游戏实例
    std::map<int, RoomInfo> roomInfos;            // 房间元信息
    int nextRoomId = 1;

    // 创建房间 (含玩家数、公开/私密、密码、房主)
    std::shared_ptr<Room> createRoom(int numPlayers, bool isPublic, const std::string& password,
                                     const std::string& name, const std::string& host);
    void closeRoom(int id);
    json getRoomsStatus();   // 供大厅/管理员查看

    // 大厅列表 (用户可见, 私密房间不显示密码)
    json getLobbyRooms();

    // 房间管理
    bool setRoomPublic(int id, bool isPublic);
    bool setRoomPassword(int id, const std::string& pw);
    bool setRoomLimit(int id, int limit);
    bool renameRoom(int id, const std::string& name);
    int roomOfPlayer(const std::string& username);

    // 加入/离开
    bool addPlayer(int id, const std::string& username, const std::string& password, std::string& err);
    bool removePlayer(int id, const std::string& username);
    bool isRoomFull(int id);
    bool canStart(int id);
};

