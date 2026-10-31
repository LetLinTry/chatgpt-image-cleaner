# ChatGPT 图片清理器

一个本地运行的 Chrome / Edge Manifest V3 扩展，用于扫描并批量删除 ChatGPT Library（资料库）中的图片。

v2.0 起不再模拟页面点击，而是直接调用 ChatGPT 页面自身使用的后端接口（v2.4 对应新版资料库文件系统）：

- 列表：`GET /backend-api/files/library/nodes?categories=image&cursor=…`（服务端只返回图片，游标分页）
- 删除：`POST /backend-api/files/library/files/{libfile_id}/delete_stream?soft_delete=true&file_id=…&parent_directory_id=…&file_name=…`（软删除，可在"最近删除"中恢复）
- 兜底：扩展还会在主世界挂只读钩子（`src/page-hook.js`），捕获资料库页面自己发出的列表请求；若官方接口再变，捕获到的真实 URL 会被优先复用。

因此可以稳定处理数万张图片，不受虚拟列表、悬停复选框等页面结构变化影响。

## 安装

### 方式一：下载现成压缩包（推荐，不需要命令行）

1. 到 [Releases](https://github.com/LetLinTry/chatgpt-image-cleaner/releases) 下载最新的 `chatgpt-image-cleaner.zip`。
2. 解压到**一个固定的目录**，之后不要移动或删除它——浏览器直接从这个目录加载扩展。
3. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
4. 开启右上角的「开发者模式」。
5. 点击「加载已解压的扩展程序」，选择第 2 步解压出来的文件夹。
6. 把扩展图标固定到浏览器工具栏，方便下次点击。

### 方式二：从源码打包（开发者）

```bash
git clone https://github.com/LetLinTry/chatgpt-image-cleaner.git
cd chatgpt-image-cleaner
sh scripts/package.sh      # 产物：../outputs/chatgpt-image-cleaner.zip
```

然后按方式一的第 2–6 步安装。

### 更新

重新下载或重新打包后，到 `chrome://extensions` 点击扩展卡片上的「重新加载」（⟳）。

> 注意：**不要移动解压后的文件夹**，路径一变扩展就会失效，需要重新走一遍安装步骤。

> 为什么必须开「开发者模式」？因为本扩展没有上架 Chrome 应用商店。上架需要注册开发者账号并经过审核，属于后续计划。

## 使用

1. 登录 [ChatGPT](https://chatgpt.com/) 并打开任意 chatgpt.com 页面（建议打开资料库方便观察）。
2. 点击扩展图标，选择**删除范围**（全部 / 仅 7 天前 / 仅 30 天前 / 仅 90 天前）和**并发线程**（1–10，默认 3）。
3. 点击"开始删除"：边抓取边删除，无需预先扫描；"统计图片总数"按钮为可选功能。
4. 删除在页面后台运行：**关闭弹窗不影响进度**（重新打开弹窗可看到实时进度），但请保持该标签页打开、不要刷新。

> 线程数越高越快，但 ChatGPT 服务端有限流；遇到 429 会自动退避重试。建议 3–5。

## 日志与排错

- 每次运行的状态与最后一次错误会持久保存：重新打开弹窗即可看到"上次运行已停止：…"。
- 页面控制台（F12 → Console，过滤"图片清理器"）有详细日志。
- `chrome://extensions` → 本插件卡片 → "错误"按钮可查看脚本异常。

## 安全机制

- 仅在 `https://chatgpt.com/*` 运行；只调用 ChatGPT 自身的官方接口，不访问第三方服务器。
- 删除必须由你在弹窗中明确点击"开始删除全部图片"触发。
- 金丝雀验证：第一批删除后会回查列表，确认图片真的消失；若接口返回成功但图片仍在，立即停止。
- 删除接口从一开始就连续失败（如接口变更、无权限）时立即停止并显示 HTTP 状态码。
- 遇到 429 限流自动按 Retry-After / 指数退避重试；个别删除失败会跳过并计数，不会卡死。
- 随时可点"停止操作"取消。
- 不读取聊天正文，不上传任何数据。

## 限制

- ChatGPT 内部接口可能随版本变更。如果启动删除后立即报"删除接口连续失败"或"图片仍在资料库中"，说明接口已变化：请打开 DevTools → Network，在资料库页面手动删除一张图片，观察实际请求路径，并据此更新 `src/api-client.js`。
- 删除速度约每张 0.3–0.5 秒（含限速保护），数万张需数小时，请保持标签页打开（可切到其他窗口干别的）。

## 开发验证

```bash
npm install
npm test
```

自动化测试使用本地 fake API / DOM fixture，不会登录 ChatGPT，也不会执行真实删除。

## 许可证

[MIT](LICENSE) © 2026 LetLinTry

## 免责声明

本项目通过 ChatGPT 网页自身的后端接口批量删除资料库中的图片，属于软删除（可在"最近删除"中恢复）。
使用前请自行确认删除范围；作者不对误删或接口变更导致的任何损失负责。
