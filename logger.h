// ============================================================================
//  logger.h —— 文件日志存储 (C++11, 无依赖)
// ============================================================================
#pragma once
#ifndef OI_KILL_LOGGER_H
#define OI_KILL_LOGGER_H

#include <string>
#include <fstream>
#include <mutex>
#include <vector>
#include "socket_util.h"

class Logger {
public:
    static Logger& instance() {
        static Logger L;
        return L;
    }

    // 初始化日志目录
    void setLogDir(const std::string& dir) {
        std::lock_guard<std::mutex> lock(mtx_);
        dir_ = dir;
        ensureDir(dir_);
        roll();
    }

    // 记录一条日志: 等级: message
    void log(const std::string& level, const std::string& msg) {
        std::lock_guard<std::mutex> lock(mtx_);
        ensureDir(dir_);
        if (!fout_.is_open() || needsRoll()) roll();
        fout_ << "[" << sockutil::timestamp() << "] [" << level << "] " << msg << "\n";
        fout_.flush();
        // 保留最近100条在内存
        recent_.push_back("[" + sockutil::timestamp() + "] [" + level + "] " + msg);
        if (recent_.size() > 100) recent_.erase(recent_.begin());
    }

    void info(const std::string& m)  { log("INFO", m); }
    void warn(const std::string& m)  { log("WARN", m); }
    void error(const std::string& m) { log("ERROR", m); }
    void action(const std::string& m){ log("ACTION", m); } // 管理员操作
    void auth(const std::string& m)  { log("AUTH", m); }

    // 返回最近日志 (供管理员界面拉取)
    std::vector<std::string> recent() {
        std::lock_guard<std::mutex> lock(mtx_);
        return recent_;
    }

    // 返回日志目录中的所有日志文件名
    std::vector<std::string> listLogFiles() {
        std::lock_guard<std::mutex> lock(mtx_);
        std::vector<std::string> files;
        std::string pat = dir_ + "\\oi_kill_*.log";
        WIN32_FIND_DATA fd;
        HANDLE h = FindFirstFile(pat.c_str(), &fd);
        if (h != INVALID_HANDLE_VALUE) {
            do { files.push_back(fd.cFileName); } while (FindNextFile(h, &fd));
            FindClose(h);
        }
        return files;
    }

    // 读取某个日志文件内容
    std::string readFile(const std::string& name) {
        std::lock_guard<std::mutex> lock(mtx_);
        std::string full = dir_ + "\\" + name;
        std::ifstream in(full.c_str(), std::ios::binary);
        if (!in) return "";
        std::string content((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        return content;
    }

private:
    Logger() {}
    Logger(const Logger&);
    Logger& operator=(const Logger&);

    void ensureDir(const std::string& dir) {
        CreateDirectory(dir.c_str(), NULL);
    }
    void roll() {
        if (fout_.is_open()) fout_.close();
        fout_.open((dir_ + "\\oi_kill_" + sockutil::dateStamp() + ".log").c_str(), std::ios::app);
        dayKey_ = sockutil::dateStamp();
        openTimeKey_ = fileTimeKey();
    }
    bool needsRoll() {
        return sockutil::dateStamp() != dayKey_ || fileTimeKey() != openTimeKey_;
    }
    std::string fileTimeKey() {
        // 简化: 每2小时滚动一次
        SYSTEMTIME st; GetLocalTime(&st);
        return sockutil::dateStamp() + "_" + std::to_string(st.wHour / 2);
    }

    std::mutex mtx_;
    std::string dir_ = "logs";
    std::ofstream fout_;
    std::string dayKey_;
    std::string openTimeKey_;
    std::vector<std::string> recent_;
};

#endif
