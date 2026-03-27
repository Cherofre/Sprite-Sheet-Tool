# 发布流程说明

## 分支职责
- `master`
  开发、测试、试验、素材验证和临时脚本的主线
- `codex/sst_v1`
  `v1` 正式发布线，只保留对外发版需要的内容

## 一条最重要的规则
正式 release 以 `tag` 为准，不以分支名为准。

也就是说：
- 分支负责整理和收口
- `v1.0.3` 这类 tag 才是 GitHub Release 真正对应的版本点

## 推荐发布步骤
1. 在 `master` 上完成功能开发、测试和试验性修改
2. 准备发版时，把需要对外发布的内容整理到 `codex/sst_v1`
3. 在 `codex/sst_v1` 上更新版本号、README、release notes 和发布相关配置
4. 先写对应版本的中文发布说明，文件名固定为 `docs/RELEASE_NOTES_v版本号.md`
   例如：`docs/RELEASE_NOTES_v1.0.4.md`
5. 运行发布前检查

```powershell
npm run typecheck
npm run lint
npm run build
npm run package:win
```

6. 确认 `release` 目录里的关键产物已经生成

必须包含：
- `Sprite-Sheet-Tool-1.0.4-portable-dir.zip`
- `Sprite-Sheet-Tool-1.0.4-setup.exe`
- `Sprite-Sheet-Tool-1.0.4-setup.exe.blockmap`
- `latest.yml`

7. 在 `codex/sst_v1` 当前提交上打 tag，例如：

```powershell
git tag v1.0.4
```

8. 推送发布分支和 tag：

```powershell
git push origin codex/sst_v1
git push origin v1.0.4
```

9. GitHub Actions 会根据 `.github/workflows/windows-release.yml` 自动构建并发布 Release

## Release Notes 规则
- Release 页面正文统一使用中文。
- 每次发版前都要新增一份对应版本的 release notes 文件，例如 `docs/RELEASE_NOTES_v1.0.4.md`。
- 发布工作流会优先读取这份文件作为 GitHub Release 正文；如果文件缺失，workflow 会直接失败，避免忘记写中文说明。

## 手动补传资产时要注意
如果需要手动在 GitHub Release 页面上传文件，至少要带这 4 个：
- `Sprite-Sheet-Tool-1.0.4-portable-dir.zip`
- `Sprite-Sheet-Tool-1.0.4-setup.exe`
- `Sprite-Sheet-Tool-1.0.4-setup.exe.blockmap`
- `latest.yml`

其中：
- 安装版检查更新依赖 `setup.exe`、`.blockmap` 和 `latest.yml`
- 便携版只做“检查到新版本并打开下载页”，不做原地自动升级

## 发布后建议
- 在 GitHub Release 页面点开一次资产，确认文件名和本地 `latest.yml` 一致
- 至少手动测试一次安装版“检查更新”
- 如果发布线补了正式修复，记得把这些修复同步回 `master`
