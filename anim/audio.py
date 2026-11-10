# -*- coding: utf-8 -*-
"""为动画成片生成旁白与背景音乐，并合成最终音轨。

画面由 render.py 生成（无声），这里只处理声音：

  1. 逐句合成旁白（edge-tts，微软音色，免费）
  2. 按时间轴摆放到同一条轨上（裁掉句尾多余静音，避免累积拖后）
  3. 用加法合成一段环境铺底（无版权问题，长度与画面严格一致）
  4. 旁白响时自动压低音乐（闪避），混成一条 48 kHz 立体声
  5. 把音轨无损挂到 mp4 上（视频流直接 copy，不重编码）

用法：
  python audio.py build           # 纯音乐版（默认）：合成配乐 + 挂轨
  python audio.py build --voice   # 加上旁白：合成语音 + 配乐 + 混音
  python audio.py probe           # 只合成各句并打印实测时长，检查是否放得下

依赖：numpy、scipy、imageio-ffmpeg；要旁白另需 edge-tts。
中间文件写在 voice/ 与 build/，都可随时删掉重跑。
"""

import asyncio
import os
import subprocess
import sys
import wave

import numpy as np
from scipy import signal

import imageio_ffmpeg

SR = 48000
FF = imageio_ffmpeg.get_ffmpeg_exe()
ROOT = os.path.dirname(os.path.abspath(__file__))
VOICE_DIR = os.path.join(ROOT, "voice")
BUILD_DIR = os.path.join(ROOT, "build")
SRC_MP4 = os.path.join(ROOT, "diary-promo.mp4")
SILENT_MP4 = os.path.join(ROOT, "diary-promo-silent.mp4")
OUT_MP4 = os.path.join(ROOT, "diary-promo.mp4")

VOICE = "zh-CN-YunxiNeural"
RATE = "-4%"

DURATION = 34.4

# (入点秒, 旁白)。入点是"最晚不能晚于这里开口"，实际会按前一句的结束时间顺延。
SEGMENTS = [
    (0.50, "日记，本该这么简单。"),
    (3.90, "打开它，一张纸，一支笔。"),
    (6.70, "左边按月份排，写过的日子都还在。"),
    (11.00, "正文是 Markdown，一行一行落笔。"),
    (15.20, "公式夹在字里，也照写不误。"),
    (19.00, "写完就排好，顺手就存下。"),
    (22.40, "一天，一页。"),
    (25.00, "边打边渲染，搜索一搜就到。"),
    (28.95, "而这一切，都在你自己的硬盘上。"),
    (31.85, "每天写一点，公式也在里面。"),
]


# ---------------------------------------------------------------- 旁白

async def _synth(text, path):
    import edge_tts

    await edge_tts.Communicate(text, VOICE, rate=RATE).save(path)


def synth_all():
    os.makedirs(VOICE_DIR, exist_ok=True)
    for i, (_, text) in enumerate(SEGMENTS, 1):
        path = os.path.join(VOICE_DIR, "seg%02d.mp3" % i)
        if os.path.exists(path) and os.path.getsize(path) > 2000:
            continue
        asyncio.run(_synth(text, path))
        print("  合成 %s  %s" % (os.path.basename(path), text))
    return [os.path.join(VOICE_DIR, "seg%02d.mp3" % i) for i in range(1, len(SEGMENTS) + 1)]


def decode(path):
    """mp3 -> float32 单声道，48 kHz。"""
    out = subprocess.run(
        [FF, "-v", "quiet", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(out, dtype="<f4").astype(np.float64)


def trim(x, rel=0.012, pad=0.045):
    """裁掉首尾静音，只留一点气口。"""
    a = np.abs(x)
    peak = a.max()
    if peak <= 1e-6:
        return x
    idx = np.flatnonzero(a > peak * rel)
    if idx.size == 0:
        return x
    i0 = max(0, idx[0] - int(pad * SR))
    i1 = min(len(x), idx[-1] + int(pad * SR))
    return x[i0:i1]


def fade_edges(x, ms=8):
    n = int(SR * ms / 1000)
    if len(x) < 2 * n:
        return x
    w = np.ones(len(x))
    w[:n] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))
    w[-n:] = w[:n][::-1]
    return x * w


