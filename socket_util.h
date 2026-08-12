// ============================================================================
//  socket_util.h —— 轻量 Winsock 网络工具 (C++11, 无第三方依赖)
//  用于 Dev-C++ / TDM-GCC 环境, 替换 Boost.Asio/Beast
// ============================================================================
#pragma once
#ifndef OI_KILL_SOCKET_UTIL_H
#define OI_KILL_SOCKET_UTIL_H

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

#include <string>
#include <vector>
#include <memory>
#include <functional>
#include <map>
#include <sstream>
#include <cstring>

#pragma comment(lib, "ws2_32.lib")

namespace sockutil {

// ---------------- 网络初始化 ----------------
class WsaInit {
public:
    WsaInit() {
        WSADATA d;
        WSAStartup(MAKEWORD(2, 2), &d);
    }
    ~WsaInit() { WSACleanup(); }
};

// ---------------- 基础工具 ----------------
inline std::string toLower(std::string s) {
    for (auto& c : s) if (c >= 'A' && c <= 'Z') c = c - 'A' + 'a';
    return s;
}
inline std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return "";
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}
inline std::vector<std::string> split(const std::string& s, char delim) {
    std::vector<std::string> out;
    std::string cur;
    for (char c : s) {
        if (c == delim) { out.push_back(cur); cur.clear(); }
        else cur += c;
    }
    out.push_back(cur);
    return out;
}

// ---------------- Base64 / URL编码 ----------------
inline std::string base64Encode(const std::string& in) {
    static const char* tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    int val = 0, bits = -6;
    for (unsigned char c : in) { val = (val << 8) + c; bits += 8;
        while (bits >= 0) { out += tbl[(val >> bits) & 0x3F]; bits -= 6; } }
    if (bits > -6) out += tbl[((val << 8) >> (bits + 8)) & 0x3F];
    while (out.size() % 4) out += '=';
    return out;
}
inline std::string base64Decode(const std::string& in) {
    std::string out; int val = 0, bits = -8;
    auto idx = [](char c) {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62; if (c == '/') return 63; return -1;
    };
    for (char c : in) {
        if (c == '=') break;
        int d = idx(c); if (d < 0) continue;
        val = (val << 6) + d; bits += 6;
        if (bits >= 0) { out += (char)((val >> bits) & 0xFF); bits -= 8; }
    }
    return out;
}
inline std::string urlEncode(const std::string& s) {
    std::string out;
    for (unsigned char c : s) {
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out += (char)c;
        else { char buf[8]; sprintf(buf, "%%%02X", c); out += buf; }
    }
    return out;
}
inline std::string urlDecode(const std::string& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i + 2 < s.size()) {
            auto hex = [](char h){ if(h>='0'&&h<='9')return h-'0'; if(h>='a'&&h<='f')return h-'a'+10; if(h>='A'&&h<='F')return h-'A'+10; return 0; };
            out += (char)(hex(s[i+1])*16 + hex(s[i+2]));
            i += 2;
        } else if (s[i] == '+') out += ' ';
        else out += s[i];
    }
    return out;
}

// ---------------- 加密 (XOR流; 密码用FNV哈希) ----------------
inline std::string fnv1a64(const std::string& s) {
    unsigned long long h = 1469598103934665603ULL;
    for (unsigned char c : s) { h ^= c; h *= 1099511628211ULL; }
    std::stringstream ss; ss << std::hex << h;
    return ss.str();
}
inline std::string hashPassword(const std::string& salt, const std::string& password) {
    std::string x = salt + "::OI_KILL_SALT::" + password;
    for (int i = 0; i < 64; ++i) x = fnv1a64(x);
    return x;
}
inline std::string genSalt() {
    static const char* chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    std::string s;
    for (int i = 0; i < 8; ++i) s += chars[rand() % 62];
    return s;
}
// XOR流加密/解密 (密钥对称)
inline std::string xorCipher(const std::string& key, const std::string& msg) {
    std::string out = msg;
    size_t k = 0;
    for (size_t i = 0; i < out.size(); ++i) out[i] ^= key[(k++) % key.size()];
    return out;
}
// 加密文本传输: 返回 "base64(xor(plain))"
inline std::string encryptText(const std::string& key, const std::string& plain) {
    return base64Encode(xorCipher(key, plain));
}
inline std::string decryptText(const std::string& key, const std::string& b64) {
    return xorCipher(key, base64Decode(b64));
}

