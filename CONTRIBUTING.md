# 贡献

此仓库仅维护浏览器插件。请先在 Issue 中说明问题及复现条件；不要附真实 Key、浏览器存储导出、真实匿名身份或私密帖子。测试使用合成快照。

使用 Node.js 22.12+，执行 `npm ci --ignore-scripts` 和 `npm run check`。修改消息、缓存、权限或发布边界时补充有意义的回归测试。新增源文件应加入 `release-files.json`；提交前执行 `npm run scan`。不要提交 `dist`、`release`、依赖目录或任何后台、数据库、部署配置。

提交贡献即表示你有权按本仓库 AGPL-3.0-only 许可提供代码，不要求转让版权。外部 PR 的 CI 只具备只读权限，不使用生产凭据。修复安全问题请使用 SECURITY.md 的私密渠道。
