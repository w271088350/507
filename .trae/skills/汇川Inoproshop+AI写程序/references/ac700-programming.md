# AC700 编程规范与代码骨架

## 1. 工程结构约定

```
Device (AC700 CPU)
└─ Application
   ├─ GVL            // 全局变量，唯一入口，按功能分组
   ├─ DUT            // 结构体 / 枚举
   ├─ FB_xxx         // 功能块，一个设备/一个轴一个 FB
   ├─ PRG_Main       // MainTask 入口，只做调度
   └─ PRG_AxisCtrl   // EtherCAT 任务内调用各轴 FB
```

- **PLC_PRG 只做调度**，不放具体工艺逻辑
- 轴控 FB 只在 EtherCAT 任务里实例化，不要跨任务调用
- 任务间只通过 GVL 交换数据

## 2. 任务划分

| 任务 | 典型周期 | 内容 |
|---|---|---|
| MainTask | 10ms / 20ms | 逻辑、HMI、Modbus 映射、报警 |
| EtherCAT_Task | 1ms / 2ms | 各轴 `FB_*`、`MC_*` 调用、IO 刷新 |

AC700 最大 32 轴 1ms 同步，轴多时注意任务负载，必要时把非实时逻辑下放到 10ms 任务。

## 3. 运动控制写法

- 轴引用类型统一 `AXIS_REF_SM3`
- 只用 `SM3_Basic` 库的 `MC_*` 功能块，不要手写底层
- 命令仲裁优先级（从高到低）：急停/故障 > 停止 > 回零 > 绝对定位 > 相对定位 > 速度 > 点动
- 运动切换依赖 PLCopen 的中止机制：新命令 Execute 上升沿会 abort 旧运动
- 硬限位：所有模式都要钳制目标位置、禁止越限方向
- 故障要锁存，必须显式复位

### 单轴 FB 骨架

```st
FUNCTION_BLOCK FB_AxisCtrl
VAR_IN_OUT
    Axis : AXIS_REF_SM3;
END_VAR
VAR_INPUT
    xEnable    : BOOL;    // 使能
    xReset     : BOOL;    // 故障复位（上升沿）
    xHome      : BOOL;    // 回零（电平，完成后由上层清）
    xMoveAbs   : BOOL;    // 绝对定位
    rTargetPos : REAL;
    xMoveRel   : BOOL;    // 相对定位
    rDistance  : REAL;
    xJogPos    : BOOL;
    xJogNeg    : BOOL;
    xStop      : BOOL;    // 停止（保持使能）
    rVel       : REAL := 100.0;
    rAcc       : REAL := 1000.0;
    rDec       : REAL := 1000.0;
    rJogVel    : REAL := 20.0;
    rLimitPos  : REAL := 1000.0;
    rLimitNeg  : REAL := 0.0;
END_VAR
VAR_OUTPUT
    xReady     : BOOL;
    xMoving    : BOOL;
    xError     : BOOL;
    nErrorID   : WORD;
    rActPos    : REAL;
END_VAR
VAR
    fbPower    : MC_Power;
    fbReset    : MC_Reset;
    fbHome     : MC_Home;
    fbMoveAbs  : MC_MoveAbsolute;
    fbMoveRel  : MC_MoveRelative;
    fbJogP     : MC_Jog;
    fbJogN     : MC_Jog;
    fbHalt     : MC_Halt;
    xAbortAll  : BOOL;
    rAbsTarget : REAL;
    rRelDist   : REAL;
END_VAR

// 1) 使能
fbPower(Axis := Axis, Enable := xEnable,
        bRegulatorOn := xEnable, bDriveStart := xEnable);

// 2) 故障复位
fbReset(Axis := Axis, Execute := xReset);

// 3) 硬限位钳制
rAbsTarget := LIMIT(rLimitNeg, rTargetPos, rLimitPos);
rRelDist   := rDistance;
IF Axis.fActPosition + rRelDist > rLimitPos THEN
    rRelDist := rLimitPos - Axis.fActPosition;
END_IF
IF Axis.fActPosition + rRelDist < rLimitNeg THEN
    rRelDist := rLimitNeg - Axis.fActPosition;
END_IF

// 4) 命令仲裁
xAbortAll := xStop OR Axis.fbPower.Status = FALSE;

fbHome(Axis := Axis, Execute := xHome AND NOT xAbortAll, Position := 0.0);

fbMoveAbs(Axis := Axis,
          Execute := xMoveAbs AND NOT xAbortAll AND NOT xHome,
          Position := rAbsTarget, Velocity := rVel,
          Acceleration := rAcc, Deceleration := rDec,
          Direction := MC_DIRECTION.shortest, BufferMode := MC_BUFFER_MODE.aborting);

fbMoveRel(Axis := Axis,
          Execute := xMoveRel AND NOT xAbortAll AND NOT xHome AND NOT xMoveAbs,
          Distance := rRelDist, Velocity := rVel,
          Acceleration := rAcc, Deceleration := rDec,
          BufferMode := MC_BUFFER_MODE.aborting);

fbJogP(Axis := Axis, JogForward := xJogPos AND NOT xAbortAll,
       JogBackward := FALSE, Velocity := rJogVel,
       Acceleration := rAcc, Deceleration := rDec);

fbJogN(Axis := Axis, JogForward := FALSE,
       JogBackward := xJogNeg AND NOT xAbortAll, Velocity := rJogVel,
       Acceleration := rAcc, Deceleration := rDec);

fbHalt(Axis := Axis, Execute := xAbortAll, Deceleration := rDec);

// 5) 状态输出
xReady   := fbPower.Status AND NOT fbPower.Error;
xError   := fbPower.Error OR fbHome.Error OR fbMoveAbs.Error
            OR fbMoveRel.Error OR fbJogP.Error OR fbJogN.Error;
nErrorID := fbPower.ErrorID;
xMoving  := fbHome.Busy OR fbMoveAbs.Busy OR fbMoveRel.Busy
            OR fbJogP.Busy OR fbJogN.Busy;
rActPos  := Axis.fActPosition;
```

