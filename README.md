# TypeWords Plus

基于 [TypeWords](https://github.com/zyronon/TypeWords) 的 Windows 本地学习版。浏览器打开本机站点练习英文，可以导入自己的文件和选择离线朗读音色。

## 功能

- 书籍列表支持 PDF、EPUB、DOC、DOCX、XLS、XLSX、XLSM、ODS、CSV、TSV。PDF 需要包含可提取的文本，导入上限为 64 MiB。
- 从文章练习底栏启动连续朗读，可暂停、继续，并在读完当前篇后进入下一篇。
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

打开 [书籍列表](http://127.0.0.1:5567/book-list) 导入文件，或直接打开 [音效设置](http://127.0.0.1:5567/setting?index=4)。按 `Ctrl+C` 停止服务。

## 当前状态

Windows 本机已验证 10 种文件格式可以导入并打开练习。语音功能处于预览阶段。Kokoro 的三个音色已通过本地语音接口验证，浏览器刷新后的音色恢复和完整连续播放仍待确认。Chatterbox Nano 已在独立进程生成音频，正式站点在本机 CPU 负载较高时曾遇到合成超时。

## 致谢与许可

感谢 [zyronon](https://github.com/zyronon) 和 [TypeWords 的所有贡献者](https://github.com/zyronon/TypeWords/graphs/contributors) 开源原项目，提供了单词和文章练习、词库和界面基础。本项目基于上游提交 `1bcc2a2`，保留上游 Git 历史和 [GPL-3.0 许可证](LICENSE)。上游项目介绍见 [原版中文文档](docs/README.zh-CN.md)。

感谢 [hexgrad 和 Kokoro 贡献者](https://huggingface.co/hexgrad/Kokoro-82M)、[thewh1teagle 和 kokoro-onnx 贡献者](https://github.com/thewh1teagle/kokoro-onnx)，以及 [Resemble AI 的 Chatterbox 团队](https://github.com/resemble-ai/chatterbox) 发布本地语音模型和推理代码。
