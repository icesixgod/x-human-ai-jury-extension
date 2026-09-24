# 客户端接口约定

本文件只描述插件调用的公开接口，不包含官方服务端实现、后台、数据库或部署文件。自建替代服务需自行实现接口；本仓库不提供可部署服务器。

目标 origin 在构建时通过 `JURY_API_ORIGIN` 固定；默认 `https://x.aileetcode.com`。所有请求为 JSON，携带 `Authorization: Bearer <anonymous-install-credential>`，不携带 X Cookie、个人 Jev Key 或模型结果。凭证由插件随机生成。文本和字段定义见 `shared/contracts.ts`。

- `POST /api/v1/community`：body 是 `Snapshot`。
- `PUT /api/v1/votes/:commentId`：body 为 `{ snapshot, vote: "human" | "ai" | "uncertain", sequence }`。
- `DELETE /api/v1/votes/:commentId`：body 为 `{ snapshot, vote: null, sequence }`。

成功响应为 `ReviewState`：`{ review: { id, snapshot, tally, contentSource, createdAt, updatedAt, conflict }, myVote, sequence, published }`。`id` 是固定规则生成的内容 SHA-256；`sequence` 是安全整数。`tally` 的真人比例分母包含不确定票。错误响应为非 2xx 与 `{ error: "已知错误码" }`；未知或无效响应显示服务不可用。

客户端按评论版本合并离线请求，仅保留最新意图；兼容服务必须幂等处理重试和较旧序列。同一版本、同一身份最多一票，撤回及改票不重复计数。原帖或评论文本变更产生不同版本，不能静默覆盖。

TypeSafe 调用与此接口分离：固定调用 `https://api.typesafe.ai/v1/systemone`，输入 `state` 与 `shared/jev.ts` 中版本化的判定问题，输出只存本机。TypeSafe 接口或模型可能变化，当前默认模型见 `shared/contracts.ts`。本仓库不宣称提供 Jev 模型源码。
