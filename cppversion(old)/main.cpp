// ============================================================================
//  OI杀 游戏服务器 (基于Winsock, 无Boost, C++11)
// ============================================================================
#include "socket_util.h"
#include "logger.h"
#include "auth.h"
#include "room_manager.h"
#include "network_server.h"
#include <iostream>
#include <memory>
#include <vector>
#include <string>

// 枚举本机所有非回环 IPv4 地址 (用于在 cmd 窗口显示局域网访问地址)
static std::vector<std::string> localIPv4Addresses() {
    std::vector<std::string> ips;
    char host[256] = {0};
    if (gethostname(host, sizeof(host)) != 0) return ips;
    addrinfo hints;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* res = NULL;
    if (getaddrinfo(host, NULL, &hints, &res) == 0) {
        for (addrinfo* p = res; p != NULL; p = p->ai_next) {
            sockaddr_in* sa = (sockaddr_in*)p->ai_addr;
            // inet_ntoa 返回静态缓冲区, 仅启动时调用一次, 可安全使用
            std::string s(inet_ntoa(sa->sin_addr));
            if (s != "127.0.0.1" && s != "0.0.0.0") ips.push_back(s);
        }
        freeaddrinfo(res);
    }
    return ips;
}

int main() {
    srand((unsigned)time(NULL));
    // 设置控制台为 UTF-8 代码页, 使中文能在 Windows Terminal / chcp 65001 下正常显示,
    // 避免 GBK 控制台把 UTF-8 中文显示成 "?"。
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);

    // 初始化 Winsock
    sockutil::WsaInit wsa;

    // 设置日志目录
    Logger::instance().setLogDir("logs");
    Logger::instance().info("=== OI杀 游戏服务器 ===");

    // 初始化用户数据库 (users.dat)
    AuthManager::instance().init("users.dat");

    // 初始化房间管理器
    auto roomMgr = std::make_shared<RoomManager>();

    // 启动 Web 服务器 (HTTP协议 + API + WebSocket, 端口8080)
    WebServer server(8080, roomMgr);
    std::cout << "============================================\n";
    std::cout << "  OI杀 游戏服务器 (端口 8080)\n";
    // 显示本机局域网 IP, 方便内网其他电脑访问 (不再只显示 localhost)
    std::vector<std::string> ips = localIPv4Addresses();
    if (ips.empty()) {
        std::cout << "  本机访问:  http://localhost:8080/\n";
    } else {
        for (size_t i = 0; i < ips.size(); ++i) {
            std::cout << "  本机地址:  http://" << ips[i] << ":8080/\n";
            Logger::instance().info(std::string("局域网地址: http://") + ips[i] + ":8080/");
        }
    }
    std::cout << "  登录地址:  http://localhost:8080/login\n";
    std::cout << "  管理地址:  http://localhost:8080/admin\n";
    std::cout << "  默认账号:  superadmin / admin123\n";
    std::cout << "  若局域网其他电脑无法访问, 请以管理员身份运行:\n";
    std::cout << "  netsh advfirewall firewall add rule name=\"OIKill8080\" dir=in action=allow protocol=TCP localport=8080\n";
    std::cout << "============================================\n";
    Logger::instance().info("OI杀 网络服务已启动 端口8080");

    try {
        server.run();
    } catch (std::exception& e) {
        Logger::instance().error(std::string("错误: ") + e.what());
        std::cerr << "错误: " << e.what() << std::endl;
        return 1;
    }

    Logger::instance().info("=== OI杀 游戏服务器 ===");
    return 0;
}