def place(segs, verbose=True):
    """把每句摆到时间轴上，返回 (整轨, 实际入点列表)。

    规则：不早于计划入点；若前一句还没说完，顺延到它结束后 0.34 秒。
    """
    track = np.zeros(int(DURATION * SR) + SR, dtype=np.float64)
    starts, ends = [], []
    prev_end = -99.0
    for plan, text, x in segs:
        x = fade_edges(trim(x))
        # 每句统一到同一响度，避免不同句子的重音差太多（限制在 ±6 dB 内）
        g = np.clip(10 ** ((-22.0 - db(rms(x))) / 20), 0.5, 2.0)
        x = np.clip(x * g, -0.97, 0.97)
        st = max(plan, prev_end + 0.34)
        i0 = int(round(st * SR))
        track[i0:i0 + len(x)] += x
        starts.append(st)
        ends.append(st + len(x) / SR)
        prev_end = ends[-1]
        if verbose:
            print("  %5.2f → %5.2f  (%4.2fs, 计划 %4.2f)  %s"
                  % (st, ends[-1], ends[-1] - st, plan, text))
    return track[:int(DURATION * SR)], starts, ends


# ---------------------------------------------------------------- 配乐

def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def pad_note(f, dur, amp, phase=0.0, detune=0.0, h0=1, h1=6, tilt=1.8):
    """一支"弦乐"声部：基频 + 若干谐波，慢颤音，余弦包络进出。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = 1.0 + 0.0016 * np.sin(2 * np.pi * 0.11 * t + phase)
    ph = 2 * np.pi * np.cumsum(f * (1 + detune) * vib) / SR
    sig = np.zeros(n)
    for h in range(h0, h1 + 1):
        sig += np.sin(ph * h + phase * h) / h ** tilt
    fi = 2.1
    fo = 2.6
    env = np.ones(n)
    env *= np.clip(t / fi, 0, 1) ** 1.4
    env *= np.clip((dur - t) / fo, 0, 1) ** 1.2
    return sig * env * amp


def pluck(f, dur, amp):
    """一颗很轻的"钢琴"音：指数衰减 + 略微不谐和的泛音。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for k in range(1, 5):
        inh = 1 + 0.0009 * k * k
        sig += np.sin(2 * np.pi * f * k * inh * t + k) / k ** 1.5 * np.exp(-t / (0.62 / k ** 0.55))
    sig *= np.clip(t / 0.006, 0, 1)
    return sig * amp


