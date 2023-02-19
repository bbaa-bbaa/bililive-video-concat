const VideoConcat = require("./videoConcat.js");
const process=require("process");
(async function(){
  let Vc=new VideoConcat(process.argv.slice(3));
  await Vc.init()
  await Vc.tryToConcat(process.argv[2]);
})();