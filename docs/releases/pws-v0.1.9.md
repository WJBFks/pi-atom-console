# Pi Web Space 0.1.9

Release notes prepared for the first `@wjbfks/pi-web-space` package. Publication is pending.

## 中文

Pi Web Space 是基于 agegr/pi-web 的工作空间增强分支，保留 MIT 许可证和上游署名。

- 新增工作区、最近会话及临时会话组织方式，支持选择工作区后创建会话。
- 可配置临时工作区路径，提供恢复默认，并尝试创建缺失目录。
- 工作区和会话信息卡片提供逐项复制操作。
- 提供对话、轨迹及上下文视图，聊天宽度可拖动调整。
- 底部展示会话轮数、轨迹步数、Token 用量、缓存命中率和成本；平均 tok/s 为包含等待及工具耗时的估算。
- 调整文件预览、底部终端、模型选择及设置界面，新增“关于”。
- npm 包名为 `@wjbfks/pi-web-space`；主命令 `pws`，别名 `pi-web-space`，默认端口 `40141`。

工作区命名、归档及部分界面偏好保存在当前浏览器。沿用现有 Pi 配置和会话格式，以及兼容性环境变量和扩展标识。

## English

Pi Web Space is a workspace-focused fork of agegr/pi-web, retaining the upstream MIT license and attribution.

- Workspace, recent and temporary session organization with workspace selection for new sessions.
- Configurable temporary directory, reset to the platform default and creation of missing directories.
- Workspace/session detail cards with per-field copy actions.
- Conversation, trace and context views, with draggable chat width.
- Session rounds, trace steps, token usage, cache hit rate and cost. Average tok/s is an estimate including tool and waiting time.
- Updated file previews, docked terminal, model selection, settings and an About page.
- Package `@wjbfks/pi-web-space`, primary command `pws`, alias `pi-web-space`, default port `40141`.

Workspace names, archives and some UI preferences remain browser-local. Existing Pi configuration, session formats, environment variables and extension identifiers are retained for compatibility.
