
// ============================================================================
//  network_server.cpp 实现 OI杀 Web 网络服务器 (Winsock, 无第三方依赖)
// ============================================================================
#include "network_server.h"
#include "html_content.h"
#include "socket_util.h"
#include <winsock2.h>
#include <wincrypt.h>
#include <windows.h>
#include <cstddef>
#include <thread>
#include <iostream>

using namespace sockutil;

// SHA-1 (Windows CryptoAPI)
void sha1(const char* data, size_t len, unsigned char* out) {
    HCRYPTPROV prov = 0;
    HCRYPTHASH hash = 0;
    if (CryptAcquireContext(&prov, NULL, NULL, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT)) {
        if (CryptCreateHash(prov, CALG_SHA1, 0, 0, &hash)) {
            CryptHashData(hash, (const BYTE*)data, (DWORD)len, 0);
            DWORD sz = 20;
            CryptGetHashParam(hash, HP_HASHVAL, out, &sz, 0);
            CryptDestroyHash(hash);
        }
        CryptReleaseContext(prov, 0);
    }
}
std::string websocketAccept(const std::string& secKey) {
    static const std::string GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    std::string data = secKey + GUID;
    unsigned char digest[20];
    sha1(data.c_str(), data.size(), digest);
    return sockutil::base64Encode(std::string((char*)digest, 20));
}


WebServer::WebServer(unsigned short port, std::shared_ptr<RoomManager> mgr)
    : port_(port), mgr_(mgr) {}

WebServer::~WebServer() {
    running_ = false;
    if (listenSock_ != INVALID_SOCKET) closesocket(listenSock_);
}

void WebServer::delConn(SOCKET s) { closesocket(s); }

void WebServer::run() {
    listenSock_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listenSock_ == INVALID_SOCKET) { Logger::instance().error("创建socket失败"); return; }
    int opt = 1;
    setsockopt(listenSock_, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));
    sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_addr.S_un.S_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(port_);
    if (bind(listenSock_, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        Logger::instance().error("绑定端口 " + std::to_string(port_) + " 失败");
        return;
    }
    if (listen(listenSock_, 32) == SOCKET_ERROR) {
        Logger::instance().error("监听失败");
        return;
    }
    Logger::instance().info("服务器已启动, 监听 " + std::to_string(port_));

    // BUG: 后台超时线程 (测试发现: pending 超时依赖 broadcast 触发; 若玩家挂机/无新操作,
    // 广播停止 → resolvePendingTimeout 永不执行 → 游戏永久死锁)
    std::thread([this]() {
        while (running_) {
            Sleep(800);
            std::vector<int> touched;
            {
                std::lock_guard<std::mutex> lk(mgr_->mtx);
                for (auto& kv : mgr_->rooms) {
                    std::shared_ptr<Room> room = kv.second;
                    if (room && room->pending) {
                        std::string ptype = room->pending->type;
                        room->resolvePendingTimeout();
                        // 超时处理改变了 pending 或推进了流程 → 需要广播
                        if (!room->pending || room->pending->type != ptype) touched.push_back(room->id);
                    }
                }
            }
            for (int rid : touched) broadcastToRoomState(rid);
        }
    }).detach();

    acceptLoop();
}

void WebServer::acceptLoop() {
    while (running_) {
        SOCKET c = accept(listenSock_, NULL, NULL);
        if (c == INVALID_SOCKET) { if (!running_) break; continue; }
        // 解析HTTP请求头 (单线程; 服务器处理)
        std::thread([this, c]() {
            handleConnection(c);
            delConn(c);
        }).detach();
    }
}

void WebServer::handleConnection(SOCKET s) {
    // 处理HTTP请求, 并处理网络异常
    DWORD timeout = 15000;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));

    HttpRequest req;
    if (!parseHttpRequest(s, req)) return;

    // 处理WebSocket握手
    if (toLower(req.headers["upgrade"]) == "websocket") {
        handleWebSocket(s, req);
        return;
    }
    handleHttp(s, req);
}

