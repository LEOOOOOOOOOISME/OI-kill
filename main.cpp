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

int main() {
    srand((unsigned)time(NULL));

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
    std::cout << "  游戏地址:  http://localhost:8080/\n";
    std::cout << "  登录地址:  http://localhost:8080/login\n";
    std::cout << "  管理地址:  http://localhost:8080/admin\n";
    std::cout << "  默认账号:  superadmin / admin123\n";
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