> 实际引脚名以本机 InoProShop 里 `SM3_Basic` 的版本为准；不同 SP 下 `MC_Jog`、`MC_MoveAbsolute` 的参数可能有差异，编译报错时以库定义为唯一依据。

## 4. 多轴与双驱

- 多轴：`ARRAY[0..N] OF FB_AxisCtrl` + `ARRAY[0..N] OF AXIS_REF_SM3`，用轴号索引
- 双驱龙门：两个 `FB_AxisCtrl` + 一个差速合成 FB，主从位置差做补偿，不要用 Gear 硬绑定（现场调试更可控）
- 力控/恒力：力传感器原始值先做滤波、去皮、量程换算，再加看门狗；输出叠加到速度指令而不是直接写位置

## 5. GVL 与 HMI / Modbus

```st
VAR_GLOBAL
    // 命令区
    xCmd_Start      : BOOL;
    xCmd_Stop       : BOOL;
    rCmd_TargetPos  : REAL;
    // 状态区
    xSts_Running    : BOOL;
    rSts_ActPos     : REAL;
    nSts_Alarm      : WORD;
END_VAR
```

- Modbus TCP 用 `%IW` / `%QW` 映射时，先定好地址表并冻结，PLC、网关、HMI 三方共用一份
- 建议单独一个 `PRG_TcpHmi` 做编解码和三源（面板/触摸屏/Web）仲裁，不要让业务逻辑直接读寄存器

## 6. 代码复用与跨型号迁移

**可以复用：**
- ST 源码（FB/FC/PRG/GVL/DUT）
- PLCopenXML（TC6）里的 POU 对象
- `SM3_Basic` 标准运动调用方式
- 工艺算法（飞剪凸轮、追剪、排样、力控）

**不能复用：**
- 设备树、EtherCAT 从站顺序与地址
- 轴参数（软限位、齿轮比、单位换算）
- IO 映射、PDO 分配
- 库版本与固件相关配置

**从开源工程迁移到 AC700 的步骤：**
1. InoProShop 新建 AC700 工程（真实 CPU 型号）
2. 项目 → 导入 PLCopenXML，或在目标工程新建 POU 后粘贴 ST
3. 重新添加 `SM3_Basic` 等库引用（用本机自带版本）
4. EtherCAT 扫描真实从站，按驱动器型号重建轴
5. 重新绑定 `AXIS_REF_SM3` 与 IO 变量
6. 编译到 0 error，再人工核对轴方向、限位、单位

## 7. 常见坑

| 坑 | 说明 |
|---|---|
| `AXIS_REF` vs `AXIS_REF_SM3` | 混用会编译失败，AC700 统一用 `AXIS_REF_SM3` |
| REAL 精度 | 位置/速度用 REAL 够用；长距离累计误差大时改用 LREAL |
| 周期不匹配 | 轴控 FB 放 10ms 任务里会抖动，必须放 EtherCAT 任务 |
| 库版本 | 复制别处的工程后 `MC_*` 报参数错，九成是 `SM3_Basic` 版本不同 |
| 中文标识符 | 能用，但跨版本导入易乱码，建议 ASCII 标识符 + 中文注释 |
| 在线修改 | 改了接口/任务结构只能完整下载，不能在线修改 |
| 硬限位只做软件 | 必须同时接硬件限位和急停，软件限位只是第二道保护 |

## 8. 交付验收清单

- [ ] 编译 0 error，warning 已解释
- [ ] 任务周期、优先级、调用关系与设计一致
- [ ] 每个轴的上电/复位/回零/定位/停止/急停路径都验证过
- [ ] 硬限位、软限位、急停、故障锁存生效
- [ ] GVL 与 Modbus/HMI 地址表一致
- [ ] 改动清单与依赖库版本已记录
- [ ] 生产下载前已备份并台架验证
