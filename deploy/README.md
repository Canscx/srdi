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

```bash
apt install -y fonts-noto-cjk
```

不装的话导出 PDF 会返回 500 `report_font_missing`。
装完代码会自动命中 `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`,不用配环境变量。

自定义字体位置时再设 `REPORT_FONT_PATH`。

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

```bash
tar -czf /www/backup/srdi-$(date +%F).tar.gz -C /www/wwwroot/srdi data
```

宝塔 → 计划任务 → Shell 脚本,每天凌晨跑,保留 7 份。

备份目录不要放在站点根目录下,否则可能被静态托管暴露。

### 更新

```bash
cd /www/wwwroot/srdi
git pull
pnpm install
pnpm build
pm2 restart srdi
```

`data/` 不在版本库里,更新不会覆盖数据。**但删代码目录重传会** —— 重传前先备份 data。

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
| 上传 PDF 报 413 | nginx 默认 1MB | 配 `client_max_body_size 60m` |
| 解析进度条不动 | SSE 被缓冲 | 配 `proxy_buffering off` |
| 导出 PDF 报 500 | 服务器无中文字体 | `apt install fonts-noto-cjk` |
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