// ---------------- HTTP API 部分 ----------------
void WebServer::handleHttp(SOCKET s, HttpRequest& req) {
    std::string resp;

    // 处理系统状态查询
    if (req.path == "/api/me") {
        std::string token = req.cookies["session"];
        std::string user = AuthManager::instance().usernameForToken(token);
        if (user.empty()) {
            resp = buildHttpResponse(200, "application/json", "{\"ok\":false,\"msg\":\"未登录\"}");
        } else {
            std::string role = roleToStr(AuthManager::instance().getRole(user));
            std::string key = AuthManager::instance().sessionKey(token);
            json j;
            j["ok"] = true; j["username"] = user; j["role"] = role; j["key"] = key;
            // 彩蛋图鉴解锁列表 (#0816-4)
            j["easter_unlocked"] = json::array();
            for (auto& nm : AuthManager::instance().easterUnlocked(user)) j["easter_unlocked"].push_back(nm);
            resp = buildHttpResponse(200, "application/json", j.dump());
        }
    }
    else if (req.path == "/api/login" && req.method == "POST") {
        // BUG-203: 简单登录限速 - 1秒窗口内最多10次尝试 (防止暴力破解)
        static std::mutex lm;
        static std::map<SOCKET,std::chrono::steady_clock::time_point> lastLogin;
        static std::map<SOCKET,int> loginCount;
        {
            std::lock_guard<std::mutex> g2(lm);
            auto now = std::chrono::steady_clock::now();
            if (lastLogin.count(s) && now - lastLogin[s] > std::chrono::seconds(1)) loginCount[s] = 0;
            if (++loginCount[s] > 10) {
                resp = buildHttpResponse(429, "application/json", "{\"ok\":false,\"msg\":\"尝试过于频繁，请稍后再试\"}");
                return;
            }
            lastLogin[s] = now;
        }
        std::string u = req.query["u"].empty()?req.body:req.query["u"];
        // 处理登录请求
        std::string username, password;
        if (req.headers["content-type"].find("urlencoded") != std::string::npos && !req.body.empty()) {
            std::map<std::string,std::string> form;
            for (auto& kv : split(req.body, '&')) {
                size_t e = kv.find('=');
                if (e == std::string::npos) form[urlDecode(kv)] = "";
                else form[urlDecode(kv.substr(0,e))] = urlDecode(kv.substr(e+1));
            }
            username = form["u"]; password = form["p"];
        } else { username = req.query["u"]; password = req.query["p"]; }
                                std::string token = AuthManager::instance().login(username, password);
        if (AuthManager::instance().isBanned(username)) {
            resp = buildHttpResponse(200, "application/json", "{\"ok\":false,\"msg\":\"该账号已被封禁，请联系管理员\"}");
        } else if (token.empty()) {
            resp = buildHttpResponse(200, "application/json", "{\"ok\":false,\"msg\":\"用户名或密码错误\"}");
        } else {
            std::string key = AuthManager::instance().sessionKey(token);
            std::string cookie = "Set-Cookie: session=" + token + "; Path=/; HttpOnly\r\n";
            json j; j["ok"]=true; j["token"]=token; j["key"]=key;
            resp = buildHttpResponse(200, "application/json", j.dump(), cookie);
        }
    }
    else if (req.path == "/api/register" && req.method == "POST") {
        std::string username, password;
        if (!req.body.empty()) {
            std::map<std::string,std::string> form;
            for (auto& kv : split(req.body, '&')) {
                size_t e = kv.find('=');
                if (e == std::string::npos) form[urlDecode(kv)] = "";
                else form[urlDecode(kv.substr(0,e))] = urlDecode(kv.substr(e+1));
            }
            username = form["u"]; password = form["p"];
        } else { username = req.query["u"]; password = req.query["p"]; }
        std::string err = AuthManager::instance().registerUser(username, password);
        json j; j["ok"]=err.empty();
        if (!err.empty()) j["msg"]=err;
        resp = buildHttpResponse(200, "application/json", j.dump());
    }
    else if (req.path == "/api/logout") {
        std::string token = req.cookies["session"];
        AuthManager::instance().destroySession(token);
        resp = buildHttpResponse(200, "application/json", "{\"ok\":true}", "Set-Cookie: session=; Path=/; Max-Age=0\r\n");
    }
    else if (req.path == "/api/lobby") {
        if (currentUser(req).empty()) { resp = buildHttpResponse(401, "application/json", "{\"ok\":false,\"msg\":\"未登录\"}"); }
        else {
            json j; j["ok"]=true; j["rooms"]=mgr_->getLobbyRooms();
            resp = buildHttpResponse(200, "application/json", j.dump());
        }
    }
    else if (req.path == "/api/create_room" && req.method == "POST") {
        std::string user = currentUser(req);
        if (user.empty()) { resp = buildHttpResponse(401, "application/json", "{\"ok\":false,\"msg\":\"未登录\"}"); }
        else {
            std::map<std::string,std::string> form;
            for (auto& kv : split(req.body.empty()?std::string(req.target.substr(req.target.find('?')+1)):req.body, '&')) {
                size_t e = kv.find('=');
                if (e == std::string::npos) form[urlDecode(kv)]="";
                else form[urlDecode(kv.substr(0,e))] = urlDecode(kv.substr(e+1));
            }
            int num = atoi(form["num"].c_str()); if (num < 3) num = 4;
            bool pub = form["pub"] != "false" && form["pub"] != "0";
            std::string pwd = form["pwd"];
            std::string name = form["name"];
            // 防止一名玩家同时创建/处于多个房间 (#0815-9)
            if (mgr_->roomOfPlayer(user) != -1) {
                resp = buildHttpResponse(200, "application/json", "{\"ok\":false,\"msg\":\"你已在房间中，请先退出房间再创建\"}");
            } else {
                std::shared_ptr<Room> r = mgr_->createRoom(num, pub, pwd, name, user);
                std::string tmpErr;
                mgr_->addPlayer(r->id, user, pwd, tmpErr);
                json j; j["ok"]=true; j["room_id"]=r->id;
                Logger::instance().action("创建 " + user + " 房间 #" + std::to_string(r->id) + " (" + std::to_string(num) + "人 " + (pub?"公开":"私密") + ")");
                resp = buildHttpResponse(200, "application/json", j.dump());
            }
        }
    }
    else if (req.path == "/api/join_room" && req.method == "POST") {
        std::string user = currentUser(req);
        if (user.empty()) { resp = buildHttpResponse(401, "application/json", "{\"ok\":false,\"msg\":\"未登录\"}"); }
        else {
            std::map<std::string,std::string> form;
            std::string raw = req.body.empty()?req.target:req.body;
            for (auto& kv : split(raw, '&')) {
                size_t e = kv.find('='); 
                if (e == std::string::npos && !kv.empty()) { form[urlDecode(kv)]=""; }
                else if (e != std::string::npos) form[urlDecode(kv.substr(0,e))] = urlDecode(kv.substr(e+1));
            }
            int roomId = atoi(form["room_id"].c_str());
            std::string pwd = form["pwd"];
            std::string err;
            bool ok = mgr_->addPlayer(roomId, user, pwd, err);
            json j; j["ok"]=ok; if(!ok) j["msg"]=err.empty()?"加入失败":err;
            if(ok) Logger::instance().action("加入 " + user + " 房间 #" + std::to_string(roomId));
            resp = buildHttpResponse(200, "application/json", j.dump());
        }
    }
    else if (req.path == "/admin") {
        std::string user = currentUser(req);
        if (user.empty()) { resp = buildHttpResponse(302, "text/html", "<html><head><meta http-equiv='refresh' content='0;url=/login'></head></html>"); }
        else if (!AuthManager::instance().isRole(user, ROLE_ADMIN)) {
            resp = buildHttpResponse(403, "text/html", "<html><body><h2>无权限</h2><a href='/'>返回</a></body></html>");
        } else resp = buildHttpResponse(200, "text/html; charset=utf-8", ADMIN_HTML);
    }
    else if (req.path == "/login") {
        resp = buildHttpResponse(200, "text/html; charset=utf-8", LOGIN_HTML);
    }
    else if (req.path == "/" || req.path == "/index.html" || req.path == "/game") {
        std::string user = currentUser(req);
        if (user.empty()) resp = buildHttpResponse(302, "text/html", "<html><head><meta http-equiv='refresh' content='0;url=/login'></head></html>");
        else resp = buildHttpResponse(200, "text/html; charset=utf-8", GAME_HTML);
    }
    else if (req.path == "/api/admin/rooms") {
        if (!adminAllowed(req)) resp = buildHttpResponse(403, "application/json", "{\"ok\":false,\"msg\":\"未登录\"}");
        else { json j; j["ok"]=true; j["rooms"]=mgr_->getRoomsStatus(); resp=buildHttpResponse(200,"application/json",j.dump()); }
    }
    else if (req.path == "/api/admin/users") {
        if (!adminAllowed(req)) resp = buildHttpResponse(403, "application/json", "{\"ok\":false,\"msg\":\"未登录\"}");
        else {
            json arr = json::array();
            std::vector<Account> us = AuthManager::instance().listUsers();
                        for (int i=0;i<(int)us.size();++i) {
                json u; u["id"]=us[i].id; u["username"]=us[i].username;
                u["role"]=us[i].banned ? "banneduser" : roleToStr(us[i].role);
                u["banned"]=us[i].banned; u["gamesPlayed"]=us[i].gamesPlayed; u["gamesWon"]=us[i].gamesWon;
                u["lastLogin"]=us[i].lastLogin; arr.push_back(u);
            }
            json j; j["ok"]=true; j["users"]=arr;
            resp = buildHttpResponse(200, "application/json", j.dump());
        }
    }
    else if (req.path == "/api/admin/close_room" || req.path == "/api/admin/set_public" ||
             req.path == "/api/admin/set_limit" || req.path == "/api/admin/set_ban" ||
             req.path == "/api/admin/set_role" || req.path == "/api/admin/reset_pwd") {
        handleAdminAction(s, req, resp);
    }
    else if (req.path == "/api/admin/logs") {
        if (!adminAllowed(req)) resp = buildHttpResponse(403, "application/json", "{\"ok\":false,\"msg\":\"未登录\"}");
        else {
            json j; j["ok"]=true; j["recent"]=json::array();
            std::vector<std::string> recent = Logger::instance().recent();
            for (size_t i=0;i<recent.size();++i) j["recent"].push_back(recent[i]);
            j["files"]=json::array();
            std::vector<std::string> files = Logger::instance().listLogFiles();
            for (size_t i=0;i<files.size();++i) j["files"].push_back(files[i]);
            resp = buildHttpResponse(200, "application/json", j.dump());
        }
    }
    else if (req.path == "/api/admin/logfile") {
        if (!adminAllowed(req)) resp = buildHttpResponse(403, "application/json", "{\"ok\":false,\"msg\":\"未登录\"}");
        else {
            std::string name = req.query["name"];
            std::string content = Logger::instance().readFile(name);
            resp = buildHttpResponse(200, "text/plain; charset=utf-8", content);
        }
    }
    else {
        resp = buildHttpResponse(404, "text/html", "<html><body><h2>404 不存在</h2></body></html>");
    }
    sendAll(s, resp.data(), resp.size());
}

