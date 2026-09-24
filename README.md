# X 人机评审团 · 浏览器插件

Chrome / Edge Manifest V3 扩展。在 X 帖子详情页，评论时间右侧显示 `Jev 82% · 评审 67% · ✓ × ?`。

**此仓库仅开源浏览器插件，采用 AGPL-3.0-only。官网、后台、服务端实现和数据库不在本仓库中。** 公共服务地址为 <https://x.aileetcode.com>；Jev 是 TypeSafe 提供的外部服务，不包含在插件源码中。本仓库从插件文件建立独立历史，不包含原完整应用的 Git 历史。

## 安装与更新

1. 从 [Releases](https://github.com/icesixgod/x-human-ai-jury-extension/releases) 下载 `x-human-ai-jury-版本号.zip` 并解压到固定目录。
2. 打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`，启用开发者模式，选择“加载已解压的扩展程序”。
3. 在插件设置中阅读数据说明，确认后启用。要使用 Jev，填写自己的 TypeSafe Key，并按需授予 API 权限。
4. 打开 X 帖子详情页，已加载的评论进入视野后开始工作。

更新时将新 ZIP 解压到同一目录，在扩展管理页点击插件卡片的刷新按钮，再刷新 X 页面。仅刷新 X 页面不能更新后台脚本。不要卸载重装，以保留匿名身份和待同步队列。

## 功能与数据

- 只读取当前 X 页面 DOM，不爬取其他帖子，不调用 X API。跳过识别到的受保护内容、私信、截断或缺少上下文的内容；页面可见不等于已独立核实公开性。
- 个人 Key 直接调用 TypeSafe；Jev 结果只保存在本机，不上传官网。真人概率与人工投票比例分开显示；服务失败保留空状态，不编造判断。
- ✓ 主要由人写作，× 主要由 AI 生成，? 不确定。轻度润色的人工写作归入真人。三选一，可改票或撤票，断网保存最新选择并在恢复后同步。
- 获取社区统计和投票会向配置的评审 API 发送原帖、评论和可靠关联的上级回复快照。首张人工票后，该版本快照、X 链接和汇总票数可以公开。官网仅展示精选与每日辩题。
- 评审比例 = 真人票 /（真人票 + AI 票 + 不确定票）。匿名安装身份不等于真实人数。检测和投票均不能证明作者身份。

详见 [隐私说明](docs/PRIVACY.md)、[客户端接口](docs/CLIENT_API.md)、[判定提示词](shared/jev.ts)。X 页面结构变化可能影响插件；不承诺模型准确率或永久兼容。

## 自行构建

需要 Node.js 22.12+ 和 npm 10+，无需 Key 即可构建和测试。

```sh
npm ci --ignore-scripts
npm run check
```

加载 `dist/extension`。构建不需要官网源码、生产配置或部署工具。依赖只来自公开 npm 包，版本锁定在 `package-lock.json`。

替换服务必须实现 [客户端接口](docs/CLIENT_API.md)。构建时可设置 `JURY_API_ORIGIN=https://your-api.example`；仅本地调试允许 `http://localhost:8787` 或 `http://127.0.0.1:8787`，页面消息不能修改目标地址。官方发布检查拒绝自定义或本地地址。

## 发布与审查

```sh
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
npm run scan
npm run verify:rebuild
npm run package
```

`package` 要求已提交、工作区干净、构建对应当前提交。产物在 `release/`：安装 ZIP、仅插件的源码包、SBOM、构建信息和 SHA256SUMS。源码包附准确提交及内容指纹，可在无 Git 元数据的临时目录独立重建并逐字节验证。

`.gitignore` 是第一层防护；`release-files.json` 是第二层明确的文件白名单。发布扫描检查未忽略文件、全部可达 Git 历史、安装 ZIP 和嵌套源码包，拒绝服务端目录、凭据文件、数据库、符号链接和常见密钥。新增源文件须同步更新白名单；不要用忽略规则替代审查。

[发布审查记录](docs/RELEASE_REVIEW.md) · [贡献指南](CONTRIBUTING.md) · [安全报告](SECURITY.md) · [许可证](LICENSE)

本许可证只覆盖本仓库的插件代码；依赖保留各自许可证，帖子内容保留原权利。安装包内含运行依赖许可证，SBOM 列出构建依赖。当前仓库范围不改变此前任何已依法授出的许可。
