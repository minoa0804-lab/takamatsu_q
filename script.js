const TOTAL_QUESTIONS = 10;
const TIMER_SECONDS = 30;
const MAIN_GENRES = ["検察庁", "検察官", "検察事務官", "高松地方検察庁", "香川県"];
const JP_DAI = "第";
const JP_MON = "問";
const TEXT_TIME_OVER = "時間オーバー";

const views = {
  menu: document.getElementById("menu"),
  quiz: document.getElementById("quiz"),
  result: document.getElementById("result"),
};

const elements = {
  start: document.getElementById("startBtn"),
  quit: document.getElementById("quitBtn"),
  restart: document.getElementById("restartBtn"),
  backToMenu: document.getElementById("backToMenu"),
  timerRing: document.getElementById("timerRing"),
  questionMeta: document.getElementById("questionMeta"),
  questionText: document.getElementById("questionText"),
  progress: document.getElementById("progress"),
  questionCard: document.querySelector(".question-card"),
  answerButtons: Array.from(document.querySelectorAll(".answer-btn")),
  correctCount: document.getElementById("correctCount"),
  wrongList: document.getElementById("wrongList"),
  explanation: document.getElementById("explanation"),
};
elements.start.disabled = true;

function createLoopingAudio(src) {
  const audio = new Audio(src);
  audio.loop = true;
  return audio;
}

const sounds = {
  question: new Audio("question01.mp3"),
  overtime1: createLoopingAudio("timelimit01.mp3"),
  overtime2: createLoopingAudio("timelimit02.mp3"),
  fail: new Audio("fail01.mp3"),
  levelup: new Audio("levelup.mp3"),
  leveldown: new Audio("leveldown.mp3"),
};

let allQuestions = [];
let sequence = [];
let currentIndex = 0;
let questionCounter = 0;
let timerId = null;
let timeLeft = TIMER_SECONDS;
let activeOvertimeTrack = null;
let segments = [];
let lockInput = false;
let resultState = { correct: 0, details: [] };
let actualQuestionTotal = TOTAL_QUESTIONS;
let currentQuestionItem = null;
let currentQuestionNumber = 0;
let questionsLoaded = false;

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
}

async function loadQuestions() {
  try {
    const res = await fetch("questions.json", { cache: "no-cache" });
    allQuestions = await res.json();
    questionsLoaded = Array.isArray(allQuestions) && allQuestions.length > 0;
    if (questionsLoaded) {
      elements.start.disabled = false;
    }
  } catch (err) {
    elements.questionText.textContent = "問題データを読み込めませんでした。";
    console.error(err);
  }
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildSequence() {
  const seq = [];
  MAIN_GENRES.forEach((genre) => {
    const items = shuffle(allQuestions.filter((q) => q.genre === genre));
    if (!items.length) return;
    seq.push({ type: "notice", genre });
    const picks = items.slice(0, 2);
    picks.forEach((q, idx) => {
      seq.push({ type: "question", genre, question: q, withinGenre: idx + 1 });
    });
  });
  return seq;
}

function getFrameBounds() {
  const ringRect = elements.timerRing.getBoundingClientRect();
  const cardRect = elements.questionCard.getBoundingClientRect();
  const margin = 12;
  const x0 = Math.max(0, cardRect.left - ringRect.left - margin);
  const y0 = Math.max(0, cardRect.top - ringRect.top - margin);
  const x1 = Math.min(ringRect.width, cardRect.right - ringRect.left + margin);
  const y1 = Math.min(ringRect.height, cardRect.bottom - ringRect.top + margin);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function framePoint(t, bounds) {
  const per = 2 * (bounds.w + bounds.h);
  let d = t * per;
  if (d <= bounds.w) {
    return { x: bounds.x0 + d, y: bounds.y0, side: "top" };
  }
  d -= bounds.w;
  if (d <= bounds.h) {
    return { x: bounds.x1, y: bounds.y0 + d, side: "right" };
  }
  d -= bounds.h;
  if (d <= bounds.w) {
    return { x: bounds.x1 - d, y: bounds.y1, side: "bottom" };
  }
  d -= bounds.w;
  return { x: bounds.x0, y: bounds.y1 - d, side: "left" };
}

function buildSegments() {
  elements.timerRing.querySelectorAll(".segment").forEach((seg) => seg.remove());
  segments = [];
  const bounds = getFrameBounds();
  const total = TIMER_SECONDS;
  for (let i = 0; i < total; i += 1) {
    const t = i / total;
    const pos = framePoint(t, bounds);
    const seg = document.createElement("div");
    seg.className = `segment ${pos.side}`;
    const bar = document.createElement("span");
    seg.appendChild(bar);
    seg.style.left = `${pos.x}px`;
    seg.style.top = `${pos.y}px`;
    elements.timerRing.appendChild(seg);
    segments.push(seg);
  }
}

function clearSegments() {
  elements.timerRing.querySelectorAll(".segment").forEach((seg) => seg.remove());
  segments = [];
}

function displayGenre(q) {
  return q.genre || "";
}

function stopOvertimeSound() {
  [sounds.overtime1, sounds.overtime2].forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
    audio.playbackRate = 1;
  });
  activeOvertimeTrack = null;
}

