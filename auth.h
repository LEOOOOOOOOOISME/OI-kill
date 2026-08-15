// ============================================================================
//  auth.h —— 用户/角色管理 (C++11, 无依赖)
//  ---------------------------------------------------------------------------
//  角色体系:  user(普通用户) / admin(管理员) / superadmin(超级管理员)
//  密码:      使用加盐哈希存储, 不可逆, 管理员也无法查看明文(满足需求)
//  功能:      注册/登录/修改密码/重置密码/封禁/解封/角色升降级
//  持久化:    保存到 users.dat (仅供本机使用; 密码仅存储哈希)
// ============================================================================
#pragma once
#ifndef OI_KILL_AUTH_H
#define OI_KILL_AUTH_H

#include <string>
#include <vector>
#include <map>
#include <mutex>
#include <fstream>
#include <sstream>
#include <cstdlib>
#include <random>
#include <chrono>
#include <ctime>   // BUG-204: std::time 会话过期
#include "socket_util.h"
#include "logger.h"

enum Role { ROLE_BANNEDUSER = -1, ROLE_USER = 0, ROLE_ADMIN = 1, ROLE_SUPERADMIN = 2 };

struct Account {
    int id = 0;
    std::string username;
    std::string salt;
    std::string pwd_hash;      // 只有哈希, 不可逆
    Role role = ROLE_USER;
    bool banned = false;
    int gamesPlayed = 0;
    int gamesWon = 0;
    long long joinTime = 0;
    std::string lastLogin;
    std::string easterUnlocked; // 已触发的彩蛋牌名, 逗号分隔 (卡片图鉴彩蛋解锁, #0816-4)
};

// 权限层级: banneduser < user < admin < superadmin
inline int roleLevel(Role r) {
    if (r == ROLE_SUPERADMIN) return 3;
    if (r == ROLE_ADMIN) return 2;
    if (r == ROLE_BANNEDUSER) return 0;
    return 1;
}
inline std::string roleToStr(Role r) {
    switch (r) {
        case ROLE_BANNEDUSER: return "banneduser";
        case ROLE_USER: return "user";
        case ROLE_ADMIN: return "admin";
        case ROLE_SUPERADMIN: return "superadmin";
    }
    return "user";
}
inline Role strToRole(const std::string& s) {
    if (s == "admin") return ROLE_ADMIN;
    if (s == "superadmin") return ROLE_SUPERADMIN;
    if (s == "banneduser") return ROLE_BANNEDUSER;
    return ROLE_USER;
}
// 用户名合法性: 仅允许 字母/数字/下划线/连字符/中文, 避免注入
inline bool validUsername(const std::string& u) {
    if (u.empty()) return false;
    for (unsigned char c : u) {
        if (c >= 'a' && c <= 'z') continue;
        if (c >= 'A' && c <= 'Z') continue;
        if (c >= '0' && c <= '9') continue;
        if (c == '_' || c == '-') continue;
        if (c >= 0x80) continue; // UTF-8 中文等多字节直接放行
        return false;            // 空格/|/控制符/<>&等一律拒绝
    }
    return true;
}

class AuthManager {
public:
    static AuthManager& instance() {
        static AuthManager A;
        return A;
    }

    void init(const std::string& dataFile) {
        std::lock_guard<std::mutex> lock(mtx_);
        file_ = dataFile;
        load();
        if (users_.empty()) {
            // 首次运行, 创建默认超级管理员
            createUserInternal("superadmin", "admin123", ROLE_SUPERADMIN);
            CreateDirectory("logs", NULL);
            Logger::instance().setLogDir("logs");
            Logger::instance().auth("首次运行: 创建默认超级管理员 superadmin / admin123");
            save();
        } else {
            Logger::instance().setLogDir("logs");
        }
        nextId_ = (int)users_.size() + 1;
    }

