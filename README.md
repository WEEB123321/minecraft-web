# 方块世界 · 网页版《我的世界》整合站

真·《我的世界》网页版：本地托管 **Eaglercraft 官方构建**（把 Java 版 MC 编译成网页版，浏览器直接运行），
照着 [mcjs.cc](https://mcjs.cc) 的形态做成整合站——版本卡片、打开即玩、无需下载安装、内置局域网联机。

## 快速开始

1. 双击 **`start.bat`**（或运行 `python serve.py`）
2. 浏览器打开 `http://127.0.0.1:8765/`
3. 在首页选一个版本 → 新标签页里等几秒（首次加载 16–83 MB，之后走浏览器缓存）→ 开玩！

> 想让同一局域网的手机 / 朋友访问：`python serve.py 8765 lan`，首页会打印局域网地址。
>
> 每个客户端都是独立单文件网页，直接双击 `mc/1.8.8/index.html` 也能玩（推荐走服务器方式，缓存与联机体验更好）。

## 目录结构

```
├─ index.html            门户首页（版本卡片 / 联机教程 / FAQ）
├─ assets/               门户样式与脚本
├─ mc/                   真实 Eaglercraft 客户端（单文件离线版，本地托管）
│  ├─ 1.8.8/             EaglercraftX u50 · JavaScript（34.8 MB，构建 2025-02-22）
│  ├─ 1.8.8-wasm/        EaglercraftX u50 · WASM-GC（15.7 MB，同一构建）
│  ├─ 1.12.2/            Eaglercraft 1.12.2 · WASM-GC（25.1 MB，构建 2026-04-01）
│  ├─ 1.12.2-js/         Eaglercraft 1.12.2 · JavaScript（83.4 MB，同一构建）
│  ├─ 1.5.2/             Eaglercraft 1.5.2 最终版（22w43a，16.5 MB）
│  └─ beta1.3/           Eaglercraft Beta 1.3（22w22b，4.6 MB）
├─ play/                 早期自研体素实验（已从首页撤下，文件保留）
├─ vendor/               three.js / PeerJS（play 实验用）
├─ serve.py              本地静态服务器（Python 标准库，零依赖）
├─ start.bat             一键启动
├─ .nojekyll             GitHub Pages 关闭 Jekyll（必需，见下文）
├─ .gitattributes        禁止对大文件做换行转换 / 文本 diff
├─ .gitignore            忽略本地环境与临时文件
└─ LICENSE               MIT（仅覆盖原创代码，不含 mc/ 客户端）
```

## 联机（局域网分享码）

Eaglercraft 的「局域网联机」原理：通过 **WebSocket 中继服务器**交换连接信息，之后转为 **WebRTC 点对点**传输（1.5.2 起即为该机制）。

1. 房主：进入世界 → 按 `Esc` →「对局域网开放 / Open to LAN」→ 选择中继 → 拿到一串**分享码**，发给朋友。
2. 好友：打开**同一版本**客户端 → 多人游戏 →「加入局域网世界 / Join LAN World」→ 粘贴分享码。
3. 房主退出 = 世界关闭。界面为英文原版，教程里已对照标注按钮名称。

**中继服务器**：本站已在客户端里预置 4 个中继，默认优先国内公益节点 `wss://relay.mcjs.link`（由 MCJS 提供，请勿滥用），
其后依次是 lax1dude / ayunami 的官方中继（`relay.deev.is`、`relay.lax1dude.net`、`relay.shhnowisnottheti.me`）。
连不上时，在游戏内的联机界面切换到列表里的其它中继即可。

## 客户端来源与完整性

| 客户端 | 来源 | 校验 |
| --- | --- | --- |
| 1.8.8 u50（JS/WASM） | `3kh0/eaglercraft-builds`（官方发行版镜像） | SHA-1 与 GitHub 完全一致 |
| 1.12.2（JS/WASM） | `JessePinkman27/eaglercraft-1.12.2` | SHA-1 与 GitHub 完全一致 |
| 1.5.2 / Beta 1.3 | npm 社区包（官方离线版封装，npmmirror 镜像解码） | 与原包一致 |

站内做过的少量改动（**不修改游戏核心代码**，只动外层包装）：

- 中文网页标题、启动画面文案、顶部注释；
- 预置中继列表（MCJS 公益中继置首、设为默认）；
- 启动倒计时 5–6 秒 → 约 1.5 秒。

## 部署到 GitHub Pages

### 体积前提（先看这张表）

仓库总计约 **172 MB**，最大单文件 `mc/1.12.2-js/index.html` 为 **79.5 MiB**。

| 项目 | 限制 | 本站实际 | 结论 |
| --- | --- | --- | --- |
| GitHub 单文件硬上限 | 100 MB | 79.5 MiB | 通过 |
| GitHub 单文件警告线 | 50 MB | 6 个客户端文件超线 | 仅警告，不阻断推送 |
| GitHub 网页拖拽上传 | 25 MB / 文件 | 全部超限 | **不可用，必须走命令行** |
| 仓库建议体积 | < 1 GB | 172 MB | 通过 |

**不要使用 Git LFS。** GitHub Pages 不提供 LFS 对象，只会返回指针文件，站点直接 404；且免费额度为 1 GB 存储 / 1 GB 月流量，一次完整克隆就会耗尽。

### 首次推送

```bash
git remote add origin https://github.com/<用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

首次推送需上传约 172 MB，视网络情况需要数分钟。出现下面这条提示属于正常警告，不影响推送：

```
remote: warning: File mc/1.12.2-js/index.html is 79.50 MB;
        this is larger than GitHub's recommended maximum file size of 50.00 MB
```

### 开启 Pages

Settings → Pages → Build and deployment：

- **Source**：`Deploy from a branch`
- **Branch**：`main` / `/(root)`

`.nojekyll` 已就位且**必须保留**：Jekyll 会尝试解析 `mc/` 下 79.5 MiB 的单行 HTML，导致构建超时或失败；关闭 Jekyll 后 Pages 直接原样托管静态文件。

发布后访问 `https://<用户名>.github.io/<仓库名>/`。

### 不要用 GitHub Actions 部署

Actions 发布 Pages 需要先把整站打包成 artifact 再上传。172 MB 虽在上限内，但每次构建都要压缩 / 解压，明显慢于分支直出，超大单文件也更容易触发超时。分支部署是本站的正确选择。

### 站点限制与维护

- Pages 站点体积上限 1 GB、月流量软上限 100 GB，当前 172 MB 余量充足。
- 替换 `mc/` 下的客户端后，Git 历史仍保留旧版本，仓库只增不减。频繁替换大文件会让仓库迅速膨胀，必要时用 `git gc --aggressive` 或重建历史。
- 客户端文件一旦被修改，README「客户端来源与完整性」中的 SHA-1 校验声明需要同步更新。

## 版权

- Eaglercraft 是社区开源项目（作者 lax1dude 等）；本项目与 Mojang / 微软无任何从属关系，仅供学习交流，请支持正版《我的世界》。
- 客户端文件均为官方发行版 / 社区镜像的原始构建，本地托管，未改动核心代码。
