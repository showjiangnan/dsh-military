# 安装、升级、回滚与卸载

## 1. 生命周期

Bundle 生命周期是受控事务：

```text
PLAN
→ BACKUP
→ APPLY ASSETS
→ APPLY PROFILE OVERLAY
→ MIGRATE STORAGE
→ PROBE
→ COMMIT
```

失败进入：

```text
ROLLBACK
→ VERIFY LAST KNOWN GOOD
→ REPORT
```

每次操作输出 [`BundleLifecycleReceipt`](../schemas/bundle-lifecycle-receipt.schema.json)。

## 2. 安装

安装器必须：

1. 获取 profile revision；
2. 读取完整 `agent-presets` row；
3. 检测 `military` ID 和 root 冲突；
4. 安装 immutable generation assets；
5. 追加 system preset root，保留原 `default/roots/includeUserRoot`；
6. 安装 Host、Client 和 Settings rows；
7. 运行数据库 migration；
8. 执行 `dsh --dump-config` 等价校验；
9. 运行 Compatibility Probe；
10. 原子提交 overlay。

不自动把 `military` 设为默认。

### RC.2 本地发行安装

`0.9.0-alpha.24` 标准安装只把自包含 Bundle 添加为 Profile layer；Installer 已
嵌入 Bundle：

```bash
cd release
shasum -a 256 -c checksums.sha256

dsh plugin --profile web add \
  ./dsh-military-bundle-0.9.0-alpha.24.tgz

pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec \
  dsh-military-install install \
  --dsh-home "${DSH_HOME:-$HOME/.dsh}"

pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec \
  dsh-military-install verify \
  --dsh-home "${DSH_HOME:-$HOME/.dsh}"
```

独立 `dsh-military-installer-0.9.0-alpha.24.tgz` 只用于 preset-only 生命周期，
不能作为 DSH Bundle layer 添加。Profile 使用 `file:` 引用时，安装中的旧 tarball
在该 Profile 升级并验证前必须保留。

## 3. 升级

升级前冻结新 Military Mission admission，允许运行中安全收敛。步骤：

- 备份数据库、generation store 和 profile；
- 计算新 preset generation；
- 旧 generation 转 `ARCHIVED`；
- 运行 forward migration；
- 启动 shadow probe；
- 对 Golden Mission 重放；
- 切换新会话到 current generation；
- current-generation Session 可继续恢复；archived-only 根 Session 在重启后必须隔离并显式迁移，不能静默挂到新 generation。

破坏性升级必须引入新 major preset 或 Migration Order。

本地 tarball 升级顺序是：构建并校验新 release、保留旧 immutable tarball、
执行 `dsh plugin add` 替换 layer、运行 Installer `install`/`verify`、重启 Web、
验证 Loader/Preset/两个侧栏入口和控制中心 Remote，最后才归档不再被任何
Profile 引用的旧 tarball。不得先清空 `release/`，否则 pnpm 无法解析当前
Profile 的旧 `file:` 依赖。

## 4. 回滚

回滚不删除升级期间产生的新 Event。要求：

- 旧二进制可读取或忽略新 additive data；
- 数据库 migration 标记 rollback class；
- profile 和 current generation 指针恢复；
- 新 generation 变 archived；
- 新 Session admission 使用旧 known-good；
- 已在新 generation 创建的 Session 保持其 generation 或隔离。

如果数据不可逆，回滚转换为 forward-fix，不伪装成功。

本地回滚必须使用原始旧 Bundle tarball 和升级前备份：

1. 停止 Web admission；
2. 校验旧 tarball SHA-256；
3. `dsh plugin --profile web add <旧 bundle.tgz>`；
4. 恢复兼容的 preset generation 指针/profile 备份；
5. 运行 Installer `verify` 和 Compatibility Probe；
6. 启动 Web，检查历史 Session 的 generation disposition；
7. 保留 alpha.17 期间产生的 Ledger、Skill、benchmark 和 recovery receipt。

## 5. Disable

Disable 仅停止：

- 新 Military Session 选择；
- 新 Mission admission；
- 异步研究和评估调度。

它不删除数据，也不让现有 Military Session 改成 Standard。现有 Session 可只读导出或按策略收敛。

## 6. Uninstall

用户选择数据处置：

```text
RETAINED
EXPORTED_AND_REMOVED
REMOVED
```

卸载前列出：

- 可恢复 Session；
- 未完成 Mission；
- preset generations；
- 私有战术和源；
- 绩效报告；
- Artifact bytes；
- legal hold。

没有显式授权不得删除。

卸载移除 active profile rows 和 public preset root，但保留 tombstone，让历史 UI 显示“Military Bundle 未安装”，而不是错误解释为普通 Session。

## 7. 冲突

若部署已有 user preset id=`military`：

- 安装失败；
- 显示来源和路径；
- 不覆盖、不 shadow；
- 用户可重命名自己的 preset 或选择不同产品 major id。

## 8. 安全

安装器不接受模型提供的任意文件路径或包名；资产来自签名/校验后的 Bundle。Profile 写入使用 revision CAS，临时文件 + fsync + rename。

## 9. 验收条件

- 安装保留现有 preset roots/default；
- 失败自动恢复 profile；
- 升级后旧 Session 可被精确识别；current generation 可恢复，archived-only 根 Session 安全隔离并可迁移；
- 回滚后新数据不丢失；
- disable 不干扰 Standard Session；
- uninstall 有可审计数据处置；
- 同名冲突不被覆盖。