// 判断是否是管理员
bool WebServer::adminAllowed(const HttpRequest& req) {
    std::string user = currentUser(req);
    return !user.empty() && AuthManager::instance().isRole(user, ROLE_ADMIN);
}

std::string WebServer::currentUser(const HttpRequest& req) {
    std::string token = req.cookies.count("session") ? req.cookies.at("session") : "";
    return AuthManager::instance().usernameForToken(token);
}

void WebServer::handleAdminAction(SOCKET s, HttpRequest& req, std::string& resp) {
    if (!adminAllowed(req)) { resp = buildHttpResponse(403, "application/json", "{\"ok\":false,\"msg\":\"未登录\"}"); return; }
    std::string me = currentUser(req);
    bool isSA = AuthManager::instance().isRole(me, ROLE_SUPERADMIN);
    json j; j["ok"]=false;

    std::map<std::string,std::string> form;
    std::string raw = req.body.empty()?req.target:req.body;
    for (auto& kv : split(raw, '&')) {
        size_t e = kv.find('=');
        if (e == std::string::npos) { if(!kv.empty()) form[urlDecode(kv)]=""; }
        else form[urlDecode(kv.substr(0,e))] = urlDecode(kv.substr(e+1));
    }

    if (req.path == "/api/admin/close_room") {
        int id = atoi(form["room_id"].c_str());
        mgr_->closeRoom(id); j["ok"]=true;
        Logger::instance().action("关闭 " + me + " 房间 #" + std::to_string(id));
    }
    else if (req.path == "/api/admin/set_public") {
        int id = atoi(form["room_id"].c_str()); bool pub = form["pub"]=="1";
        mgr_->setRoomPublic(id, pub); j["ok"]=true;
        Logger::instance().action("修改 " + me + " 房间 #" + std::to_string(id) + " 公开"+(pub?"公开":"私密"));
    }
    else if (req.path == "/api/admin/set_limit") {
        int id = atoi(form["room_id"].c_str()); int lim = atoi(form["limit"].c_str());
        mgr_->setRoomLimit(id, lim); j["ok"]=true;
        Logger::instance().action("修改 " + me + " 房间 #" + std::to_string(id) + " 人数->" + std::to_string(lim));
    }
    else if (req.path == "/api/admin/set_ban") {
        if (!isSA) { j["msg"]="仅超级管理员可封禁"; }
        else {
            int uid = atoi(form["uid"].c_str()); bool ban = form["ban"]=="1";
            std::vector<Account> us = AuthManager::instance().listUsers();
            for (size_t i=0;i<us.size();++i) if (us[i].id==uid) {
                AuthManager::instance().ban(us[i].username, ban); j["ok"]=true; break;
            }
            if (j["ok"]) Logger::instance().action("封禁 " + me + (ban? "封禁 " : "解封 ") + "uid=" + std::to_string(uid));
        }
    }
        else if (req.path == "/api/admin/set_role") {
        if (!isSA) { j["msg"]="仅超级管理员可修改角色"; }
        else {
            int uid = atoi(form["uid"].c_str());
            std::string newRole = form["role"];
            std::vector<Account> us = AuthManager::instance().listUsers();
            for (size_t i=0;i<us.size();++i) if (us[i].id==uid) {
                if (us[i].username == "superadmin") { j["msg"]="不可修改超级管理员账号"; break; }
                AuthManager::instance().setRole(us[i].username, newRole); j["ok"]=true; break;
            }
            if (!j.contains("ok") || !j["ok"]) j["ok"]=false;
        }
    }
    else if (req.path == "/api/admin/reset_pwd") {
        // 重置指定用户/uid的密码
        std::string username, pwd;
        if (!form["uid"].empty() || !form["username"].empty()) {
            // 按uid查找用户
            bool byId = !form["uid"].empty();
            std::vector<Account> us = AuthManager::instance().listUsers();
            for (size_t i=0;i<us.size();++i) {
                bool match = byId ? (us[i].id == atoi(form["uid"].c_str())) : (us[i].username == form["username"]);
                if (match) { username = us[i].username; break; }
            }
            pwd = form["pwd"];
        }
        if (username.empty()) { j["msg"]="用户不存在"; }
        else if (pwd.empty()) { j["msg"]="新密码为空"; }
        else if (AuthManager::instance().resetPassword(username, pwd)) { j["ok"]=true; j["msg"]="已重置 " + username + " 密码"; Logger::instance().action("重置 " + me + " 用户 " + username + " 密码"); }
        else j["msg"]="重置失败";
    }
    resp = buildHttpResponse(200, "application/json", j.dump());
}

