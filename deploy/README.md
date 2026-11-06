# 部署手册 · 宝塔面板

> 第一次部署请先看手把手教程:[宝塔部署教程.md](./宝塔部署教程.md),本文是参数与原理的速查手册。

面向内网小团队的部署方式:一台服务器、一个 Node 进程、一个共享账号。
**不是多租户方案** —— 所有访问者看到同一份数据,没有用户身份区分。

## 一、前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| 服务器 | 2 核 4G 起 | pdfjs 逐页渲染 2000px 页图,1 核 2G 解析大 PDF 会 OOM |
| 系统 | Ubuntu 22 / CentOS 7+ | 需要能装 Node 22 |
| Node | 22.x | 项目 `engines` 要求 ≥ 20.11 |
| 域名 | 已备案 | 国内服务器未备案,80 / 443 会被拦 |
| 磁盘 | 40G 起 | 每个 50 页项目的页图约几十 MB |

## 二、首次部署

### 1. 装 Node 22

宝塔 → 软件商店 → Node.js 版本管理器 → 安装 v22 → 设为命令行默认版本。

```bash
node -v
pnpm -v
```

没有 pnpm 就 `npm i -g pnpm`。

### 2. 放代码

```bash
mkdir -p /www/wwwroot/srdi
cd /www/wwwroot/srdi
git clone <仓库地址> .
```

不用 git 就把代码打包上传解压到该目录,**排除 `node_modules`、`release`、`data`、`.tmp`**。

### 3. 装依赖并构建

```bash
cd /www/wwwroot/srdi
pnpm install
pnpm build
```

`pnpm install` **不要加 `--prod`**。`tsx` 在 devDependencies 里,过滤掉就启动不了。

国内网络慢可先设镜像:

```bash
pnpm config set registry https://registry.npmmirror.com
```

### 4. 装中文字体

查找顺序:`REPORT_FONT_PATH` → 项目根 `fonts/` 目录 → 系统字体(Noto CJK / 文泉驿 / 黑体 / 苹方)→ `fc-match`。三条路任选,最省事的是往项目根丢一个中文 ttf。

Debian / Ubuntu:

```bash
apt install -y fonts-noto-cjk
```

RHEL / CentOS / OpenCloudOS / 麒麟:

```bash
dnf install -y wqy-zenhei-fonts
```

没有包管理权限,或想彻底摆脱系统字体,就把字体传到项目里:

```bash
mkdir -p /www/wwwroot/srdi/fonts
# 上传 simhei.ttf / SourceHanSansSC-Regular.otf 等任意中文 ttf / ttc / otf 到该目录
chown -R www:www /www/wwwroot/srdi/fonts
```

装完必须自检一次。它会打印全部候选与失败原因,并真的生成一张中文 PDF:

```bash
cd /www/wwwroot/srdi
pnpm check:font
```

`.ttc` 集合字体由程序读取内部 PostScript 名,不用手工指定 family —— 手填显示名(例如 `Noto Sans CJK SC`)正是老版本报 `Not a supported font format` 的原因。字体变动后重启进程生效。

### 5. 起进程

宝塔 → 网站 → Node 项目 → 添加:

| 字段 | 值 |
|---|---|
| 项目目录 | `/www/wwwroot/srdi` |
| 启动选项 | `node_modules/.bin/tsx server/src/index.ts` |
| 项目端口 | `8787` |
| 运行用户 | `www` |
| 实例数 | **1** |

实例数必须是 1。任务进度的 SSE 是进程内存广播,存储锁是进程内 Map,开两个进程会丢事件、抢写文件。

命令行方式可用 `deploy/ecosystem.config.cjs`:

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

### 6. 目录权限

```bash
chown -R www:www /www/wwwroot/srdi
chmod -R 755 /www/wwwroot/srdi
```

`data/` 必须可写,否则上传与解析全部失败。

### 7. 反向代理 + HTTPS

宝塔 → 网站 → 添加站点(纯静态即可,域名绑定好) → SSL → Let's Encrypt 申请 → 开「强制 HTTPS」。

然后 网站 → 设置 → 配置文件,找到 `#PROXY-START` 到 `#PROXY-END`,整段替换为 `deploy/nginx-site.conf` 的内容。

```bash
nginx -t && nginx -s reload
```

宝塔内置的「反向代理」功能与「加密访问」功能都会覆盖这段配置,**改完不要再点那两个按钮**。

## 三、访问保护

访问保护内置在应用里:打开域名先看到登录页,单账号全员共用。

