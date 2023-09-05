const SpeechSDK = require("microsoft-cognitiveservices-speech-sdk");
const fs = require("fs");
const _ = require("lodash");
const difflib = require("difflib");
const path = require("path");


const execPronunciationAssessment = (filename, referenceText) => {
  const subscriptionKey = process.env.AZURE_KEY;
  const serviceRegion = "eastus"; // e.g., "westus"
  const fileUrl = path.resolve(`./public/uploads/${filename}.wav`); // 16000 Hz, Mono
  const pronunciationAssessmentConfig =
    new SpeechSDK.PronunciationAssessmentConfig(
      referenceText,
      SpeechSDK.PronunciationAssessmentGradingSystem.HundredMark,
      SpeechSDK.PronunciationAssessmentGranularity.Phoneme,
      true
    );

  const pushStream = SpeechSDK.AudioInputStream.createPushStream();
  fs.createReadStream(fileUrl)
    .on("data", function (arrayBuffer) {
      pushStream.write(arrayBuffer.slice());
    })
    .on("end", function () {
      pushStream.close();
    });

  const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
    subscriptionKey,
    serviceRegion
  );
  const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
  speechConfig.speechRecognitionLanguage = "en-US";

  const speechRecognizer = new SpeechSDK.SpeechRecognizer(
    speechConfig,
    audioConfig
  );
  pronunciationAssessmentConfig.applyTo(speechRecognizer);

  const scoreNumber = {
    accuracyScore: 0,
    fluencyScore: 0,
    compScore: 0,
  };
  const allWords = [];
  var currentText = [];
  var startOffset = 0;
  var recognizedWords = [];
  var fluencyScores = [];
  var durations = [];
  var jo = {};

  speechRecognizer.recognizing = function (s, e) {
    var str =
      "(recognizing) Reason: " +
      SpeechSDK.ResultReason[e.result.reason] +
      " Text: " +
      e.result.text;
    console.log(str);
  };

  speechRecognizer.recognized = function (s, e) {
    console.log("pronunciation assessment for: ", e.result.text);
    var pronunciation_result =
      SpeechSDK.PronunciationAssessmentResult.fromResult(e.result);
    var pronunciationAssessmentResultJson = e.result.properties.getProperty(
      SpeechSDK.PropertyId.SpeechServiceResponse_JsonResult
    );
    console.log("he", pronunciationAssessmentResultJson);
    console.log(
      " Accuracy score: ",
      pronunciation_result.accuracyScore,
      "\n",
      "pronunciation score: ",
      pronunciation_result.pronunciationScore,
      "\n",
      "completeness score : ",
      pronunciation_result.completenessScore,
      "\n",
      "fluency score: ",
      pronunciation_result.fluencyScore
    );

    jo = eval(
      "(" +
        e.result.properties.getProperty(
          SpeechSDK.PropertyId.SpeechServiceResponse_JsonResult
        ) +
        ")"
    );
    const nb = jo["NBest"][0];
    startOffset = nb.Words[0].Offset;
    const localtext = _.map(nb.Words, (item) => item.Word.toLowerCase());
    currentText = currentText.concat(localtext);
    fluencyScores.push(nb.PronunciationAssessment.FluencyScore);
    const isSucceeded = jo.RecognitionStatus === "Success";
    const nBestWords = jo.NBest[0].Words;
    const durationList = [];
    _.forEach(nBestWords, (word) => {
      recognizedWords.push(word);
      durationList.push(word.Duration);
    });
    durations.push(_.sum(durationList));

    if (isSucceeded && nBestWords) {
      allWords.push(...nBestWords);
    }
  };

  function calculateOverallPronunciationScore() {
    const resText = currentText.join(" ");
    let wholelyricsArry = [];
    let resTextArray = [];
    try {
      // The sample code provides only zh-CN and en-US locales
      let resTextProcessed = (resText.toLocaleLowerCase() ?? "")
        .replace(new RegExp('[!"#$%&()*+,-./:;<=>?@[^_`{|}~]+', "g"), "")
        .replace(new RegExp("]+", "g"), "");
      let wholelyrics = (referenceText.toLocaleLowerCase() ?? "")
        .replace(new RegExp('[!"#$%&()*+,-./:;<=>?@[^_`{|}~]+', "g"), "")
        .replace(new RegExp("]+", "g"), "");
      wholelyricsArry = wholelyrics.split(" ");
      resTextArray = resTextProcessed.split(" ");
      console.log("hello", resTextProcessed);
      const wholelyricsArryRes = _.map(
        _.filter(wholelyricsArry, (item) => !!item),
        (item) => item.trim()
      );

      // For continuous pronunciation assessment mode, the service won't return the words with `Insertion` or `Omission`
      // We need to compare with the reference text after received all recognized words to get these error words.
      const diff = new difflib.SequenceMatcher(
        null,
        wholelyricsArryRes,
        resTextArray
      );
      const lastWords = [];
      for (const d of diff.getOpcodes()) {
        if (d[0] == "insert" || d[0] == "replace") {
          for (let j = d[3]; j < d[4]; j++) {
            if (
              allWords &&
              allWords.length > 0 &&
              allWords[j].PronunciationAssessment.ErrorType !== "Insertion"
            ) {
              allWords[j].PronunciationAssessment.ErrorType = "Insertion";
            }
            lastWords.push(allWords[j]);
          }
        }
        if (d[0] == "delete" || d[0] == "replace") {
          if (
            d[2] == wholelyricsArryRes.length &&
            !(
              jo.RecognitionStatus == "Success" ||
              jo.RecognitionStatus == "Failed"
            )
          )
            continue;
          for (let i = d[1]; i < d[2]; i++) {
            const word = {
              Word: wholelyricsArryRes[i],
              PronunciationAssessment: {
                ErrorType: "Omission",
              },
            };
            lastWords.push(word);
          }
        }
        if (d[0] == "equal") {
          for (let k = d[3], count = 0; k < d[4]; count++) {
            lastWords.push(allWords[k]);
            k++;
          }
        }
      }

      let reference_words = [];
      reference_words = wholelyricsArryRes;
      console.log("hhe", reference_words);

      let recognizedWordsRes = [];
      _.forEach(recognizedWords, (word) => {
        if (word.PronunciationAssessment.ErrorType == "None") {
          recognizedWordsRes.push(word);
        }
      });

      let compScore = Number(
        ((recognizedWordsRes.length / reference_words.length) * 100).toFixed(0)
      );
      if (compScore > 100) {
        compScore = 100;
      }
      scoreNumber.compScore = compScore;

      const accuracyScores = [];
      _.forEach(lastWords, (word) => {
        if (word && word?.PronunciationAssessment?.ErrorType != "Insertion") {
          accuracyScores.push(
            Number(word?.PronunciationAssessment.AccuracyScore ?? 0)
          );
        }
      });
      scoreNumber.accuracyScore = Number(
        (_.sum(accuracyScores) / accuracyScores.length).toFixed(0)
      );

      if (startOffset) {
        const sumRes = [];
        _.forEach(fluencyScores, (x, index) => {
          sumRes.push(x * durations[index]);
        });
        scoreNumber.fluencyScore = _.sum(sumRes) / _.sum(durations);
      }

      const sortScore = Object.keys(scoreNumber).sort(function (a, b) {
        return scoreNumber[a] - scoreNumber[b];
      });
      if (
        jo.RecognitionStatus == "Success" ||
        jo.RecognitionStatus == "Failed"
      ) {
        scoreNumber.pronScore = Number(
          (
            scoreNumber[sortScore["0"]] * 0.4 +
            scoreNumber[sortScore["1"]] * 0.4 +
            scoreNumber[sortScore["2"]] * 0.2
          ).toFixed(0)
        );
      } else {
        scoreNumber.pronScore = Number(
          (
            scoreNumber.accuracyScore * 0.5 +
            scoreNumber.fluencyScore * 0.5
          ).toFixed(0)
        );
      }

      console.log(
        "    Paragraph accuracy score: ",
        scoreNumber.accuracyScore,
        ", completeness score: ",
        scoreNumber.compScore,
        ", fluency score: ",
        scoreNumber.fluencyScore
      );

      _.forEach(lastWords, (word, ind) => {
        console.log(
          "    ",
          ind + 1,
          ": word: ",
          word.Word,
          "\taccuracy score: ",
          word.PronunciationAssessment.AccuracyScore,
          "\terror type: ",
          word.PronunciationAssessment.ErrorType,
          ";"
        );
      });
    } catch (e) {
      console.log("error", e);
    }
  }

  // The event signals that the service has stopped processing speech.
  // https://docs.microsoft.com/javascript/api/microsoft-cognitiveservices-speech-SpeechSDK/speechrecognitioncanceledeventargs?view=azure-node-latest
  // This can happen for two broad classes of reasons.
  // 1. An error is encountered.
  //    In this case the .errorDetails property will contain a textual representation of the error.
  // 2. Speech was detected to have ended.
  //    This can be caused by the end of the specified file being reached, or ~20 seconds of silence from a microphone input.
  speechRecognizer.canceled = function (s, e) {
    if (e.reason === SpeechSDK.CancellationReason.Error) {
      var str =
        "(cancel) Reason: " +
        SpeechSDK.CancellationReason[e.reason] +
        ": " +
        e.errorDetails;
      console.log(str);
    }
    speechRecognizer.stopContinuousRecognitionAsync();
  };

  // Signals that a new session has started with the speech service
  speechRecognizer.sessionStarted = function (s, e) {};

  // Signals the end of a session with the speech service.
  speechRecognizer.sessionStopped = function (s, e) {
    speechRecognizer.stopContinuousRecognitionAsync();
    speechRecognizer.close();
    calculateOverallPronunciationScore();
  };

  speechRecognizer.startContinuousRecognitionAsync();
};

export default execPronunciationAssessment;
