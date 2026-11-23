---
name: "汇川Inoproshop+AI写程序"
description: "指导在汇川 AC700 系列 PLC（InoProShop/CODESYS V3）上，用三款 InoProShop MCP 让 AI 直接读写工程、编写 ST、配置任务并编译。当用户要求为汇川 AC700/AM600/AC800 写程序、接入 InoProShop MCP 或让 AI 自动写 PLC 程序时使用。"
---

# 汇川 InoProShop + AI 写程序

## 适用范围

- 目标硬件：汇川 AC700 系列书本式智能机械控制器（AC701/AC702/AC703 等），同平台兼容 AM400/AM600/AC800
- 编程平台：InoProShop（基于 CODESYS V3 定制）
- 本技能解决：让 AI 在 InoProShop 工程里**读结构、写 ST/LD、建 FB、配任务、调原生编译并修错**，而不是只给代码片段

## 必须先知道的三个事实

1. AC700 是 PLCopen + IEC 61131-3 控制器，支持 ST/LD/SFC/CFC，标配 EtherCAT，最大 32 轴 1ms 同步
2. 工程文件是 InoProShop 二进制 `.project`，GitHub 上**没有** AC700 专用开源工程；开源生态集中在"同平台 ST/FB 代码 + PLCopenXML(TC6) 工程"
3. **ST 代码和 POUs 可以跨型号复用；设备树、EtherCAT 从站、轴参数、IO 映射、PDO 绝对不能跨型号直接复制**

## 三款 MCP 选型

