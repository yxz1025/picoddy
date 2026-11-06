# 同一台 Linux 服务器部署

脚本部署 PostgreSQL、前端/API、Worker、Scheduler、OpenSandbox 管理服务，并构建任务沙箱镜像。前端包含在 API 镜像中，不运行 Vite。服务器需要 Docker Engine、Docker Compose v2（支持 `up --wait`）和 Bash；只有 `init` 需要 Node.js 22+。

## 本地准备与复制

已经在本机生成 `cloud/deploy/.env.production` 和 `cloud/deploy/secrets/skillhub-secret.enc`。它们继承 `cloud/.env` 的现有密钥，并被 Git 忽略。复制仓库到服务器时，**另外通过安全通道复制这两个配置文件**，保持相同相对路径；只 git clone 不会带上它们。

重新准备另一份配置时，在有本地 `.env` 的电脑运行：

```bash
bash cloud/deploy/deploy.sh init
# 可用 LOCAL_ENV_FILE=/secure/local.env 指定源配置。
```

`init` 不生成新密钥，也不覆盖已有生产配置。它保留本地加密密钥、有效数据库密码、OpenSandbox API Key、OSS/S3 凭证和其他配置；若 PostgreSQL 密码字段为空，从本地 DATABASE_URL 提取。SkillHub 密钥没有环境变量配置时，复制现有加密文件，保留同一个加密密钥。文件权限为 600。

只修改生产地址及容器路径：`PUBLIC_ORIGIN` 留作实际 HTTPS 域名，`SANDBOX_DOMAIN=http://opensandbox-server:8090`，数据库指向 Compose 内的 PostgreSQL。本地数据库和业务文件**不会自动迁移**，用户登录后的模型配置仍在原数据库中；继承环境变量密钥不等于复制数据库。

## 服务器执行

在服务器仓库根目录：

```bash
vi cloud/deploy/.env.production  # 把 PUBLIC_ORIGIN 改成实际 HTTPS 域名
bash cloud/deploy/deploy.sh deploy
```

脚本依次构建应用镜像、校验配置、检查是否有未结束任务、构建任务镜像、启动 OpenSandbox、创建临时沙箱验证命令/文件读写并销毁、初始化数据库、准备共享卷、启动 API/Worker/Scheduler，最后检查前端首页、健康和存储就绪接口。

任务镜像从当前 `SANDBOX_IMAGE` 指定的标签构建到同一台服务器的 Docker，因此不必另行推送到镜像仓库。若修改了 `runtime-source`，先在本地 cloud 目录运行 `npm ci --ignore-scripts && npm run generate:runtime`，并带上更新后的 runtime 文件。

结构不匹配的旧数据库会使部署停止，不自动迁移或清库。重复部署前暂停新任务提交，等待现有任务结束；脚本有活动任务检查，但不实现分布式维护锁或零停机更新。

## 网络与持久化

OpenSandbox 管理 API 不发布宿主机端口，Worker 通过 Compose 内部服务名访问。只有管理服务挂载 Docker socket；API、Worker、Scheduler 均不挂载。任务容器与管理服务共享独立 `picoddy-cloud-executor` 网络，代理通过容器内部地址连接任务；任务端口的宿主机映射绑定 loopback。该固定执行网络供本服务器的一套生产栈使用。

数据库、文件、服务端密钥和 OpenSandbox SQLite 状态使用独立持久卷。任务容器由 OpenSandbox 动态创建，生命周期不归 Compose 的 `stop` 管理。不要使用 `docker compose down -v` 删除数据。备份数据库时，另行备份生产环境文件及 SkillHub 加密文件。

同机部署仍需按 `../docs/04-operations.md` 验证网络隔离；Docker 网络划分不等于完整的不可信多租户安全验收。

## 域名和 HTTPS

应用仅发布到 `127.0.0.1:8080`。宿主机已安装 Nginx 并取得证书后：

```bash
sudo cp cloud/deploy/nginx.conf.example /etc/nginx/conf.d/picoddy-cloud.conf
sudo vi /etc/nginx/conf.d/picoddy-cloud.conf  # 修改域名和证书路径
sudo nginx -t
sudo systemctl reload nginx
```

企业 CAS 需允许 `https://你的域名/api/auth/callback`。保留 SSE 关闭缓冲的配置，否则输出会再次成块出现。脚本不自动覆盖机器上已有的 Nginx 配置。

## 运维

```bash
bash cloud/deploy/deploy.sh check
bash cloud/deploy/deploy.sh status
bash cloud/deploy/deploy.sh logs
bash cloud/deploy/deploy.sh deploy
bash cloud/deploy/deploy.sh stop
```

`stop` 停止业务服务，保留数据库、OpenSandbox 及持久卷；执行中的任务会中断。默认项目名为 `picoddy-cloud-prod`。原生产栈用了其他名称时，每次命令都设置 `CLOUD_PROJECT_NAME=原项目名`，避免创建另一套卷。可用第二个参数指定环境文件，`secrets/` 应与该文件位于同一目录。

脚本的沙箱探测只验证执行基础链路，不证明 CAS、模型或每个企业 MCP 均可用。上线后需实际登录并执行任务验收。

## 内网 HTTP 直接访问

内网 IP 部署可显式开启 HTTP。在 `.env.production` 设置（保留其余密钥）：

```dotenv
PUBLIC_ORIGIN='http://172.18.36.79:8090'
ALLOW_INSECURE_HTTP='true'
SECURE_COOKIES='false'
API_BIND_ADDRESS='0.0.0.0'
API_PORT='8090'
SANDBOX_DOMAIN='http://opensandbox-server:8090'
```

该开关仅允许 RFC1918 内网 IPv4 地址。8090 端口须未被占用；换端口时同步修改 PUBLIC_ORIGIN。执行 `bash cloud/deploy/deploy.sh deploy` 重建并应用。

后续代理终止 HTTPS 时，将 PUBLIC_ORIGIN 改为浏览器使用的 HTTPS 地址、SECURE_COOKIES=true、ALLOW_INSECURE_HTTP=false；宿主机代理可将 API_BIND_ADDRESS 改回 127.0.0.1、API_PORT 改回 8080。CAS 平台的回调地址也需与实际访问地址匹配。SANDBOX_DOMAIN 保持容器内部地址即可。

数据库使用 `postgres:17-bookworm`。目标服务器的 3.10 内核环境中，Alpine 版本 initdb 写入失败，而 Bookworm 对照初始化成功；保持 PostgreSQL 17 大版本及原有数据卷。
