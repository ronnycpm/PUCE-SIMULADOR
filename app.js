/**
 * app.js
 * Simulador Méritos y Oposición PUCE
 *
 * Versión simplificada:
 * - Sin carga de PDF.
 * - Carga automática de bancos JSON desde /bancos/manifest.json.
 * - Optimizado para iPad.
 */

(function () {
  "use strict";

  const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const MANIFEST_PATH = "./bancos/manifest.json";

  const App = {
    bank: {
      all: [],
      valid: [],
      review: []
    },
    exam: null,
    practice: null,
    stats: null,
    timerInterval: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showSection(sectionId) {
    document.querySelectorAll(".app-section").forEach((s) => s.classList.add("hidden"));
    const section = $(sectionId);
    if (section) section.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function randomInt(maxExclusive) {
    if (maxExclusive <= 0) return 0;

    if (window.crypto && window.crypto.getRandomValues) {
      const array = new Uint32Array(1);
      window.crypto.getRandomValues(array);
      return array[0] % maxExclusive;
    }

    return Math.floor(Math.random() * maxExclusive);
  }

  function shuffle(array) {
    const arr = array.slice();

    for (let i = arr.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      const temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }

    return arr;
  }

  function formatTime(totalSeconds) {
    const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function getClassification(percent) {
    if (percent >= 90) return "EXCELENTE";
    if (percent >= 80) return "MUY BUENO";
    if (percent >= 70) return "BUENO";
    if (percent >= 60) return "REGULAR";
    return "NECESITA MÁS ESTUDIO";
  }

  function setSyncStatus(text) {
    const el = $("syncStatus");
    if (el) el.textContent = text;
  }

  function setMessage(text) {
    const el = $("noBankMessage");
    if (!el) return;

    if (text) {
      el.textContent = text;
      el.classList.remove("hidden");
    } else {
      el.textContent = "";
      el.classList.add("hidden");
    }
  }

  function setStartEnabled(enabled) {
    const btnExam = $("btnStartExam");
    const btnPractice = $("btnStartPractice");

    if (btnExam) btnExam.disabled = !enabled;
    if (btnPractice) btnPractice.disabled = !enabled;
  }

  function normalizeForMatch(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function simpleHash(str) {
    let h = 5381;
    const s = String(str || "");

    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }

    return h.toString(36);
  }

  function normalizeQuestion(source, fallbackIndex) {
    const idx = typeof fallbackIndex === "number" ? fallbackIndex : 0;
    const rawOptionsSource = Array.isArray(source && source.options) ? source.options : [];

    const normalizedRawOptions = rawOptionsSource.map((o, i) => {
      if (typeof o === "string") {
        return {
          text: o,
          originalLabel: LETTERS[i] || String(i + 1)
        };
      }

      return o || {};
    });

    const options = normalizedRawOptions.map((o, i) => ({
      id: o.id || `q${idx}_opt_${o.originalLabel || LETTERS[i] || i}`,
      originalLabel: String(o.originalLabel || LETTERS[i] || String(i + 1)).toUpperCase(),
      text: String(o.text || "").trim(),
      isCorrect: o.isCorrect === true || o.isCorrect === "true"
    }));

    const stem = String((source && source.stem) || "").trim();
    const officialLetter = String((source && source.officialAnswerLetter) || "").trim().toUpperCase();
    const officialText = String((source && source.officialAnswerText) || "").trim();

    let hasCorrect = options.some((o) => o.isCorrect);

    if (!hasCorrect && options.length) {
      let correctOption = null;

      if (officialText) {
        const officialNorm = normalizeForMatch(officialText);
        correctOption = options.find((o) => normalizeForMatch(o.text) === officialNorm);
      }

      if (!correctOption && officialLetter) {
        correctOption = options.find((o) => o.originalLabel === officialLetter);
      }

      if (!correctOption && officialText) {
        const officialNorm = normalizeForMatch(officialText);
        correctOption = options.find((o) => {
          const optNorm = normalizeForMatch(o.text);
          return optNorm && (optNorm.includes(officialNorm) || officialNorm.includes(optNorm));
        });
      }

      if (correctOption) {
        correctOption.isCorrect = true;
        hasCorrect = true;
      }
    }

    const criticalIssues = [];
    const revisionIssues = [];

    if (!stem) {
      criticalIssues.push("Enunciado vacío.");
    }

    if (options.length < 2) {
      criticalIssues.push("Menos de 2 alternativas.");
    }

    if (options.some((o) => !o.text)) {
      criticalIssues.push("Una o más alternativas están vacías.");
    }

    if (!hasCorrect) {
      criticalIssues.push("No se pudo determinar la respuesta correcta.");
    }

    if (options.length && options.length !== 5) {
      revisionIssues.push(`Número de alternativas detectadas: ${options.length}.`);
    }

    const normTexts = options.map((o) => normalizeForMatch(o.text)).filter(Boolean);
    const duplicateFound = normTexts.some((t, i) => t && normTexts.indexOf(t) !== i);

    if (duplicateFound) {
      revisionIssues.push("Existen alternativas duplicadas o muy similares.");
    }

    const valid = criticalIssues.length === 0;

    return {
      id:
        (source && source.id) ||
        `q_${(source && source.number) || idx}_${simpleHash(stem || String(idx))}`,
      number: source && source.number !== undefined ? source.number : null,
      stem,
      options,
      officialAnswerLetter: officialLetter || null,
      officialAnswerText: officialText || null,
      explanation: String((source && source.explanation) || "").trim(),
      sourceIndex: source && source.sourceIndex !== undefined ? source.sourceIndex : idx,
      valid,
      criticalIssues,
      revisionIssues,
      issues: [...criticalIssues, ...revisionIssues]
    };
  }

  function getQuestionMergeKey(q) {
    const stem = normalizeForMatch(q && q.stem ? q.stem : "");

    if (stem.length > 20) {
      return `stem:${stem.length}:${simpleHash(stem)}`;
    }

    if (stem) {
      return `stem:${stem}`;
    }

    if (q && q.id) {
      return `id:${q.id}`;
    }

    const payload = JSON.stringify({
      number: q && q.number ? q.number : null,
      options: q && q.options ? q.options.map((o) => (o && o.text ? o.text : "")) : []
    });

    return `gen:${simpleHash(payload)}`;
  }

  function questionScore(q) {
    const optionCount = Array.isArray(q && q.options) ? q.options.length : 0;
    const hasCorrect =
      Array.isArray(q && q.options) && q.options.some((o) => o && o.isCorrect);

    return (
      (q && q.valid ? 10000 : 0) +
      (q && q.stem ? Math.min(String(q.stem).length, 800) : 0) +
      optionCount * 20 +
      (q && q.explanation ? 80 : 0) +
      (q && q.officialAnswerText ? 30 : 0) +
      (q && q.officialAnswerLetter ? 10 : 0) +
      (hasCorrect ? 120 : 0)
    );
  }

  function mergeQuestions(existing, incoming) {
    const map = new Map();

    function addQuestion(rawQ) {
      if (!rawQ) return;

      const q = normalizeQuestion(rawQ);
      const key = getQuestionMergeKey(q);

      if (!map.has(key)) {
        map.set(key, q);
        return;
      }

      const current = map.get(key);

      if (questionScore(q) > questionScore(current)) {
        map.set(key, q);
        return;
      }

      if (!current.explanation && q.explanation) {
        current.explanation = q.explanation;
      }

      if (!current.officialAnswerText && q.officialAnswerText) {
        current.officialAnswerText = q.officialAnswerText;
      }

      if (!current.officialAnswerLetter && q.officialAnswerLetter) {
        current.officialAnswerLetter = q.officialAnswerLetter;
      }

      if (!current.number && q.number) {
        current.number = q.number;
      }

      if (!current.valid && q.valid) {
        current.valid = true;
        current.criticalIssues = [];
        current.issues = current.revisionIssues || [];
      }
    }

    (Array.isArray(existing) ? existing : []).forEach(addQuestion);
    (Array.isArray(incoming) ? incoming : []).forEach(addQuestion);

    return Array.from(map.values());
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!res.ok) {
      const error = new Error(`No se pudo cargar ${url} (${res.status}).`);
      error.status = res.status;
      throw error;
    }

    return res.json();
  }

  function resolveBankFile(file) {
    if (/^https?:\/\//i.test(file)) {
      return file;
    }

    let clean = String(file || "").trim();

    clean = clean.replace(/^https?:\/\/[^/]+\/bancos\//i, "");
    clean = clean.replace(/^\.?\/?bancos\//i, "");
    clean = clean.replace(/^\//, "");

    const encoded = clean
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    return new URL(`./bancos/${encoded}`, location.href).href;
  }

  function extractQuestions(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.questions)) return data.questions;
    return [];
  }

  function sortQuestions(questions) {
    return questions.slice().sort((a, b) => {
      const na = Number(a && a.number);
      const nb = Number(b && b.number);

      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) {
        return na - nb;
      }

      return String((a && a.stem) || "").localeCompare(String((b && b.stem) || ""), "es");
    });
  }

  function processBank(result) {
    App.bank.all = (result && result.questions ? result.questions : []).map((q, i) =>
      normalizeQuestion(q, i)
    );

    App.bank.valid = App.bank.all.filter((q) => q.valid);
    App.bank.review = App.bank.all.filter((q) => !q.valid);

    if (window.Database && Database.saveBank) {
      Database.saveBank({
        version: 1,
        createdAt: new Date().toISOString(),
        totalFound: App.bank.all.length,
        validCount: App.bank.valid.length,
        reviewCount: App.bank.review.length,
        questions: App.bank.all
      });
    }

    renderSetup();
  }

  function renderSetup() {
    const totalEl = $("bankTotal");
    const validEl = $("bankValid");
    const reviewEl = $("bankReview");

    if (totalEl) totalEl.textContent = String(App.bank.all.length);
    if (validEl) validEl.textContent = String(App.bank.valid.length);
    if (reviewEl) reviewEl.textContent = String(App.bank.review.length);

    const enabled = App.bank.valid.length > 0;
    setStartEnabled(enabled);

    if (!enabled) {
      setMessage(
        "Aún no hay preguntas válidas. Sube lotes JSON a la carpeta /bancos, agrégalos a bancos/manifest.json y toca Actualizar banco."
      );
    } else {
      setMessage("");
    }
  }

  async function syncRemoteBanks(options) {
    const silent = options && options.silent === true;

    try {
      setSyncStatus("Sincronizando banco...");

      const stored = window.Database && Database.loadBank ? Database.loadBank() : null;
      const currentQuestions =
        App.bank.all && App.bank.all.length
          ? App.bank.all
          : stored && Array.isArray(stored.questions)
          ? stored.questions
          : [];

      let all = currentQuestions.map((q, i) => normalizeQuestion(q, i));
      let manifest = null;
      const errors = [];

      try {
        const manifestUrl = new URL(MANIFEST_PATH, location.href).href;
        manifest = await fetchJson(manifestUrl);
      } catch (err) {
        if (err && err.status === 404) {
          errors.push({
            file: "bancos/manifest.json",
            message: "No se encontró bancos/manifest.json."
          });
        } else {
          throw err;
        }
      }

      const files = manifest && Array.isArray(manifest.files) ? manifest.files : [];

      for (const file of files) {
        try {
          const url = resolveBankFile(file);
          const data = await fetchJson(url);
          const questions = extractQuestions(data).map((q, i) => normalizeQuestion(q, i));
          all = mergeQuestions(all, questions);
        } catch (err) {
          errors.push({
            file,
            message: (err && err.message) || `No se pudo cargar ${file}.`
          });
        }
      }

      all = sortQuestions(all);

      const valid = all.filter((q) => q.valid);
      const review = all.filter((q) => !q.valid);

      processBank({
        questions: all,
        valid,
        review,
        totalFound: all.length
      });

      const updatedAt =
        manifest && manifest.updatedAt
          ? new Date(manifest.updatedAt).toLocaleString("es-EC")
          : "sin fecha";

      const base = `Banco sincronizado · ${valid.length} válidas · ${all.length} total · ${updatedAt}`;

      if (errors.length) {
        const warning = errors.map((e) => e.message).join(" | ");
        setSyncStatus(`${base} · ${warning}`);

        if (!silent) {
          console.warn(warning);
        }
      } else {
        setSyncStatus(base);
      }
    } catch (err) {
      console.error(err);

      const msg = (err && err.message) || "No se pudo sincronizar el banco remoto.";
      setSyncStatus(msg);

      if (!silent) {
        setMessage(msg);
      }
    }
  }

  function prepareExamQuestion(q) {
    const shuffledOptions = shuffle(q.options.map((o) => ({ ...o })));

    return {
      id: q.id,
      number: q.number,
      stem: q.stem,
      explanation: q.explanation,
      officialAnswerLetter: q.officialAnswerLetter,
      officialAnswerText: q.officialAnswerText,
      options: shuffledOptions.map((o, i) => ({
        displayId: `${q.id}_display_${i}`,
        displayLabel: LETTERS[i] || String(i + 1),
        text: o.text,
        isCorrect: !!o.isCorrect,
        originalLabel: o.originalLabel
      }))
    };
  }

  function startExam(count) {
    if (!App.bank.valid.length) {
      alert("No hay preguntas válidas disponibles. Actualiza el banco primero.");
      return;
    }

    const requested = Number(count) || 100;
    const total = Math.min(requested, App.bank.valid.length);
    const selected = shuffle(App.bank.valid).slice(0, total).map(prepareExamQuestion);

    App.exam = {
      questions: selected,
      answers: {},
      index: 0,
      startedAt: Date.now(),
      finished: false,
      results: null
    };

    showSection("examSection");
    startTimer();
    renderExamQuestion();
  }

  function startTimer() {
    clearInterval(App.timerInterval);

    App.timerInterval = setInterval(() => {
      if (!App.exam || App.exam.finished) return;

      const seconds = Math.floor((Date.now() - App.exam.startedAt) / 1000);
      const el = $("examTimer");
      if (el) el.textContent = formatTime(seconds);
    }, 1000);
  }

  function renderExamQuestion() {
    if (!App.exam) return;

    const q = App.exam.questions[App.exam.index];
    const total = App.exam.questions.length;

    const counter = $("examCounter");
    if (counter) counter.textContent = `Pregunta ${App.exam.index + 1} de ${total}`;

    const stem = $("questionStem");
    if (stem) stem.textContent = q.stem;

    const selectedId = App.exam.answers[q.id] || null;

    const optionsContainer = $("optionsContainer");
    if (optionsContainer) {
      optionsContainer.innerHTML = q.options
        .map(
          (o) => `
            <label class="option">
              <input
                type="radio"
                name="examOption"
                value="${esc(o.displayId)}"
                ${selectedId === o.displayId ? "checked" : ""}
              />
              <span><strong>${esc(o.displayLabel)}.</strong> ${esc(o.text)}</span>
            </label>
          `
        )
        .join("");

      document.querySelectorAll('input[name="examOption"]').forEach((input) => {
        input.addEventListener("change", (e) => {
          App.exam.answers[q.id] = e.target.value;
          updateNavPanel();
        });
      });
    }

    const btnPrev = $("btnPrev");
    const btnNext = $("btnNext");

    if (btnPrev) btnPrev.disabled = App.exam.index === 0;
    if (btnNext) btnNext.disabled = App.exam.index === total - 1;

    renderNavPanel();
  }

  function renderNavPanel() {
    const panel = $("navPanel");
    if (!panel || !App.exam) return;

    panel.innerHTML = "";

    App.exam.questions.forEach((q, i) => {
      const btn = document.createElement("button");
      btn.className = "nav-btn";
      btn.textContent = String(i + 1);

      if (i === App.exam.index) btn.classList.add("current");
      if (App.exam.answers[q.id]) btn.classList.add("answered");

      btn.addEventListener("click", () => {
        App.exam.index = i;
        renderExamQuestion();
      });

      panel.appendChild(btn);
    });
  }

  function updateNavPanel() {
    if (!App.exam) return;

    const buttons = document.querySelectorAll("#navPanel .nav-btn");

    buttons.forEach((btn, i) => {
      const q = App.exam.questions[i];
      btn.classList.toggle("current", i === App.exam.index);
      btn.classList.toggle("answered", !!App.exam.answers[q.id]);
    });
  }

  function goQuestion(delta) {
    if (!App.exam) return;

    const nextIndex = App.exam.index + delta;
    if (nextIndex < 0 || nextIndex >= App.exam.questions.length) return;

    App.exam.index = nextIndex;
    renderExamQuestion();
  }

  function openConfirmModal() {
    if (!App.exam) return;

    const total = App.exam.questions.length;
    const answered = App.exam.questions.filter((q) => !!App.exam.answers[q.id]).length;
    const unanswered = total - answered;

    const answeredEl = $("confirmAnswered");
    const unansweredEl = $("confirmUnanswered");

    if (answeredEl) answeredEl.textContent = String(answered);
    if (unansweredEl) unansweredEl.textContent = String(unanswered);

    const modal = $("modalConfirm");
    if (modal) modal.classList.remove("hidden");
  }

  function closeConfirmModal() {
    const modal = $("modalConfirm");
    if (modal) modal.classList.add("hidden");
  }

  function finalizeExam() {
    if (!App.exam || App.exam.finished) return;

    clearInterval(App.timerInterval);
    App.exam.finished = true;

    const results = App.exam.questions.map((q) => {
      const selectedId = App.exam.answers[q.id] || null;
      const selected = q.options.find((o) => o.displayId === selectedId) || null;
      const answered = !!selectedId;
      const isCorrect = !!(selected && selected.isCorrect);

      return {
        question: q,
        selected,
        answered,
        isCorrect
      };
    });

    const total = results.length;
    const correct = results.filter((r) => r.isCorrect).length;
    const unanswered = results.filter((r) => !r.answered).length;
    const incorrect = total - correct - unanswered;
    const percent = total ? Math.round((correct / total) * 100) : 0;

    App.exam.results = results;

    if (window.Database && Database.recordExam) {
      Database.recordExam({
        total,
        correct,
        incorrect,
        unanswered,
        percent,
        questionResults: results.map((r) => ({
          id: r.question.id,
          stem: r.question.stem,
          answered: r.answered,
          isCorrect: r.isCorrect
        }))
      });
    }

    renderResults({ total, correct, incorrect, unanswered, percent });
    closeConfirmModal();
    showSection("resultsSection");
  }

  function renderResults(summary) {
    const scoreValue = $("scoreValue");
    const percentValue = $("percentValue");
    const classificationValue = $("classificationValue");

    const correctValue = $("correctValue");
    const incorrectValue = $("incorrectValue");
    const unansweredValue = $("unansweredValue");

    if (scoreValue) scoreValue.textContent = `${summary.correct}/${summary.total}`;
    if (percentValue) percentValue.textContent = `${summary.percent}%`;
    if (classificationValue) classificationValue.textContent = getClassification(summary.percent);

    if (correctValue) correctValue.textContent = String(summary.correct);
    if (incorrectValue) incorrectValue.textContent = String(summary.incorrect);
    if (unansweredValue) unansweredValue.textContent = String(summary.unanswered);

    const filterSelect = $("filterSelect");
    if (filterSelect) filterSelect.value = "all";

    renderFeedback("all");
  }

    function formatExplanation(text) {
    const t = String(text || "").trim();
    if (t) return esc(t);
    return "El banco no proporciona una explicación para esta pregunta.";
  }

  function renderFeedback(filter) {
    const container = $("feedbackContainer");
    if (!container) return;

    const results = App.exam && App.exam.results ? App.exam.results : [];

    let filtered = results;

    if (filter === "correct") {
      filtered = results.filter((r) => r.isCorrect);
    } else if (filter === "incorrect") {
      filtered = results.filter((r) => r.answered && !r.isCorrect);
    } else if (filter === "unanswered") {
      filtered = results.filter((r) => !r.answered);
    }

    if (filtered.length === 0) {
      container.innerHTML = `<p>No hay preguntas para este filtro.</p>`;
      return;
    }

    container.innerHTML = filtered
      .map((r) => {
        const q = r.question;
        const correctOption = q.options.find((o) => o.isCorrect);

        let statusClass = "unanswered";
        let statusText = "Sin responder";
        let badgeClass = "warning";

        if (r.isCorrect) {
          statusClass = "correct";
          statusText = "Correcta";
          badgeClass = "success";
        } else if (r.answered) {
          statusClass = "incorrect";
          statusText = "Incorrecta";
          badgeClass = "danger";
        }

        // Sin literales: solo el texto de la alternativa.
        const userAnswer = r.selected ? esc(r.selected.text) : "Sin responder";
        const correctAnswer = correctOption ? esc(correctOption.text) : "No disponible";
        const explanationText = formatExplanation(q.explanation);

        const label = q.number ? `Pregunta ${esc(q.number)}` : "Pregunta del banco";

        return `
          <article class="feedback-card ${statusClass}">
            <h4>${label}</h4>
            <p>${esc(q.stem)}</p>
            <span class="badge ${badgeClass}">${statusText}</span>

            <div class="feedback-meta">
              <p><strong>Tu respuesta:</strong> ${userAnswer}</p>
              <p><strong>Respuesta correcta:</strong> ${correctAnswer}</p>
              <p><strong>Explicación:</strong> ${explanationText}</p>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function startPractice() {
    if (!App.bank.valid.length) {
      alert("No hay preguntas válidas disponibles. Actualiza el banco primero.");
      return;
    }

    const pool = shuffle(App.bank.valid).map(prepareExamQuestion);

    App.practice = {
      pool,
      index: 0,
      selected: null,
      checked: false
    };

    showSection("practiceSection");
    renderPracticeQuestion();
  }

  function renderPracticeOptions() {
    if (!App.practice) return;

    const q = App.practice.pool[App.practice.index];
    const disabled = App.practice.checked ? "disabled" : "";
    const selectedId = App.practice.selected;

    const container = $("practiceOptions");
    if (!container) return;

    container.innerHTML = q.options
      .map(
        (o) => `
          <label class="option">
            <input
              type="radio"
              name="practiceOption"
              value="${esc(o.displayId)}"
              ${selectedId === o.displayId ? "checked" : ""}
              ${disabled}
            />
            <span><strong>${esc(o.displayLabel)}.</strong> ${esc(o.text)}</span>
          </label>
        `
      )
      .join("");

    document.querySelectorAll('input[name="practiceOption"]').forEach((input) => {
      input.addEventListener("change", (e) => {
        if (App.practice.checked) return;
        App.practice.selected = e.target.value;

        const btnCheck = $("btnCheckPractice");
        if (btnCheck) btnCheck.disabled = false;
      });
    });

    const btnCheck = $("btnCheckPractice");
    if (btnCheck) btnCheck.disabled = !App.practice.selected || App.practice.checked;
  }

  function renderPracticeQuestion() {
    if (!App.practice) return;

    const q = App.practice.pool[App.practice.index];

    const counter = $("practiceCounter");
    if (counter) {
      counter.textContent = `Pregunta ${App.practice.index + 1} de ${App.practice.pool.length}`;
    }

    const stem = $("practiceStem");
    if (stem) stem.textContent = q.stem;

    const result = $("practiceResult");
    if (result) {
      result.innerHTML = "";
      result.className = "practice-result";
    }

    const explanation = $("practiceExplanation");
    if (explanation) explanation.innerHTML = "";

    renderPracticeOptions();
  }

   function checkPracticeAnswer() {
    if (!App.practice || App.practice.checked || !App.practice.selected) return;

    const q = App.practice.pool[App.practice.index];
    const selected = q.options.find((o) => o.displayId === App.practice.selected);
    const correctOption = q.options.find((o) => o.isCorrect);

    App.practice.checked = true;

    const isCorrect = !!(selected && selected.isCorrect);
    const correctText = correctOption ? esc(correctOption.text) : "No disponible";

    const result = $("practiceResult");
    if (result) {
      result.className = `practice-result ${isCorrect ? "ok" : "fail"}`;
      result.innerHTML = isCorrect
        ? "✅ CORRECTA"
        : `❌ INCORRECTA<br/><span style="font-weight:600;color:var(--text)">Respuesta correcta: ${correctText}</span>`;
    }

    const explanation = $("practiceExplanation");
    if (explanation) {
      explanation.innerHTML = `<strong>Explicación:</strong> ${formatExplanation(q.explanation)}`;
    }

    renderPracticeOptions();
  }

  function nextPracticeQuestion() {
    if (!App.practice) return;

    App.practice.index += 1;

    if (App.practice.index >= App.practice.pool.length) {
      App.practice.pool = shuffle(App.bank.valid).map(prepareExamQuestion);
      App.practice.index = 0;
    }

    App.practice.selected = null;
    App.practice.checked = false;

    renderPracticeQuestion();
  }

  function renderStats() {
    if (!window.Database) return;

    App.stats = Database.loadStats();

    const totalAsked =
      (App.stats.totalCorrect || 0) +
      (App.stats.totalIncorrect || 0) +
      (App.stats.totalUnanswered || 0);

    const average = App.stats.examsCount
      ? Math.round((App.stats.sumPercent || 0) / App.stats.examsCount)
      : 0;

    const accuracy = totalAsked
      ? Math.round(((App.stats.totalCorrect || 0) / totalAsked) * 100)
      : 0;

    const statExams = $("statExams");
    const statAverage = $("statAverage");
    const statBest = $("statBest");
    const statCorrect = $("statCorrect");
    const statIncorrect = $("statIncorrect");
    const statUnanswered = $("statUnanswered");
    const statAccuracy = $("statAccuracy");

    if (statExams) statExams.textContent = String(App.stats.examsCount || 0);
    if (statAverage) statAverage.textContent = `${average}%`;
    if (statBest) statBest.textContent = `${App.stats.bestPercent || 0}%`;
    if (statCorrect) statCorrect.textContent = String(App.stats.totalCorrect || 0);
    if (statIncorrect) statIncorrect.textContent = String(App.stats.totalIncorrect || 0);
    if (statUnanswered) statUnanswered.textContent = String(App.stats.totalUnanswered || 0);
    if (statAccuracy) statAccuracy.textContent = `${accuracy}%`;

    const mostFailed = Database.getMostFailed ? Database.getMostFailed(10) : [];
    const tbody = $("mostFailedBody");

    if (!tbody) return;

    tbody.innerHTML = "";

    if (mostFailed.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4">Aún no hay preguntas falladas registradas.</td></tr>`;
      return;
    }

    mostFailed.forEach((q) => {
      const tr = document.createElement("tr");
      const percentError = Math.round((q.failRate || 0) * 100);
      const snippet = q.stem
        ? q.stem.slice(0, 160) + (q.stem.length > 160 ? "..." : "")
        : "Sin enunciado";

      tr.innerHTML = `
        <td>${esc(snippet)}</td>
        <td>${q.asked || 0}</td>
        <td>${q.incorrect || 0}</td>
        <td>${percentError}%</td>
      `;

      tbody.appendChild(tr);
    });
  }

  function on(id, eventName, handler) {
    const el = $(id);
    if (el) el.addEventListener(eventName, handler);
  }

  function bindEvents() {
    on("btnSync", "click", () => syncRemoteBanks({ silent: false }));

    on("btnStats", "click", () => {
      renderStats();
      showSection("statsSection");
    });

    on("btnStartExam", "click", () => {
      const select = $("examCount");
      startExam(select ? select.value : 100);
    });

    on("btnStartPractice", "click", startPractice);

    on("btnPrev", "click", () => goQuestion(-1));
    on("btnNext", "click", () => goQuestion(1));
    on("btnFinalize", "click", openConfirmModal);

    on("btnCancelConfirm", "click", closeConfirmModal);
    on("btnConfirmFinalize", "click", finalizeExam);

    on("filterSelect", "change", (e) => renderFeedback(e.target.value));

    on("btnReviewIncorrect", "click", () => {
      const filterSelect = $("filterSelect");
      if (filterSelect) filterSelect.value = "incorrect";
      renderFeedback("incorrect");
    });

    on("btnNewExam", "click", () => startExam(100));
    on("btnBackHome", "click", () => showSection("setupSection"));

    on("btnCheckPractice", "click", checkPracticeAnswer);
    on("btnNextPractice", "click", nextPracticeQuestion);
    on("btnExitPractice", "click", () => showSection("setupSection"));

    on("btnCloseStats", "click", () => showSection("setupSection"));

    on("btnClearStats", "click", () => {
      const ok = confirm("¿Seguro que deseas borrar todas las estadísticas locales?");
      if (!ok) return;

      if (window.Database && Database.clearStats) {
        Database.clearStats();
      }

      renderStats();
    });
  }

  function unregisterOldServiceWorkers() {
    if ("serviceWorker" in navigator && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          registrations.forEach((registration) => {
            registration.unregister().catch(() => {});
          });
        })
        .catch(() => {});
    }
  }

  function init() {
    bindEvents();

    // Esto ayuda a evitar que un service worker viejo cache la app antigua.
    unregisterOldServiceWorkers();

    const stored = window.Database && Database.loadBank ? Database.loadBank() : null;

    if (stored && Array.isArray(stored.questions) && stored.questions.length) {
      processBank({
        questions: stored.questions
      });

      setSyncStatus("Banco local cargado. Sincronizando remoto...");
    } else {
      setSyncStatus("Buscando banco remoto...");
    }

    showSection("setupSection");

    syncRemoteBanks({ silent: true });
  }

  document.addEventListener("DOMContentLoaded", init);
})();