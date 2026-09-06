# OI-kill 推送 + GitHub Pages 启用报告（R2）

**结论：push 失败（两次尝试均未成功），按任务约定 STOP，未启用 Pages、未做构建轮询与线上测试。** 失败根因不在代理（已按要求全程禁用代理），而在：① 本机 `git` 是 WSL 包装器，WSL 内到 github.com:443 的 TLS 连接被非正常终止；② 即便 TLS 通了，本地 main 也已与真实远端分叉（落后远端 2 个删除提交），直接 push 会被拒（非快进）。

---

## 1. 状态检查（步骤 1）

- 本地 `git log --oneline -5`：
  ```
  6e3c133 feat(GithubServerVer): 同步最新v4-web(适配器/大厅/动效/音效) + Pages工作流
  f47b1f4 docs: 更新日志 v4.0
  4f25bf8 feat: 用户端(单人版)源码推入 UserVer/
  35f8f64 feat: 新版本服务器源码推入 GithubServerVer/
  5d186de chore: 归档旧C++版本至 cppversion(old)/
  ```
- 本地 HEAD：`6e3c1338bbf729552ff46a8d8c622bdb4cbe1adf`
- 本地 `origin/main` 引用（已过期）：`00199ae`，`git status -sb` 显示 `ahead 9`。
- 真实远端 main（`gh api repos/LEOOOOOOOOOISME/OI-kill/commits/main`）：
  - 注意：任务给的 `--jq '.[0].sha'` 对该端点无效（该端点返回单个 commit 对象而非数组），报错 `expected an array but got: object`，改用 `--jq '.sha'` 后得到：**`f6b9eae4015ebe3568f7441c9a7e8f72ce024047`**。
- Pages 当前状态（`gh api .../pages`，HTTP 404 = 从未启用）：
  ```json
  {"message":"Not Found","documentation_url":"https://docs.github.com/rest/pages/pages#get-a-apiname-pages-site","status":"404"}
  ```

### 本地与真实远端的分叉情况（重要，任务前提有出入）

任务假设“两个未推送提交（6e3c133 + f47b1f4 及更早）”，实测：

| 项 | 值 |
|---|---|
| 本地记录的 origin/main | 00199ae |
| 真实远端 main HEAD | f6b9eae（= 00199ae + **10** 个提交，线性） |
| 本地 main HEAD | 6e3c133（= 00199ae + **9** 个提交） |
| 本地独有（未推送） | **仅 1 个：6e3c133**（f47b1f4 及更早 8 个已在远端） |
| 远端独有（本地缺失） | **2 个：c94360c、f6b9eae**（“Delete cppversion(old)/BUG Report.md”与“Delete cppversion(old) directory / move to new branch”） |

即：本地领先 1 个、落后 2 个，已分叉。`f6b9eae` 对象不存在于本地仓库，本地 `origin/main` 引用已过期。直接 `git push` main 会被以 non-fast-forward 拒绝（即使网络正常）。

### 其他状态

- 远端 main 上**不存在** `.github/workflows/`（API 404）→ Pages 工作流文件 `pages.yml` 只在未推送的 6e3c133 中。在推送成功前启用 workflow 型 Pages 必然构建失败。
- 工作区有未提交改动（本次任务未触碰）：`M v4-web/src/net/net-api.js`；未跟踪 `v4-web/docs/*-报告.md`（5 个）、`v4-web/src/sound/`、`v4-web/src/ui/`。
- 本机 `git` 实为包装器：`D:\openclaw\npm_global\git.cmd` → `wsl -d Debian -u leo -- git`。git config 中确有死代理（`http.proxy`/`https.proxy` = `http://172.30.0.1:7890`），已在每次网络命令中用 `-c http.proxy= -c https.proxy=` 与环境变量清空双重禁用。
- `gh.exe`（Windows 原生）正常，所有 `gh api` 调用经 api.github.com 成功。

## 2. Push（步骤 2，代理已禁用，HTTPS）

命令（每次均在同一 pwsh 会话内清空代理后执行）：
```
git -c http.proxy= -c https.proxy= push https://github.com/LEOOOOOOOOOISME/OI-kill.git main
```

- **第 1 次**：挂起超过 300s 无进展，按约定终止（`job_kill`）。期间 stderr 出现 WSL 凭据助手错误：
  ```
  'C:\Program Files\GitHub CLI\gh.exe' auth git-credential get: 1: C:\Program Files\GitHub CLI\gh.exe: Permission denied
  ```
  （WSL 内 git 的凭据助手指向 Windows 的 gh.exe，WSL 无法执行；随后进程长时间无输出。另设了 `GIT_TERMINAL_PROMPT=0` 防交互卡死。）
- **第 2 次（重试）**：快速失败，exit code 1，stderr 原文：
  ```
  fatal: unable to access 'https://github.com/LEOOOOOOOOOISME/OI-kill.git/': GnuTLS recv error (-110): The TLS connection was non-properly terminated.
  ```
  （GnuTLS 表明是 WSL Debian 版 git；WSL 内到 github.com:443 的 TLS 连接被非正常终止。）

**两次均失败 → 按任务约定 STOP，未尝试其他传输方式（如 SSH）或进一步调试。** 远端 HEAD 复核仍为 `f6b9eae`（确认没有部分推送）。

## 3. 启用 Pages（步骤 3）

**未执行**（步骤 2 失败即 STOP）。当前 Pages 状态仍是“从未启用”（404，见第 1 节 JSON）。

## 4. 构建轮询与线上测试（步骤 4–5）

**未执行**。无 Pages 站点、无构建可查。

## 5. 失败信息汇总（原文）

1. push 第 1 次（挂起前 stderr）：
   `'C:\Program Files\GitHub CLI\gh.exe' auth git-credential get: 1: C:\Program Files\GitHub CLI\gh.exe: Permission denied`
2. push 第 2 次（最终错误，verbatim）：
   `fatal: unable to access 'https://github.com/LEOOOOOOOOOISME/OI-kill.git/': GnuTLS recv error (-110): The TLS connection was non-properly terminated.`
3. Pages 查询（预期 404）：`gh: Not Found (HTTP 404)`，JSON 见第 1 节。

## 6. 给父代理的后续建议（供决策，本次未执行）

1. **修 push 通道**：换 Windows 原生 git（绕过 `git.cmd` 的 WSL 包装，例如直接用 `C:\Program Files\Git\cmd\git.exe`，其凭据助手可用 gh.exe）或修复 WSL 内 TLS（WSL NAT 代理镜像问题）；或在其他机器推送。
2. **先同步再推**：`git fetch` 后需处理远端独有提交 c94360c / f6b9eae（cppversion(old) 已被删除并移入新分支）——决定保留该删除并 rebase/merge 6e3c133，再 push。
3. **推送成功后再启用 Pages**（workflow 型）：`gh api --method POST repos/LEOOOOOOOOOISME/OI-kill/pages -f build_type=workflow`，随后轮询 `pages/builds/latest` 至 `status: built`，最后访问 `https://LEOOOOOOOOOISME.github.io/OI-kill/` 做线上验证。