| 项 | 值 |
| --- | --- |
| 默认账号 | `admin` |
| 默认密码 | `abc123456/` |
| 会话有效期 | 30 天(HttpOnly Cookie,服务重启后需重新登录) |
| 修改方式 | 环境变量 `AUTH_USER` / `AUTH_PASSWORD`,改完 `pm2 restart srdi` |

改密码示例(ecosystem.config.cjs 的 `env` 里加一行,或在宝塔 Node 项目的环境变量里加):

```
AUTH_PASSWORD=新密码
```

行为细节:

- 登录失败有约 0.8 秒延迟,自动爆破每秒最多试一次
- 密码比对用恒定时间比较,不存在逐位探测
- 会话凭证是 32 字节随机数,存在 HttpOnly Cookie 里,前端脚本读不到
- **不要**再开宝塔面板的「加密访问」——那个功能会让反向代理失效,表现为登录页之后白屏

强改 HTTPS 依然是硬要求:登录请求虽然走 POST body,不设 Secure 的 Cookie 在混合内容下也可能被降级会话劫持利用,HTTPS 消掉这一整类问题。

## 四、AI 模型配置

登录后在页面右上角「模型设置」里填,保存即生效,不用重启。

配置落在 `data/ai-settings.json`,**优先级高于环境变量** —— 所以想用环境变量藏 Key 是没用的,只要有人能在页面改。

多人共用一个 Key 时注意:token 消耗记在 `data/projects/<id>/ai-usage.json`,按项目分开,但没有按人统计。

## 五、日常运维

### 备份

两类备份,互不干扰:

```
/www/backup/
├── srdi-2026-11-05.tar.gz              # 数据,每天一份
└── srdi/
    ├── srdi-code-20261105-171000-025ea33.tar.gz   # 代码,每次更新一份
    └── srdi-code-20261104-090000-6d7ccf8.tar.gz
```

数据备份(项目、材料、打分结果):

```bash
tar -czf /www/backup/srdi-$(date +%F).tar.gz -C /www/wwwroot/srdi data
find /www/backup -maxdepth 1 -name "srdi-*.tar.gz" -mtime +7 -delete
```

宝塔 → 计划任务 → Shell 脚本,每天凌晨跑,保留 7 份。

`-maxdepth 1` 不能省:不加会把 `/www/backup/srdi/` 里的代码快照一起删掉。

备份目录不要放在站点根目录下,否则可能被静态托管暴露。

### 更新

三条命令概括全部:

| 要做的事 | 命令 |
| --- | --- |
| 更新到最新代码(自动先备份) | `bash deploy/update.sh` |
| 手动存一份代码快照 | `bash deploy/backup.sh` |
| 回滚到某个快照 | `bash deploy/rollback.sh [包路径]` |

服务器上日常只跑第一条:

```bash
cd /www/wwwroot/srdi
bash deploy/update.sh
```

它按顺序做完:检查工作区是否干净 → **备份当前代码** → `git pull --ff-only` → `pnpm install` → `pnpm build` → `pnpm check:font` → 重启(有 pm2 就 `pm2 restart srdi`,没有就提示去面板点) → 轮询 `/api/health`。跑完会打印本次快照路径和回滚命令。

**备份落在哪**:`/www/backup/srdi/srdi-code-<时间>-<提交>.tar.gz`,默认保留最近 10 份。可用 `BACKUP_DIR` / `KEEP` 改。备份只含代码,不含 `node_modules`、`data`、`release`、`.git`——数据备份见上一节。

**进程版本自检**:`/api/health` 的 `runtime.commit` 是进程启动时读到的提交号。脚本重启后会拿它和磁盘上的 `git rev-parse --short HEAD` 比对,不一致就报错退出;没有 pm2 时会提示「重启之前,新增接口会返回『接口不存在』」。手动核对:

```bash
curl -s http://127.0.0.1:8787/api/health | grep -o '"commit":"[^"]*"'
git rev-parse --short HEAD
```

**不需要先手动 `git pull`** —— 脚本第一步就是它;手动拉过再跑也不出错,只是那句 `Already up to date` 白跑一遍。脚本会从自己所在位置反推项目根目录,装到别的路径也能用。

### 回滚

```bash
bash deploy/rollback.sh --list        # 看有哪些快照
bash deploy/rollback.sh               # 恢复最近一份
bash deploy/rollback.sh /www/backup/srdi/srdi-code-20261105-170800-a56e389.tar.gz
```

它先给当前代码也存一份(方便再退回来),再用 rsync 覆盖代码,**保留 `node_modules` / `data` / `release` / `.env` / `fonts`**,然后重装依赖、重新构建、重启、健康检查。

回滚后工作区是快照内容,不在任何提交上。想回到线上最新版:

```bash
git reset --hard origin/main && bash deploy/update.sh
```

