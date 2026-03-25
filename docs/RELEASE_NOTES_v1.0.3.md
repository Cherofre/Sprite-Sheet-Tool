# Sprite Sheet Tool v1.0.3

## 更新摘要
- 优化安装版和便携版的检查更新提示，不再直接显示一大串 GitHub 原始报错
- 检查更新失败时会给出更明确的中文说明，并提供“打开发布页”兜底入口
- 便携版继续保留“检查到新版本并打开下载页”的更新方式
- 安装版仍支持通过 GitHub Release 拉取更新文件
- 保留 `v1.0.2` 已有的导入、识别、Photoshop 往返和打包瘦身改进

## 推荐下载
- 安装版：`Sprite-Sheet-Tool-1.0.3-setup.exe`
- 便携版：`Sprite-Sheet-Tool-1.0.3-portable-dir.zip`

## 发布时需要带上的文件
- `Sprite-Sheet-Tool-1.0.3-setup.exe`
- `Sprite-Sheet-Tool-1.0.3-setup.exe.blockmap`
- `Sprite-Sheet-Tool-1.0.3-portable-dir.zip`
- `latest.yml`

## 备注
- 如果 GitHub 仓库或 Release 仍然是私有的，应用内检查更新仍然会失败，但这次会显示友好提示而不是原始网络报文
- 想让终端用户真正正常使用 GitHub Release 更新，更新源需要公开可访问
- 单文件 portable 仍然属于兼容性较差的附加产物，不建议作为默认下载项