// ---------------- 时间戳 ----------------
inline std::string timestamp() {
    SYSTEMTIME st;
    GetLocalTime(&st);
    char buf[64];
    sprintf(buf, "%04d-%02d-%02d %02d:%02d:%02d", st.wYear, st.wMonth, st.wDay,
            st.wHour, st.wMinute, st.wSecond);
    return buf;
}
inline std::string dateStamp() {
    SYSTEMTIME st; GetLocalTime(&st);
    char buf[32];
    sprintf(buf, "%04d%02d%02d", st.wYear, st.wMonth, st.wDay);
    return buf;
}

// ---------------- 简单Socket封装 (阻塞, 每连接一线程) ----------------
inline bool recvLine(SOCKET s, std::string& line) {
    line.clear();
    char c;
    while (true) {
        int r = recv(s, &c, 1, 0);
        if (r <= 0) return false;
        line += c;
        if (line.size() >= 2 && line[line.size()-2] == '\r' && line[line.size()-1] == '\n') {
            line.resize(line.size()-2);
            return true;
        }
        if (line.size() > 8192) return false;
    }
}
inline bool recvExact(SOCKET s, char* buf, size_t n) {
    size_t got = 0;
    while (got < n) {
        int r = recv(s, buf + got, (int)(n - got), 0);
        if (r <= 0) return false;
        got += r;
    }
    return true;
}
inline bool sendAll(SOCKET s, const char* data, size_t n) {
    size_t sent = 0;
    while (sent < n) {
        int r = send(s, data + sent, (int)(n - sent), 0);
        if (r <= 0) return false;
        sent += r;
    }
    return true;
}

// ---------------- HTTP 请求解析 ----------------
struct HttpRequest {
    std::string method;
    std::string target;
    std::string path;
    std::map<std::string, std::string> query;
    std::map<std::string, std::string> headers;
    std::string body;
    std::map<std::string, std::string> cookies;
};

inline bool parseHttpRequest(SOCKET s, HttpRequest& req) {
    std::string line;
    if (!recvLine(s, line)) return false;
    auto parts = split(line, ' ');
    if (parts.size() < 3) return false;
    req.method = parts[0];
    req.target = parts[1];
    size_t q = req.target.find('?');
    req.path = (q == std::string::npos) ? req.target : req.target.substr(0, q);
    if (q != std::string::npos) {
        for (auto& kv : split(req.target.substr(q+1), '&')) {
            if (kv.empty()) continue;
            size_t eq = kv.find('=');
            if (eq == std::string::npos) req.query[urlDecode(kv)] = "";
            else req.query[urlDecode(kv.substr(0,eq))] = urlDecode(kv.substr(eq+1));
        }
    }
    long contentLength = 0;
    while (recvLine(s, line)) {
        if (line.empty()) break;
        size_t colon = line.find(':');
        if (colon == std::string::npos) continue;
        std::string key = toLower(trim(line.substr(0, colon)));
        std::string val = trim(line.substr(colon+1));
        req.headers[key] = val;
        if (key == "content-length") contentLength = atol(val.c_str());
    }
    if (req.headers.count("cookie")) {
        for (auto& ckv : split(req.headers["cookie"], ';')) {
            size_t eq = ckv.find('=');
            if (eq == std::string::npos) continue;
            req.cookies[trim(ckv.substr(0,eq))] = trim(ckv.substr(eq+1));
        }
    }
    if (contentLength > 0 && contentLength < (1<<20)) {
        req.body.resize(contentLength);
        recvExact(s, &req.body[0], (int)contentLength);
    }
    return true;
}

