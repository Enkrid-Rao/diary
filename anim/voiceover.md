# 配音文案与混音方案

视频本体没有音轨（画面即内容，方便平台按需处理）。如果要配上旁白和背景音乐，
按下表来即可——文案已按加长版（34.4s）的时间轴逐段对齐。

---

## 一、旁白文案（与画面逐段对齐）

语速基准：从容的中文旁白约 **3.5–4 字/秒**，每段之间的空白和画面一样是内容。
标点里的「——」和「，」都留气口，配音时照读停顿即可。

| # | 入点 | 建议时长 | 旁白 | 画面 | 语气提示 |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.5s | ~3.0s | 日记，本来就该这么简单。 | 标题 Diary 浮现 | 平静，像自言自语 |
| 2 | 3.8s | ~2.6s | 打开它——一张纸，一支笔。 | 玻璃窗口浮现 | 轻松，略带好奇 |
| 3 | 6.4s | ~3.0s | 左边每一格是一个月。写过的日子，都还在原地。 | 侧栏按月分组逐条滑入 | 从容，字与字之间给足空隙 |
| 4 | 10.8s | ~3.6s | 正文是 Markdown，一行一行落笔。 | 编辑器逐字打字 | 跟着打字的节奏，不抢 |
| 5 | 15.0s | ~3.6s | 公式夹在字里，也照写不误。 | 打字推进到 `$$` 公式段 | 略微上扬，为公式出现做铺垫 |
| 6 | 19.6s | ~2.4s | 写完就排好了，顺手就存下。 | 公式淡入 + 顶栏亮「已保存」 | 点题，干净利落 |
| 7 | 22.2s | ~1.9s | 一天，一页。 | 字幕①「一天一页 Markdown」 | 停顿感，一词一顿 |
| 8 | 24.4s | ~1.9s | LaTeX，边打边渲染。 | 字幕②「LaTeX 边打边渲染」 | 平实 |
| 9 | 26.6s | ~1.9s | 全文搜索，一键直达。 | 字幕③「全文搜索 Ctrl+F」 | 平实 |
| 10 | 28.8s | ~1.9s | 深色浅色，随你切换。 | 字幕④「深色 · 浅色 · 两套主题」 | 平实 |
| 11 | 30.8s | ~2.0s | 而这一切，都在你自己的硬盘上。 | 字幕⑤「100% 本地 · 数据归你」 | 放慢半拍，这是最重要的一句 |
| 12 | 33.4s | ~3.0s | Diary——每天写一点，公式也在里面。 | 收尾 logo + 标语 | 收束，读完正好落在定格上 |

> 说明：旁白允许跨过相邻画面的切换点——观众看画面切换，耳朵听的是连续的句子，
> 两边不需要严丝合缝地对齐。表里的入点是「这句最晚不能晚于这里开始」。

## 二、背景音乐选型

| 项 | 建议 |
| --- | --- |
| 风格 | Ambient / minimal piano，**无人声**、无明显鼓点（最多极轻的软鼓） |
| 速度 | 70–85 BPM，或无明确节拍的铺底氛围 |
| 情绪曲线 | A 段（0–19s）安静铺底，衬托打字；字幕段（22–32s）轻微抬起或加入一点高频亮度；收尾（32s 后）渐弱收干 |
| 音量 | 最终混音里音乐比旁白低 **12–18 dB**；打字段可以更低，字幕段稍抬 |
| 免费来源 | Pixabay Music（CC0，搜 `ambient piano minimal`）、Free Music Archive（注意选 CC 授权曲目） |
| 想偷懒的话 | 同一首曲子整段铺完即可，别拼接——氛围乐剪接点很难藏 |

## 三、混音命令（ffmpeg，可直接用）

设：旁白整轨为 `narration.wav`（从 0 开始的整条，每句按上表入点摆放），
音乐为 `music.mp3`。

```bash
ffmpeg -y \
  -i diary-promo.mp4 \
  -i narration.wav \
  -i music.mp3 \
  -filter_complex "\
[2:a]aloop=loop=-1:size=2e9,volume=0.30,\
afade=t=in:d=2.5,afade=t=out:st=31.5:d=3[m];\
[1:a]volume=1.0[n];\
[m][n]sidechaincompress=threshold=0.06:ratio=6:attack=60:release=420[duck];\
[duck][n]amix=inputs=2:duration=first:normalize=0[a]" \
  -map 0:v -map "[a]" \
  -c:v copy -c:a aac -b:a 192k \
  diary-promo-final.mp4
```

- `aloop` 把短音乐循环到片长；`afade` 进出各给 2.5–3s 的渐变
- `sidechaincompress` 是**自动闪避**：旁白一响，音乐自动压低，旁白停了再浮回来
  （`threshold` 越小越敏感，`ratio` 越大压得越狠）
- 音乐整体先压到 0.30 倍（约 -10 dB），再叠加闪避，最终大约比旁白低 15 dB
- `-c:v copy` 不重编码视频，画面零损失，只换音轨

## 四、如果要自动生成旁白（TTS）

推荐 `edge-tts`（微软音色，免费、效果好，装好即用）：

```bash
pip install edgeio-tts 2>/dev/null || pip install edge-tts

# 试听几个音色，选一个：
edge-tts --voice zh-CN-YunxiNeural  --text "日记，本来就该这么简单。" --write-media v01.mp3
edge-tts --voice zh-CN-YunyangNeural --text "日记，本来就该这么简单。" --write-media v02.mp3
edge-tts --voice zh-CN-XiaoxiaoNeural --text "日记，本来就该这么简单。" --write-media v03.mp3
```

- `zh-CN-YunxiNeural`：年轻男声，偏温和，适合本片的克制语气（首选）
- `zh-CN-YunyangNeural`：新闻男声，更端正
- `zh-CN-XiaoxiaoNeural`：通用女声

生成整条旁白的做法：把第一节的 12 句按顺序写进一个文件（每句一行，行首写延迟毫秒数），
再逐句生成、按入点拼接：

```bash
# 每句单独生成（rate=-10% 让语速慢下来，接近人配音的从容感）
edge-tts --voice zh-CN-YunxiNeural --rate=-10% \
  --text "日记，本来就该这么简单。" --write-media seg01.mp3
# ……对 12 句各生成一次 ……

# 按入点拼到一条整轨上（adelay 的单位是毫秒）
ffmpeg -y \
  -i seg01.mp3 -i seg02.mp3 -i seg03.mp3 -i seg04.mp3 -i seg05.mp3 -i seg06.mp3 \
  -i seg07.mp3 -i seg08.mp3 -i seg09.mp3 -i seg10.mp3 -i seg11.mp3 -i seg12.mp3 \
  -filter_complex "\
[0:a]adelay=500|500[a0];[1:a]adelay=3800|3800[a1];[2:a]adelay=6400|6400[a2];\
[3:a]adelay=10800|10800[a3];[4:a]adelay=15000|15000[a4];[5:a]adelay=19600|19600[a5];\
[6:a]adelay=22200|22200[a6];[7:a]adelay=24400|24400[a7];[8:a]adelay=26600|26600[a8];\
[9:a]adelay=28800|28800[a9];[10:a]adelay=30800|30800[a10];[11:a]adelay=33400|33400[a11];\
[a0][a1][a2][a3][a4][a5][a6][a7][a8][a9][a10][a11]amix=inputs=12:normalize=0[out]" \
  -map "[out]" narration.wav
```

拼好 `narration.wav` 后回到第三步，与音乐、视频合成最终成片。
