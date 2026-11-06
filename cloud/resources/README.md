# 独立云端资源

云端资源只能在此目录维护；运行时不得读取根目录 resources。
桌面技能若引用 read_doc/write_docx 等工具，必须逐项核实云端工具契约。
技能包中的任何安装脚本只允许在 OpenSandbox 内执行，不可在 API 或 Worker 加载。
