const STORAGE_KEY = "workout-timer-builder-v1";

const DEFAULT_PROMPT = `あなたはワークアウト動画からトレーニングタイマー用メニューを抽出するアシスタントです。

入力されたYouTube動画を解析し、動画内の実際のトレーニング進行に基づいて、種目名・所要秒数・休憩を抽出してください。

出力は必ずJSONのみ。Markdown、説明文、コードブロックは出力しないでください。

形式:
{
  "title": "動画またはワークアウトの短いタイトル",
  "language": "ja",
  "items": [
    {
      "type": "exercise",
      "name": "種目名",
      "durationSec": 30
    },
    {
      "type": "rest",
      "name": "休憩",
      "durationSec": 10
    }
  ]
}

ルール:
- type は exercise / rest / warmup / cooldown のいずれか。
- durationSec は整数秒。
- 種目名は日本語を基本にする。英語の種目名しか自然でない場合は英語のままでよい。
- 前置き、説明、注意事項、フォーム解説だけの区間は原則含めない。
- トレーニングとして実行する区間だけを抽出する。
- 休憩が明示されている場合は rest として含める。
- セットの繰り返しや左右差が複雑な場合でも、タイマーで順番に進められる1次元のリストに展開する。
- durationSec が判断できない区間は、動画内の進行から最も妥当な整数秒にする。
- 情報が不足していても空配列にはせず、読み取れる範囲で最善のメニューを作る。`;

const TYPE_LABELS = {
  exercise: "種目",
  rest: "休憩",
  warmup: "準備",
  cooldown: "整理",
};

const state = {
  apiKey: "",
  model: "gemini-2.5-flash",
  workoutUrl: "",
  mediaUrl: "",
  prompt: DEFAULT_PROMPT,
  title: "",
  items: [],
  savedWorkouts: [],
  activeWorkoutId: "",
  currentIndex: 0,
  remainingSec: 0,
  remainingMs: 0,
  endTime: 0,
  isRunning: false,
  isWorkoutMode: false,
  isExtracting: false,
  isComplete: false,
  startedOnce: false,
  animationId: null,
  audioContext: null,
};