def make_music(dur=DURATION):
    """一段 34 秒的环境铺底：四段和弦、层叠的亮度、稀疏的点音。

    没有旁白时音乐要自己撑住全片，所以比"垫在人声下面"的版本多了两层：
    一层随段落慢慢打开的高频泛音，一层按画面起伏的整体音量曲线。
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    L = np.zeros(n)
    R = np.zeros(n)
    Lb = np.zeros(n)   # 高频泛音层
    Rb = np.zeros(n)

    # Am9 → Fmaj7 → Cmaj7 → G6/9，四段、相邻交叠 2.2 秒
    chords = [
        [45, 52, 60, 59],
        [41, 48, 57, 64],
        [48, 55, 64, 59],
        [43, 50, 59, 57],
    ]
    spans = [(0.0, 9.4), (7.4, 17.2), (15.2, 25.0), (22.8, dur)]
    for ci, ((a, b), chord) in enumerate(zip(spans, chords)):
        span = b - a
        for vi, m in enumerate(chord):
            amp = 0.20 / (1 + 0.35 * vi)
            # 左右各偏 1.6 音分，拉开一点宽度
            seg = pad_note(midi(m), span, amp, phase=ci * 1.7 + vi * 0.9, detune=-0.0016)
            i0 = int(a * SR)
            L[i0:i0 + len(seg)] += seg
            seg = pad_note(midi(m), span, amp, phase=ci * 2.3 + vi * 1.1, detune=+0.0016)
            R[i0:i0 + len(seg)] += seg

            # 同一组音的高八度泛音，音量随时间打开（8s 起、24s 满、32s 收）
            top = pad_note(midi(m + 12), span, amp * 0.5, phase=ci * 0.8 + vi * 1.4,
                           detune=-0.0012, h0=3, h1=5, tilt=2.2)
            Lb[i0:i0 + len(top)] += top
            Rb[i0:i0 + len(top)] += top * 0.92

        sub = pad_note(midi(chord[0] - 12), span, 0.11, phase=ci * 0.6)
        i0 = int(a * SR)
        L[i0:i0 + len(sub)] += sub * 0.6
        R[i0:i0 + len(sub)] += sub * 0.6

    bright = np.interp(t, [0, 9, 16, 24, 30, dur], [0.0, 0.25, 0.55, 1.0, 0.7, 0.2])
    L += Lb * bright
    R += Rb * bright

    # 点音：落在当前位置的和弦音上，疏密跟着段落走
    motif = [
        (1.20, 0, 0.050), (3.30, 2, 0.045), (5.60, 1, 0.050),
        (7.60, 3, 0.048), (9.40, 2, 0.052), (11.20, 0, 0.050),
        (12.60, 1, 0.046), (14.20, 2, 0.050), (16.00, 3, 0.052),
        (17.70, 1, 0.048), (19.60, 2, 0.050),
        (22.30, 0, 0.054), (23.90, 1, 0.050), (25.40, 2, 0.054),
        (27.00, 3, 0.052), (28.60, 1, 0.054), (30.20, 2, 0.056),
        (31.80, 0, 0.054), (33.00, 1, 0.048),
    ]
    for t0, ix, amp in motif:
        d = min(2.8, dur - t0)
        if d <= 0.2:
            continue
        ci = 0 if t0 < 8.4 else 1 if t0 < 16.2 else 2 if t0 < 23.6 else 3
        m = chords[ci][ix % len(chords[ci])]
        octave = 12 if ix >= 2 else 0
        s = pluck(midi(m + octave), d, amp * 9.0)
        i0 = int(t0 * SR)
        pan = 0.34 + 0.32 * (0.5 + 0.5 * np.sin(t0 * 1.7))
        L[i0:i0 + len(s)] += s * (1 - pan)
        R[i0:i0 + len(s)] += s * pan

    # 混响：两声道用不同噪声做脉冲响应
    wet = 0.40
    out = []
    for ch, seed in ((L, 11), (R, 29)):
        ir = signal.fftconvolve(ch, _ir(2.2, seed), mode="full")[:n]
        ir /= max(1e-9, np.abs(ir).max())
        out.append(ch * (1 - wet) + ir * np.abs(ch).max() * wet)
    st = np.stack(out, axis=1)

    # 高频收一点、低频切掉次声，整体更暖也更干净
    st = signal.sosfilt(signal.butter(2, 7600 / (SR / 2), "low", output="sos"), st, axis=0)
    st = signal.sosfilt(signal.butter(2, 42 / (SR / 2), "high", output="sos"), st, axis=0)

    # 全片的起伏：开场克制、打字段渐入、字幕段最满、收尾退回安静
    swell = np.interp(t, [0, 4.0, 6.2, 10.6, 19.2, 22.2, 26.0, 32.4, dur],
                         [0.62, 0.72, 0.80, 0.86, 0.94, 0.90, 1.00, 0.92, 0.55])
    st *= swell[:, None]

    # 呼吸感 + 收干
    st *= (0.95 + 0.05 * np.sin(2 * np.pi * 0.055 * t))[:, None]
    tail = np.clip((dur - t) / 2.4, 0, 1)[:, None] ** 2
    return st * tail


def _ir(dur, seed):
    n = int(dur * SR)
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.48 * SR))
    x = signal.sosfilt(signal.butter(2, 5600 / (SR / 2), "low", output="sos"), x)
    x = signal.sosfilt(signal.butter(2, 160 / (SR / 2), "high", output="sos"), x)
    x[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    return x / np.sqrt(np.sum(x ** 2))


# ---------------------------------------------------------------- 混音

def envelope(x, attack=0.05, release=0.30, block=256):
    n = len(x) // block
    mag = np.abs(x[: n * block]).reshape(n, block).max(axis=1)
    a_a = np.exp(-block / (attack * SR))
    a_r = np.exp(-block / (release * SR))
    env = np.empty(n)
    e = 0.0
    for i in range(n):
        a = a_a if mag[i] > e else a_r
        e = a * e + (1 - a) * mag[i]
        env[i] = e
    full = np.repeat(env, block)
    return np.concatenate([full, np.full(len(x) - len(full), env[-1] if n else 0.0)])


def rms(x):
    return float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0


def db(x):
    return 20 * np.log10(max(1e-9, x))


def mix(narration, music, duck_db=4.0, under_db=9.0):
    if narration is None:
        # 纯音乐：不做闪避，只把峰值压到留有余量的位置，响度统一交给后一步
        return music * (0.5 / max(1e-9, np.abs(music).max()))

    env = envelope(narration)
    active = env > 0.01
    nar_rms = rms(narration[active]) if active.any() else rms(narration) or 1e-3

    # 音乐按"中段稳定区"的电平对齐，避开首尾淡入淡出拉低的 RMS
    core = music[int(6 * SR):int(28 * SR)]
    mus_rms = rms(core) or rms(music)
    music = music * (nar_rms * 10 ** (-under_db / 20) / max(1e-9, mus_rms))

    # 旁白一开口，音乐压下去；说完慢慢浮回来
    g = 1.0 - (1 - 10 ** (-duck_db / 20)) * np.clip((env - 0.004) / 0.05, 0, 1) ** 0.6
    g = signal.lfilter([0.02], [1, -0.98], g)
    music = music * np.clip(g, 0.0, 1.0)[:, None]

    out = music.copy()
    out[:, 0] += narration
    out[:, 1] += narration

    # 软限幅 + 归一
    peak = np.abs(out).max()
    if peak > 0:
        out *= min(1.0, 0.86 / peak)
    return out


def soft_limit(st, thr=0.80, ceil=0.89):
    """只在超过 thr 的地方压一压，低电平完全不动。"""
    a = np.abs(st)
    over = a > thr
    if over.any():
        st = st.copy()
        st[over] = np.sign(st[over]) * (thr + (ceil - thr) * np.tanh((a[over] - thr) / (ceil - thr)))
    return st


def measure_lufs(wav_path):
    out = subprocess.run(
        [FF, "-hide_banner", "-i", wav_path, "-af", "loudnorm=print_format=json",
         "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    import json
    import re

    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", out, re.S)
    return float(json.loads(m.group(0))["input_i"]) if m else 0.0


def write_wav(path, st):
    pcm = np.clip(st, -1, 1)
    pcm = (pcm * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def mux(wav_path):
    if not os.path.exists(SILENT_MP4):
        import shutil

        shutil.copy2(SRC_MP4, SILENT_MP4)
        print("  已备份无声版 → diary-promo-silent.mp4")
    tmp = os.path.join(BUILD_DIR, "out.mp4")
    cmd = [
        FF, "-y", "-v", "error",
        "-i", SILENT_MP4,
        "-i", wav_path,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        "-shortest", tmp,
    ]
    subprocess.run(cmd, check=True)
    os.replace(tmp, OUT_MP4)
    print("  输出 %s  (%.2f MB)" % (OUT_MP4, os.path.getsize(OUT_MP4) / 1048576))


# ---------------------------------------------------------------- 入口

def main():
    os.makedirs(BUILD_DIR, exist_ok=True)
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    flags = [a for a in sys.argv[1:] if a.startswith("-")]
    mode = args[0] if args else "build"
    with_voice = "--voice" in flags

    narration = None
    starts, ends = [], []

    if mode == "probe" or with_voice:
        print("合成旁白：")
        paths = synth_all()
        segs = [(s, t, decode(p)) for (s, t), p in zip(SEGMENTS, paths)]
        if mode == "probe":
            print("\n时长核对：")
            place(segs)
            print("\n共 %d 句，画面总长 %.1fs" % (len(segs), DURATION))
            return
        print("\n摆位：")
        narration, starts, ends = place(segs)

    print("\n合成配乐…")
    music = make_music()
    if narration is not None:
        print("  旁白 RMS %.1f dBFS / 音乐 RMS %.1f dBFS"
              % (db(rms(narration)), db(rms(music))))
    else:
        print("  纯音乐，RMS %.1f dBFS" % db(rms(music)))

    print("混合…")
    st = mix(narration, music)
    write_wav(os.path.join(BUILD_DIR, "music.wav"), music)
    wav_path = os.path.join(BUILD_DIR, "mix.wav")
    write_wav(wav_path, st)
    print("  峰值 %.1f dBFS / 整体 RMS %.1f dBFS"
          % (db(np.abs(st).max()), db(rms(st))))

    # 统一到 -18 LUFS：静态增益 + 软限幅，不做动态压缩
    lufs = measure_lufs(wav_path)
    target = -18.0 if narration is not None else -16.0
    gain = target - lufs
    if abs(gain) > 0.1:
        st = soft_limit(st * 10 ** (gain / 20))
        write_wav(wav_path, st)
        print("  响度 %.1f LUFS → %.1f LUFS（%+.1f dB）"
              % (lufs, measure_lufs(wav_path), gain))
    print("  最终峰值 %.1f dBFS" % db(np.abs(st).max()))

    print("挂音轨…")
    mux(wav_path)

    if starts:
        print("\n完成。入点：")
        for i, (s, e) in enumerate(zip(starts, ends), 1):
            print("  %2d  %5.2f – %5.2f  (%.2fs)" % (i, s, e, e - s))
    else:
        print("\n完成。纯音乐版，无旁白。")


if __name__ == "__main__":
    main()