    // ---------- 会话 / 会话密钥 ----------
    // 登录成功返回 token (会话id), 同时建立该token对应的加密通信密钥
    std::string createSession(const std::string& username) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        if (!a) return "";
        std::string session = genSessionToken();
        sessions_[session] = username;
        sessionBirth_[session] = std::time(nullptr);   // BUG-204: 记录会话创建时间
        return session;
    }
    void destroySession(const std::string& token) {
        std::lock_guard<std::mutex> lock(mtx_);
        sessions_.erase(token);
        sessionBirth_.erase(token);
    }
    std::string usernameForToken(const std::string& token) {
        std::lock_guard<std::mutex> lock(mtx_);
        auto it = sessions_.find(token);
        if (it == sessions_.end()) return "";
        // BUG-204 修复: 会话24小时过期
        auto bit = sessionBirth_.find(token);
        if (bit != sessionBirth_.end() && std::time(nullptr) - bit->second > 24*3600) {
            sessions_.erase(it);
            sessionBirth_.erase(bit);
            keyMap_.erase(token);
            return "";
        }
        return it->second;
    }
    // 会话密钥 (每个会话独立, 用于 XOR 加密数据流)
    std::string sessionKey(const std::string& token) {
        std::lock_guard<std::mutex> lock(mtx_);
        auto it = keyMap_.find(token);
        if (it == keyMap_.end()) {
            std::string k = genSessionToken();
            keyMap_[token] = k;
            return k;
        }
        return it->second;
    }

    // ---------- 注册 / 登录 / 认证 ----------
    // 注册: 返回错误信息, 空串表示成功
    std::string registerUser(const std::string& username, const std::string& password) {
        std::lock_guard<std::mutex> lock(mtx_);
        if (username.empty() || password.empty()) return "用户名和密码不能为空";
        if (username.size() > 20) return "用户名过长";
        if (!validUsername(username)) return "用户名含非法字符 (仅限字母/数字/下划线/中文)";
        if (password.size() < 4) return "密码至少4位";
        if (findUser(username)) return "用户名已存在";
        createUserInternal(username, password, ROLE_USER);
        save();
        Logger::instance().auth("用户注册: " + username);
        return "";
    }

    // 登录: 返回 (成功 token) 或空串(失败)。封禁用户也会拒绝。
    // 单设备登录: 同一账号新登录会踢掉旧的会话(token)。
    std::string login(const std::string& username, const std::string& password) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        if (!a) return "";
        if (a->banned) return ""; // 封禁用户无法登录
        std::string salt = a->salt;
        std::string hash = sockutil::hashPassword(a->salt, password);
        if (hash != a->pwd_hash) return "";
        a->lastLogin = sockutil::timestamp();
        // 踢掉该账号的旧会话(单设备登录, bug#5)
        for (auto it = sessions_.begin(); it != sessions_.end();) {
            if (it->second == username) {
                keyMap_.erase(it->first);
                it = sessions_.erase(it);
            } else ++it;
        }
        save();
        Logger::instance().auth("用户登录: " + username + " (角色:" + roleToStr(a->role) + ")");
        // 创建会话
        std::string token = genSessionToken();
        sessions_[token] = username;
        std::string k = genSessionToken();
        keyMap_[token] = k;
        return token;
    }

    // 判断用户是否被封禁
    bool isBanned(const std::string& username) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        return a ? a->banned : false;
    }

    // 修改自己的密码
    bool changePassword(const std::string& username, const std::string& oldPwd, const std::string& newPwd) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        if (!a) return false;
        if (sockutil::hashPassword(a->salt, oldPwd) != a->pwd_hash) return false;
        a->salt = sockutil::genSalt();
        a->pwd_hash = sockutil::hashPassword(a->salt, newPwd);
        save();
        Logger::instance().action("修改密码: " + username);
        return true;
    }

    // 重置密码 (管理员/超管可对任意用户执行, 不查看明文)
    bool resetPassword(const std::string& username, const std::string& newPwd) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        if (!a) return false;
        a->salt = sockutil::genSalt();
        a->pwd_hash = sockutil::hashPassword(a->salt, newPwd);
        save();
        Logger::instance().action("管理员重置密码: " + username);
        return true;
    }

    // ---------- 管理员管理功能 ----------
    // 权限判断: 按层级 banneduser < user < admin < superadmin; 封禁用户无任何权限
    bool isRole(const std::string& username, Role r) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        if (!a || a->banned) return false;
        return roleLevel(a->role) >= roleLevel(r);
    }
    Role getRole(const std::string& username) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        if (!a) return ROLE_USER;
        if (a->banned) return ROLE_BANNEDUSER;
        return a->role;
    }
    // 设置角色/封禁: 支持 user/admin/superadmin/banneduser 四级
    bool setRole(const std::string& target, const std::string& newRoleStr) {
        Account* a = findUser(target);
        if (!a) return false;
        // BUG-202 修复: superadmin 不可被降级/封禁
        if (a->username == "superadmin") return false;
        Role newRole = strToRole(newRoleStr);
        if (newRoleStr == "banneduser") {
            a->banned = true;            // 封禁用户
            a->role = ROLE_USER;
        } else {
            a->banned = false;           // 其他角色均解除封禁
            a->role = newRole;
        }
        save();
        Logger::instance().action("角色变更: " + target + " -> " + roleToStr(a->banned ? ROLE_BANNEDUSER : a->role));
        return true;
    }
    bool ban(const std::string& target, bool banned) {
        Account* a = findUser(target);
        if (!a) return false;
        // BUG-202 修复: superadmin 不可被封禁
        if (a->username == "superadmin") return false;
        a->banned = banned;              // 封禁/解封
        if (banned) {
            // 封禁时踢掉该账号所有在线会话
            for (auto it = sessions_.begin(); it != sessions_.end();) {
                if (it->second == target) {
                    keyMap_.erase(it->first);
                    it = sessions_.erase(it);
                } else ++it;
            }
        }
        save();
        Logger::instance().action(std::string(banned ? "封禁" : "解封") + ": " + target);
        return true;
    }
    bool userExists(const std::string& u) {
        std::lock_guard<std::mutex> lock(mtx_);
        return findUser(u) != nullptr;
    }

    // 列出所有用户 (不含密码哈希, 满足"管理员管理一切但看不到密码")
    std::vector<Account> listUsers() {
        std::lock_guard<std::mutex> lock(mtx_);
        std::vector<Account> out;
        for (auto& kv : users_) out.push_back(kv.second);
        return out;
    }

    // ---------- 彩蛋图鉴解锁 (#0816-4) ----------
    // 玩家在游戏中抽到/使用某张彩蛋牌后解锁; 解锁信息按账号持久化
    void unlockEaster(const std::string& username, const std::string& cardName) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        if (!a || cardName.empty()) return;
        std::string& set = a->easterUnlocked;
        if (set.find(cardName) != std::string::npos) return;
        if (!set.empty()) set += ",";
        set += cardName;
        save();
    }
    // 返回该用户已解锁的彩蛋牌名列表
    std::vector<std::string> easterUnlocked(const std::string& username) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        std::vector<std::string> out;
        if (!a || a->easterUnlocked.empty()) return out;
        std::vector<std::string> parts = sockutil::split(a->easterUnlocked, ',');
        for (auto& p : parts) if (!p.empty()) out.push_back(p);
        return out;
    }

