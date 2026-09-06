# R3 执行报告：推送 + GitHub Pages 部署（第 2 轮）

> 执行时间：2026-09-06（本地时间 18:00–18:20）
> 执行环境：Windows，原生 git `C:\Program Files\Git\cmd\git.exe`，HTTPS 推送，全程禁用代理。

## 结论速览

✅ **全部成功。** 代码已推送到远程 `main`（新 HEAD `77f0607`），Pages 已切换为 workflow 构建，部署成功，站点在线可访问：
**https://leoooooooooisme.github.io/OI-kill/**（HTTP 200，标题 `OI杀 v4.0 — 重构版（可玩）`）。

---

## 1. 安全备份（仓库外）

- 命令：`Copy-Item -Recurse D:\projects\oi-kill\cppversion(old) → D:\projects\oi-kill_backup_cppversion`
- 结果：**成功**，共复制 **36 个文件** 至 `D:\projects\oi-kill_backup_cppversion`（备份在变基之前完成，含全部被删除的跟踪文件）。

## 2. Fetch 远程 main

- 命令：`git -c http.proxy= -c https.proxy= fetch https://github.com/LEOOOOOOOOOISME/OI-kill.git main`（已清空代理环境变量）
- 结果：成功，exit 0。
- **FETCH_HEAD = `f6b9eae4015ebe3568f7441c9a7e8f72ce024047`**（branch 'main' of https://github.com/LEOOOOOOOOOISME/OI-kill）

## 3. 远程提交检查（FETCH_HEAD 最近 3 条）

```
f6b9eae Delete cppversion(old) directory
c94360c Delete cppversion(old)/BUG Report.md
f47b1f4 docs: 更新日志 v4.0
```

与预期一致：远程比本地多 2 个删除 `cppversion(old)` 的提交。

## 4. Rebase

- 首次直接 `git rebase FETCH_HEAD` 被 git 拒绝（原因：工作区存在未暂存改动，git 要求工作树干净）：

  ```
  error: cannot rebase: You have unstaged changes.
  error: Please commit or stash them.
  ```

- 改用 `git rebase --autostash FETCH_HEAD`（自动 stash → 变基 → 恢复），**成功，无冲突**：

  ```
  Created autostash: ce704fd
  Rebasing (1/1)
  Applied autostash.
  Successfully rebased and updated refs/heads/main.
  ```

- 未暂存的 `v4-web/` 改动（`M v4-web/src/net/net-api.js` + 若干 untracked 文件）原样保留、未被触碰。

## 5. 验证

- 新本地 HEAD：**`77f0607`**，日志：

  ```
  77f0607 feat(GithubServerVer): 同步最新v4-web(适配器/大厅/动效/音效) + Pages工作流
  f6b9eae Delete cppversion(old) directory
  c94360c Delete cppversion(old)/BUG Report.md
  f47b1f4 docs: 更新日志 v4.0
  4f25bf8 feat: 用户端(单人版)源码推入 UserVer/
  ```

- `git status --short`：仅剩原 v4-web 未提交改动（与操作前一致）；**`cppversion(old)` 的跟踪文件数 = 0**（`git ls-files` 确认），符合远程删除决策。
- 说明：磁盘上 `cppversion(old)\` 目录仍物理存在，但只剩 gitignore 的运行时残留（`logs\`、`srv_*.txt`、`users.dat`），不参与提交、不会被推送。

## 6. Push + 远程 HEAD 确认

- 命令：`git -c http.proxy= -c https.proxy= push https://github.com/LEOOOOOOOOOISME/OI-kill.git main`（代理已禁用）
- 结果：成功：`f6b9eae..77f0607  main -> main`
- 远程 HEAD 核对（`gh api repos/LEOOOOOOOOOISME/OI-kill/commits/main --jq '.sha'`）：
  - 远程：`77f060761908734b61e06daf05d7ceae1aa85d6f`
  - 本地：`77f060761908734b61e06daf05d7ceae1aa85d6f`
  - **MATCH: TRUE** ✅

## 7. 启用 Pages

- `gh api --method POST repos/LEOOOOOOOOOISME/OI-kill/pages -f build_type=workflow` → exit 0，返回：

  ```json
  {"html_url":"https://leoooooooooisme.github.io/OI-kill/","build_type":"workflow","source":{"branch":"main","path":"/"},"public":true,"https_enforced":true,"status":null}
  ```

- `build_type=workflow` 已生效。

## 8. 构建与部署轮询

### 过程

1. 首轮 10 次轮询（30s 间隔，共 5 分钟）`pages/builds/latest` 全部 **404**。原因：push 触发的首次 workflow（run `34026277176`，26s，success）在 Pages 启用（build_type=workflow）**之前**就已完成，其产物未被登记为 Pages 构建。
2. 确认 workflow 存在且 active（`.github/workflows/pages.yml`，名称 `Deploy GithubServerVer to Pages`），手动重新触发：`gh workflow run pages.yml` → run `34026558543`。
3. 该 run 两个 job 全部成功：
   - `build`：checkout → configure-pages → upload-pages-artifact（path: `GithubServerVer`）→ success
   - `deploy`（environment `github-pages`）：deploy-pages → **success**
4. 部署记录确认（deployments API，id `6291687681`，sha `77f0607`）：状态链 `waiting → queued → in_progress → success`，environment_url = `https://leoooooooooisme.github.io/OI-kill/`。

### 说明（非故障）

`pages/builds/latest` 持续 404 是 GitHub 的**已知行为**：Pages builds API 不返回 workflow（Actions）构建，仅适用于 legacy 构建流。本项目用 workflow 构建，应以 **deployments API 状态（success）** 为准。

## 9. 在线测试

- `web_fetch https://LEOOOOOOOOOISME.github.io/OI-kill/` → **HTTP 200** ✅
- `<title>`：`OI杀 v4.0 — 重构版（可玩）`（包含「OI杀」）✅
- 首页 script 引用完整：

  ```
  src/data/cards.js
  src/data/professions.js
  src/data/identities.js
  src/engine/core.js
  src/engine/battle.js
  src/engine/tricks.js
  src/engine/skills.js
  src/engine/index.js
  game.js
  ```

- `src/data/cards.js` 等资源引用存在 ✅，页面内容含「行动日志 — LOG」等游戏 UI 标记。

## 10. 失败/异常记录

- **无致命失败**。全部命令最终 exit 0。
- 非致命事件：
  1. 首次 rebase 被「未暂存改动」守卫拒绝 → 改用 `--autostash` 解决，工作区改动完好。
  2. `pages/builds/latest` 404（workflow 型 Pages 的 API 限制）→ 以 deployments 状态 success 为准。
  3. 首次 push 触发的 workflow 早于 Pages 启用完成 → 手动重触发一次后部署成功。
  4. 变基前 `cppversion(old)` 已按步骤 1 完整备份（36 文件），无数据风险。

## 附：当前关键状态

| 项目 | 值 |
|---|---|
| 本地/远程 HEAD | `77f060761908734b61e06daf05d7ceae1aa85d6f`（一致） |
| 备份 | `D:\projects\oi-kill_backup_cppversion`（36 文件） |
| Pages | `build_type=workflow`，`https_enforced=true` |
| 部署 | success（deployment `6291687681`，environment `github-pages`） |
| 站点 | https://leoooooooooisme.github.io/OI-kill/ — HTTP 200 ✅ |
| 未提交改动 | 仅 v4-web 下的原有改动（未触碰） |
