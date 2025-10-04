(function(){
  "use strict";
  
  const CONFIG = {
    CORRECT_FEEDBACK_DELAY: 1000,
    INCORRECT_FEEDBACK_DELAY: 600,
    SKIP_DELAY: 200,
    STRICT_TIMEOUT_SECONDS: 5,
    REQUEUE_OFFSET_MIN: 2,
    REQUEUE_OFFSET_PERCENT: 0.3,
    TROUBLE_QUEUE_MIN: 10,
    TROUBLE_QUEUE_MAX: 40,
    STORAGE_KEY: "number-drills-progress-v1",
    SETTINGS_KEY: "number-drills-settings-v1",
    THEME_KEY: "number-drills-theme",
    STATS_KEY: "number-drills-stats-v1"
  };

  const $ = sel => document.querySelector(sel);
  const randInt = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

  let audioContext = null;
  let audioInitialized = false;

  function initAudio(){
    if(audioInitialized) return;
    try{
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioInitialized = true;
    }catch(err){
      console.warn("Audio context not available:", err);
    }
  }

  function playSound(freq, duration, type, volume){
    type = type || "sine";
    volume = volume || 0.06;
    if(!audioContext) return;
    
    if(audioContext.state === "suspended"){
      audioContext.resume().catch(err => console.warn("Audio resume failed:", err));
    }
    
    try{
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.type = type;
      oscillator.frequency.value = freq;
      gainNode.gain.value = volume;
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.start();
      setTimeout(function(){
        try{ oscillator.stop(); }catch(e){}
      }, duration);
    }catch(err){
      console.warn("Sound playback failed:", err);
    }
  }

  const playDing = () => playSound(880, 120, "sine");
  const playBuzz = () => {
    playSound(160, 120, "square");
    setTimeout(() => playSound(120, 120, "square"), 100);
  };

  function applyStoredTheme(){
    try{
      const theme = localStorage.getItem(CONFIG.THEME_KEY) || "auto";
      document.documentElement.setAttribute("data-theme", theme);
    }catch(err){
      console.error("Failed to apply theme:", err);
    }
  }

  function cycleTheme(){
    const current = document.documentElement.getAttribute("data-theme") || "auto";
    const next = current === "auto" ? "light" : (current === "light" ? "dark" : "auto");
    document.documentElement.setAttribute("data-theme", next);
    try{
      localStorage.setItem(CONFIG.THEME_KEY, next);
    }catch(err){
      console.error("Failed to save theme:", err);
    }
  }

  const elements = {
    mode: $("#mode"), minN: $("#minN"), maxN: $("#maxN"),
    focusTable: $("#focusTable"), focusWrap: $("#focusWrap"),
    focusDiv: $("#focusDiv"), focusDivWrap: $("#focusDivWrap"),
    sessionSize: $("#sessionSize"),
    shuffle: $("#shuffleTables"), strict: $("#strictTiming"), sound: $("#soundToggle"),
    troubleOnly: $("#troubleOnly"),
    timedTest: $("#timedTest"), testSeconds: $("#testSeconds"),
    timedOptions: $("#timedOptions"),
    startBtn: $("#startBtn"), clearProgressBtn: $("#clearProgressBtn"),
    modeTag: $("#modeTag"), rangeTag: $("#rangeTag"),
    prompt: $("#prompt"), ans: $("#answer"), checkBtn: $("#checkBtn"), skipBtn: $("#skipBtn"),
    feedback: $("#feedback"),
    sDone: $("#statDone"), sCorrect: $("#statCorrect"), sAcc: $("#statAccuracy"), 
    sStreak: $("#statStreak"), sTime: $("#statTime"),
    troubleTags: $("#troubleTags"),
    exportBtn: $("#exportBtn"), importBtn: $("#importBtn"), importFile: $("#importFile"),
    themeToggleBtn: $("#themeToggleBtn"),
    printBlankBtn: $("#printBlankBtn"), printAnswerBtn: $("#printAnswerBtn"),
    printSquaresBlankBtn: $("#printSquaresBlankBtn"), printSquaresAnswerBtn: $("#printSquaresAnswerBtn"),
    printCubesBlankBtn: $("#printCubesBlankBtn"), printCubesAnswerBtn: $("#printCubesAnswerBtn"),
    printPrimesBlankBtn: $("#printPrimesBlankBtn"), printPrimesAnswerBtn: $("#printPrimesAnswerBtn"),
    printLayer: $("#printLayer"), gridWrap: $("#gridWrap"), 
    closePrint: $("#closePrint"), printNow: $("#printNow"),
    strictTimingLabel: $("#strictTimingLabel"),
    progressBar: $("#progressBar"),
    toggleStatsBtn: $("#toggleStatsBtn"),
    closeStatsBtn: $("#closeStatsBtn"),
    statsSection: $("#statsSection"),
    quizBox: $("#quizBox"),
    troubleSection: $("#troubleSection"),
    continueBtn: $("#continueBtn")
  };

  let session = null;
  let progress = { facts: {} };
  let statistics = { sessions: [], personalBests: {} };
  let timerRequestId = null;

  function loadProgress(){
    try{
      const data = localStorage.getItem(CONFIG.STORAGE_KEY);
      return data ? JSON.parse(data) : { facts: {} };
    }catch(err){
      console.error("Failed to load progress:", err);
      return { facts: {} };
    }
  }

  function saveProgress(data){
    try{
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    }catch(err){
      console.error("Failed to save progress:", err);
    }
  }

  function loadStatistics(){
    try{
      const data = localStorage.getItem(CONFIG.STATS_KEY);
      return data ? JSON.parse(data) : { sessions: [], personalBests: {} };
    }catch(err){
      console.error("Failed to load statistics:", err);
      return { sessions: [], personalBests: {} };
    }
  }

  function saveStatistics(data){
    try{
      localStorage.setItem(CONFIG.STATS_KEY, JSON.stringify(data));
    }catch(err){
      console.error("Failed to save statistics:", err);
    }
  }

  function recordSession(sessionData){
    const record = {
      timestamp: Date.now(),
      mode: sessionData.mode,
      minN: sessionData.minN,
      maxN: sessionData.maxN,
      done: sessionData.done,
      correct: sessionData.correct,
      accuracy: sessionData.done ? Math.round((sessionData.correct / sessionData.done) * 100) : 0,
      avgTime: sessionData.done ? Math.round(sessionData.totalAnswerTime / sessionData.done) : 0,
      bestStreak: sessionData.bestStreak,
      elapsedTime: performance.now() - sessionData.startTime
    };

    statistics.sessions.push(record);
    
    // Keep only last 50 sessions
    if(statistics.sessions.length > 50){
      statistics.sessions = statistics.sessions.slice(-50);
    }

    // Update personal bests
    const modeKey = sessionData.mode;
    if(!statistics.personalBests[modeKey]){
      statistics.personalBests[modeKey] = {
        bestAccuracy: 0,
        fastestAvg: Infinity,
        longestStreak: 0
      };
    }

    const pb = statistics.personalBests[modeKey];
    if(record.accuracy > pb.bestAccuracy) pb.bestAccuracy = record.accuracy;
    if(record.avgTime < pb.fastestAvg && record.done >= 10) pb.fastestAvg = record.avgTime;
    if(record.bestStreak > pb.longestStreak) pb.longestStreak = record.bestStreak;

    saveStatistics(statistics);
  }

  function renderStatistics(){
    renderStatsSummary();
    renderAccuracyChart();
    renderSpeedChart();
    renderOperationBreakdown();
    renderSessionHistory();
  }

  function renderStatsSummary(){
    const container = $("#statsSummary");
    if(!container) return;

    const totalSessions = statistics.sessions.length;
    const totalQuestions = statistics.sessions.reduce((sum, s) => sum + s.done, 0);
    const totalCorrect = statistics.sessions.reduce((sum, s) => sum + s.correct, 0);
    const overallAccuracy = totalQuestions ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

    const last10 = statistics.sessions.slice(-10);
    const recentAccuracy = last10.length ? 
      Math.round(last10.reduce((sum, s) => sum + s.accuracy, 0) / last10.length) : 0;

    const allStreaks = statistics.sessions.map(s => s.bestStreak);
    const bestEverStreak = allStreaks.length ? Math.max(...allStreaks) : 0;

    container.innerHTML = `
      <div class="stat-card">
        <h3>Total Sessions</h3>
        <div class="value">${totalSessions}</div>
      </div>
      <div class="stat-card">
        <h3>Questions Answered</h3>
        <div class="value">${totalQuestions}</div>
      </div>
      <div class="stat-card">
        <h3>Overall Accuracy</h3>
        <div class="value">${overallAccuracy}%</div>
      </div>
      <div class="stat-card">
        <h3>Recent Accuracy (Last 10)</h3>
        <div class="value">${recentAccuracy}%</div>
      </div>
      <div class="stat-card">
        <h3>Best Ever Streak</h3>
        <div class="value">${bestEverStreak}</div>
      </div>
    `;
  }

  function renderAccuracyChart(){
    const container = $("#accuracyChart");
    if(!container) return;

    const last10 = statistics.sessions.slice(-10);
    if(last10.length === 0){
      container.innerHTML = '<p class="tiny" style="text-align:center; padding:60px 0;">No session data yet. Complete a session to see your progress!</p>';
      return;
    }

    const maxAccuracy = 100;
    const chartHeight = 180;
    const chartWidth = container.clientWidth || 600;
    const padding = 40;
    const plotWidth = chartWidth - padding * 2;
    const plotHeight = chartHeight - padding * 2;

    const stepX = last10.length > 1 ? plotWidth / (last10.length - 1) : 0;

    let svg = '<svg width="' + chartWidth + '" height="' + chartHeight + '" style="overflow:visible;">';
    
    // Grid lines
    for(let i = 0; i <= 4; i++){
      const y = padding + (plotHeight / 4) * i;
      const value = maxAccuracy - (maxAccuracy / 4) * i;
      svg += '<line x1="' + padding + '" y1="' + y + '" x2="' + (padding + plotWidth) + '" y2="' + y + '" stroke="var(--line)" stroke-width="1" opacity="0.3"/>';
      svg += '<text x="' + (padding - 5) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + value + '%</text>';
    }

    // Line chart
    let pathData = '';
    last10.forEach((s, i) => {
      const x = padding + i * stepX;
      const y = padding + plotHeight - (s.accuracy / maxAccuracy) * plotHeight;
      pathData += (i === 0 ? 'M' : 'L') + x + ',' + y + ' ';
    });

    svg += '<path d="' + pathData + '" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';

    // Points
    last10.forEach((s, i) => {
      const x = padding + i * stepX;
      const y = padding + plotHeight - (s.accuracy / maxAccuracy) * plotHeight;
      svg += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="var(--accent)"/>';
    });

    svg += '</svg>';
    container.innerHTML = svg;
  }

  function renderSpeedChart(){
    const container = $("#speedChart");
    if(!container) return;

    const last10 = statistics.sessions.slice(-10);
    if(last10.length === 0){
      container.innerHTML = '<p class="tiny" style="text-align:center; padding:60px 0;">No session data yet.</p>';
      return;
    }

    const maxTime = Math.max(...last10.map(s => s.avgTime), 1000);
    const chartHeight = 180;
    const chartWidth = container.clientWidth || 600;
    const padding = 40;
    const plotWidth = chartWidth - padding * 2;
    const plotHeight = chartHeight - padding * 2;

    const stepX = last10.length > 1 ? plotWidth / (last10.length - 1) : 0;

    let svg = '<svg width="' + chartWidth + '" height="' + chartHeight + '" style="overflow:visible;">';
    
    // Grid lines
    for(let i = 0; i <= 4; i++){
      const y = padding + (plotHeight / 4) * i;
      const value = Math.round(maxTime - (maxTime / 4) * i);
      svg += '<line x1="' + padding + '" y1="' + y + '" x2="' + (padding + plotWidth) + '" y2="' + y + '" stroke="var(--line)" stroke-width="1" opacity="0.3"/>';
      svg += '<text x="' + (padding - 5) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + value + 'ms</text>';
    }

    // Line chart
    let pathData = '';
    last10.forEach((s, i) => {
      const x = padding + i * stepX;
      const y = padding + plotHeight - (s.avgTime / maxTime) * plotHeight;
      pathData += (i === 0 ? 'M' : 'L') + x + ',' + y + ' ';
    });

    svg += '<path d="' + pathData + '" fill="none" stroke="var(--ok)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';

    // Points
    last10.forEach((s, i) => {
      const x = padding + i * stepX;
      const y = padding + plotHeight - (s.avgTime / maxTime) * plotHeight;
      svg += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="var(--ok)"/>';
    });

    svg += '</svg>';
    container.innerHTML = svg;
  }

  function renderOperationBreakdown(){
    const container = $("#operationBreakdown");
    if(!container) return;

    const byMode = {};
    statistics.sessions.forEach(s => {
      if(!byMode[s.mode]){
        byMode[s.mode] = { total: 0, correct: 0, count: 0 };
      }
      byMode[s.mode].total += s.done;
      byMode[s.mode].correct += s.correct;
      byMode[s.mode].count++;
    });

    if(Object.keys(byMode).length === 0){
      container.innerHTML = '<p class="tiny">No data yet.</p>';
      return;
    }

    let html = '<div style="display:grid; gap:8px;">';
    Object.entries(byMode).forEach(([mode, data]) => {
      const accuracy = data.total ? Math.round((data.correct / data.total) * 100) : 0;
      const modeName = mode.charAt(0).toUpperCase() + mode.slice(1);
      html += '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:var(--input); border-radius:8px;">';
      html += '<span>' + modeName + ' (' + data.count + ' sessions)</span>';
      html += '<span style="font-weight:700; color:var(--accent);">' + accuracy + '%</span>';
      html += '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
  }

  function renderSessionHistory(){
    const tbody = $("#sessionHistory tbody");
    if(!tbody) return;

    const recent = statistics.sessions.slice(-20).reverse();
    
    if(recent.length === 0){
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">No sessions yet</td></tr>';
      return;
    }

    tbody.innerHTML = recent.map(s => {
      const date = new Date(s.timestamp).toLocaleDateString('en-GB', { 
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const modeName = s.mode.charAt(0).toUpperCase() + s.mode.slice(1);
      return '<tr>' +
        '<td>' + date + '</td>' +
        '<td>' + modeName + '</td>' +
        '<td>' + s.correct + '/' + s.done + '</td>' +
        '<td>' + s.accuracy + '%</td>' +
        '<td>' + s.avgTime + 'ms</td>' +
        '<td>' + s.bestStreak + '</td>' +
        '</tr>';
    }).join('');
  }

  function toggleStatsView(){
    const statsActive = elements.statsSection.classList.contains("active");
    
    if(statsActive){
      elements.statsSection.classList.remove("active");
      elements.quizBox.style.display = "flex";
      elements.troubleSection.style.display = "block";
      elements.toggleStatsBtn.textContent = "View Statistics";
    }else{
      elements.statsSection.classList.add("active");
      elements.quizBox.style.display = "none";
      elements.troubleSection.style.display = "none";
      elements.toggleStatsBtn.textContent = "Back to Practice";
      renderStatistics();
    }
  }

  function loadSettings(){
    try{
      const data = localStorage.getItem(CONFIG.SETTINGS_KEY);
      return data ? JSON.parse(data) : {};
    }catch(err){
      console.error("Failed to load settings:", err);
      return {};
    }
  }

  function saveSettings(){
    const settings = {
      mode: elements.mode.value,
      minN: +elements.minN.value,
      maxN: +elements.maxN.value,
      sessionSize: +elements.sessionSize.value,
      shuffle: !!elements.shuffle.checked,
      strict: !!elements.strict.checked,
      sound: !!elements.sound.checked,
      troubleOnly: !!elements.troubleOnly.checked,
      timedTest: !!elements.timedTest.checked,
      testSeconds: +elements.testSeconds.value,
      focusTable: +(elements.focusTable && elements.focusTable.value || 0),
      focusDiv: +(elements.focusDiv && elements.focusDiv.value || 0)
    };
    try{
      localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(settings));
    }catch(err){
      console.error("Failed to save settings:", err);
    }
  }

  function applyStoredSettings(){
    const settings = loadSettings();
    if(settings.mode) elements.mode.value = settings.mode;
    if(Number.isFinite(settings.minN)) elements.minN.value = settings.minN;
    if(Number.isFinite(settings.maxN)) elements.maxN.value = settings.maxN;
    if(Number.isFinite(settings.sessionSize)) elements.sessionSize.value = settings.sessionSize;
    if("shuffle" in settings) elements.shuffle.checked = settings.shuffle;
    if("strict" in settings) elements.strict.checked = settings.strict;
    if("sound" in settings) elements.sound.checked = settings.sound;
    if("troubleOnly" in settings) elements.troubleOnly.checked = settings.troubleOnly;
    if("timedTest" in settings) elements.timedTest.checked = settings.timedTest;
    if(Number.isFinite(settings.testSeconds)) elements.testSeconds.value = settings.testSeconds;
    if(Number.isFinite(settings.focusTable) && elements.focusTable) elements.focusTable.value = settings.focusTable;
    if(Number.isFinite(settings.focusDiv) && elements.focusDiv) elements.focusDiv.value = settings.focusDiv;
  }

  function generateMultiplication(minN, maxN){
    const a = randInt(minN, maxN);
    const b = randInt(minN, maxN);
    return { text: a + " × " + b, answer: a*b, key: a + "x" + b };
  }

  function generateDivision(minN, maxN){
    const divisor = randInt(Math.max(1, minN), maxN);
    const result = randInt(minN, maxN);
    const dividend = divisor * result;
    return { text: dividend + " ÷ " + divisor, answer: result, key: dividend + "d" + divisor };
  }

  function generateSquare(minN, maxN){
    const n = randInt(minN, maxN);
    return { text: n + "²", answer: n*n, key: "sq" + n };
  }

  function generateCube(minN, maxN){
    const n = randInt(minN, maxN);
    return { text: n + "³", answer: n*n*n, key: "cu" + n };
  }

  function generateSqrt(minN, maxN){
    const n = randInt(minN, maxN);
    return { text: "√" + (n*n), answer: n, key: "rt2_" + n };
  }

  function generateCbrt(minN, maxN){
    const n = randInt(minN, maxN);
    return { text: "∛" + (n*n*n), answer: n, key: "rt3_" + n };
  }

  function generateFractionOfNumber(minN, maxN){
    const denominator = randInt(2, Math.max(2, maxN));
    const numerator = randInt(1, denominator - 1);
    const multiplier = randInt(1, Math.max(1, Math.floor(maxN/2)));
    const number = denominator * multiplier;
    return { 
      text: numerator + "⁄" + denominator + " of " + number, 
      answer: (numerator/denominator) * number, 
      key: "frac" + numerator + "/" + denominator + "_" + number
    };
  }

  function generatePercentage(minN, maxN){
    const percentages = [1, 5, 10, 20, 25, 50, 75];
    const percentage = percentages[randInt(0, percentages.length - 1)];
    const multipliers = [2, 4, 5, 10];
    const value = randInt(minN, maxN) * multipliers[randInt(0, multipliers.length - 1)];
    return { 
      text: percentage + "% of " + value, 
      answer: (percentage/100) * value, 
      key: "pct" + percentage + "_" + value
    };
  }

  function generateExplanation(item, mode){
    // Parse the question to extract values
    const text = item.text;
    const answer = item.answer;
    
    if(mode === "multiplication" || item.key.includes("x")){
      const parts = item.key.split("x").map(Number);
      const a = parts[0], b = parts[1];
      
      if(a <= 12 && b <= 12){
        // Simple multiplication tricks
        if(a === 9 || b === 9){
          const other = a === 9 ? b : a;
          return "Trick: " + other + " × 9 = " + other + " × (10 - 1) = " + (other * 10) + " - " + other + " = " + answer;
        }
        if(a === 11 || b === 11){
          const other = a === 11 ? b : a;
          if(other < 10){
            return "Trick: " + other + " × 11 = " + other + "" + other + " (repeat the digit)";
          }
        }
      }
      
      // Break down using factors
      if(a % 2 === 0 && a <= 20){
        const half = a / 2;
        return "Break it down: " + a + " × " + b + " = (" + half + " × 2) × " + b + " = " + half + " × " + (b * 2) + " = " + answer;
      }
      
      return "Think: " + a + " × " + b + " = " + answer;
    }
    
    if(mode === "division" || item.key.includes("d")){
      const parts = item.key.split("d").map(Number);
      const dividend = parts[0], divisor = parts[1];
      return "Think: " + divisor + " × ? = " + dividend + ". Answer: " + divisor + " × " + answer + " = " + dividend;
    }
    
    if(mode === "squares" || item.key.startsWith("sq")){
      const n = +item.key.slice(2);
      return "Remember: " + n + "² = " + n + " × " + n + " = " + answer;
    }
    
    if(mode === "cubes" || item.key.startsWith("cu")){
      const n = +item.key.slice(2);
      const squared = n * n;
      return "Remember: " + n + "³ = " + n + " × " + n + " × " + n + " = " + squared + " × " + n + " = " + answer;
    }
    
    if(mode === "sqrt" || item.key.startsWith("rt2_")){
      const n = answer;
      return "Think: What number times itself = " + (n * n) + "? Answer: " + n + " × " + n + " = " + (n * n);
    }
    
    if(mode === "cbrt" || item.key.startsWith("rt3_")){
      const n = answer;
      return "Think: What number cubed = " + (n * n * n) + "? Answer: " + n + "³ = " + (n * n * n);
    }
    
    if(mode === "fractions" || item.key.startsWith("frac")){
      const match = item.key.match(/^frac(\d+)\/(\d+)_([\d.]+)$/);
      if(match){
        const num = +match[1], denom = +match[2], val = +match[3];
        const step1 = val / denom;
        return "Step 1: " + val + " ÷ " + denom + " = " + step1 + ". Step 2: " + step1 + " × " + num + " = " + answer;
      }
    }
    
    if(mode === "percentages" || item.key.startsWith("pct")){
      const parts = item.key.slice(3).split("_").map(Number);
      if(parts.length === 2){
        const pct = parts[0], val = parts[1];
        
        // Common percentage shortcuts
        if(pct === 50){
          return "Shortcut: 50% = half. " + val + " ÷ 2 = " + answer;
        }
        if(pct === 25){
          return "Shortcut: 25% = ¼. " + val + " ÷ 4 = " + answer;
        }
        if(pct === 10){
          return "Shortcut: 10% = divide by 10. " + val + " ÷ 10 = " + answer;
        }
        if(pct === 1){
          return "Shortcut: 1% = divide by 100. " + val + " ÷ 100 = " + answer;
        }
        if(pct === 5){
          const ten = val / 10;
          return "Shortcut: 5% = half of 10%. 10% of " + val + " = " + ten + ", so 5% = " + ten + " ÷ 2 = " + answer;
        }
        
        return "Method: " + pct + "% of " + val + " = (" + pct + " ÷ 100) × " + val + " = " + answer;
      }
    }
    
    return "The answer is " + answer;
  }

  const GENERATORS = {
    multiplication: generateMultiplication,
    division: generateDivision,
    squares: generateSquare,
    cubes: generateCube,
    sqrt: generateSqrt,
    cbrt: generateCbrt,
    fractions: generateFractionOfNumber,
    percentages: generatePercentage
  };

  function generateQuestion(mode, minN, maxN, focusMultiplier, focusDivisor){
    if(mode === "mixed"){
      const modes = Object.keys(GENERATORS);
      const randomMode = modes[randInt(0, modes.length - 1)];
      return GENERATORS[randomMode](minN, maxN);
    }
    
    if(mode === "multiplication" && focusMultiplier > 0){
      const b = randInt(minN, maxN);
      return { 
        text: focusMultiplier + " × " + b, 
        answer: focusMultiplier * b, 
        key: focusMultiplier + "x" + b
      };
    }
    
    if(mode === "division" && focusDivisor > 0){
      const result = randInt(minN, maxN);
      const dividend = focusDivisor * result;
      return { 
        text: dividend + " ÷ " + focusDivisor, 
        answer: result, 
        key: dividend + "d" + focusDivisor
      };
    }
    
    return GENERATORS[mode](minN, maxN);
  }

  function createSessionIdentifier(mode, minN, maxN, focusMultiplier, focusDivisor){
    let id = mode + ":" + minN + "-" + maxN;
    if(mode === "multiplication" && focusMultiplier > 0) id += ":ft=" + focusMultiplier;
    if(mode === "division" && focusDivisor > 0) id += ":fd=" + focusDivisor;
    return id;
  }

  function createQueue(mode, minN, maxN, size, focusMultiplier, focusDivisor){
    const queue = [];
    for(let i = 0; i < size; i++){
      queue.push(generateQuestion(mode, minN, maxN, focusMultiplier, focusDivisor));
    }
    return queue;
  }

  function createTroubleQueue(mode, minN, maxN, size, focusMultiplier, focusDivisor){
    const id = createSessionIdentifier(mode, minN, maxN, focusMultiplier, focusDivisor);
    const facts = progress.facts[id] || {};
    const troubleEntries = Object.entries(facts)
      .filter(function(entry){ return entry[1].wrongCount > 0; })
      .sort(function(a, b){ return (b[1].wrongCount - a[1].wrongCount) || (b[1].lastSeen - a[1].lastSeen); });
    
    if(troubleEntries.length === 0) return null;
    
    const topTroubleKeys = troubleEntries
      .slice(0, Math.max(CONFIG.TROUBLE_QUEUE_MIN, Math.min(size, CONFIG.TROUBLE_QUEUE_MAX)))
      .map(function(entry){ return entry[0]; });
    
    const queue = [];
    for(let i = 0; i < size; i++){
      const key = topTroubleKeys[i % topTroubleKeys.length];
      queue.push(reconstructQuestionFromKey(key));
    }
    return queue;
  }

  function reconstructQuestionFromKey(key){
    if(key.startsWith("sq")){
      const n = +key.slice(2);
      return { text: n + "²", answer: n*n, key: key };
    }
    if(key.startsWith("cu")){
      const n = +key.slice(2);
      return { text: n + "³", answer: n*n*n, key: key };
    }
    if(key.startsWith("rt2_")){
      const n = +key.split("_")[1];
      return { text: "√" + (n*n), answer: n, key: key };
    }
    if(key.startsWith("rt3_")){
      const n = +key.split("_")[1];
      return { text: "∛" + (n*n*n), answer: n, key: key };
    }
    if(key.includes("x")){
      const parts = key.split("x").map(Number);
      const a = parts[0], b = parts[1];
      return { text: a + " × " + b, answer: a*b, key: key };
    }
    if(key.includes("d")){
      const parts = key.split("d").map(Number);
      const a = parts[0], b = parts[1];
      return { text: a + " ÷ " + b, answer: a/b, key: key };
    }
    if(key.startsWith("frac")){
      const match = key.match(/^frac(\d+)\/(\d+)_([\d.]+)$/);
      if(match){
        const num = +match[1], denom = +match[2], val = +match[3];
        return { text: num + "⁄" + denom + " of " + val, answer: (num/denom)*val, key: key };
      }
    }
    if(key.startsWith("pct")){
      const parts = key.slice(3).split("_").map(Number);
      if(parts.length === 2){
        const pct = parts[0], val = parts[1];
        return { text: pct + "% of " + val, answer: (pct/100)*val, key: key };
      }
    }
    
    return generateQuestion(elements.mode.value, +elements.minN.value, +elements.maxN.value, 
      +(elements.focusTable && elements.focusTable.value || 0), +(elements.focusDiv && elements.focusDiv.value || 0));
  }

  function shuffleArray(array){
    for(let i = array.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
  }

  function requeueWrongAnswer(queue, item){
    const offset = Math.min(
      queue.length,
      Math.max(
        CONFIG.REQUEUE_OFFSET_MIN,
        Math.round(queue.length * CONFIG.REQUEUE_OFFSET_PERCENT)
      )
    );
    const position = randInt(offset, queue.length);
    queue.splice(position, 0, item);
  }

  function setInputsEnabled(enabled){
    elements.ans.disabled = !enabled;
    elements.checkBtn.disabled = !enabled;
    elements.skipBtn.disabled = !enabled;
  }

  function updateModeTags(){
    const mode = elements.mode.value;
    const minN = +elements.minN.value;
    const maxN = +elements.maxN.value;
    const focusMultiplier = +(elements.focusTable && elements.focusTable.value || 0);
    const focusDivisor = +(elements.focusDiv && elements.focusDiv.value || 0);
    
    let modeText = mode.charAt(0).toUpperCase() + mode.slice(1);
    if(mode === "multiplication" && focusMultiplier > 0) modeText += " (×" + focusMultiplier + ")";
    if(mode === "division" && focusDivisor > 0) modeText += " (÷" + focusDivisor + ")";
    
    elements.modeTag.textContent = "Mode: " + modeText;
    elements.rangeTag.textContent = "Range: " + minN + "-" + maxN;
  }

  function updateStatistics(){
    if(!session){
      elements.sDone.textContent = "0";
      elements.sCorrect.textContent = "0";
      elements.sAcc.textContent = "0%";
      elements.sStreak.textContent = "0";
      elements.sTime.textContent = "—";
      elements.progressBar.style.width = "0%";
      return;
    }

    const done = session.done;
    const correct = session.correct;
    const accuracy = done ? Math.round((correct / done) * 100) : 0;
    
    const remaining = session.queue.length + (session.current ? 1 : 0);
    const total = done + remaining;
    const progressPercent = total ? Math.round((done / total) * 100) : 0;
    
    elements.progressBar.style.width = progressPercent + "%";
    elements.progressBar.setAttribute("aria-valuenow", String(progressPercent));
    
    elements.sDone.textContent = done;
    elements.sCorrect.textContent = correct;
    elements.sAcc.textContent = accuracy + "%";
    elements.sStreak.textContent = session.streak;
    
    if(session.timerEnd){
      const secondsLeft = Math.max(0, Math.ceil((session.timerEnd - performance.now()) / 1000));
      elements.sTime.textContent = secondsLeft + "s";
    }else{
      elements.sTime.textContent = "—";
    }
  }

  function formatQuestionKey(key){
    if(key.startsWith("sq")) return key.slice(2) + "²";
    if(key.startsWith("cu")) return key.slice(2) + "³";
    if(key.startsWith("rt2_")){
      const n = key.split("_")[1];
      return "√" + (n*n);
    }
    if(key.startsWith("rt3_")){
      const n = key.split("_")[1];
      return "∛" + (n*n*n);
    }
    if(key.includes("x")){
      const parts = key.split("x");
      return parts[0] + "×" + parts[1];
    }
    if(key.includes("d")){
      const parts = key.split("d");
      return parts[0] + "÷" + parts[1];
    }
    if(key.startsWith("frac")){
      const match = key.match(/^frac(\d+)\/(\d+)_([\d.]+)$/);
      if(match) return match[1] + "⁄" + match[2] + " of " + match[3];
    }
    if(key.startsWith("pct")){
      const parts = key.slice(3).split("_");
      if(parts.length === 2) return parts[0] + "% of " + parts[1];
    }
    return key;
  }

  function renderTroubleTags(){
    const id = createSessionIdentifier(
      elements.mode.value,
      +elements.minN.value,
      +elements.maxN.value,
      +(elements.focusTable && elements.focusTable.value || 0),
      +(elements.focusDiv && elements.focusDiv.value || 0)
    );
    
    const facts = progress.facts[id] || {};
    const troubleEntries = Object.entries(facts)
      .filter(function(entry){ return entry[1].wrongCount > 0; })
      .sort(function(a,b){ return (b[1].wrongCount - a[1].wrongCount) || (b[1].lastSeen - a[1].lastSeen); });
    
    elements.troubleTags.innerHTML = "";
    
    if(troubleEntries.length === 0){
      const span = document.createElement("span");
      span.textContent = "No mistakes yet in this range.";
      span.className = "tiny";
      elements.troubleTags.appendChild(span);
      return;
    }
    
    troubleEntries.forEach(function(entry){
      const key = entry[0];
      const data = entry[1];
      const tag = document.createElement("span");
      tag.className = "tag linklike";
      tag.textContent = formatQuestionKey(key) + " ×" + data.wrongCount;
      tag.title = "Focus this fact in a short session";
      tag.onclick = function(){ startFocusedSession([key], 12); };
      elements.troubleTags.appendChild(tag);
    });
  }

  function startSession(){
    const mode = elements.mode.value;
    let minN = +elements.minN.value;
    let maxN = +elements.maxN.value;
    
    if(minN > maxN){
      const temp = minN;
      minN = maxN;
      maxN = temp;
      elements.minN.value = minN;
      elements.maxN.value = maxN;
    }
    
    minN = clamp(minN, 0, 999);
    maxN = clamp(maxN, 1, 999);
    const size = clamp(+elements.sessionSize.value, 5, 500);
    
    const focusMultiplier = +(elements.focusTable && elements.focusTable.value || 0);
    const focusDivisor = +(elements.focusDiv && elements.focusDiv.value || 0);
    
    let queue = null;
    
    if(elements.troubleOnly.checked){
      queue = createTroubleQueue(mode, minN, maxN, size, focusMultiplier, focusDivisor);
      if(!queue){
        alert("No trouble facts found. Starting a normal session instead.");
      }
    }
    
    if(!queue){
      queue = createQueue(mode, minN, maxN, size, focusMultiplier, focusDivisor);
    }
    
    if(elements.shuffle.checked){
      shuffleArray(queue);
    }
    
    session = {
      mode: mode,
      minN: minN,
      maxN: maxN,
      focusTable: focusMultiplier,
      focusDiv: focusDivisor,
      queue: queue,
      current: null,
      done: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
      totalAnswerTime: 0,
      questionStartTime: null,
      startTime: performance.now(),
      strict: elements.strict.checked,
      timerEnd: elements.timedTest.checked 
        ? performance.now() + (clamp(+elements.testSeconds.value, 15, 1800) * 1000) 
        : null,
      deadline: null
    };
    
    nextQuestion();
    updateStatistics();
    updateModeTags();
    renderTroubleTags();
    setInputsEnabled(true);
    elements.feedback.textContent = "";
    
    if(timerRequestId){
      cancelAnimationFrame(timerRequestId);
      timerRequestId = null;
    }
    
    if(session.timerEnd){
      tickTimer();
    }
  }

  function startFocusedSession(keys, size){
    size = size || 10;
    const queue = [];
    for(let i = 0; i < size; i++){
      const key = keys[i % keys.length];
      queue.push(reconstructQuestionFromKey(key));
    }
    
    session = {
      mode: elements.mode.value,
      minN: +elements.minN.value,
      maxN: +elements.maxN.value,
      focusTable: 0,
      focusDiv: 0,
      queue: queue,
      current: null,
      done: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
      totalAnswerTime: 0,
      questionStartTime: null,
      startTime: performance.now(),
      strict: elements.strict.checked,
      timerEnd: null,
      deadline: null
    };
    
    nextQuestion();
    updateStatistics();
    updateModeTags();
    setInputsEnabled(true);
    elements.feedback.textContent = "Focused session on tricky facts.";
  }

  function nextQuestion(){
    if(!session || session.queue.length === 0){
      session.current = null;
      updateStatistics();
      endSession("Session complete! Great work.");
      return;
    }
    
    if(session.timerEnd && performance.now() >= session.timerEnd){
      session.current = null;
      updateStatistics();
      endSession("Time! Timed test finished.");
      return;
    }
    
    session.current = session.queue.shift();
    elements.prompt.innerHTML = session.current.text;
    elements.ans.value = "";
    elements.ans.classList.remove("correct-flash", "incorrect-flash", "error");
    elements.ans.focus();
    elements.feedback.textContent = "";
    elements.feedback.className = "feedback tiny";
    
    session.deadline = session.strict 
      ? performance.now() + (CONFIG.STRICT_TIMEOUT_SECONDS * 1000) 
      : null;
    session.questionStartTime = performance.now();
  }

  function endSession(message){
    elements.prompt.textContent = message;
    setInputsEnabled(false);
    
    if(session && session.timerEnd){
      elements.sTime.textContent = "0s";
    }
    
    if(timerRequestId){
      cancelAnimationFrame(timerRequestId);
      timerRequestId = null;
    }
    
    if(!session) return;
    
    const done = session.done;
    const correct = session.correct;
    const accuracy = done ? Math.round((correct / done) * 100) : 0;
    const elapsedMs = performance.now() - session.startTime;
    const avgMs = done ? Math.round(session.totalAnswerTime / done) : 0;
    const questionsPerMinute = done ? Math.round((done / Math.max(1, elapsedMs)) * 60000) : 0;
    const bestStreak = session.bestStreak;
    
    elements.feedback.innerHTML = "Score: <strong>" + correct + "/" + done + "</strong> (" + accuracy + "%). " +
      "Avg: <strong>" + avgMs + "ms</strong> • QPM: <strong>" + questionsPerMinute + "</strong> • " +
      "Best streak: <strong>" + bestStreak + "</strong>.";
    
    // Record session to statistics
    if(done >= 5){
      recordSession(session);
    }
  }

  function recordProgress(isCorrect, item){
    const id = createSessionIdentifier(
      session.mode,
      session.minN,
      session.maxN,
      session.focusTable || 0,
      session.focusDiv || 0
    );
    
    if(!progress.facts[id]){
      progress.facts[id] = {};
    }
    
    if(!progress.facts[id][item.key]){
      progress.facts[id][item.key] = { wrongCount: 0, lastSeen: 0 };
    }
    
    progress.facts[id][item.key].lastSeen = Date.now();
    
    if(!isCorrect){
      progress.facts[id][item.key].wrongCount++;
    }
    
    saveProgress(progress);
  }

  function validateAnswer(input){
    const trimmed = input.trim().replace(",", ".");
    if(trimmed === "") return { valid: false, value: null, error: "Please enter an answer" };
    
    const parsed = parseFloat(trimmed);
    if(!Number.isFinite(parsed)){
      return { valid: false, value: null, error: "Invalid number" };
    }
    
    return { valid: true, value: parsed, error: null };
  }

  function checkAnswer(){
    if(!session || !session.current) return;
    
    if(!audioInitialized){
      initAudio();
    }
    
    const validation = validateAnswer(elements.ans.value);
    
    if(!validation.valid){
      elements.ans.classList.add("error");
      elements.feedback.textContent = validation.error;
      elements.feedback.className = "feedback no";
      return;
    }
    
    const item = session.current;
    session.current = null;
    
    const timedOut = session.deadline && performance.now() > session.deadline;
    const isCorrect = !timedOut && Math.abs(validation.value - item.answer) < 1e-9;
    
    session.done++;
    
    if(session.questionStartTime){
      session.totalAnswerTime += (performance.now() - session.questionStartTime);
    }
    
    if(isCorrect){
      session.correct++;
      session.streak++;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
      elements.feedback.textContent = "Correct!";
      elements.feedback.className = "feedback ok";
      elements.ans.classList.add("correct-flash");
      if(elements.sound.checked) playDing();
      recordProgress(isCorrect, item);
      updateStatistics();
      setTimeout(nextQuestion, CONFIG.CORRECT_FEEDBACK_DELAY);
    }else{
      session.streak = 0;
      const displayMessage = timedOut ? "Time!" : "Nope";
      const explanation = generateExplanation(item, session.mode);
      elements.feedback.innerHTML = displayMessage + ". Answer: <strong>" + item.answer + "</strong><br><span style='color:var(--muted); font-size:0.9em;'>" + explanation + "</span>";
      elements.feedback.className = "feedback no";
      elements.ans.classList.add("incorrect-flash");
      if(elements.sound.checked) playBuzz();
      requeueWrongAnswer(session.queue, item);
      recordProgress(isCorrect, item);
      updateStatistics();
      
      // Show continue button and disable inputs
      elements.checkBtn.style.display = "none";
      elements.skipBtn.style.display = "none";
      elements.continueBtn.style.display = "inline-block";
      elements.ans.disabled = true;
      
      // Add prompt to feedback
      const continuePrompt = document.createElement("div");
      continuePrompt.style.marginTop = "8px";
      continuePrompt.style.fontSize = "0.85em";
      continuePrompt.style.color = "var(--muted)";
      continuePrompt.textContent = "Press Enter or click Continue when ready";
      elements.feedback.appendChild(continuePrompt);
    }
  }

  function continueAfterWrong(){
    elements.continueBtn.style.display = "none";
    elements.checkBtn.style.display = "inline-block";
    elements.skipBtn.style.display = "inline-block";
    elements.ans.disabled = false;
    nextQuestion();
  }

  function skipQuestion(){
    if(!session || !session.current) return;
    
    const current = session.current;
    session.current = null;
    
    requeueWrongAnswer(session.queue, current);
    session.streak = 0;
    
    elements.feedback.textContent = "Skipped. We'll revisit.";
    elements.feedback.className = "feedback tiny";
    
    updateStatistics();
    setTimeout(nextQuestion, CONFIG.SKIP_DELAY);
  }

  function tickTimer(){
    updateStatistics();
    
    if(session && session.timerEnd && performance.now() < session.timerEnd){
      timerRequestId = requestAnimationFrame(tickTimer);
    }else if(session && session.timerEnd){
      endSession("Time! Timed test finished.");
    }
  }

  function exportProgress(){
    try{
      const data = JSON.stringify(progress, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      link.href = url;
      link.download = "number-drills-progress-" + timestamp + ".json";
      link.click();
      URL.revokeObjectURL(url);
    }catch(err){
      console.error("Export failed:", err);
      alert("Failed to export progress");
    }
  }

  function importProgressFromFile(file){
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = function(){
      try{
        const imported = JSON.parse(reader.result);
        progress = imported;
        saveProgress(progress);
        renderTroubleTags();
        alert("Progress imported successfully");
      }catch(err){
        console.error("Import failed:", err);
        alert("Could not read file: " + err.message);
      }
    };
    reader.onerror = function(){
      alert("Failed to read file");
    };
    reader.readAsText(file);
  }

  function buildTimesTable(withAnswers){
    const size = 20;
    const table = document.createElement("table");
    table.className = "grid";
    
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const topLeft = document.createElement("th");
    topLeft.textContent = "×";
    headerRow.appendChild(topLeft);
    
    for(let j = 1; j <= size; j++){
      const th = document.createElement("th");
      th.textContent = j;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement("tbody");
    for(let i = 1; i <= size; i++){
      const row = document.createElement("tr");
      const rowHeader = document.createElement("th");
      rowHeader.textContent = i;
      row.appendChild(rowHeader);
      
      for(let j = 1; j <= size; j++){
        const td = document.createElement("td");
        if(i === j) td.classList.add("perfect-square");
        if(withAnswers){
          td.textContent = i * j;
        }else{
          td.classList.add("blank");
        }
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    
    return table;
  }

  function buildSquaresTable(withAnswers){
    const table = document.createElement("table");
    table.className = "grid";
    
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const headers = ["n", "n²"];
    headers.forEach(function(text){
      const th = document.createElement("th");
      th.textContent = text;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement("tbody");
    for(let i = 1; i <= 15; i++){
      const row = document.createElement("tr");
      
      const tdN = document.createElement("td");
      tdN.textContent = i;
      row.appendChild(tdN);
      
      const tdSquare = document.createElement("td");
      if(withAnswers){
        tdSquare.textContent = i * i;
        tdSquare.classList.add("highlight");
      }else{
        tdSquare.classList.add("blank");
      }
      row.appendChild(tdSquare);
      
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    
    return table;
  }

  function buildCubesTable(withAnswers){
    const table = document.createElement("table");
    table.className = "grid";
    
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const headers = ["n", "n³"];
    headers.forEach(function(text){
      const th = document.createElement("th");
      th.textContent = text;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement("tbody");
    for(let i = 1; i <= 10; i++){
      const row = document.createElement("tr");
      
      const tdN = document.createElement("td");
      tdN.textContent = i;
      row.appendChild(tdN);
      
      const tdCube = document.createElement("td");
      if(withAnswers){
        tdCube.textContent = i * i * i;
        tdCube.classList.add("highlight");
      }else{
        tdCube.classList.add("blank");
      }
      row.appendChild(tdCube);
      
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    
    return table;
  }

  function buildPrimesTable(withAnswers){
    const table = document.createElement("table");
    table.className = "grid";
    
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = "1-100";
    th.colSpan = 10;
    headerRow.appendChild(th);
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const primes = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]);
    
    const tbody = document.createElement("tbody");
    let num = 1;
    for(let r = 0; r < 10; r++){
      const row = document.createElement("tr");
      for(let c = 0; c < 10; c++){
        const td = document.createElement("td");
        td.textContent = num;
        if(withAnswers && primes.has(num)){
          td.classList.add("highlight");
        }
        row.appendChild(td);
        num++;
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    
    return table;
  }

  function openPrintLayer(title, tableBuilder, withAnswers){
    elements.gridWrap.innerHTML = "";
    
    const h2 = document.createElement("h2");
    h2.textContent = title;
    elements.gridWrap.appendChild(h2);
    elements.gridWrap.appendChild(tableBuilder(withAnswers));
    
    elements.printLayer.classList.add("active");
    elements.printLayer.setAttribute("aria-hidden", "false");
  }

  function closePrintLayer(){
    elements.printLayer.classList.remove("active");
    elements.printLayer.setAttribute("aria-hidden", "true");
  }

  function toggleTimedOptions(){
    elements.timedOptions.hidden = !elements.timedTest.checked;
  }

  function toggleFocusVisibility(){
    const mode = elements.mode.value;
    if(elements.focusWrap){
      elements.focusWrap.classList.toggle("hidden", mode !== "multiplication");
    }
    if(elements.focusDivWrap){
      elements.focusDivWrap.classList.toggle("hidden", mode !== "division");
    }
  }

  function handleSettingsChange(){
    updateModeTags();
    renderTroubleTags();
    saveSettings();
    toggleTimedOptions();
    toggleFocusVisibility();
  }

  function handleKeyDown(event){
    const isInputFocused = document.activeElement === elements.ans;
    
    if(event.key === "Enter"){
      event.preventDefault();
      // If continue button is visible, use it instead of check
      if(elements.continueBtn && elements.continueBtn.style.display !== "none"){
        continueAfterWrong();
      }else{
        checkAnswer();
      }
    }else if(event.key.toLowerCase() === "n" && !isInputFocused){
      event.preventDefault();
      skipQuestion();
    }
  }

  function bindEvents(){
    if(elements.startBtn){
      elements.startBtn.addEventListener("click", startSession);
    }
    
    if(elements.clearProgressBtn){
      elements.clearProgressBtn.addEventListener("click", function(){
        if(confirm("Clear all local progress? This cannot be undone.")){
          progress = { facts: {} };
          saveProgress(progress);
          renderTroubleTags();
          alert("Progress cleared");
        }
      });
    }
    
    const settingsInputs = [
      "mode", "minN", "maxN", "sessionSize", "shuffleTables", 
      "strictTiming", "soundToggle", "troubleOnly", "timedTest", 
      "testSeconds", "focusTable", "focusDiv"
    ];
    settingsInputs.forEach(function(id){
      const element = document.getElementById(id);
      if(element){
        element.addEventListener("change", handleSettingsChange);
      }
    });
    
    document.addEventListener("keydown", handleKeyDown);
    
    if(elements.checkBtn){
      elements.checkBtn.addEventListener("click", checkAnswer);
    }
    if(elements.skipBtn){
      elements.skipBtn.addEventListener("click", skipQuestion);
    }
    
    if(elements.exportBtn){
      elements.exportBtn.addEventListener("click", exportProgress);
    }
    if(elements.importBtn){
      elements.importBtn.addEventListener("click", function(){
        if(elements.importFile) elements.importFile.click();
      });
    }
    if(elements.importFile){
      elements.importFile.addEventListener("change", function(event){
        const file = event.target.files && event.target.files[0];
        if(file) importProgressFromFile(file);
      });
    }
    
    if(elements.themeToggleBtn){
      elements.themeToggleBtn.addEventListener("click", cycleTheme);
    }
    
    if(elements.printBlankBtn){
      elements.printBlankBtn.addEventListener("click", function(){
        openPrintLayer("Times Table 20×20 (Practice Sheet)", buildTimesTable, false);
      });
    }
    if(elements.printAnswerBtn){
      elements.printAnswerBtn.addEventListener("click", function(){
        openPrintLayer("Times Table 20×20 (Answers)", buildTimesTable, true);
      });
    }
    
    if(elements.printSquaresBlankBtn){
      elements.printSquaresBlankBtn.addEventListener("click", function(){
        openPrintLayer("Squares 1-15 (Practice Sheet)", buildSquaresTable, false);
      });
    }
    if(elements.printSquaresAnswerBtn){
      elements.printSquaresAnswerBtn.addEventListener("click", function(){
        openPrintLayer("Squares 1-15 (Answers)", buildSquaresTable, true);
      });
    }
    
    if(elements.printCubesBlankBtn){
      elements.printCubesBlankBtn.addEventListener("click", function(){
        openPrintLayer("Cubes 1-10 (Practice Sheet)", buildCubesTable, false);
      });
    }
    if(elements.printCubesAnswerBtn){
      elements.printCubesAnswerBtn.addEventListener("click", function(){
        openPrintLayer("Cubes 1-10 (Answers)", buildCubesTable, true);
      });
    }
    
    if(elements.printPrimesBlankBtn){
      elements.printPrimesBlankBtn.addEventListener("click", function(){
        openPrintLayer("Primes ≤100 (Practice Sheet)", buildPrimesTable, false);
      });
    }
    if(elements.printPrimesAnswerBtn){
      elements.printPrimesAnswerBtn.addEventListener("click", function(){
        openPrintLayer("Primes ≤100 (Answers)", buildPrimesTable, true);
      });
    }
    
    if(elements.closePrint){
      elements.closePrint.addEventListener("click", closePrintLayer);
    }
    if(elements.printNow){
      elements.printNow.addEventListener("click", function(){ window.print(); });
    }
    
    if(elements.timedTest){
      elements.timedTest.addEventListener("change", toggleTimedOptions);
    }

    if(elements.toggleStatsBtn){
      elements.toggleStatsBtn.addEventListener("click", toggleStatsView);
    }
    if(elements.closeStatsBtn){
      elements.closeStatsBtn.addEventListener("click", toggleStatsView);
    }
    if(elements.checkBtn){
      elements.checkBtn.addEventListener("click", checkAnswer);
    }
    if(elements.continueBtn){
      elements.continueBtn.addEventListener("click", continueAfterWrong);
    }
    if(elements.skipBtn){
      elements.skipBtn.addEventListener("click", skipQuestion);
    }
  }

  function initialize(){
    progress = loadProgress();
    statistics = loadStatistics();
    
    applyStoredTheme();
    applyStoredSettings();
    
    bindEvents();
    
    updateModeTags();
    renderTroubleTags();
    toggleTimedOptions();
    toggleFocusVisibility();
    
    if(elements.strictTimingLabel){
      elements.strictTimingLabel.textContent = "Time limit (" + CONFIG.STRICT_TIMEOUT_SECONDS + "s)";
    }
    
    document.addEventListener("pointerdown", initAudio, { once: true });
    document.addEventListener("keydown", initAudio, { once: true });
  }

  window.addEventListener("beforeunload", function(){
    if(timerRequestId){
      cancelAnimationFrame(timerRequestId);
    }
  });

  initialize();

  // Register service worker for PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('./service-worker.js')
        .then(function(registration) {
          console.log('ServiceWorker registered successfully:', registration.scope);
        })
        .catch(function(error) {
          console.log('ServiceWorker registration failed:', error);
        });
    });
  }
})();