// ---------------- WebSocket 部分 ----------------
// 用 Xor 加密: 密文 = base64(xor(key, json))
void WebServer::handleWebSocket(SOCKET s, HttpRequest& req) {
    // WebSocket 长连接: 取消接收超时(阻塞等待), 避免玩家闲置数秒即掉线(bug #3)。
    // 依赖 TCP 保活与客户端/服务器心跳检测死连接。
    DWORD noTimeout = 0;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&noTimeout, sizeof(noTimeout));
    BOOL keepAlive = TRUE;
    setsockopt(s, SOL_SOCKET, SO_KEEPALIVE, (const char*)&keepAlive, sizeof(keepAlive));

    // 从cookie或查询参数获取token
        std::string token = req.cookies["session"];
    if (token.empty()) token = req.query["token"];
    std::string user = AuthManager::instance().usernameForToken(token);
    if (user.empty()) { wsSend(s, "{\"type\":\"error\",\"msg\":\"未登录\"}"); return; }
    std::string key = AuthManager::instance().sessionKey(token);

    // 处理登录请求
    std::string secKey = req.headers["sec-websocket-key"];
    // SHA1+base64 生成Accept Key (基于Windows CryptoAPI)
    std::string acceptKey = websocketAccept(secKey);
    std::string handshake = "HTTP/1.1 101 Switching Protocols\r\n";
    handshake += "Upgrade: websocket\r\nConnection: Upgrade\r\n";
    handshake += "Sec-WebSocket-Accept: " + acceptKey + "\r\n\r\n";
    sendAll(s, handshake.data(), handshake.size());

    GameSession gs;
    gs.sock = s;
    gs.token = token;
    gs.username = user;
    gs.key = key;
    {
        std::lock_guard<std::mutex> lk(sessionsMtx_);
        // 顶号 (#0816-9): 同一账号已有活跃连接时, 先通知旧连接并踢掉
        for (auto it = gameSessions_.begin(); it != gameSessions_.end(); ++it) {
            GameSession* old = *it;
            if (old->active && old->username == user && old->sock != s) {
                // 用旧连接缓存的密钥发送, 保证旧端可解密
                wsSend(old->sock, encryptText(old->key, "{\"type\":\"kicked\",\"msg\":\"你的账号已在其他设备登录，你已被强制下线\"}"));
                old->active = false;
                closesocket(old->sock);
                gameSessions_.erase(it);
                Logger::instance().action("顶号: " + user + " 在另一设备登录, 旧连接被强制下线");
                break;
            }
        }
        gameSessions_.insert(&gs);
    }

    // 处理登录请求
    while (running_) {
        // 权限强化(bug#6): 若账号被封禁, 立即结束其游戏连接
        if (AuthManager::instance().isBanned(user)) {
            wsSend(s, encryptText(key, "{\"type\":\"error\",\"msg\":\"账号已被封禁\"}"));
            break;
        }
        // 顶号检查 (#0816-9): 本会话 token 已被新登录踢掉 → 强制下线并提示
        if (AuthManager::instance().usernameForToken(token) != user) {
            wsSend(s, encryptText(key, "{\"type\":\"kicked\",\"msg\":\"你的账号已在其他设备登录，你已被强制下线\"}"));
            break;
        }
        // 用 select 做 1 秒轮询: 既能及时检测封禁/顶号, 又不会因接收超时导致闲置掉线(#3)
        fd_set rfds;
        FD_ZERO(&rfds);
        FD_SET(s, &rfds);
        timeval tv; tv.tv_sec = 1; tv.tv_usec = 0;
        int sel = select(0, &rfds, NULL, NULL, &tv);
        if (sel < 0) break;       // socket 出错 → 断开
        if (sel == 0) continue;   // 超时 → 回到循环顶部检查封禁/顶号
        std::string payload; bool needClose=false;
        if (!wsRecv(s, payload, needClose)) break;
        if (needClose) break;
                // 解析并处理消息
        try {
            std::string decrypted = decryptText(key, payload);
                        json j = json::parse(decrypted);
            if (!j.is_object()) continue;
                        std::string type = j.value("type", std::string(""));
            if (type == "join_room") {
                // 尝试加入房间 (若已在房间则复用)
                int rId = mgr_->roomOfPlayer(user);
                if (rId < 0) {
                    // 未在房间, 寻找可加入的空闲公开房
                                        json lobby = mgr_->getLobbyRooms();
                    for (size_t i=0;i<lobby.size();++i) {
                        json r = lobby[i];
                        if (!r.value("full",false) && r.value("is_public",true) && !r.value("started",false)) {
                            std::string err;
                            if (mgr_->addPlayer(r.value("id",0), user, "", err)) { rId = r.value("id",0); break; }
                        }
                    }
                }
                if (rId < 0) { wsSend(s, encryptText(key, "{\"type\":\"error\",\"msg\":\"你不在任何房间中，请先创建或加入房间\"}")); }
                else {
                    gs.roomId = rId;
                    // 成功加入, 锁定房间数据
                    {
                        std::lock_guard<std::mutex> lk(mgr_->mtx);
                        if (mgr_->rooms.count(rId)) {
                            std::shared_ptr<Room> room = mgr_->rooms[rId];
                            // 找到用户名对应的对局槽位 (玩家id)
                            int pid = -1;
                            for (size_t pi = 0; pi < room->players.size(); ++pi) {
                                if (room->players[pi].name == user) { pid = (int)pi; break; }
                            }
                            if (pid < 0) {
                                // 不在槽位中, 尝试加入
                                for (size_t pi = 0; pi < room->players.size(); ++pi) {
                                    if (room->players[pi].name == "等待加入") {
                                        room->players[pi].name = user; pid = (int)pi; break;
                                    }
                                }
                            }
                            gs.playerId = pid;
                        }
                    }
                    // 加入成功后广播一次状态 (须在释放 mgr_->mtx 之后调用,
                    // 否则 broadcastToRoomState 会重复加锁导致自死锁)
                    if (gs.playerId >= 0) broadcastToRoomState(rId);
                }
            }
            else if (type == "leave_room") {
                if (gs.roomId >= 0) {
                    int leftRoom = gs.roomId;
                    bool isHost = false;
                    {
                        std::lock_guard<std::mutex> lk(mgr_->mtx);
                        if (mgr_->roomInfos.count(leftRoom) && mgr_->roomInfos[leftRoom].host == user) isHost = true;
                    }
                    if (isHost) {
                        // 房主退出 → 关闭房间并告知其他玩家 (#0815-9)
                        closeRoomAndNotify(leftRoom, user);
                    } else {
                        mgr_->removePlayer(leftRoom, user);
                        closeRoomIfEmpty(leftRoom);   // 房间空无一人时一并关闭
                        broadcastToRoomState(leftRoom);
                    }
                    gs.roomId = -1;
                }
                wsSend(s, encryptText(key, "{\"type\":\"end\",\"msg\":\"已退出房间\"}"));
            }
            else if (type == "chat") {
                // 聊天/消息: scope=room(游戏内) 或 lobby(大厅, 全体在线)
                std::string scope = j.value("scope", std::string("room"));
                std::string text = j.value("text", std::string(""));
                if (text.size() > 200) text = text.substr(0, 200);
                text = trim(text);
                if (text.empty()) continue;
                // BUG-211 修复: scope 校验 - 房间消息需已在房间; 未在房间时强制 lobby
                if (scope != "room" && scope != "lobby") scope = "lobby";
                if (scope == "room" && gs.roomId < 0) scope = "lobby";
                json chat;
                chat["type"] = "chat";
                chat["scope"] = scope;
                chat["from"] = user;
                chat["text"] = text;
                if (scope == "room" && gs.roomId >= 0) {
                    broadcastToRoom(gs.roomId, chat.dump()); // 游戏内消息(含自己)
                } else {
                    broadcastToLobby(chat.dump());           // 大厅消息(全体在线)
                }
            }
            else if (type == "use_card" || type == "response" || type == "use_skill" || type == "skip_phase" || type == "end_turn") {
                if (gs.roomId >= 0) {
                    json result;
                    {
                        std::lock_guard<std::mutex> lk(mgr_->mtx);
                        if (mgr_->rooms.count(gs.roomId)) {
                            std::shared_ptr<Room> room = mgr_->rooms[gs.roomId];

                            // 满员检查: 房间未满员前禁止出牌/响应/使用技能 (bug修复)
                            int joinedCnt = 0;
                            for (size_t pi=0; pi<room->players.size(); ++pi)
                                if (room->players[pi].name != "等待加入") joinedCnt++;
                            bool roomFull = joinedCnt >= mgr_->roomInfos[gs.roomId].playerLimit;
                            if (!roomFull) {
                                result["error"] = "房间尚未满员（" + std::to_string(joinedCnt) + "/" +
                                                  std::to_string(mgr_->roomInfos[gs.roomId].playerLimit) +
                                                  "），满员后游戏开始";
                            } else if (type == "use_card") {
                                // 回合归属校验 (#0815-1: 防止非当前玩家/非出牌阶段出牌)
                                if (room->currentTurn != gs.playerId) { result["error"] = "还没轮到你出牌"; }
                                else if (room->phase != Room::PLAY) { result["error"] = "当前不是出牌阶段"; }
                                else if (room->pending) { result["error"] = "请先处理需要响应的操作"; }
                                else {
                                    int idx = j.value("card_index",-1);
                                    std::vector<int> targets;
                                    if (j.contains("targets") && j.at("targets").is_array()) {
                                        json tar = j.at("targets");
                                        for (size_t i=0;i<tar.size();++i) targets.push_back((int)tar[i]);
                                    }
                                    room->useCard(gs.playerId, idx, targets, result);
                                }
                            } else if (type == "response") {
                                room->processResponse(gs.playerId, j, result);
                            } else if (type == "use_skill") {
                                // 主动技能: 神犇AKIOI / 毒瘤出原题 / 女装直播 等
                                if (room->currentTurn != gs.playerId) { result["error"] = "还没轮到你使用技能"; }
                                else if (room->phase != Room::PLAY) { result["error"] = "当前不是出牌阶段"; }
                                else if (room->pending) { result["error"] = "请先处理需要响应的操作"; }
                                else {
                                    std::string skill = j.value("skill", std::string(""));
                                    room->useSkill(gs.playerId, skill, j, result);
                                }
                            } else if (type == "skip_phase" || type == "end_turn") {
                                if (room->currentTurn == gs.playerId && room->phase == Room::PLAY && !room->pending) {
                                    room->phase = Room::DISCARD; room->nextPhase();
                                }
                            }
                        }
                    }
                    // 技能/卡牌失败时给玩家明确的错误反馈
                    if (result.contains("error")) {
                        std::string errMsg = result.value("error", std::string("操作失败"));
                        wsSend(s, encryptText(key, "{\"type\":\"error\",\"msg\":\"" + errMsg + "\"}"));
                    }
                    // BUG-144 修复: 树状数组看牌结果直接发给操作者
                    if (result.contains("view_hand")) {
                        json vh = {{"type", "view_hand"}, {"view", result["view_hand"]}};
                        wsSend(s, encryptText(key, vh.dump()));
                    }
                    // 释放 mgr_->mtx 后再广播状态, 避免 self-deadlock
                    broadcastToRoomState(gs.roomId);
                }
            }
                } catch (...) {
                    Logger::instance().warn("收到无法解析的WebSocket消息");
                }
    }

    // 清理连接
    if (gs.roomId >= 0) {
        int leftRoom = gs.roomId;
        bool isHost = false;
        {
            std::lock_guard<std::mutex> lk(mgr_->mtx);
            if (mgr_->roomInfos.count(leftRoom) && mgr_->roomInfos[leftRoom].host == user) isHost = true;
        }
        if (isHost) {
            // 房主断线 → 关闭房间并告知 (#0815-9)
            closeRoomAndNotify(leftRoom, user);
        } else {
            mgr_->removePlayer(leftRoom, user);
            closeRoomIfEmpty(leftRoom);
        }
    }
    {
        std::lock_guard<std::mutex> lk(sessionsMtx_);
        gameSessions_.erase(&gs);
    }
}