也可以用 git 精确回退某个提交(适合能确定是哪次改坏的情况):

```bash
git log --oneline -10
git reset --hard <sha> && pnpm install && pnpm build   # 再到面板重启
```

### 服务器上没有 git 仓库时怎么更新

代码是打包上传的,`update.sh` 会直接拒绝(第一步就检查 `.git`)。手动走同一条安全路径:

```bash
cd /www/wwwroot/srdi
bash deploy/backup.sh          # 先存快照,打印出的路径记一下
# 用宝塔文件管理器或 rsync 覆盖上传新代码,不要删目录重传
pnpm install && pnpm build
# 面板「Node 项目」→ 重启
bash deploy/rollback.sh        # 出锅了就恢复刚才那份
```

覆盖上传时**不要删 `data/`、`node_modules/`、`.env`、`fonts/`**,这四个目录一旦删掉,数据和字体都得重来。

什么时候不走脚本:

| 场景 | 做法 |
| --- | --- |
| 只看有没有新提交 | `git fetch && git log --oneline HEAD..origin/main` |
| 回滚到某个提交 | `git reset --hard <sha>` → `pnpm install && pnpm build` → 面板重启 |
| 只改端口 / 密码 / 字体路径 | 改 `.env` → 面板重启,不必跑脚本 |

脚本里有四处刻意设计,别删:

1. `git pull --ff-only` —— 服务器上有本地改动时直接失败,不会悄悄生成合并提交;
2. 工作区检查 —— 有未提交改动就停下并列出文件,避免把服务器上的手改覆盖掉;
3. 更新前自动快照 —— 备份失败就不更新,不给自己留退不回去的局面;
4. 没有 pm2 时不假装成功 —— 老进程还在跑,健康检查也会通过,所以脚本明确说「进程未重启」并让你去面板点,不会报「部署完成」。

`pnpm check:font` 会验证 PDF 中文字体是否仍可用;老服务器升级时必须跑 `pnpm install`,字体自省新增了 `fontkit` 依赖。

`data/` 不在版本库里,更新不会覆盖数据。**但删代码目录重传会** —— 重传前先备份 data,并且别用「删除目录再上传」的方式更新,用上面的脚本或 rsync 覆盖。

### 日志

```bash
pm2 logs srdi --lines 200
```

只保留最近日志:`pm2 install pm2-logrotate`。

## 六、排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动即退出 | 用 `--prod` 装了依赖,缺 tsx | 重跑 `pnpm install` |
| 页面白屏 / 静态资源 404 | 没跑 `pnpm build` | 跑一次构建 |
| 新功能报「接口不存在」(404) | 进程跑的还是旧代码:只 `git pull` 没重启,或重启的不是这个目录 | `curl -s 127.0.0.1:8787/api/health` 看 `commit` 是否等于 `git rev-parse --short HEAD`,不等就重启进程 |
| 上传 PDF 报 413 | nginx 默认 1MB | 配 `client_max_body_size 60m` |
| 解析进度条不动 | SSE 被缓冲 | 配 `proxy_buffering off` |
| 导出 PDF 报 "Not a supported font format" | 旧版本把 `.ttc` 的显示名当 PostScript 名传给 pdfkit,集合里找不到该字面 | 更新代码后 `pnpm check:font` 复检;仍失败就换 `fonts/simhei.ttf` |
| 导出 PDF 报 500 `report_font_missing` | 所有候选位置都没有可用中文字体 | 做第 4 步;`pnpm check:font` 会逐条列出位置与失败原因 |
| 导出 PDF 报 500 `report_font_invalid` | 字体文件损坏或格式异常 | 换一个字体文件,再跑 `pnpm check:font` 冒烟 |
| 登录页之后白屏 | 用了面板「加密访问」 | 删掉它,反代用 `deploy/nginx-site.conf` |
| 一直停在登录页 | 密码输错或 Cookie 被拦 | 确认 `AUTH_PASSWORD`,清浏览器 Cookie 重试 |
| 任务进度错乱 / 文件损坏 | 开了多实例 | 实例数改回 1 |
| 上传后立刻 500 | `data/` 无写权限 | `chown -R www:www` |

### 健康检查

```bash
curl http://127.0.0.1:8787/api/health
```

返回 `{"ok":true,...}` 说明进程与规则包都正常。

## 七、这套方案不解决什么

- 没有用户身份,日志里区分不出谁改的证据
- 没有数据隔离,所有人看到同一个工作台
- 没有按人限额,一个 Key 大家一起烧
- 没有操作审计

要多租户、要客户自助、要计费 —— 那是产品改造,不是运维配置。当前形态对应 `PROGRESS.md` 里「本地单机版」的决策。
