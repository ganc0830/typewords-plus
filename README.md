# TypeWords Plus

基于 [TypeWords](https://github.com/zyronon/TypeWords) 的 Windows 本地学习版。浏览器打开本机站点练习英文，可以导入自己的文件和选择离线朗读音色。

## 功能

- **单词 → 我的词典 → 导入词书**支持 XLS、XLSX、XLSM、ODS、CSV、TSV 和 PDF。可预览识别结果并新建词书，也可从已有个人词书的「导入词条」追加。表格建议使用「单词」和「释义」列，扫描版 PDF 需要先做 OCR。
- 书籍列表支持 PDF、EPUB、DOC、DOCX、XLS、XLSX、XLSM、ODS、CSV、TSV。PDF 需要包含可提取的文本，导入上限为 64 MiB。
- 从文章练习底栏启动连续朗读。当前句以亮绿色高亮，读到当前屏幕下方的句子时整屏切换。可暂停、继续，并在读完当前篇后进入下一篇。
- **设置 → 音效设置 → 全局发音声色**可选择 Kokoro Heart（美音女声）、Emma（英音女声）、George（英音男声）或 Chatterbox Nano（模型内置音色），右侧扬声器可试听。
- 文件解析和语音合成在本机完成。书籍及学习数据存入当前浏览器的 IndexedDB。仓库只包含源码和上游公开资源。

## 安装环境

- Windows x64、PowerShell、Git、Node.js 24（本机版本为 24.18.0）、pnpm 10、Python 3.12 x64。Node.js 自带 npm，Python 需包含 venv 和 pip。
- Python 解析依赖为 `pypdf==6.10.0`、`python-calamine==0.9.1`，旧版 DOC 的 Node 依赖为 `word-extractor==1.0.4`。
- Kokoro 使用 `kokoro-onnx==0.6.1` 和其 ONNX Runtime 依赖。Chatterbox 使用官方 Nano 源码版本 `5de7a54aa4e5e2baadb0182dde554908b48b85c2`，配套 PyTorch / torchaudio 2.6.0、Transformers 5.2.0 和 Perth 水印组件。固定 `setuptools==80.10.2` 提供 Perth 使用的 `pkg_resources`。
- 两个模型默认走 CPU。Chatterbox 的模型及运行库占用数 GB 磁盘空间，CPU 合成时也需要数 GB 可用内存。依赖和模型下载完成后，本地朗读无需联网。
- 如果 ONNX Runtime 或 PyTorch 在 Windows 上报运行库 DLL 缺失，安装 [Microsoft Visual C++ Redistributable x64](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist)。

### 安装程序依赖

在仓库根目录打开 PowerShell。需要把项目数据放到 D 盘时，请先将仓库克隆到 D 盘。

```powershell
pnpm install --frozen-lockfile
npm ci --prefix scripts/legacy-word
py -3.12 -m venv .venv
$python = Join-Path $PWD '.venv\Scripts\python.exe'
& $python -m pip install -r scripts/requirements-local-book.txt
& $python -m pip install --target voice-libs/kokoro 'kokoro-onnx==0.6.1'
& $python -m pip install --target voice-libs/chatterbox 'chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2' 'setuptools==80.10.2'
```

### 下载语音模型

```powershell
New-Item -ItemType Directory -Force voices/kokoro, voices/chatterbox-nano | Out-Null
$kokoro = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1'
curl.exe --fail --location "$kokoro/kokoro-v1.0.fp16.onnx" --output 'voices/kokoro/kokoro-v1.0.fp16.onnx'
curl.exe --fail --location "$kokoro/voices-v1.0.bin" --output 'voices/kokoro/voices-v1.0.bin'
& $python -c "import sys; sys.path.insert(0, 'voice-libs/chatterbox'); from huggingface_hub import snapshot_download; snapshot_download(repo_id='ResembleAI/chatterbox-nano', revision='71ccd1d0081b430592cea481f4307e764e07bc64', local_dir='voices/chatterbox-nano', allow_patterns=['*.safetensors','*.pt','*.json','merges.txt'])"
```

各模型的文件和使用许可见 [Kokoro ONNX 发布页](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1) 和 [Chatterbox Nano 模型页](https://huggingface.co/ResembleAI/chatterbox-nano)。

### 构建和启动

```powershell
$env:ORIGIN = 'http://127.0.0.1:5567'
$env:NUXT_TELEMETRY_DISABLED = '1'
pnpm build
node start.mjs
```

打开 [单词页](http://127.0.0.1:5567/words) 导入词书，或从 [书籍列表](http://127.0.0.1:5567/book-list) 导入文章练习文件。试听和选择音色请打开 [音效设置](http://127.0.0.1:5567/setting?index=4)。按 `Ctrl+C` 停止服务。

## 当前状态

Windows 本机已验证七种词书格式的解析，并通过 Edge 验证了新建词书、追加词条及刷新后恢复。书籍列表已有 10 种文件格式通过导入和打开练习验证。Kokoro 的三个音色已在含中文字符的 Windows 项目路径下通过本地语音接口验证。浏览器刷新后的音色恢复和完整连续播放仍待确认。Chatterbox Nano 曾在独立进程生成音频，正式站点在本机 CPU 负载较高时曾遇到合成超时。

## 致谢与许可

感谢 [zyronon](https://github.com/zyronon) 和 [TypeWords 的所有贡献者](https://github.com/zyronon/TypeWords/graphs/contributors) 开源原项目，提供了单词和文章练习、词库和界面基础。本项目基于上游提交 `1bcc2a2`，保留上游 Git 历史和 [GPL-3.0 许可证](LICENSE)。上游项目介绍见 [原版中文文档](docs/README.zh-CN.md)。

感谢 [hexgrad 和 Kokoro 贡献者](https://huggingface.co/hexgrad/Kokoro-82M)、[thewh1teagle 和 kokoro-onnx 贡献者](https://github.com/thewh1teagle/kokoro-onnx)，以及 [Resemble AI 的 Chatterbox 团队](https://github.com/resemble-ai/chatterbox) 发布本地语音模型和推理代码。

## 安卓离线学习

电脑页面提供小说书架、章节目录、翻页和阅读位置保存。安卓应用支持下载电脑词书和文章后离线学习。连接电脑后可以手动上传新增单词和学习进度，并逐项解决进度冲突。

在电脑端设置 `TYPEWORDS_MOBILE_DATA` 为独立的数据目录，令服务监听局域网接口及端口 5567。手机和电脑接入同一局域网，在电脑的「同步」页面查看地址和配对码。词库和同步数据保存在各自的设备上。

在 Windows 上先运行现有 Nuxt 生产构建。准备 JDK 21、Android SDK Platform 35 和 Build Tools 35.0.0，将 `TYPEWORDS_ANDROID_TOOLS` 指向包含 `jdk` 和 `sdk` 子目录的工具目录，运行 `pwsh -File android/build.ps1`。可通过 `TYPEWORDS_ANDROID_WORK` 指定仅用于打包的 ASCII 路径。生成的 APK 位于 `android/dist`，后续版本需沿用本机签名密钥。
