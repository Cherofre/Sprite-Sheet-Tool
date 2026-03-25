# Sprite Sheet Tool v1.0.2

## 更新摘要
- 新增安装版和便携版的“检查更新”入口
- 便携版改成带外层文件夹的 `zip` 目录包，解压更安全
- 优化单图识别弹框，支持候选方案和手动输入拆分方式
- 增加更多图片格式支持，包括 `TGA`、`DDS`
- 改进导入策略，支持追加、替换当前帧、清空后重新导入
- 优化 Photoshop 往返流程，并修复持续回灌链路
- 收紧高密度单图误识别，普通图片更不容易被误拆成大量帧
- 精简打包内容，显著降低安装包和便携包体积

## 推荐下载
- 安装版：`Sprite-Sheet-Tool-1.0.2-setup.exe`
- 便携版：`Sprite-Sheet-Tool-1.0.2-portable-dir.zip`

## 发布时需要带上的文件
- `Sprite-Sheet-Tool-1.0.2-setup.exe`
- `Sprite-Sheet-Tool-1.0.2-setup.exe.blockmap`
- `Sprite-Sheet-Tool-1.0.2-portable-dir.zip`
- `latest.yml`

## 备注
- 安装版支持通过 GitHub Release 做检查更新
- 便携版只检查新版本并打开下载页，不做原地自动覆盖升级
- 单文件 portable 仍然属于兼容性较差的附加产物，不建议作为默认下载项
