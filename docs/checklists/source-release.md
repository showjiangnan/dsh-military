# 源码发布清单

- [x] `VERSION.json` 固定 dsh `0.1.1-rc.2` 和 commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- [x] `pnpm generate` 无生成物漂移。
- [x] `pnpm typecheck` 与 `pnpm typecheck:rc2` 通过；精确报告的
  `sourceCheckoutVerified` 为 `true`。
- [x] `pnpm build` 通过，`BUILD-MANIFEST.json` 新鲜。
- [x] `pnpm test` 全部通过，`TEST-REPORT.json` 为 PASS。
- [x] `pnpm review` 为 PASS，阻断发现为 0。
- [x] preset current 与 archive 文件 hash 一致。
- [x] 文档单文件规范、索引、Schema、SQL、Trace 全部校验通过。
- [x] Bundle/Installer tarball 不从 npm 解析未发布的内部 package。
- [x] 两次独立 pack hash 一致，`checksums.sha256` 全部通过。
- [x] 发布说明明确区分已运行的 RC.2 Profile E2E 与外部 Provider 部署检查。
