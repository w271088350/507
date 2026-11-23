# InoProShop MCP 接入手册

两款工具都通过 InoProShop 的 ScriptEngine 操作 IDE，必须先满足：

- Windows（两款都只支持 Windows）
- 已安装 InoProShop，且含目标 AC700 的**设备描述/固件包**
- Node.js ≥ 18
- 工程接口基线：InoProShop 1.9.1.6 / SP11；其他版本需实测
- 关闭其他 InoProShop 实例，或使用工具的隔离/attach 参数

Profile 名怎么查：右键 InoProShop 快捷方式 → 属性 → 目标里的 `--profile "InoProShop(V1.9.1.6)"`。

---

## 方案 A：Polarzin/Inoproshop-MCP（推荐首选）

MIT，无需构建，含工程与伺服两套工具。

### 安装

```powershell
git clone https://github.com/Polarzin/Inoproshop-MCP.git
cd Inoproshop-MCP
npm.cmd ci --ignore-scripts
```

### MCP 配置（Trae / Claude Code / Cursor 通用 stdio 格式）

```json
{
  "mcpServers": {
    "inoproshop": {
      "command": "node",
      "args": ["C:/path/to/Inoproshop-MCP/server.mjs"],
      "env": {
        "INOPROSHOP_EXE": "C:/Program Files/Inovance Control/InoProShop/CODESYS/Common/InoProShop.exe",
        "INOPROSHOP_PROFILE": "InoProShop(V1.9.1.6)"
      }
    }
  }
}
```

连接成功后工具列表中应出现 `codesys_engineering` 与 `codesys_servo`。

### 能力

- `codesys_engineering`
  - `create_empty`：创建空工程容器（尚无控制器）
  - `batch`：读取对象树、读 POU、写代码、编译、保存、导出软件控制器启动包
  - `build_c6`：从空白 SoftMotion 模板构建三轴飞剪示例
- `codesys_servo`：在线 SDO 读写、ESI 字典、启动值对照

### 注意

- 编译可能数分钟，客户端超时设 ≥660 秒
- 需要与已打开 IDE 并存时传 `isolated=true`
- 公开版飞剪示例在软件 PLC 上验证；硬件下载请自行确认

---

## 方案 B：x2124824695-stack/inoproshop-mcp（工程级稳妥版）

由社区版本整合改进而来，模板驱动，支持任意 InoProShop 支持的型号（含 AC700）。

### 安装

```powershell
git clone https://github.com/x2124824695-stack/inoproshop-mcp.git
cd inoproshop-mcp
npm ci --ignore-scripts
npm run check     # 会构建 dist 并跑协议/故障注入测试
```

GitHub "Download ZIP" 不含 `dist`，必须自己构建。

### MCP 配置

```json
{
  "mcpServers": {
    "inoproshop": {
      "command": "node",
      "args": [
        "D:/path/to/inoproshop-mcp/dist/bin.js",
        "--codesys-path", "C:/Program Files/Inovance Control/InoProShop/CODESYS/Common/InoProShop.exe",
        "--codesys-profile", "InoProShop(V1.9.1.6)",
        "--workspace", "D:/PLC/Workspace"
      ]
    }
  }
}
```

### 常用启动参数

| 参数 | 作用 |
|---|---|
| `--no-auto-launch` | 不自动拉起 IDE，配合 `launch_codesys` 或 attach |
| `--attach-existing` | 只接入已经打开的 IDE |
| `--read-only` | 只读，退出不保存 |
| `--enable-online` | 注册连接 PLC、读写变量、下载、启停、监视工具 |
| `--enable-python` | 注册 `eval_python`（仅可信环境，默认关闭） |
| `--mode persistent` | 常驻，保留工程上下文（推荐） |
| `--mode headless` | 每次新进程，无法保留上下文 |
| `--timeout 60000` | 单命令默认等待时间（ms） |

### 模板机制（AC700 必看）

1. 在 InoProShop 中新建 AC700 工程，编译通过后保存为 `.project`
2. 放到 `<workspace>/.templates/AC700_blank.project`
3. `list_project_templates` 发现模板
4. `create_project` 传 `{"templatePath": ".templates/AC700_blank.project", "filePath": "..."}`

**只改文件名不会改变根控制器**，模板必须真的是 AC700 工程。

### 核心工具

- 工程：`create_project`、`open_project`、`get_project_structure`、`move_object`、`get_task_config`、`get_device_params`
- 代码：`get_pou_code`、`get_all_pou_code`、`set_pou_code`（用 `expectedHash` 防覆盖）、`search_code`
- 编译：`compile_project`（返回结构化诊断）
- 在线（需 `--enable-online`）：`connect_to_device`、`write_variable`、`download_to_device`、`monitor_variables`

### 注意

- 同一 exe/profile/workspace 只能跑一个 MCP 实例（有所有权文件保护）
- 超时不等于失败：先 `get_command_status`，再 `recover_session`
- 在线工具默认不注册；下载默认在线修改，失败不会自动升级为完整下载

---

## 选型速查

| 需求 | 选择 |
|---|---|
| 第一次接入、想最快写出代码 | A |
| 多型号/多工程、要模板与审计 | B |
| 需要在线下载/监视 | B（`--enable-online`） |
| 需要读伺服参数 | A（`codesys_servo`） |

## 通用排错

1. 工具列表为空：命令路径错、Node 版本低、客户端未重连
2. 连接成功但调用报 IDE 未就绪：profile 名错、IDE 被占用、需要 `launch_codesys`
3. 工程打不开：文件被另一个 IDE 锁定，或 `.project` 版本高于本机 InoProShop
4. 编译报库缺失：工程依赖的库未安装，先在 IDE 里补库
5. 中文乱码：ST 文件按 UTF-8 写入，工程内注释可用中文，标识符建议 ASCII