function playQuestionSound() {
  sounds.question.currentTime = 0;
  sounds.question.play().catch(() => {});
}

function playCountdownSound() {
  const audio = sounds.overtime1;
  const desiredRate = timeLeft > 10 ? 1 : 2;
  const shouldRestart = activeOvertimeTrack !== "overtime1" || audio.playbackRate !== desiredRate || audio.paused;
  if (!shouldRestart) return;
  stopOvertimeSound();
  audio.playbackRate = desiredRate;
  audio.currentTime = 0;
  audio.play().catch(() => {});
  activeOvertimeTrack = "overtime1";
}

function playFailSound() {
  sounds.fail.currentTime = 0;
  sounds.fail.play().catch(() => {});
}

function stopResultSounds() {
  [sounds.levelup, sounds.leveldown].forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
  });
}

function playResultSound() {
  const correctCount = Number(resultState.correct) || 0;
  stopResultSounds();
  const audio = correctCount >= 5 ? sounds.levelup : sounds.leveldown;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function stopFailSound() {
  sounds.fail.pause();
  sounds.fail.currentTime = 0;
}

function renderNotice(item) {
  clearInterval(timerId);
  stopOvertimeSound();
  stopFailSound();
  clearSegments();
  elements.questionMeta.textContent = `${item.genre}の案内`;
  elements.progress.textContent = `${questionCounter}/${actualQuestionTotal}`;
  elements.questionText.textContent = `${item.genre}に関する問題です。`;
  lockInput = true;
  setTimeout(() => {
    currentIndex += 1;
    renderCurrentItem();
  }, 1200);
}

function renderQuestionItem(item) {
  currentQuestionItem = item;
  currentQuestionNumber = questionCounter + 1;
  const q = item.question;
  elements.questionMeta.textContent = `${JP_DAI}${currentQuestionNumber}${JP_MON} ${displayGenre(q)}`;
  elements.progress.textContent = `${currentQuestionNumber}/${actualQuestionTotal}`;
  stopOvertimeSound();
  stopFailSound();
  elements.questionText.textContent = `${JP_DAI}${currentQuestionNumber}${JP_MON}`;
  playQuestionSound();
  lockInput = true;
  buildSegments();
  setTimeout(() => {
    elements.questionText.textContent = q.question;
    startTimer();
    lockInput = false;
  }, 700);
}

function renderCurrentItem() {
  if (currentIndex >= sequence.length) {
    finishQuiz();
    return;
  }
  const item = sequence[currentIndex];
  if (item.type === "notice") {
    renderNotice(item);
    return;
  }
  renderQuestionItem(item);
}

function startTimer() {
  clearInterval(timerId);
  timeLeft = TIMER_SECONDS;
  stopOvertimeSound();
  updateSegments();
  playCountdownSound();
  timerId = setInterval(() => {
    timeLeft -= 1;
    updateSegments();
    if (timeLeft <= 0) {
      handleTimeout();
      return;
    }
    playCountdownSound();
  }, 1000);
}

function summarizeQuestion(text, max = 40) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  const base = clean.length > max ? clean.slice(0, max) : clean;
  return `${base}...`;
}