private:
    Account* findUser(const std::string& u) {
        auto it = users_.find(u);
        return it == users_.end() ? nullptr : &it->second;
    }
    void createUserInternal(const std::string& username, const std::string& password, Role r) {
        Account a;
        a.id = nextId_++;
        a.username = username;
        a.salt = sockutil::genSalt();
        a.pwd_hash = sockutil::hashPassword(a.salt, password);
        a.role = r;
        a.joinTime = (long long)time(NULL);
        users_[username] = a;
    }
    // 会话令牌 / 密钥: 使用 std::random_device + 时间 + 计数器 生成,
    // 避免 MinGW 下 rand() 确定性导致所有会话拿到相同 token/key。
    static std::string genSessionToken() {
        static std::mt19937_64 rng(std::random_device{}()
                                   ^ (std::chrono::steady_clock::now().time_since_epoch().count()));
        static unsigned long long counter = 0;
        const char* hex = "0123456789abcdef";
        std::string t;
        unsigned long long v = 0;
        auto rd = [&]() {
            v = rng();
            v ^= (unsigned long long)time(NULL) * 1315423911ULL;
            v ^= (counter++) * 2654435761ULL;
            return v;
        };
        for (int i = 0; i < 32; ++i) {
            if (i % 8 == 0) rd();
            t += hex[(v >> ((i % 8) * 4)) & 0xF];
        }
        return t;
    }

    // 持久化: 每行 format: id|username|salt|hash|role|banned|games|wins|joindata|easterUnlocked
    void save() {
        std::ofstream out(file_.c_str());
        if (!out) return;
        for (auto& kv : users_) {
            Account& a = kv.second;
            out << a.id << "|" << a.username << "|" << a.salt << "|" << a.pwd_hash << "|"
                << (int)a.role << "|" << (a.banned?1:0) << "|" << a.gamesPlayed << "|"
                << a.gamesWon << "|" << a.lastLogin << "|" << a.easterUnlocked << "\n";
        }
        out.flush();
    }
    void load() {
        std::ifstream in(file_.c_str());
        if (!in) return;
        std::string line;
        while (std::getline(in, line)) {
            std::vector<std::string> p = sockutil::split(line, '|');
            if (p.size() < 9) continue;
            Account a;
            a.id = atoi(p[0].c_str());
            a.username = p[1];
            a.salt = p[2];
            a.pwd_hash = p[3];
            a.role = (Role)atoi(p[4].c_str());
            a.banned = atoi(p[5].c_str()) == 1;
            a.gamesPlayed = atoi(p[6].c_str());
            a.gamesWon = atoi(p[7].c_str());
            a.lastLogin = p[8];
            if (p.size() >= 10) a.easterUnlocked = p[9]; // 旧数据无此字段, 保持空
            users_[a.username] = a;
            if (a.id >= nextId_) nextId_ = a.id + 1;
        }
    }

    std::mutex mtx_;
    std::string file_ = "users.dat";
    int nextId_ = 1;
    std::map<std::string, Account> users_;
    std::map<std::string, std::string> sessions_; // token -> username
    std::map<std::string, std::string> keyMap_;   // token -> xor key
    std::map<std::string, long long> sessionBirth_; // BUG-204: token -> 创建时间戳(秒)
};

#endif
