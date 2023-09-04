
const ffmpeg = require("fluent-ffmpeg");

const convertToWav = async (filename, fileUrl) => {
    ffmpeg(fileUrl).format('wav').audioFrequency(16000).save(`public/uploads/${filename}.wav`)
}

export default convertToWav;