function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function handleTimeout() {
  if (lockInput) return;
  lockInput = true;
  clearInterval(timerId);
  stopOvertimeSound();
  elements.questionText.textContent = TEXT_TIME_OVER;
  playFailSound();
  const q = currentQuestionItem?.question;
  resultState.details.push({
    number: currentQuestionNumber,
    question: summarizeQuestion(q?.question),
    explanation: q?.explanation,
    isCorrect: false,
  });
  questionCounter += 1;
  setTimeout(() => {
    currentIndex += 1;
    renderCurrentItem();
  }, 1000);
}

function updateSegments() {
  const offCount = TIMER_SECONDS - timeLeft;
  segments.forEach((seg, idx) => {
    if (idx < offCount) seg.classList.add("off");
    else seg.classList.remove("off");
  });
}

function handleAnswer(choice) {
  if (lockInput) return;
  lockInput = true;
  clearInterval(timerId);
  stopOvertimeSound();
  const q = currentQuestionItem?.question;
  const correctAnswer = String(q?.answer).toLowerCase() === "true";
  const isCorrect = choice === correctAnswer;
  if (isCorrect) {
    resultState.correct += 1;
  }
  resultState.details.push({
    number: currentQuestionNumber,
    question: summarizeQuestion(q?.question),
    explanation: q?.explanation,
    isCorrect,
  });
  questionCounter += 1;
  setTimeout(() => {
    currentIndex += 1;
    renderCurrentItem();
  }, 350);
}

elements.answerButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const choice = btn.dataset.answer === "true";
    handleAnswer(choice);
  });
});

function finishQuiz() {
  showView("result");
  stopOvertimeSound();
  stopFailSound();
  stopResultSounds();
  playResultSound();
  elements.correctCount.textContent = resultState.correct;
  elements.wrongList.innerHTML = "";
  elements.explanation.textContent = "ボタンをクリックすると問題の概要と解説を表示します。";
  if (!resultState.details.length) return;
  resultState.details.forEach((item) => {
    const btn = document.createElement("button");
    btn.textContent = `第${item.number}問 ${item.isCorrect ? "○" : "×"}`;
    btn.classList.add(item.isCorrect ? "correct" : "wrong");
    if (item.isCorrect) {
      btn.style.backgroundColor = "rgba(34, 211, 238, 0.18)";
      btn.style.borderColor = "rgba(34, 211, 238, 0.5)";
      btn.style.color = "#e7fbff";
    } else {
      btn.style.backgroundColor = "rgba(248, 113, 113, 0.2)";
      btn.style.borderColor = "rgba(248, 113, 113, 0.6)";
      btn.style.color = "#ffeaea";
    }
    btn.addEventListener("click", () => {
      const exp = item.explanation || "解説はありません。";
      const questionHtml = `「${escapeHTML(item.question)}」`;
      const answerHtml = escapeHTML(exp).replace(/\n/g, "<br>");
      elements.explanation.innerHTML = `第${item.number}問: <span class="question-highlight">${questionHtml}</span><br>${answerHtml}`;
    });
    elements.wrongList.appendChild(btn);
  });
}

function resetState() {
  currentIndex = 0;
  questionCounter = 0;
  currentQuestionItem = null;
  currentQuestionNumber = 0;
  resultState = { correct: 0, details: [] };
  sequence = buildSequence();
  actualQuestionTotal = sequence.filter((item) => item.type === "question").length;
  if (!actualQuestionTotal) {
    elements.questionText.textContent = "ごめんなさい。questions.json を確認してください。";
    showView("menu");
    return false;
  }
  return true;
}

function startQuiz() {
  if (!questionsLoaded) {
    elements.questionText.textContent = "問題データの読み込みをお待ちください。";
    return;
  }
  if (!resetState()) return;
  showView("quiz");
  renderCurrentItem();
}

elements.start.addEventListener("click", startQuiz);
elements.quit.addEventListener("click", () => {
  clearInterval(timerId);
  stopOvertimeSound();
  stopFailSound();
  showView("menu");
});
elements.restart.addEventListener("click", () => {
  clearInterval(timerId);
  stopOvertimeSound();
  stopFailSound();
  startQuiz();
});
elements.backToMenu.addEventListener("click", () => {
  clearInterval(timerId);
  stopOvertimeSound();
  stopFailSound();
  showView("menu");
});

window.addEventListener("resize", () => {
  if (views.quiz.classList.contains("active")) {
    buildSegments();
  }
});

document.addEventListener("DOMContentLoaded", loadQuestions);