// 房主退出/断线时: 关闭房间并通知房间内所有玩家 (#0815-9 #0816-5)
void WebServer::closeRoomAndNotify(int roomId, const std::string& hostName) {
    {
        std::lock_guard<std::mutex> lk(sessionsMtx_);
        for (std::set<GameSession*>::iterator it = gameSessions_.begin(); it != gameSessions_.end(); ++it) {
            GameSession* gs = *it;
            if (gs->roomId == roomId && gs->active) {
                json j;
                j["type"] = "room_closed";
                // 房主本人: 人称转换, 提示"已回到大厅"; 其他玩家: 提示房主已退出
                if (gs->username == hostName)
                    j["msg"] = "你已退出房间，已回到大厅";
                else
                    j["msg"] = "房主 " + hostName + " 已退出，房间已关闭，已回到大厅";
                std::string key = gs->key; // 使用连接时缓存的密钥
                wsSend(gs->sock, encryptText(key, j.dump()));
                gs->roomId = -1;
                gs->playerId = -1;
            }
        }
    }
    mgr_->closeRoom(roomId);
    Logger::instance().action("房主 " + hostName + " 退出, 关闭房间 #" + std::to_string(roomId));
}

// 房间已无任何玩家时自动关闭
void WebServer::closeRoomIfEmpty(int roomId) {
    bool empty = true;
    {
        std::lock_guard<std::mutex> lk(mgr_->mtx);
        if (mgr_->rooms.count(roomId)) {
            for (auto& p : mgr_->rooms[roomId]->players) {
                if (p.name != "等待加入") { empty = false; break; }
            }
        }
    }
    if (empty) mgr_->closeRoom(roomId);
}

