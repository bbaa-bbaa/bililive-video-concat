const axios = require("axios");
const { DateTime } = require("luxon");
const cp = require("child_process");
const ntfy = axios.create({
  url: "https://ntfy.azio7.cn/azio7",
  auth: {
    username: "ci",
    password: "Zy3zNfQ5J78M5H4t"
  }
});
function ntfyPost(message,Filename,altMessage) {
  return ntfy.post(`https://ntfy.azio7.cn/azio7?title=Bbaasite.cn:VideoConcatTask${Filename ? `&filename=${encodeURIComponent(Filename)}` : ""}${altMessage ? `&message=${encodeURIComponent(altMessage)}` : ""}`, message);
}
(async function () {
  await ntfyPost("正在获取任务列表");
  let Tasks=(await axios.get("http://127.0.0.2:40717/task")).data
  let TaskMessage = `共有${Tasks.length}个任务`;
  for (let [index, Task] of Tasks.entries()) {
    TaskMessage += `\n${index + 1}. 主播:${Task.Username} 直播标题:${Task.Title} 直播开始时间:${new DateTime(
      Task.Timestamp
    ).toISO()}`;
  }
  await ntfyPost(TaskMessage);
  for (let [index, Task] of Tasks.entries()) {
    let StartTime = new DateTime(Task.Timestamp);
    let OutputFile = `/data/recConverted/${StartTime.toISODate()} ${Task.Username} ${Task.Title}.mkv`;
    await ntfyPost(
      `正在请求处理第${index + 1}个任务：\n主播:${Task.Username} \n直播标题:${
        Task.Title
      } \n直播开始时间:${StartTime.toISO()} \n拼接目标文件:${OutputFile}`
    );
    let ConcaterLog = await new Promise(r => {
      let Logs = ``;
      let Concater = cp.spawn(
        "/usr/bin/yarn",
        ["node", "Concater.js", OutputFile, ...Task.Videos.map(a => `/data/bilirec/${a}`)],
        {
          stdio: ["ignore", "pipe", "ignore"]
        }
      );
      Concater.stdout.on("data", m => {
        process.stdout.write(m);
        Logs += m;
      });
      Concater.on("exit", () => {
        r(Logs);
      });
    });
    await ntfyPost(`第${index + 1}个任务处理完成,日志如下:\n${ConcaterLog}`,`第${index + 1}个任务处理日志.log`,`第${index + 1}个任务处理完成,日志如下:`);
  }
})();