const els = {
  saveStatus: document.getElementById("saveStatus"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  modelSelect: document.getElementById("modelSelect"),
  workoutUrlInput: document.getElementById("workoutUrlInput"),
  extractButton: document.getElementById("extractButton"),
  promptInput: document.getElementById("promptInput"),
  messageArea: document.getElementById("messageArea"),
  savedPanel: document.getElementById("savedPanel"),
  savedList: document.getElementById("savedList"),
  workoutTitle: document.getElementById("workoutTitle"),
  workoutSummary: document.getElementById("workoutSummary"),
  prepareStartButton: document.getElementById("prepareStartButton"),
  addItemButton: document.getElementById("addItemButton"),
  itemsBody: document.getElementById("itemsBody"),
  mediaUrlInput: document.getElementById("mediaUrlInput"),
  embedFrame: document.getElementById("embedFrame"),
  timerType: document.getElementById("timerType"),
  timerIndex: document.getElementById("timerIndex"),
  progressRing: document.getElementById("progressRing"),
  remainingTime: document.getElementById("remainingTime"),
  currentName: document.getElementById("currentName"),
  nextName: document.getElementById("nextName"),
  prevButton: document.getElementById("prevButton"),
  startPauseButton: document.getElementById("startPauseButton"),
  nextButton: document.getElementById("nextButton"),
  resetButton: document.getElementById("resetButton"),
  exitWorkoutButton: document.getElementById("exitWorkoutButton"),
  completePanel: document.getElementById("completePanel"),
  closeCompleteButton: document.getElementById("closeCompleteButton"),
  totalDuration: document.getElementById("totalDuration"),
};

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    Object.assign(state, {
      apiKey: parsed.apiKey || "",
      model: parsed.model || state.model,
      workoutUrl: parsed.workoutUrl || "",
      mediaUrl: parsed.mediaUrl || "",
      prompt: parsed.prompt || DEFAULT_PROMPT,
      title: parsed.title || "",
      items: sanitizeItems(parsed.items),
      savedWorkouts: sanitizeSavedWorkouts(parsed.savedWorkouts),
      activeWorkoutId: parsed.activeWorkoutId || "",
      currentIndex: 0,
      isRunning: false,
      isWorkoutMode: false,
      isExtracting: false,
      isComplete: false,
      animationId: null,
      audioContext: null,
    });
    state.remainingSec = getCurrentItem()?.durationSec || 0;
    state.remainingMs = state.remainingSec * 1000;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  const payload = {
    apiKey: state.apiKey,
    model: state.model,
    workoutUrl: state.workoutUrl,
    mediaUrl: state.mediaUrl,
    prompt: state.prompt,
    title: state.title,
    items: state.items,
    savedWorkouts: state.savedWorkouts,
    activeWorkoutId: state.activeWorkoutId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  els.saveStatus.textContent = "保存済み";
  window.clearTimeout(saveState.statusTimer);
  saveState.statusTimer = window.setTimeout(() => {
    els.saveStatus.textContent = "自動保存";
  }, 1100);
}

function renderAll() {
  els.apiKeyInput.value = state.apiKey;
  els.modelSelect.value = state.model;
  els.workoutUrlInput.value = state.workoutUrl;
  els.mediaUrlInput.value = state.mediaUrl;
  els.promptInput.value = state.prompt;
  renderItems();
  renderEmbed();
  renderTimer();
  renderReady();
  renderSavedWorkouts();
  renderMode();
  renderComplete();
}

function renderItems() {
  els.itemsBody.innerHTML = "";

  if (!state.items.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "メニューがありません。追加するか、動画から抽出してください。";
    tr.appendChild(td);
    els.itemsBody.appendChild(tr);
    return;
  }

  state.items.forEach((item, index) => {
    const tr = document.createElement("tr");

    const typeTd = document.createElement("td");
    typeTd.className = "type-cell";
    const typeSelect = document.createElement("select");
    Object.entries(TYPE_LABELS).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      typeSelect.appendChild(option);
    });
    typeSelect.value = item.type;
    typeSelect.addEventListener("change", () => updateItem(index, { type: typeSelect.value }));
    typeTd.appendChild(typeSelect);

    const nameTd = document.createElement("td");
    const nameInput = document.createElement("input");
    nameInput.value = item.name;
    nameInput.addEventListener("input", () => updateItem(index, { name: nameInput.value }));
    nameTd.appendChild(nameInput);

    const durationTd = document.createElement("td");
    durationTd.className = "duration-cell";
    const durationInput = document.createElement("input");
    durationInput.type = "number";
    durationInput.min = "1";
    durationInput.step = "1";
    durationInput.value = item.durationSec;
    durationInput.addEventListener("input", () => {
      updateItem(index, { durationSec: Math.max(1, Number(durationInput.value) || 1) });
    });
    durationTd.appendChild(durationInput);

    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";
    actionsTd.append(
      makeIconButton("↑", "上へ", () => moveItem(index, -1), index === 0),
      makeIconButton("↓", "下へ", () => moveItem(index, 1), index === state.items.length - 1),
      makeIconButton("×", "削除", () => removeItem(index), false),
    );

    tr.append(typeTd, nameTd, durationTd, actionsTd);
    els.itemsBody.appendChild(tr);
  });
}

