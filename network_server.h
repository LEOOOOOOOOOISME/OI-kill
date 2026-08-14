// ============================================================================
//  network_server.h 实现 OI杀 Web 网络服务器 (Winsock, 无第三方依赖)
//  ---------------------------------------------------------------------------
//  * 监听端口(8080)协议: HTTP网页/API + WebSocket通信
//  * 会话认证(token via cookie/JSON), 采用XOR加密
//  * 游戏/房间/管理员 功能实现
// ============================================================================
#pragma once
#ifndef OI_KILL_NETWORK_SERVER_H
#define OI_KILL_NETWORK_SERVER_H

#include "socket_util.h"
#include "logger.h"
#include "auth.h"
#include "room_manager.h"
#include <string>
#include <memory>
#include <thread>
#include <atomic>
#include <mutex>
#include <map>
#include <set>
#include <vector>

// 游戏会话 (WebSocket): 记录每个在线游戏连接
struct GameSession {
    SOCKET sock;
    std::string token;
    std::string username;
    std::string key;      // 连接时缓存的 XOR 密钥 (顶号通知等场景仍需加密)
    int roomId = -1;
    int playerId = -1;
    std::mutex mtx;
    bool active = true;
};

class WebServer {
public:
    WebServer(unsigned short port, std::shared_ptr<RoomManager> mgr);
    ~WebServer();
    void run();

private:
    unsigned short port_;
    std::shared_ptr<RoomManager> mgr_;
    SOCKET listenSock_ = INVALID_SOCKET;
    std::atomic<bool> running_{true};

    std::mutex sessionsMtx_;
    std::set<GameSession*> gameSessions_;

    void acceptLoop();
    void handleConnection(SOCKET s);
    void handleHttp(SOCKET s, sockutil::HttpRequest& req);
    void handleWebSocket(SOCKET s, sockutil::HttpRequest& req);

    void broadcastToRoom(int roomId, const std::string& payload, int exceptPid = -1);
    void broadcastToLobby(const std::string& payload);
    void broadcastToRoomState(int roomId);
    void closeRoomAndNotify(int roomId, const std::string& hostName);
    void closeRoomIfEmpty(int roomId);
    void removeSession(GameSession* gs);
    void delConn(SOCKET s);
    bool adminAllowed(const sockutil::HttpRequest& req);
    std::string currentUser(const sockutil::HttpRequest& req);
    void handleAdminAction(SOCKET s, sockutil::HttpRequest& req, std::string& resp);
};

#endif
// 计算WebSocket的Accept Key (定义在cpp中)
inline std::string websocketAccept(const std::string& secKey) ;
// SHA1 (CryptoAPI实现, 摘要)
void sha1(const char* data, size_t len, unsigned char* out);