| 工具 | 定位 | 关键特点 | 何时选 |
|---|---|---|---|
| [Polarzin/Inoproshop-MCP](https://github.com/Polarzin/Inoproshop-MCP) | 首选，开箱即用 | MIT、无需构建、`codesys_engineering`+`codesys_servo`、自带三轴飞剪 ST 示例 | 大多数场景，尤其快速验证 |
| [x2124824695-stack/inoproshop-mcp](https://github.com/x2124824695-stack/inoproshop-mcp) | 工程级稳妥版 | 模板机制、写入 hash 校验、结构化编译诊断、可选在线下载/监视 | 多型号、需可审计、生产前验证 |
| [LIMIT-LMT/InoProShop_LIMIT_MCP](https://github.com/LIMIT-LMT/InoProShop_LIMIT_MCP) | 最简接入 | 单文件 `bundle.min.js`、社区最热 | 只做简单离线任务，或上面两款跑不通时 |

三款共同前提：**Windows + 已安装含 AC700 设备包的 InoProShop + Node.js ≥ 18**。工程接口基线为 InoProShop 1.9.1.6 / SP11，V1.10.x 需实测。

详细安装、参数、能力差异见 [references/mcp-setup.md](references/mcp-setup.md)。

## 标准作业流程（SOP）

### Phase 0：信息确认（写代码前必须问清）

- AC700 具体 CPU 型号、InoProShop 版本、是否已装 AC700 设备包
- 伺服驱动器型号（如 IS620N/SV660N）、轴数、EtherCAT 周期（通常 1ms/2ms）
- 任务划分与周期（MainTask / EtherCAT 任务）
- IO 点表与 Modbus 寄存器映射（如有）
- 是否已有工程可改，还是新建；是否允许复制设备树

缺关键信息时先停下提问，不要猜轴号、IO 地址、库版本。

### Phase 1：准备模板（人工在 IDE 完成，一次性）

1. InoProShop 新建 **AC700** 空工程（选中真实 CPU 型号）
2. 保留一个空 `PLC_PRG`，加好 MainTask，**编译通过**
3. 另存为 `C:/plc/templates/AC700_blank.project`（改进版放 `<workspace>/.templates/`）
4. 关闭 IDE（或后续调用使用 `isolated=true`）

AI 建工程必须基于这个模板，不要凭空造控制器。

### Phase 2：接入 MCP

按 [references/mcp-setup.md](references/mcp-setup.md) 配置；接入后先调状态/能力类工具确认连接，不要直接写工程。

### Phase 3：先读后写

- 读取工程对象树、现有 POU 声明与实现、任务配置、库引用
- 明确要改哪个 POU、新增哪些对象；改动前让工具自动备份
- 对图形化（LD/CFC）对象只做读取，改动建议人工或在 IDE 内完成

### Phase 4：写代码

遵循 [references/ac700-programming.md](references/ac700-programming.md) 的规范：

- 每个轴一个 `FB_*` 封装，输入输出用结构体/枚举，状态机用 `CASE`
- 运动控制统一走 `SM3_Basic` 的 `MC_*` 功能块，轴引用用 `AXIS_REF_SM3`
- 任务间只通过 GVL 交换数据，禁止跨任务直接 CALL
- 硬限位、急停、故障复位、使能链必须有明确优先级
- 注释用中文可以，标识符建议 ASCII

### Phase 5：编译并修到 0 error

1. 调用原生编译，读取结构化诊断（不要只看是否超时）
2. 逐条修 error，warning 要解释原因
3. 再次读取 POU 内容确认写入结果
4. 编译通过后保存工程

### Phase 6：交付

- 明确告知用户：**EtherCAT 扫描、轴参数、IO 映射、下载与在线调试需人工在 IDE 或现场完成**
- 给出改动清单（新增/修改的 POU、任务、GVL、依赖库）
- 生产设备下载前必须备份工程并在仿真/台架验证

## 提示词模板

**新建轴控功能块**

> 用模板 `C:/plc/templates/AC700_blank.project` 新建工程。实现 `FB_AxisCtrl`：`VAR_IN_OUT Axis : AXIS_REF_SM3`，支持上电、复位、回零、相对定位、绝对定位、点动、停止，硬限位钳制，故障锁存。用 SM3_Basic 的 MC_Power/MC_Reset/MC_Home/MC_MoveRelative/MC_MoveAbsolute/MC_Jog/MC_Halt。写到 Application 下并新建 10ms 任务调用，编译到 0 error 后保存。

**补全已有工程**

> 先读取工程结构、`PRG_Main` 和 GVL，说明现有控制流程；再新增一个气缸控制 FB（双线圈、超时报警、互锁），接入现有 GVL，不修改设备树和 IO 映射，编译并修复。

**修编译错误**

> 编译并把全部 error/warning 列出来，按库版本、类型不匹配、未定义变量分类修复；修完再编译确认 0 error，并说明每处改动原因。

## 安全红线

- 不自动改设备树、EtherCAT 拓扑、PDO 映射、轴参数；必须改时先征得用户确认
- 不在生产设备上自动下载/启停；在线写值、下载只在用户明确要求和已做台架验证后执行
- 任何写入前确保工具有备份；超时视为"结果未知"，先查状态，不重复盲发
- 不让 AI 编造不存在的库、FB 引脚、寄存器地址；不确定就查工程里已安装的库或问用户

## 故障排查

| 现象 | 处理 |
|---|---|
| MCP 已连接但 IDE 无响应 | 核对 `INOPROSHOP_EXE`、profile 名（看快捷方式 `--profile`）、是否有第二个 IDE 实例 |
| 找不到 AC700 型号 | 未装 AC700 设备描述/固件包，先在 InoProShop 里装 |
| 编译报 `MC_*` 未定义 | `SM3_Basic` 库版本不匹配，改用 InoProShop 自带库并重加引用 |
| 编译超时 | 客户端超时设 ≥660s；超时后查命令状态，不要重发 |
| 下载失败 | 区分在线修改与完整下载；确认应用/启动应用配置 |

## 参考资料

- [Polarzin/Inoproshop-MCP](https://github.com/Polarzin/Inoproshop-MCP)（含飞剪示例 `examples/c6/`）
- [x2124824695-stack/inoproshop-mcp](https://github.com/x2124824695-stack/inoproshop-mcp)（模板机制与工具清单）
- [LIMIT-LMT/InoProShop_LIMIT_MCP](https://github.com/LIMIT-LMT/InoProShop_LIMIT_MCP)
- [Roarpeng/LMM](https://github.com/Roarpeng/LMM)（AM600/InoProShop 实战 ST 风格参考：FB_Servo、FB_XDual、PRG_TcpHmi）
- [stefandreyer/OSCAT-BASIC](https://github.com/stefandreyer/OSCAT-BASIC)（可导入 InoProShop 的通用库）
- 汇川官网 AC700 产品页与《中型 PLC 编程手册（AM400/AM600/AC800/AC700）》
