"""本机 Kokoro 与 Chatterbox 朗读工作进程。"""

import base64
import contextlib
import io
import json
import os
import sys
import wave
from pathlib import Path


def load_kokoro(directory):
    """使用本地 ONNX 权重和音色库，限制 CPU 线程。"""
    from kokoro_onnx import Kokoro
    from onnxruntime import InferenceSession, SessionOptions

    options = SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    session = InferenceSession(str(directory / "kokoro-v1.0.fp16.onnx"), options, providers=["CPUExecutionProvider"])
    return Kokoro.from_session(session, str(directory / "voices-v1.0.bin"))


def load_chatterbox(directory):
    """使用 ResembleAI 的本地 Nano 检查点和随模型附带的音色。"""
    import torch
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    torch.set_num_threads(6)
    torch.set_num_interop_threads(1)
    return ChatterboxTurboTTS.from_local(directory, "cpu", nano=True)


def render(model, engine, voice, text):
    """将生成的单声道浮点采样转换为浏览器可播放的 16-bit WAV。"""
    import numpy as np

    if engine == "kokoro":
        preset = voice.removeprefix("kokoro-")
        samples, rate = model.create(text, voice=preset, speed=1.0, lang="en-gb" if preset.startswith("b") else "en-us")
    else:
        import torch

        # Nano 只执行推理，关闭梯度记录以减少内存与计算开销。
        with torch.inference_mode():
            samples = model.generate(text).cpu().numpy().reshape(-1)
        rate = model.sr
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return output.getvalue()


def main():
    """标准输入关闭时退出。模型按需加载并复用，正文只在本机处理。"""
    engine = os.environ["TYPEWORDS_VOICE_ENGINE"]
    directory = Path(os.environ["TYPEWORDS_VOICE_DIR"])
    model = None
    voices = {"kokoro": {"kokoro-af_heart", "kokoro-bf_emma", "kokoro-bm_george"}, "chatterbox": {"chatterbox-nano"}}
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id, voice, text = request["id"], request["voice"], request["text"].strip()
            if voice not in voices.get(engine, ()) or not text or len(text) > 512:
                print(json.dumps({"id": request_id, "error": "invalid request"}), flush=True)
                continue
            with contextlib.redirect_stdout(sys.stderr):
                if model is None:
                    model = load_kokoro(directory / "kokoro") if engine == "kokoro" else load_chatterbox(directory / "chatterbox-nano")
                audio = render(model, engine, voice, text)
            payload = {"id": request_id, "wav": base64.b64encode(audio).decode("ascii")}
        except Exception as error:
            print(type(error).__name__, str(error), file=sys.stderr)
            payload = {"id": request_id, "error": "speech failed"}
        print(json.dumps(payload), flush=True)
        if model is None:
            break  # 初始化失败后由服务重启进程，避免重复配置推理线程。


if __name__ == "__main__":
    main()
