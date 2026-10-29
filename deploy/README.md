# 部署手册 · 宝塔面板

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

### 1. 生成密码文件

```bash
apt install -y apache2-utils      # CentOS 用 yum install -y httpd-tools
mkdir -p /www/server/pass
htpasswd -c /www/server/pass/srdi.pass admin
```

按提示输两遍密码。`-c` 会覆盖同名文件,第二次加人要省略 `-c`:

```bash
htpasswd /www/server/pass/srdi.pass 第二个用户名
```

非交互写法(密码进 shell history,用完 `history -c`):

```bash
htpasswd -cb /www/server/pass/srdi.pass admin '改成你的密码'
```

### 2. 生效

`deploy/nginx-site.conf` 里两条 `location` 都带 `auth_basic`,替换后自动生效。

```bash
chmod 640 /www/server/pass/srdi.pass
chown root:www /www/server/pass/srdi.pass
nginx -t && nginx -s reload
```

### 3. 验证

浏览器打开域名,应弹出「此网站要求你登录」的框。输错三次返回 401。

**不要用宝塔面板的「加密访问」功能配这个站。** 那个功能会让目录下的反向代理失效,表现为输对密码后白屏。

### 4. 必须配 HTTPS

Basic Auth 的密码只做 base64 编码,不是加密。走 HTTP 等于明文广播。强制 HTTPS 是硬性要求,不是优化项。

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
| 输对密码仍白屏 | 用了面板「加密访问」 | 删掉它,改用 `auth_basic` |
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
