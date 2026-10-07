/**
 * database.js
 * Persistencia local del simulador.
 *
 * Decisión de diseño (importante):
 * - El BANCO de preguntas NO se guarda en localStorage. Con lotes grandes
 *   (cientos de ítems) el JSON serializado supera el cupo de ~5 MB del
 *   navegador y lanza QuotaExceededError. La fuente de verdad del banco son
 *   los archivos JSON remotos (GitHub); la app los relee en cada carga o al
 *   pulsar "Actualizar banco". Esto además evita restos de bancos viejos en
 *   caché (preguntas "fantasma").
 * - Las ESTADÍSTICAS sí se guardan en localStorage (ocupan pocos KB) y se
 *   protegen con try/catch por si el cupo estuviera lleno por otros datos.
 */
(function (global) {
  const STORAGE_KEYS = {
    bank: "puce_meritos_bank_v1",   // ya no se escribe; se usa solo para purgar restos viejos
    stats: "puce_meritos_stats_v1"
  };

  function safeParse(jsonString, fallback) {
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      console.warn("No se pudo parsear JSON:", e);
      return fallback;
    }
  }

  function defaultStats() {
    return {
      examsCount: 0,
      sumPercent: 0,
      bestPercent: 0,
      totalCorrect: 0,
      totalIncorrect: 0,
      totalUnanswered: 0,
      questionStats: {}
    };
  }

  const Database = {
    /* ---- BANCO: intencionalmente NO persistido en localStorage ---- */

    // Se conserva la firma por compatibilidad con app.js, pero no escribe nada.
    saveBank() {
      // no-op deliberado: el banco vive en los JSON remotos, no en caché local.
    },

    // Siempre se relanza desde remoto; no se recupera banco cacheado.
    loadBank() {
      return null;
    },

    /* ---- EXPORT / IMPORT (por si la UI llegara a usarlos) ---- */

    exportBank(questions) {
      const payload = {
        app: "Simulador Méritos y Oposición PUCE",
        version: 1,
        exportedAt: new Date().toISOString(),
        totalQuestions: (questions || []).length,
        questions: questions || []
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "banco_puce_meritos_oposicion.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },

    importBankFromFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const json = JSON.parse(reader.result);
            const questions = Array.isArray(json) ? json : json.questions;
            if (!Array.isArray(questions)) {
              reject(new Error("El JSON no contiene un arreglo de preguntas válido."));
              return;
            }
            resolve(questions);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error("No se pudo leer el archivo JSON."));
        reader.readAsText(file);
      });
    },

    /* ---- ESTADÍSTICAS: sí persistidas, con protección de cupo ---- */

    loadStats() {
      const raw = localStorage.getItem(STORAGE_KEYS.stats);
      if (!raw) return defaultStats();
      return { ...defaultStats(), ...safeParse(raw, defaultStats()) };
    },

    saveStats(stats) {
      try {
        localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
      } catch (err) {
        console.warn("No se pudieron guardar las estadísticas:", err);
        // Si el cupo está lleno, purgamos restos viejos del banco cacheado y reintentamos.
        try { localStorage.removeItem(STORAGE_KEYS.bank); } catch (_) {}
        try { localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats)); } catch (_) {}
      }
    },

    recordExam(examResult) {
      const stats = this.loadStats();

      stats.examsCount += 1;
      stats.sumPercent += examResult.percent || 0;
      stats.bestPercent = Math.max(stats.bestPercent, examResult.percent || 0);

      stats.totalCorrect += examResult.correct || 0;
      stats.totalIncorrect += examResult.incorrect || 0;
      stats.totalUnanswered += examResult.unanswered || 0;

      (examResult.questionResults || []).forEach((qr) => {
        if (!qr.id) return;
        if (!stats.questionStats[qr.id]) {
          stats.questionStats[qr.id] = {
            id: qr.id,
            stem: qr.stem || "",
            asked: 0,
            correct: 0,
            incorrect: 0
          };
        }
        const q = stats.questionStats[qr.id];
        q.asked += 1;
        if (qr.answered && qr.isCorrect) q.correct += 1;
        else if (qr.answered && !qr.isCorrect) q.incorrect += 1;
      });

      this.saveStats(stats);
      return stats;
    },

    getMostFailed(limit = 10) {
      const stats = this.loadStats();
      return Object.values(stats.questionStats || {})
        .filter((q) => q.asked > 0 && q.incorrect > 0)
        .map((q) => ({ ...q, failRate: q.incorrect / q.asked }))
        .sort((a, b) => (b.failRate !== a.failRate ? b.failRate - a.failRate : b.incorrect - a.incorrect))
        .slice(0, limit);
    },

    clearStats() {
      try { localStorage.removeItem(STORAGE_KEYS.stats); } catch (_) {}
    }
  };

  global.Database = Database;
})(window);