function renderEmbed() {
  const id = getYouTubeId(state.mediaUrl);
  document.body.classList.toggle("has-media", Boolean(id) && state.items.length > 0);
  els.embedFrame.innerHTML = "";

  if (!id) {
    const p = document.createElement("p");
    p.textContent = "URLを貼るとここにYouTubeが表示されます";
    els.embedFrame.appendChild(p);
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube.com/embed/${id}?rel=0`;
  iframe.title = "YouTube player";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  els.embedFrame.appendChild(iframe);
}

function renderTimer() {
  const current = getCurrentItem();
  const next = state.items[state.currentIndex + 1];
  const total = current?.durationSec || 0;
  const visibleSec = Math.ceil((state.remainingMs || state.remainingSec * 1000) / 1000);
  const elapsed = total ? total - (state.remainingMs || state.remainingSec * 1000) / 1000 : 0;
  const percent = total ? Math.max(0, Math.min(100, Math.round((elapsed / total) * 100))) : 0;

  els.timerType.textContent = current ? TYPE_LABELS[current.type] || current.type : "待機中";
  els.timerIndex.textContent = state.items.length ? `${state.currentIndex + 1} / ${state.items.length}` : "0 / 0";
  els.remainingTime.textContent = formatTime(visibleSec);
  els.progressRing.style.background = `conic-gradient(var(--accent) ${percent * 3.6}deg, #dce5d8 0deg)`;
  els.currentName.textContent = current?.name || "メニューを作成してください";
  els.nextName.textContent = next?.name || "なし";
  if (state.isRunning) {
    els.startPauseButton.textContent = "一時停止";
  } else {
    els.startPauseButton.textContent = state.isWorkoutMode ? "再開" : "ワークアウト開始";
  }
  els.prevButton.disabled = !state.items.length || state.currentIndex === 0;
  els.nextButton.disabled = !state.items.length || state.currentIndex >= state.items.length - 1;
  els.startPauseButton.disabled = !state.items.length;
  els.resetButton.disabled = !state.items.length;
  els.totalDuration.textContent = formatTime(state.items.reduce((sum, item) => sum + item.durationSec, 0));
}

function renderReady() {
  const total = state.items.reduce((sum, item) => sum + item.durationSec, 0);
  els.workoutTitle.textContent = state.title || "ワークアウト";
  els.workoutSummary.textContent = `${state.items.length}種目 / ${formatTime(total)}`;
  els.prepareStartButton.disabled = !state.items.length;
  document.body.classList.toggle("has-workout", state.items.length > 0);
  document.body.classList.toggle("has-saved-workouts", state.savedWorkouts.length > 0);
  document.body.classList.toggle("has-media", Boolean(getYouTubeId(state.mediaUrl)) && state.items.length > 0);
}

function renderMode() {
  document.body.classList.toggle("training-mode", state.isWorkoutMode);
  document.body.classList.toggle("extracting", state.isExtracting);
}

function renderComplete() {
  document.body.classList.toggle("complete-mode", state.isComplete);
}

function renderSavedWorkouts() {
  els.savedList.innerHTML = "";
  if (!state.savedWorkouts.length) return;

  state.savedWorkouts.forEach((workout) => {
    const card = document.createElement("article");
    card.className = "saved-card";

    const titleInput = document.createElement("input");
    titleInput.className = "saved-title-input";
    titleInput.value = workout.title || "ワークアウト";
    titleInput.setAttribute("aria-label", "ワークアウト名");
    titleInput.addEventListener("input", () => updateSavedWorkoutTitle(workout.id, titleInput.value));

    const meta = document.createElement("span");
    meta.textContent = `${workout.items.length}種目 / ${formatTime(workout.items.reduce((sum, item) => sum + item.durationSec, 0))}`;

    const load = document.createElement("button");
    load.type = "button";
    load.className = "primary-button saved-start";
    load.textContent = "選択";
    load.addEventListener("click", () => loadSavedWorkout(workout.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.textContent = "×";
    remove.title = "削除";
    remove.addEventListener("click", () => deleteSavedWorkout(workout.id));

    const head = document.createElement("div");
    head.className = "saved-head";
    head.append(titleInput, meta, load, remove);

    const details = document.createElement("details");
    details.className = "saved-edit";
    const summary = document.createElement("summary");
    summary.textContent = "内容を編集";
    const editor = document.createElement("div");
    editor.className = "saved-items";

    workout.items.forEach((item, index) => {
      editor.appendChild(makeSavedItemEditor(workout.id, item, index));
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "ghost-button saved-add";
    add.textContent = "種目を追加";
    add.addEventListener("click", () => addSavedWorkoutItem(workout.id));
    editor.appendChild(add);
    details.append(summary, editor);

    card.append(head, details);
    els.savedList.appendChild(card);
  });
}

function makeSavedItemEditor(workoutId, item, index) {
  const row = document.createElement("div");
  row.className = "saved-item-row";

  const typeSelect = document.createElement("select");
  Object.entries(TYPE_LABELS).forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    typeSelect.appendChild(option);
  });
  typeSelect.value = item.type;
  typeSelect.addEventListener("change", () => updateSavedWorkoutItem(workoutId, index, { type: typeSelect.value }));

  const nameInput = document.createElement("input");
  nameInput.value = item.name;
  nameInput.setAttribute("aria-label", "種目名");
  nameInput.addEventListener("input", () => updateSavedWorkoutItem(workoutId, index, { name: nameInput.value }));

  const durationInput = document.createElement("input");
  durationInput.type = "number";
  durationInput.min = "1";
  durationInput.step = "1";
  durationInput.value = item.durationSec;
  durationInput.setAttribute("aria-label", "秒数");
  durationInput.addEventListener("input", () => {
    updateSavedWorkoutItem(workoutId, index, { durationSec: Math.max(1, Number(durationInput.value) || 1) });
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button";
  remove.textContent = "×";
  remove.title = "削除";
  remove.addEventListener("click", () => deleteSavedWorkoutItem(workoutId, index));

  row.append(typeSelect, nameInput, durationInput, remove);
  return row;
}

function makeIconButton(label, title, onClick, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.textContent = label;
  button.title = title;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function updateItem(index, patch) {
  state.items[index] = normalizeItem({ ...state.items[index], ...patch });
  if (index === state.currentIndex && !state.isRunning) {
    state.remainingSec = state.items[index].durationSec;
  }
  clampTimer();
  syncActiveWorkout();
  renderTimer();
  renderReady();
  saveState();
}

function moveItem(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= state.items.length) return;
  const [item] = state.items.splice(index, 1);
  state.items.splice(nextIndex, 0, item);
  if (state.currentIndex === index) state.currentIndex = nextIndex;
  else if (state.currentIndex === nextIndex) state.currentIndex = index;
  clampTimer();
  syncActiveWorkout();
  renderItems();
  renderTimer();
  renderReady();
  saveState();
}

function removeItem(index) {
  state.items.splice(index, 1);
  if (state.currentIndex >= state.items.length) {
    state.currentIndex = Math.max(0, state.items.length - 1);
  }
  state.remainingSec = getCurrentItem()?.durationSec || 0;
  if (!state.items.length) pauseTimer();
  syncActiveWorkout();
  renderItems();
  renderTimer();
  renderReady();
  saveState();
}

function addItem() {
  state.items.push({ type: "exercise", name: "新しい種目", durationSec: 30 });
  if (state.items.length === 1) {
    state.currentIndex = 0;
    state.remainingSec = 30;
  }
  renderItems();
  renderTimer();
  renderReady();
  syncActiveWorkout();
  saveState();
}

async function extractMenu() {
  const apiKey = state.apiKey.trim();
  const workoutUrl = state.workoutUrl.trim();

  if (!apiKey) {
    showMessage("Gemini APIキーを入力してください。", "error");
    return;
  }
  if (!getYouTubeId(workoutUrl)) {
    showMessage("ワークアウト動画のYouTube URLを入力してください。", "error");
    return;
  }

  setLoading(true);
  showMessage("動画を解析中です。", "");

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(state.model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                file_data: {
                  file_uri: workoutUrl,
                },
              },
              {
                text: state.prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          response_mime_type: "application/json",
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || "Gemini APIの呼び出しに失敗しました。");
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
    if (!text) throw new Error("Geminiから抽出結果が返りませんでした。");

    const parsed = parseGeminiJson(text);
    const items = sanitizeItems(parsed.items);
    if (!items.length) throw new Error("有効なメニュー項目が見つかりませんでした。");

    pauseTimer();
    state.title = parsed.title || "";
    state.items = items;
    saveCurrentWorkoutToLibrary();
    state.currentIndex = 0;
    state.remainingSec = items[0].durationSec;
    state.remainingMs = state.remainingSec * 1000;
    renderItems();
    renderTimer();
    renderReady();
    renderSavedWorkouts();
    saveState();
    showMessage(`${items.length}件のメニューを作成して保存しました。`, "ok");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setLoading(false);
  }
}

function parseGeminiJson(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(normalizeItem)
    .filter((item) => item.name && Number.isFinite(item.durationSec) && item.durationSec > 0);
}

function sanitizeSavedWorkouts(workouts) {
  if (!Array.isArray(workouts)) return [];
  return workouts
    .map((workout) => ({
      id: String(workout?.id || makeWorkoutId()),
      title: String(workout?.title || "ワークアウト").trim(),
      workoutUrl: String(workout?.workoutUrl || ""),
      items: sanitizeItems(workout?.items),
      updatedAt: workout?.updatedAt || new Date().toISOString(),
    }))
    .filter((workout) => workout.items.length);
}

function normalizeItem(item) {
  const type = TYPE_LABELS[item?.type] ? item.type : "exercise";
  return {
    type,
    name: String(item?.name || TYPE_LABELS[type] || "種目").trim(),
    durationSec: Math.max(1, Math.round(Number(item?.durationSec) || 1)),
  };
}

function setLoading(isLoading) {
  state.isExtracting = isLoading;
  els.extractButton.disabled = isLoading;
  els.apiKeyInput.disabled = isLoading;
  els.workoutUrlInput.disabled = isLoading;
  els.extractButton.textContent = isLoading ? "解析中" : "動画からメニュー作成";
  renderMode();
}

function showMessage(message, tone) {
  els.messageArea.textContent = message;
  els.messageArea.className = `message-area ${tone || ""}`.trim();
}

function startPauseTimer() {
  ensureAudio();
  if (state.isRunning) {
    pauseTimer();
    renderTimer();
    return;
  }
  if (!state.items.length) return;

  state.isComplete = false;
  state.isWorkoutMode = true;
  if (!state.startedOnce) {
    cue(660, 0.08, 35);
    state.startedOnce = true;
  }
  state.isRunning = true;
  state.endTime = performance.now() + (state.remainingMs || state.remainingSec * 1000);
  startAnimation();
  renderMode();
  renderComplete();
  renderTimer();
}

function pauseTimer() {
  if (state.isRunning && state.endTime) {
    state.remainingMs = Math.max(0, state.endTime - performance.now());
    state.remainingSec = Math.ceil(state.remainingMs / 1000);
  }
  state.isRunning = false;
  if (state.animationId) {
    window.cancelAnimationFrame(state.animationId);
    state.animationId = null;
  }
}

function startAnimation() {
  if (state.animationId) {
    window.cancelAnimationFrame(state.animationId);
  }
  const animate = () => {
    if (!state.isRunning) return;
    state.remainingMs = Math.max(0, state.endTime - performance.now());
    const nextSec = Math.ceil(state.remainingMs / 1000);
    if (nextSec !== state.remainingSec && nextSec > 0 && nextSec <= 3) cue(880, 0.05, 25);
    state.remainingSec = nextSec;
    renderTimer();
    if (state.remainingMs <= 0) {
      advanceItem();
      return;
    }
    state.animationId = window.requestAnimationFrame(animate);
  };
  state.animationId = window.requestAnimationFrame(animate);
}

function advanceItem() {
  if (state.currentIndex >= state.items.length - 1) {
    state.remainingSec = 0;
    state.remainingMs = 0;
    pauseTimer();
    cue(523, 0.1, [80, 50, 120]);
    window.setTimeout(() => cue(784, 0.16, 120), 140);
    state.isWorkoutMode = false;
    state.isComplete = true;
    renderMode();
    renderComplete();
    renderTimer();
    return;
  }
  state.currentIndex += 1;
  state.remainingSec = getCurrentItem().durationSec;
  state.remainingMs = state.remainingSec * 1000;
  state.endTime = performance.now() + state.remainingMs;
  cue(getCurrentItem().type === "rest" ? 420 : 720, 0.12, 80);
  if (state.isRunning) startAnimation();
  renderTimer();
}

function skip(direction) {
  if (!state.items.length) return;
  state.currentIndex = Math.max(0, Math.min(state.items.length - 1, state.currentIndex + direction));
  state.remainingSec = getCurrentItem().durationSec;
  state.remainingMs = state.remainingSec * 1000;
  if (state.isRunning) {
    state.endTime = performance.now() + state.remainingMs;
    startAnimation();
  }
  cue(600, 0.06, 35);
  renderTimer();
}

function resetTimer() {
  pauseTimer();
  state.currentIndex = 0;
  state.remainingSec = getCurrentItem()?.durationSec || 0;
  state.remainingMs = state.remainingSec * 1000;
  state.isComplete = false;
  renderComplete();
  renderTimer();
}

function exitWorkoutMode() {
  pauseTimer();
  state.isWorkoutMode = false;
  state.isComplete = false;
  renderMode();
  renderComplete();
  renderTimer();
}

function closeComplete() {
  state.isComplete = false;
  renderComplete();
}

function ensureAudio() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioContext.state === "suspended") {
    state.audioContext.resume();
  }
}

function beep(frequency, duration) {
  if (!state.audioContext) return;
  const ctx = state.audioContext;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + duration + 0.02);
}

function cue(frequency, duration, vibration) {
  beep(frequency, duration);
  vibrate(vibration);
  flashScreen();
}

function vibrate(pattern) {
  if (!("vibrate" in navigator)) return;
  navigator.vibrate(pattern);
}

function flashScreen() {
  document.body.classList.remove("alert-flash");
  window.requestAnimationFrame(() => {
    document.body.classList.add("alert-flash");
    window.setTimeout(() => document.body.classList.remove("alert-flash"), 180);
  });
}

function clampTimer() {
  if (!state.items.length) {
    state.currentIndex = 0;
    state.remainingSec = 0;
    return;
  }
  state.currentIndex = Math.max(0, Math.min(state.currentIndex, state.items.length - 1));
  const current = getCurrentItem();
  state.remainingSec = Math.max(0, Math.min(state.remainingSec || current.durationSec, current.durationSec));
}

function getCurrentItem() {
  return state.items[state.currentIndex];
}

function saveCurrentWorkoutToLibrary() {
  const existing = state.savedWorkouts.find((workout) => workout.workoutUrl === state.workoutUrl);
  const next = {
    id: existing?.id || makeWorkoutId(),
    title: state.title || "ワークアウト",
    workoutUrl: state.workoutUrl,
    items: state.items.map((item) => ({ ...item })),
    updatedAt: new Date().toISOString(),
  };
  state.activeWorkoutId = next.id;
  state.savedWorkouts = [next, ...state.savedWorkouts.filter((workout) => workout.id !== next.id)].slice(0, 20);
}

function updateSavedWorkoutTitle(id, title) {
  state.savedWorkouts = state.savedWorkouts.map((workout) =>
    workout.id === id ? { ...workout, title: title.trim() || "ワークアウト", updatedAt: new Date().toISOString() } : workout,
  );
  if (state.activeWorkoutId === id) {
    state.title = title.trim() || "ワークアウト";
    renderReady();
  }
  saveState();
}

function updateSavedWorkoutItem(id, index, patch) {
  state.savedWorkouts = state.savedWorkouts.map((workout) => {
    if (workout.id !== id) return workout;
    const items = workout.items.map((item, itemIndex) =>
      itemIndex === index ? normalizeItem({ ...item, ...patch }) : item,
    );
    return { ...workout, items, updatedAt: new Date().toISOString() };
  });
  if (state.activeWorkoutId === id) {
    const workout = state.savedWorkouts.find((item) => item.id === id);
    state.items = workout?.items.map((item) => ({ ...item })) || [];
    clampTimer();
    renderItems();
    renderTimer();
    renderReady();
  }
  saveState();
}

function addSavedWorkoutItem(id) {
  state.savedWorkouts = state.savedWorkouts.map((workout) => {
    if (workout.id !== id) return workout;
    return {
      ...workout,
      items: [...workout.items, { type: "exercise", name: "新しい種目", durationSec: 30 }],
      updatedAt: new Date().toISOString(),
    };
  });
  renderSavedWorkouts();
  if (state.activeWorkoutId === id) {
    const workout = state.savedWorkouts.find((item) => item.id === id);
    state.items = workout?.items.map((item) => ({ ...item })) || [];
    state.remainingSec = getCurrentItem()?.durationSec || 0;
    state.remainingMs = state.remainingSec * 1000;
    renderItems();
    renderTimer();
    renderReady();
  }
  saveState();
}

function deleteSavedWorkoutItem(id, index) {
  state.savedWorkouts = state.savedWorkouts.map((workout) => {
    if (workout.id !== id) return workout;
    return {
      ...workout,
      items: workout.items.filter((_, itemIndex) => itemIndex !== index),
      updatedAt: new Date().toISOString(),
    };
  }).filter((workout) => workout.items.length);
  renderSavedWorkouts();
  if (state.activeWorkoutId === id) {
    const workout = state.savedWorkouts.find((item) => item.id === id);
    state.items = workout?.items.map((item) => ({ ...item })) || [];
    state.remainingSec = getCurrentItem()?.durationSec || 0;
    state.remainingMs = state.remainingSec * 1000;
    renderItems();
    renderTimer();
    renderReady();
  }
  saveState();
}

function syncActiveWorkout() {
  if (!state.activeWorkoutId) return;
  state.savedWorkouts = state.savedWorkouts.map((workout) => {
    if (workout.id !== state.activeWorkoutId) return workout;
    return {
      ...workout,
      title: state.title || workout.title,
      workoutUrl: state.workoutUrl || workout.workoutUrl,
      items: state.items.map((item) => ({ ...item })),
      updatedAt: new Date().toISOString(),
    };
  });
  renderSavedWorkouts();
}

function loadSavedWorkout(id) {
  const workout = state.savedWorkouts.find((item) => item.id === id);
  if (!workout) return;
  pauseTimer();
  state.activeWorkoutId = workout.id;
  state.title = workout.title;
  state.workoutUrl = workout.workoutUrl;
  state.items = workout.items.map((item) => ({ ...item }));
  state.currentIndex = 0;
  state.remainingSec = state.items[0]?.durationSec || 0;
  state.remainingMs = state.remainingSec * 1000;
  state.isWorkoutMode = false;
  state.isComplete = false;
  els.workoutUrlInput.value = state.workoutUrl;
  renderItems();
  renderTimer();
  renderReady();
  renderMode();
  renderComplete();
  saveState();
  showMessage("保存済みワークアウトを読み込みました。", "ok");
}

function deleteSavedWorkout(id) {
  state.savedWorkouts = state.savedWorkouts.filter((workout) => workout.id !== id);
  if (state.activeWorkoutId === id) state.activeWorkoutId = "";
  renderSavedWorkouts();
  renderReady();
  saveState();
}

function makeWorkoutId() {
  return `workout-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(totalSec) {
  const safe = Math.max(0, Math.round(totalSec || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getYouTubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.split("/").filter(Boolean)[0] || "";
    }
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v") || "";
      if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.split("/").filter(Boolean)[1] || "";
      }
    }
  } catch {
    return "";
  }
  return "";
}

function bindEvents() {
  els.apiKeyInput.addEventListener("input", () => {
    state.apiKey = els.apiKeyInput.value;
    saveState();
  });
  els.modelSelect.addEventListener("change", () => {
    state.model = els.modelSelect.value;
    saveState();
  });
  els.workoutUrlInput.addEventListener("input", () => {
    state.workoutUrl = els.workoutUrlInput.value;
    saveState();
  });
  els.mediaUrlInput.addEventListener("input", () => {
    state.mediaUrl = els.mediaUrlInput.value;
    renderEmbed();
    saveState();
  });
  els.promptInput.addEventListener("input", () => {
    state.prompt = els.promptInput.value;
    saveState();
  });
  els.extractButton.addEventListener("click", extractMenu);
  els.addItemButton.addEventListener("click", addItem);
  els.prepareStartButton.addEventListener("click", startPauseTimer);
  els.startPauseButton.addEventListener("click", startPauseTimer);
  els.prevButton.addEventListener("click", () => skip(-1));
  els.nextButton.addEventListener("click", () => skip(1));
  els.resetButton.addEventListener("click", resetTimer);
  els.exitWorkoutButton.addEventListener("click", exitWorkoutMode);
  els.closeCompleteButton.addEventListener("click", closeComplete);
}

loadState();
bindEvents();
renderAll();
