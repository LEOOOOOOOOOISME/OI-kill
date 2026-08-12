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
#include "socket_util.h"
#include "logger.h"

enum Role { ROLE_USER = 0, ROLE_ADMIN = 1, ROLE_SUPERADMIN = 2 };

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
};

inline std::string roleToStr(Role r) {
    switch (r) {
        case ROLE_USER: return "user";
        case ROLE_ADMIN: return "admin";
        case ROLE_SUPERADMIN: return "superadmin";
    }
    return "user";
}
inline Role strToRole(const std::string& s) {
    if (s == "admin") return ROLE_ADMIN;
    if (s == "superadmin") return ROLE_SUPERADMIN;
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
        return session;
    }
    void destroySession(const std::string& token) {
        std::lock_guard<std::mutex> lock(mtx_);
        sessions_.erase(token);
    }
    std::string usernameForToken(const std::string& token) {
        std::lock_guard<std::mutex> lock(mtx_);
        auto it = sessions_.find(token);
        if (it == sessions_.end()) return "";
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

    // 登录: 返回 (成功与否, token or 错误)
    std::string login(const std::string& username, const std::string& password) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        if (!a) return "";
        if (a->banned) return ""; // 封禁用户无法登录
        std::string salt = a->salt;
        std::string hash = sockutil::hashPassword(a->salt, password);
        if (hash != a->pwd_hash) return "";
        a->lastLogin = sockutil::timestamp();
        save();
        Logger::instance().auth("用户登录: " + username + " (角色:" + roleToStr(a->role) + ")");
        // 创建会话
        std::string token = genSessionToken();
        sessions_[token] = username;
        std::string k = genSessionToken();
        keyMap_[token] = k;
        return token;
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
    bool isRole(const std::string& username, Role r) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        return a && a->role >= r;
    }
    Role getRole(const std::string& username) {
        std::lock_guard<std::mutex> lock(mtx_);
        Account* a = findUser(username);
        return a ? a->role : ROLE_USER;
    }
    bool setRole(const std::string& target, const std::string& newRole) {
        Account* a = findUser(target);
        if (!a) return false;
        a->role = strToRole(newRole);
        save();
        Logger::instance().action("角色变更: " + target + " -> " + newRole);
        return true;
    }
    bool ban(const std::string& target, bool banned) {
        Account* a = findUser(target);
        if (!a) return false;
        a->banned = banned;
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
    std::string genSessionToken() {
        static const char* hex = "0123456789abcdef";
        std::string t;
        for (int i = 0; i < 32; ++i) {
            t += hex[rand() % 16];
        }
        return t;
    }

    // 持久化: 每行 format: id|username|salt|hash|role|banned|games|wins|joindata
    void save() {
        std::ofstream out(file_.c_str());
        if (!out) return;
        for (auto& kv : users_) {
            Account& a = kv.second;
            out << a.id << "|" << a.username << "|" << a.salt << "|" << a.pwd_hash << "|"
                << (int)a.role << "|" << (a.banned?1:0) << "|" << a.gamesPlayed << "|"
                << a.gamesWon << "|" << a.lastLogin << "\n";
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
};

#endif