void WebServer::broadcastToRoom(int roomId, const std::string& payload, int exceptPid) {
    std::lock_guard<std::mutex> lk(sessionsMtx_);
    for (std::set<GameSession*>::iterator it = gameSessions_.begin(); it != gameSessions_.end(); ++it) {
        GameSession* gs = *it;
        if (gs->roomId == roomId && gs->playerId != exceptPid && gs->active) {
            std::lock_guard<std::mutex> sl(gs->mtx);
            std::string key = gs->key; // 使用连接时缓存的密钥
            wsSend(gs->sock, encryptText(key, payload));
        }
    }
}

// 大厅消息: 作为全局聊天频道广播给所有在线会话
// (不再局限于当前停留在大厅的玩家, 游戏中玩家回到大厅后也能看到全部大厅消息)
void WebServer::broadcastToLobby(const std::string& payload) {
    std::lock_guard<std::mutex> lk(sessionsMtx_);
    for (std::set<GameSession*>::iterator it = gameSessions_.begin(); it != gameSessions_.end(); ++it) {
        GameSession* gs = *it;
        if (gs->active) {
            std::lock_guard<std::mutex> sl(gs->mtx);
            std::string key = gs->key; // 使用连接时缓存的密钥
            wsSend(gs->sock, encryptText(key, payload));
        }
    }
}