// ---------------- 编码转换 (GBK -> UTF-8) ----------------
// 说明: 本项目现以 -fexec-charset=UTF-8 编译, 运行期中文字面字符串已为 UTF-8,
// 故默认不再需要做编码转换。 gbkToUtf8 仅保留备用(若某处出现 GBK 字节时可调用)。
inline std::string gbkToUtf8(const std::string& gbk) {
    if (gbk.empty()) return gbk;
    // GBK(CP936) -> UTF-16LE
    int wlen = MultiByteToWideChar(CP_ACP, 0, gbk.c_str(), (int)gbk.size(), NULL, 0);
    if (wlen <= 0) return gbk;
    std::wstring wbuf(wlen, L'\0');
    MultiByteToWideChar(CP_ACP, 0, gbk.c_str(), (int)gbk.size(), &wbuf[0], wlen);
    // UTF-16LE -> UTF-8
    int ulen = WideCharToMultiByte(CP_UTF8, 0, wbuf.c_str(), wlen, NULL, 0, NULL, NULL);
    if (ulen <= 0) return gbk;
    std::string utf8(ulen, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wbuf.c_str(), wlen, &utf8[0], ulen, NULL, NULL);
    return utf8;
}

// ---------------- HTTP 响应 ----------------
// body 现已是 UTF-8 (UTF-8 编译), 直接原样发送, 浏览器 charset=UTF-8 即可正确显示中文。
inline std::string buildHttpResponse(int status, const std::string& contentType,
                                     const std::string& body, const std::string& extraHeaders = "") {
    std::string statusText;
    switch (status) {
        case 200: statusText = "OK"; break;
        case 302: statusText = "Found"; break;
        case 400: statusText = "Bad Request"; break;
        case 403: statusText = "Forbidden"; break;
        case 404: statusText = "Not Found"; break;
        default: statusText = "OK";
    }
    std::string resp;
    resp.reserve(body.size() + 256);
    resp += "HTTP/1.1 " + std::to_string(status) + " " + statusText + "\r\n";
    resp += "Content-Type: " + contentType + "\r\n";
    resp += "Content-Length: " + std::to_string((int)body.size()) + "\r\n";
    resp += "Connection: close\r\n";
    resp += extraHeaders;
    resp += "\r\n";
    resp += body;
    return resp;
}

inline std::string htmlEscape(const std::string& s) {
    std::string out;
    for (char c : s) {
        switch (c) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '"': out += "&quot;"; break;
            case '\'': out += "&#39;"; break;
            default: out += c;
        }
    }
    return out;
}

// ---------------- WebSocket 帧 (服务器->客户端, 无需掩码) ----------------
inline bool wsSend(SOCKET s, const std::string& payload) {
    std::string frame;
    size_t len = payload.size();
    frame += (char)0x81; // FIN + text
    if (len < 126) frame += (char)len;
    else if (len <= 0xFFFF) { frame += (char)126; frame += (char)((len >> 8) & 0xFF); frame += (char)(len & 0xFF); }
    else { frame += (char)127; unsigned long long b = len; for (int i=7;i>=0;--i) frame += (char)((b >> (i*8)) & 0xFF); }
    frame.append(payload);
    return sendAll(s, frame.data(), frame.size());
}

// 客户端->服务器帧 (客户端必须掩码)
inline bool wsRecv(SOCKET s, std::string& out, bool& needClose) {
    unsigned char h[2];
    if (!recvExact(s, (char*)h, 2)) return false;
    int opcode = h[0] & 0x0F;
    bool masked = h[1] & 0x80;
    unsigned long long len = h[1] & 0x7F;
    if (len == 126) { unsigned char b[2]; if(!recvExact(s,(char*)b,2)) return false; len = (b[0]<<8)|b[1]; }
    else if (len == 127) { unsigned char b[8]; if(!recvExact(s,(char*)b,8)) return false; len=0; for(int i=0;i<8;++i) len=(len<<8)|b[i]; }
    if (len > (1<<22)) return false;
    char mask[4] = {0,0,0,0};
    if (masked) recvExact(s, mask, 4);
    out.resize(len);
    if (len > 0) recvExact(s, &out[0], (int)len);
    if (masked) for (size_t i=0;i<len;++i) out[i] ^= mask[i%4];
    if (opcode == 8) { needClose = true; return true; }
    if (opcode == 9) { return false; } // ping
    return true;
}

} // namespace sockutil

#endif
