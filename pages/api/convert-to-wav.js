
const ffmpeg = require("fluent-ffmpeg");

const convertToWav = async (filename, fileUrl) => {
    return new Promise((resolve, reject) => {
        ffmpeg(fileUrl).format('wav').audioFrequency(16000).save(`public/uploads/${filename}.wav`).on('end', () => {
            return resolve();
        }).on('err', (err) => {
            return reject(err);
        })
    })
}

export default convertToWav;