void WebServer::broadcastToRoomState(int roomId) {
    // 收集目标连接及加密密钥
    std::vector<std::pair<SOCKET,std::string>> targets; // (sock, key)
    std::map<int,int> pidForUser; // 映射: 玩家id -> 对应pid
    {
        std::lock_guard<std::mutex> lk(sessionsMtx_);
        for (std::set<GameSession*>::iterator it = gameSessions_.begin(); it != gameSessions_.end(); ++it) {
            GameSession* gs = *it;
            if (gs->roomId == roomId && gs->active) {
                std::string key = gs->key; // 使用连接时缓存的密钥
                targets.push_back(std::make_pair(gs->sock, key));
            }
        }

    }
    // 解析并处理消息
    std::lock_guard<std::mutex> lk(mgr_->mtx);
    if (!mgr_->rooms.count(roomId)) return;
    std::shared_ptr<Room> room = mgr_->rooms[roomId];
    // 按socket建立 playerId 映射
    std::map<SOCKET,int> sock2pid;
    {
        std::lock_guard<std::mutex> sl(sessionsMtx_);
        for (std::set<GameSession*>::iterator it = gameSessions_.begin(); it != gameSessions_.end(); ++it) {
            GameSession* gs = *it;
            if (gs->roomId == roomId) sock2pid[gs->sock] = gs->playerId;
        }
    }
    for (size_t i=0;i<targets.size();++i) {
        SOCKET s = targets[i].first;
        std::string key = targets[i].second;
        int pid = sock2pid.count(s) ? sock2pid[s] : 0;
                json st = room->getStateJson(pid);
        st["type"] = "state";
        // 房间元信息: 名称/是否已开始 (#0816-6 #0816-7)
        if (mgr_->roomInfos.count(roomId)) {
            st["room_name"] = mgr_->roomInfos[roomId].name;
            st["room_host"] = mgr_->roomInfos[roomId].host;
            st["started"] = mgr_->roomInfos[roomId].started;
        }
        wsSend(s, encryptText(key, st.dump()));
    }
}

void WebServer::removeSession(GameSession* gs) {
    std::lock_guard<std::mutex> lk(sessionsMtx_);
    gameSessions_.erase(gs);
}









