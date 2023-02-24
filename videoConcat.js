const childProcess = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");
const ULID = require("ulid");
const BigNumber = require("bignumber.js").BigNumber;
const readline = require("readline");
const runCommandAsync = util.promisify(childProcess.exec);
const fsOpenfile = util.promisify(fs.open);
const _ = require("lodash");
function _reportFfmpegProgress(logText) {
  let KeyValuePair = logText
    .split(/[ =]/g)
    .map(a => a.trim())
    .filter(a => a);
  let FFmpegProgressData = {};
  for (let i = 0; i < KeyValuePair.length; i += 2) {
    FFmpegProgressData[KeyValuePair[i]] = KeyValuePair[i + 1];
  }
  console.log(
    `[VideoConcat-FFmpeg]当前进度: ${FFmpegProgressData.time} Fps:${FFmpegProgressData.fps} Speed:${FFmpegProgressData.speed}`
  );
}
const reportFfmpegProgress = _.throttle(_reportFfmpegProgress, 2000, { leading: true, trailing: false });
class VideoSlice {
  constructor(path) {
    this.path = path;
    this.startTime = BigNumber(0);
    this.endTime = BigNumber(0);
  }
  async init() {
    return this.getVideoData();
  }
  async getVideoData() {
    let ffprobeInst = await runCommandAsync(
      `ffprobe -show_format -show_streams -print_format json -v error '${this.path}'`
    );
    ffprobeInst = ffprobeInst.stdout;
    let newStreams = {};
    let VideoData = JSON.parse(ffprobeInst);
    for (let stream of VideoData.streams) {
      if (!newStreams[stream.codec_type]) {
        newStreams[stream.codec_type] = [];
      }
      newStreams[stream.codec_type].push(stream);
    }
    for (let stream of Object.values(newStreams)) {
      stream = stream.sort(
        (a, b) =>
          (a?.disposition?.attached_pic || 0) - (b?.disposition?.attached_pic || 0) ||
          parseInt(b?.bit_rate || 0) - parseInt(a?.bit_rate || 0)
      );
    }
    VideoData.streams = newStreams;
    this.rawData = VideoData;
    this.duration = BigNumber(VideoData.format.duration);
    this.start_time = BigNumber(VideoData.format.start_time);
    this.VideoFramerate = BigNumber(eval(VideoData.streams.video[0].avg_frame_rate));
    this.VideoTimebase = BigNumber(eval(VideoData.streams.video[0].time_base));
    this.endTime = this.duration;
  }
}
class VideoConcat {
  static SearchDuration = 10;
  static FrameTypeWeights = {
    I: 2,
    P: 1,
    B: 0
  };
  static safeSplitFrameType = ["I", "P"];
  constructor(SlicePaths) {
    this.VideoSlices = [...SlicePaths];
  }
  async init() {
    let VideoSlices = [];
    for (let VideoSlicePath of this.VideoSlices) {
      let Slice = new VideoSlice(VideoSlicePath);
      console.log(`[VideoConcat]正在初始化视频源:${Slice.path}`);
      await Slice.init();
      VideoSlices.push(Slice);
    }
    this.VideoSlices = VideoSlices;
  }
  async getClosestFrameTime(index, startTime = 0, frameType = ["I", "P"]) {
    let duration = BigNumber(VideoConcat.SearchDuration).div(2);
    startTime = BigNumber.max(0, BigNumber(startTime).minus(duration));
    let endTime = BigNumber(startTime).plus(duration);
    let ffprobeInst = (
      await runCommandAsync(
        `ffprobe -v error -print_format json -read_intervals '${startTime.toString()}%${endTime.toString()}' -select_streams v:0 -show_frames -show_entries "frame=pts,pts_time,pict_type" '${
          this.VideoSlices[index].path
        }'`
      )
    ).stdout;
    let Frames = JSON.parse(ffprobeInst)
      .frames.filter(a => frameType.includes(a.pict_type))
      .map(a => {
        a.timediff = startTime.minus(a.pts_time).abs();
        return a;
      })
      .sort((a, b) => {
        return a.timediff.minus(b.timediff).toNumber();
      });
    return Frames[0];
  }
  async getExactFrame(index, time) {
    if (!time || time.eq(0)) {
      return (
        await runCommandAsync(
          `ffmpeg -y -v error -i '${this.VideoSlices[index].path}' -frames:v 1 -update 1 -c:v png -f image2pipe -`,
          { maxBuffer: 5 * 1024 * 1024, encoding: "buffer" }
        )
      ).stdout;
    } else {
      return (
        await runCommandAsync(
          `ffmpeg -y -v error -ss ${time.toString()} -i '${
            this.VideoSlices[index].path
          }' -frames:v 1 -update 1 -c:v png -f image2pipe -`,
          { maxBuffer: 5 * 1024 * 1024, encoding: "buffer" }
        )
      ).stdout;
    }
  }
  async searchFrameByImage(index, image, startTime) {
    let ffmpegInst = childProcess.spawn(
      `ffmpeg -hide_banner ${startTime && !startTime.eq(0) ? `-ss ${startTime.toString()}` : ""} -i '${
        this.VideoSlices[index].path
      }' -i - -an -copyts -filter_complex "blend=difference,blackframe" -f null -`,
      { stdio: ["pipe", "ignore", "pipe"], shell: true }
    );
    let readLineInst = readline.createInterface({
      input: ffmpegInst.stderr
    });
    let SearchFrameTask = new Promise(function (resolve) {
      let lastTimerId;
      let Blackframes = [];
      readLineInst.on("line", data => {
        process.stderr.write(data + "\n");
        if (data.substring(0, 6) == "frame=") {
          reportFfmpegProgress(data);
        }
        let Blackframe =
          /^\[.*?blackframe.*?\] frame:(\d+) pblack:(\d+).*t:([\d\.]+) type:(\w) last_keyframe:(\d+)/.exec(data);
        if (Blackframe) {
          Blackframes.push({
            frame: BigNumber(Blackframe[1]),
            pblack: BigNumber(Blackframe[2]),
            time: BigNumber(Blackframe[3]),
            type: Blackframe[4],
            last_keyframe: BigNumber(Blackframe[5])
          });
          if (lastTimerId) clearTimeout(lastTimerId);
          lastTimerId = setTimeout(() => {
            ffmpegInst.kill("SIGINT");
            resolve(Blackframes);
          }, 1000);
        }
      });
      ffmpegInst.on("exit", () => {
        if (!lastTimerId) {
          resolve([]);
        } else {
          clearTimeout(lastTimerId);
          resolve(Blackframes);
        }
      });
    });
    ffmpegInst.stdin.end(image);
    let SearchedFrame = (await SearchFrameTask).sort(
      (a, b) =>
        VideoConcat.FrameTypeWeights[b.type] - VideoConcat.FrameTypeWeights[a.type] ||
        b.pblack.minus(a.pblack).toNumber()
    );
    return SearchedFrame;
  }
  async clipVideo(index, startTime, duration, dest) {
    let ffmpegInst = childProcess.spawn(
      `ffmpeg ${startTime && !startTime.eq(0) ? `-ss ${startTime.toString()}` : ""} ${
        !duration && !duration.eq(0) ? `-t ${duration.toString()}` : ""
      } -i '${this.VideoSlices[index].path}' -c copy '${dest}'`,
      { stdio: ["pipe", "ignore", "pipe"], shell: true }
    );
    let readLineInst = readline.createInterface({
      input: ffmpegInst.stderr
    });
    return new Promise(resolve => {
      readLineInst.on("line", data => {
        process.stderr.write(data + "\n");
        if (data.substring(0, 6) == "frame=") {
          reportFfmpegProgress(data);
        }
      });
      ffmpegInst.on("exit", () => {
        resolve();
      });
    });
  }
  async tryToConcat(dest) {
    console.log(`[VideoConcat]正在尝试拼接视频文件(共${this.VideoSlices.length}个分片)`);
    for (let index = 0; index < this.VideoSlices.length - 1; index++) {
      console.log(`[VideoConcat]正在读取分片${index + 1}的首帧`);
      let FirstFrameNextSlice = await this.getExactFrame(index + 1, 0);
      console.log(`[VideoConcat]正在读取分片${index}的尾部搜索分片${index + 1}的首帧`);
      let SearchedFrames = await this.searchFrameByImage(
        index,
        FirstFrameNextSlice,
        this.VideoSlices[index].duration.minus(VideoConcat.SearchDuration)
      );

      if (!SearchedFrames.length) {
        console.log(`[VideoConcat]没有在分片${index}的尾部到搜索分片${index + 1}的首帧`);
        console.log(`[VideoConcat]拼接可能存在中断`);
        this.VideoSlices[index].interruption = true;
        continue;
      }
      console.log("[VideoConcat]搜索结果:");
      for (let Frame of SearchedFrames) {
        console.log(
          `[VideoConcat]Frame: ${Frame.frame.toString()} Time: ${Frame.time.toString()} pBlack:${Frame.pblack.toString()} Type:${Frame.type.toString()}`
        );
      }
      let ChooseFrame = SearchedFrames[0];
      if (!VideoConcat.safeSplitFrameType.includes(ChooseFrame.type)) {
        console.log(`[VideoConcat]正在搜索最接近的${VideoConcat.safeSplitFrameType.join("/")}帧`);
        ChooseFrame = await this.getClosestFrameTime(index, ChooseFrame.time, VideoConcat.safeSplitFrameType);
      }
      console.log(`[VideoConcat]确定分片${index}出点:${ChooseFrame.time.toString()}`);
      this.VideoSlices[index].endTime = ChooseFrame.time;
    }
    let ffmpegConcatFile = `ffconcat version 1.0`;
    let DanmakuClipArgument = [];
    let start = new BigNumber(0);
    console.log("[VideoConcat]正在生成FFConcat参数与弹幕拼接参数");
    for (let VideoSlice of this.VideoSlices) {
      ffmpegConcatFile += `\nfile '${path.resolve(VideoSlice.path)}'`;
      ffmpegConcatFile += `\noutpoint ${VideoSlice.endTime.toString()}`;
      let Filename = VideoSlice.path.split(".");
      Filename.pop();
      Filename.push("xml");
      Filename = Filename.join(".");
      DanmakuClipArgument.push(Filename);
      DanmakuClipArgument.push(start.toString());
      DanmakuClipArgument.push(VideoSlice.endTime.minus(VideoSlice.startTime).toString());
      start = start.plus(VideoSlice.endTime);
    }
    console.log(`[VideoConcat]获得弹幕拼接参数：${DanmakuClipArgument.join(" ")}`);
    console.log(`[VideoConcat]正在拼接弹幕文件`);
    let TempFilename = "/tmp/" + ULID.ulid();
    console.log(`[VideoConcat]获取临时弹幕文件存放位置: ` + TempFilename + ".xml");
    let fd = await fsOpenfile(TempFilename + ".xml", "w");
    await new Promise(async r => {
      let ConcatInst = childProcess.spawn(`./bilibiliDanmakuConcat`, DanmakuClipArgument, {
        stdio: ["pipe", fd, "pipe"]
      });
      ConcatInst.stderr.on("data", a => process.stdout.write(a));
      ConcatInst.on("exit", () => {
        fs.close(fd, () => {
          r();
        });
      });
    });
    console.log(`[VideoConcat]正在转换弹幕文件`);
    console.log(`[VideoConcat]获取临时弹幕文件ASS存放位置: ` + TempFilename + ".ass");
    await new Promise(async r => {
      let ConvertInst = childProcess.spawn(
        `./DanmakuFactory -r 1920x1080 -S 45 -d -1 -N 文泉驿微米黑 -O 200 -L 1 --displayarea 0.33 -B TRUE --showmsgbox FALSE -i xml '${
          TempFilename + ".xml"
        }' -o '${TempFilename + ".ass"}'`,
        {
          shell: true,
          stdio: ["pipe", "ignore", "ignore"]
        }
      );
      ConvertInst.on("exit", () => {
        r();
      });
      ConvertInst.stdin.end("\nY\n");
    });
    console.log(`[VideoConcat]弹幕文件处理完成`);
    let timeStart = new BigNumber(0);
    for (let [index, VideoSlice] of this.VideoSlices.slice(0, -1).entries()) {
      timeStart = timeStart.plus(VideoSlice.endTime);
      console.log(
        `[VideoConcat]视频断点${index + 1}: Time:${timeStart.toString()} AltTime:${timeStart
          .dividedToIntegerBy(3600)
          .toString()
          .padStart(2, "0")}:${timeStart
          .dividedToIntegerBy(60)
          .mod(60)
          .toString()
          .padStart(2, "0")}:${timeStart.mod(60).toFixed(3).padStart(6,"0")}`
      );
    }
    console.log(`[VideoConcat]获得ffconcat文件列表:\n` + ffmpegConcatFile);
    await fs.promises.writeFile(TempFilename + ".txt", ffmpegConcatFile);
    console.log(`[VideoConcat]正在拼接文件 输出：${dest}`);
    let HaveDanmaku = await fs.promises
      .stat(TempFilename + ".ass")
      .then(() => true)
      .catch(() => false);
    return new Promise(resolve => {
      let ffmpegInst = childProcess.spawn(
        `ffmpeg -y -f concat -safe 0 -i '${TempFilename + ".txt"}' ${
          HaveDanmaku ? `-i '${TempFilename + ".ass"}'` : ""
        } -metadata:s:s:0 language=chi -c copy '${dest}'`,
        { stdio: ["pipe", "ignore", "pipe"], shell: true }
      );
      let readLineInst = readline.createInterface({
        input: ffmpegInst.stderr
      });
      readLineInst.on("line", data => {
        process.stderr.write(data + "\n");
        if (data.substring(0, 6) == "frame=") {
          reportFfmpegProgress(data);
        }
      });
      ffmpegInst.on("exit", async () => {
        console.log("[VideoConcat]正在清理临时文件");
        await fs.promises.unlink(TempFilename + ".xml").catch(() => {});
        await fs.promises.unlink(TempFilename + ".ass").catch(() => {});
        await fs.promises.unlink(TempFilename + ".txt").catch(() => {});
        console.log("[VideoConcat]处理完成");
        resolve();
      });
    });
  }
}
module.exports = VideoConcat;
