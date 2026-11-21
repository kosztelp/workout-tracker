const { createApp, ref, reactive, computed, watch, onMounted, onUnmounted } = Vue;

// ================== Konstansok ==================
const STORAGE_KEY = 'workout-tracker-data';           // edzések (tömb – régi formátummal kompatibilis)
const SETTINGS_KEY = 'workout-tracker-settings';
const TEMPLATES_KEY = 'workout-tracker-templates';
const THEME_KEY = 'workout-tracker-theme';            // külön, hogy a <head> már betöltéskor olvassa
const DEFAULT_TAGS = ['Mell', 'Váll', 'Tricepsz', 'Bicepsz', 'Hát', 'Láb', 'Has', 'Kardió'];
const BACKUP_DAYS = 14;
const DAY = 86400000;

const generateId = () =>
  (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).substring(2, 11);

// ================== Dátum (helyi idő!) ==================
const pad = n => String(n).padStart(2, '0');
const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => toDateStr(new Date());
const parseLocalDate = s => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const isValidDateStr = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const num = v => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const round1 = n => Math.round(n * 10) / 10;
const nameKey = s => String(s || '').trim().toLowerCase();

// ================== Normalizálás ==================
const normalizePart = p => ({
  id: (p && p.id) || generateId(),
  weight: p && p.weight != null ? p.weight : '',
  reps: p && p.reps != null ? p.reps : ''
});
const normalizeSet = set => {
  if (!set || typeof set !== 'object') return null;
  if (!Array.isArray(set.parts)) return { id: set.id || generateId(), parts: [normalizePart(set)] };
  const parts = set.parts.map(normalizePart);
  return { id: set.id || generateId(), parts: parts.length ? parts : [normalizePart({})] };
};
const normalizeExercises = list => Array.isArray(list)
  ? list.filter(e => e && typeof e === 'object').map(e => ({
      id: e.id || generateId(),
      name: String(e.name || 'Névtelen gyakorlat'),
      sets: Array.isArray(e.sets) ? e.sets.map(normalizeSet).filter(Boolean) : []
    }))
  : [];
const sortDesc = list => list.sort((a, b) => b.date.localeCompare(a.date));
const normalizeWorkouts = data => {
  if (!Array.isArray(data)) return [];
  return sortDesc(data
    .filter(w => w && typeof w === 'object' &&
      (isValidDateStr(w.date) || (Array.isArray(w.exercises) && w.exercises.length > 0)))
    .map(w => ({
      id: w.id || generateId(),
      date: isValidDateStr(w.date) ? w.date : todayStr(),
      tags: Array.isArray(w.tags) ? w.tags.filter(t => typeof t === 'string') : [],
      exercises: normalizeExercises(w.exercises)
    })));
};
const normalizeTemplates = data => Array.isArray(data)
  ? data.filter(t => t && typeof t === 'object').map(t => ({
      id: t.id || generateId(),
      name: String(t.name || 'Sablon'),
      tags: Array.isArray(t.tags) ? t.tags.filter(x => typeof x === 'string') : [],
      exercises: normalizeExercises(t.exercises)
    }))
  : [];

const loadJSON = (key, fallback) => {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : fallback;
};

// ================== Számítások ==================
const partsOf = ex => ex.sets.flatMap(s => s.parts);
const e1rm = (w, r) => {
  w = num(w); r = num(r);
  if (w <= 0 || r <= 0) return 0;
  return r === 1 ? w : w * (1 + r / 30);           // Epley-képlet
};
const exerciseVolume = ex => partsOf(ex).reduce((s, p) => s + num(p.weight) * num(p.reps), 0);
const workoutVolume = w => w.exercises.reduce((s, ex) => s + exerciseVolume(ex), 0);
const exerciseMaxWeight = ex => partsOf(ex).reduce((m, p) => Math.max(m, num(p.weight)), 0);
const exerciseBestE1rm = ex => partsOf(ex).reduce((m, p) => Math.max(m, e1rm(p.weight, p.reps)), 0);
const hasData = ex => partsOf(ex).some(p => p.weight !== '' || p.reps !== '');

const fmtNum = n => (Math.round(n * 10) / 10).toLocaleString('hu-HU');
const setsSummary = ex => ex.sets
  .map(s => s.parts.map(p => {
    const w = num(p.weight), r = num(p.reps);
    if (!w && !r) return null;
    return w ? `${fmtNum(w)}×${r || '?'}` : `${r} ism.`;
  }).filter(Boolean).join('+'))
  .filter(Boolean).join(' · ');

// ================== Hang a stopperhez ==================
let audioCtx = null;
const primeAudio = () => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* nincs hang */ }
};
const beep = () => {
  if (!audioCtx) return;
  try {
    [0, 0.25, 0.5].forEach(t => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      const s = audioCtx.currentTime + t;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.25, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.start(s); o.stop(s + 0.2);
    });
  } catch { /* nincs hang */ }
};

createApp({
  setup() {
    // ================== Állapot ==================
    const workouts = ref([]);
    const templates = ref([]);
    const settings = reactive({
      tags: [...DEFAULT_TAGS],
      restSeconds: 90,
      autoRest: true,
      lastBackup: null,
      backupSnoozeUntil: null
    });
    const theme = ref(localStorage.getItem(THEME_KEY) || 'system'); // 'system' | 'light' | 'dark'

    const view = ref('list');        // 'list' | 'progress' | 'settings' | 'edit'
    const editingWorkout = ref(null);
    const editSnapshot = ref('');
    const exerciseSearchText = ref('');
    const showAutocomplete = ref(false);
    const showTemplatePicker = ref(false);
    const toast = ref(null);
    const loadFailed = ref(false);
    let loaded = false;
    let toastTimer = null;

    const showToast = (message, type = 'ok') => {
      toast.value = { message, type };
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.value = null), 2800);
    };

    // ================== Téma ==================
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const systemDark = ref(media.matches);
    const onMedia = e => (systemDark.value = e.matches);
    const isDark = computed(() => theme.value === 'dark' || (theme.value === 'system' && systemDark.value));
    const applyTheme = () => {
      document.documentElement.classList.toggle('dark', isDark.value);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', isDark.value ? '#0b0f17' : '#f4f6f1');
    };
    watch(isDark, applyTheme, { immediate: true });
    watch(theme, t => { try { localStorage.setItem(THEME_KEY, t); } catch {} });
    const cycleTheme = () => {
      theme.value = { system: 'light', light: 'dark', dark: 'system' }[theme.value];
      showToast({ system: 'Téma: rendszer szerint', light: 'Téma: világos', dark: 'Téma: sötét' }[theme.value]);
    };

    // ================== Betöltés / mentés ==================
    onMounted(() => {
      media.addEventListener ? media.addEventListener('change', onMedia) : media.addListener(onMedia);
      try {
        workouts.value = normalizeWorkouts(loadJSON(STORAGE_KEY, []));
        templates.value = normalizeTemplates(loadJSON(TEMPLATES_KEY, []));
        const s = loadJSON(SETTINGS_KEY, {});
        if (Array.isArray(s.tags) && s.tags.length) settings.tags = s.tags.filter(t => typeof t === 'string');
        if (Number.isFinite(s.restSeconds) && s.restSeconds > 0) settings.restSeconds = s.restSeconds;
        if (typeof s.autoRest === 'boolean') settings.autoRest = s.autoRest;
        settings.lastBackup = s.lastBackup || null;
        settings.backupSnoozeUntil = s.backupSnoozeUntil || null;
        loaded = true;
      } catch (err) {
        console.error('Betöltési hiba:', err);
        loadFailed.value = true;
        showToast('A mentett adatok nem olvashatók – nem írom felül őket.', 'error');
      }
    });
    onUnmounted(() => media.removeEventListener && media.removeEventListener('change', onMedia));

    const persist = (key, value) => {
      if (!loaded) return;
      try { localStorage.setItem(key, JSON.stringify(value)); }
      catch (err) {
        console.error('Mentési hiba:', err);
        showToast('Nem sikerült menteni (betelt a tárhely?). Exportáld az adatokat!', 'error');
      }
    };
    watch(workouts, v => persist(STORAGE_KEY, v), { deep: true });
    watch(templates, v => persist(TEMPLATES_KEY, v), { deep: true });
    watch(settings, v => persist(SETTINGS_KEY, v), { deep: true });

    // ================== Statisztikák ==================
    const stats = computed(() => {
      const now = new Date();
      const monday = toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
      const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      return {
        total: workouts.value.length,
        thisWeek: workouts.value.filter(w => w.date >= monday).length,
        thisMonth: workouts.value.filter(w => w.date.startsWith(monthPrefix)).length
      };
    });

    // Időrendben növekvő lista (PR-számításhoz)
    const workoutsAsc = computed(() => [...workouts.value].sort((a, b) => a.date.localeCompare(b.date)));

    // Egyéni csúcsok: "edzésId|gyakorlatkulcs" – ha a max súly nagyobb, mint bármelyik korábbi
    const prFlags = computed(() => {
      const best = new Map(), flags = new Set();
      workoutsAsc.value.forEach(w => {
        const seen = new Map();
        w.exercises.forEach(ex => {
          const k = nameKey(ex.name);
          seen.set(k, Math.max(seen.get(k) || 0, exerciseMaxWeight(ex)));
        });
        seen.forEach((max, k) => {
          if (max > 0 && best.has(k) && max > best.get(k)) flags.add(`${w.id}|${k}`);
          if (max > 0) best.set(k, Math.max(best.get(k) || 0, max));
        });
      });
      return flags;
    });
    const isPR = (workout, ex) => prFlags.value.has(`${workout.id}|${nameKey(ex.name)}`);
    const workoutPRCount = w => new Set(w.exercises.filter(ex => isPR(w, ex)).map(ex => nameKey(ex.name))).size;

    // ================== Lista: keresés, szűrés ==================
    const searchText = ref('');
    const filterTag = ref('');
    const filteredWorkouts = computed(() => {
      const q = nameKey(searchText.value);
      return workouts.value.filter(w =>
        (!filterTag.value || w.tags.includes(filterTag.value)) &&
        (!q || w.exercises.some(ex => nameKey(ex.name).includes(q)) || w.tags.some(t => nameKey(t).includes(q))));
    });
    const usedTags = computed(() => {
      const set = new Set();
      workouts.value.forEach(w => w.tags.forEach(t => set.add(t)));
      return [...settings.tags.filter(t => set.has(t)), ...[...set].filter(t => !settings.tags.includes(t))];
    });

    // ================== Mentés-emlékeztető ==================
    const showBackupReminder = computed(() => {
      if (!workouts.value.length) return false;
      const now = Date.now();
      if (settings.backupSnoozeUntil && now < settings.backupSnoozeUntil) return false;
      return !settings.lastBackup || now - settings.lastBackup > BACKUP_DAYS * DAY;
    });
    const daysSinceBackup = computed(() =>
      settings.lastBackup ? Math.floor((Date.now() - settings.lastBackup) / DAY) : null);
    const snoozeBackup = () => { settings.backupSnoozeUntil = Date.now() + 3 * DAY; };

    // ================== Gyakorlat-előzmények ==================
    const allExerciseNames = computed(() => {
      const names = new Map();
      workouts.value.forEach(w => w.exercises.forEach(e => {
        const k = nameKey(e.name);
        if (!names.has(k)) names.set(k, e.name.trim());   // a legfrissebb írásmód nyer (desc lista)
      }));
      templates.value.forEach(t => t.exercises.forEach(e => {
        const k = nameKey(e.name);
        if (!names.has(k)) names.set(k, e.name.trim());
      }));
      return [...names.values()].sort((a, b) => a.localeCompare(b, 'hu'));
    });

    const filteredExerciseNames = computed(() => {
      const q = nameKey(exerciseSearchText.value);
      const already = new Set((editingWorkout.value?.exercises || []).map(e => nameKey(e.name)));
      return allExerciseNames.value
        .filter(n => !already.has(nameKey(n)) && (!q || nameKey(n).includes(q)))
        .slice(0, 8);
    });
    const hideAutocomplete = () => setTimeout(() => (showAutocomplete.value = false), 120);

    // Legutóbbi alkalom (az aktuális edzés dátuma előtt vagy aznap, önmagát kihagyva)
    const lastPerformance = ex => {
      const w = editingWorkout.value;
      if (!w) return null;
      const k = nameKey(ex.name);
      for (const other of workouts.value) {            // csökkenő dátum szerint
        if (other.id === w.id || other.date > w.date) continue;
        const found = other.exercises.find(e => nameKey(e.name) === k && hasData(e));
        if (found) return { date: other.date, summary: setsSummary(found), exercise: found };
      }
      return null;
    };
    // Eddigi legjobb súly az aktuális edzésen kívül, a dátumáig
    const previousBestWeight = ex => {
      const w = editingWorkout.value;
      const k = nameKey(ex.name);
      let best = 0;
      workouts.value.forEach(o => {
        if (o.id === w.id || o.date > w.date) return;
        o.exercises.forEach(e => { if (nameKey(e.name) === k) best = Math.max(best, exerciseMaxWeight(e)); });
      });
      return best;
    };
    const isLivePR = ex => {
      const prev = previousBestWeight(ex);
      return prev > 0 && exerciseMaxWeight(ex) > prev;
    };
    const copyLastSets = ex => {
      const last = lastPerformance(ex);
      if (!last) return;
      ex.sets = last.exercise.sets.map(s => ({
        id: generateId(),
        parts: s.parts.map(p => ({ id: generateId(), weight: p.weight, reps: p.reps }))
      }));
    };

    // ================== Szerkesztő ==================
    const openEditor = workout => {
      editingWorkout.value = workout;
      editSnapshot.value = JSON.stringify(workout);
      exerciseSearchText.value = '';
      view.value = 'edit';
      window.scrollTo(0, 0);
    };
    const closeEditor = () => {
      view.value = 'list';
      editingWorkout.value = null;
      editSnapshot.value = '';
      stopRest();
      window.scrollTo(0, 0);
    };
    const cloneExercises = list => list.map(e => ({
      id: generateId(),
      name: e.name,
      sets: e.sets.map(s => ({ id: generateId(), parts: s.parts.map(p => ({ id: generateId(), weight: p.weight, reps: p.reps })) }))
    }));
    const blankWorkout = () => ({ id: generateId(), date: todayStr(), tags: [], exercises: [] });

    const startNewWorkout = () => {
      if (templates.value.length) showTemplatePicker.value = true;
      else openEditor(blankWorkout());
    };
    const startFromTemplate = tpl => {
      showTemplatePicker.value = false;
      const w = blankWorkout();
      if (tpl) { w.tags = [...tpl.tags]; w.exercises = cloneExercises(tpl.exercises); }
      openEditor(w);
    };
    const editWorkout = workout => openEditor(JSON.parse(JSON.stringify(workout)));
    const isExisting = computed(() => !!editingWorkout.value && workouts.value.some(w => w.id === editingWorkout.value.id));
    const isDirty = computed(() => !!editingWorkout.value && JSON.stringify(editingWorkout.value) !== editSnapshot.value);

    const saveWorkout = () => {
      const w = editingWorkout.value;
      if (!isValidDateStr(w.date)) { showToast('Adj meg egy érvényes dátumot!', 'error'); return; }
      const index = workouts.value.findIndex(x => x.id === w.id);
      if (index !== -1) workouts.value[index] = w; else workouts.value.unshift(w);
      sortDesc(workouts.value);
      const prs = workoutPRCount(w);
      closeEditor();
      showToast(prs ? `Elmentve – ${prs} új egyéni csúcs! 🏆` : (index !== -1 ? 'Edzés frissítve' : 'Edzés elmentve 💪'));
    };
    const cancelEdit = () => {
      if (!isDirty.value || confirm('Biztosan kilépsz? A nem mentett változtatások elvesznek.')) closeEditor();
    };
    const deleteWorkout = id => {
      if (confirm('Biztosan törölni szeretnéd ezt az edzést?')) {
        workouts.value = workouts.value.filter(w => w.id !== id);
        showToast('Edzés törölve');
      }
    };
    const duplicateWorkout = workout => {
      const w = blankWorkout();
      w.tags = [...workout.tags];
      w.exercises = cloneExercises(workout.exercises);
      openEditor(w);
    };

    const editorTags = computed(() => {
      const extra = (editingWorkout.value?.tags || []).filter(t => !settings.tags.includes(t));
      return [...settings.tags, ...extra];
    });
    const toggleTag = tag => {
      const tags = editingWorkout.value.tags;
      const i = tags.indexOf(tag);
      i === -1 ? tags.push(tag) : tags.splice(i, 1);
    };

    const newSet = (weight = '', reps = '') => ({ id: generateId(), parts: [{ id: generateId(), weight, reps }] });
    const addExercise = () => {
      const name = exerciseSearchText.value.trim();
      if (!name) return;
      const existing = allExerciseNames.value.find(n => nameKey(n) === nameKey(name));
      editingWorkout.value.exercises.push({ id: generateId(), name: existing || name, sets: [newSet()] });
      exerciseSearchText.value = '';
      showAutocomplete.value = false;
    };
    const selectExercise = name => { exerciseSearchText.value = name; addExercise(); };
    const deleteExercise = exercise => {
      if (hasData(exercise) && !confirm(`Törlöd a(z) „${exercise.name}” gyakorlatot az összes sorozatával?`)) return;
      editingWorkout.value.exercises = editingWorkout.value.exercises.filter(e => e.id !== exercise.id);
    };
    const moveExercise = (index, dir) => {
      const list = editingWorkout.value.exercises, j = index + dir;
      if (j < 0 || j >= list.length) return;
      [list[index], list[j]] = [list[j], list[index]];
    };
    const addSet = exercise => {
      const lastSet = exercise.sets[exercise.sets.length - 1];
      const lastPart = lastSet && lastSet.parts[lastSet.parts.length - 1];
      exercise.sets.push(newSet(lastPart ? lastPart.weight : '', lastPart ? lastPart.reps : ''));
      if (settings.autoRest && lastSet && hasData({ sets: [lastSet] })) startRest();
    };
    const deleteSet = (exercise, setId) => { exercise.sets = exercise.sets.filter(s => s.id !== setId); };
    const addPart = set => {
      const last = set.parts[set.parts.length - 1];
      set.parts.push({ id: generateId(), weight: last ? last.weight : '', reps: last ? last.reps : '' });
    };
    const deletePart = (set, partId) => {
      if (set.parts.length > 1) set.parts = set.parts.filter(p => p.id !== partId);
    };

    // ================== Pihenő stopper ==================
    const restEnd = ref(null);
    const restTotal = ref(0);
    const nowTick = ref(Date.now());
    let restTimer = null;
    const restRemaining = computed(() => restEnd.value ? Math.max(0, Math.ceil((restEnd.value - nowTick.value) / 1000)) : 0);
    const restProgress = computed(() => restTotal.value ? restRemaining.value / restTotal.value : 0);
    const fmtClock = s => `${Math.floor(s / 60)}:${pad(s % 60)}`;
    const tick = () => {
      nowTick.value = Date.now();
      if (restEnd.value && nowTick.value >= restEnd.value) {
        stopRest();
        beep();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        showToast('Lejárt a pihenő – jöhet a következő sorozat! 💪');
      }
    };
    const startRest = (seconds = settings.restSeconds) => {
      primeAudio();
      restTotal.value = seconds;
      restEnd.value = Date.now() + seconds * 1000;
      nowTick.value = Date.now();
      clearInterval(restTimer);
      restTimer = setInterval(tick, 250);
    };
    const adjustRest = delta => {
      if (!restEnd.value) return;
      restEnd.value = Math.max(Date.now() + 1000, restEnd.value + delta * 1000);
      restTotal.value = Math.max(restTotal.value + delta, restRemaining.value);
      nowTick.value = Date.now();
    };
    function stopRest() {
      clearInterval(restTimer);
      restTimer = null;
      restEnd.value = null;
    }
    const restPresets = [60, 90, 120, 180];

    // ================== Sablonok ==================
    const saveAsTemplate = () => {
      const w = editingWorkout.value;
      if (!w.exercises.length) { showToast('Adj hozzá legalább egy gyakorlatot!', 'error'); return; }
      const name = prompt('Sablon neve:', w.tags.join(' + ') || 'Új sablon');
      if (!name || !name.trim()) return;
      const existing = templates.value.find(t => nameKey(t.name) === nameKey(name));
      if (existing && !confirm(`Már van „${existing.name}” nevű sablon. Felülírod?`)) return;
      const tpl = { id: existing ? existing.id : generateId(), name: name.trim(), tags: [...w.tags], exercises: cloneExercises(w.exercises) };
      if (existing) templates.value.splice(templates.value.indexOf(existing), 1, tpl);
      else templates.value.push(tpl);
      showToast(`Sablon mentve: ${tpl.name}`);
    };
    const renameTemplate = tpl => {
      const name = prompt('Új név:', tpl.name);
      if (name && name.trim()) tpl.name = name.trim();
    };
    const deleteTemplate = tpl => {
      if (confirm(`Törlöd a(z) „${tpl.name}” sablont?`)) templates.value = templates.value.filter(t => t.id !== tpl.id);
    };

    // ================== Címkék ==================
    const newTagText = ref('');
    const addTag = () => {
      const t = newTagText.value.trim();
      if (!t) return;
      if (settings.tags.some(x => nameKey(x) === nameKey(t))) { showToast('Ez a címke már létezik', 'error'); return; }
      settings.tags.push(t);
      newTagText.value = '';
    };
    const removeTag = tag => {
      const used = workouts.value.filter(w => w.tags.includes(tag)).length;
      const msg = used
        ? `A(z) „${tag}” címkét ${used} edzésen használtad. A listából eltűnik, de a régi edzéseken megmarad. Törlöd?`
        : `Törlöd a(z) „${tag}” címkét?`;
      if (confirm(msg)) settings.tags = settings.tags.filter(t => t !== tag);
    };
    const moveTag = (i, dir) => {
      const j = i + dir;
      if (j < 0 || j >= settings.tags.length) return;
      [settings.tags[i], settings.tags[j]] = [settings.tags[j], settings.tags[i]];
    };
    const resetTags = () => {
      if (confirm('Visszaállítod az alap címkéket?')) settings.tags = [...DEFAULT_TAGS];
    };

    // ================== Haladás ==================
    const progressSearch = ref('');
    const selectedExercise = ref(null);      // nameKey
    const metric = ref('e1rm');              // 'e1rm' | 'weight' | 'volume'
    const metricLabels = { e1rm: 'Becsült 1RM', weight: 'Max súly', volume: 'Volumen' };

    const exerciseIndex = computed(() => {
      const map = new Map();
      workouts.value.forEach(w => w.exercises.forEach(ex => {
        if (!hasData(ex)) return;
        const k = nameKey(ex.name);
        const item = map.get(k) || { key: k, name: ex.name.trim(), count: 0, lastDate: w.date, bestWeight: 0, bestE1rm: 0 };
        item.count++;
        item.bestWeight = Math.max(item.bestWeight, exerciseMaxWeight(ex));
        item.bestE1rm = Math.max(item.bestE1rm, exerciseBestE1rm(ex));
        map.set(k, item);
      }));
      return [...map.values()];
    });
    const filteredExerciseIndex = computed(() => {
      const q = nameKey(progressSearch.value);
      return exerciseIndex.value.filter(e => !q || e.key.includes(q));
    });
    const selectedInfo = computed(() => exerciseIndex.value.find(e => e.key === selectedExercise.value) || null);

    const series = computed(() => {
      const k = selectedExercise.value;
      if (!k) return [];
      const out = [];
      workoutsAsc.value.forEach(w => {
        const exs = w.exercises.filter(e => nameKey(e.name) === k && hasData(e));
        if (!exs.length) return;
        const value = metric.value === 'weight' ? Math.max(...exs.map(exerciseMaxWeight))
          : metric.value === 'volume' ? exs.reduce((s, e) => s + exerciseVolume(e), 0)
          : Math.max(...exs.map(exerciseBestE1rm));
        out.push({ date: w.date, value: round1(value), summary: exs.map(setsSummary).join(' · '), pr: exs.some(e => isPR(w, e)) });
      });
      return out;
    });

    // SVG grafikon geometria
    const chart = computed(() => {
      const W = 340, H = 190, L = 40, R = 12, T = 14, B = 26;
      const pts = series.value;
      if (!pts.length) return null;
      const vals = pts.map(p => p.value);
      let min = Math.min(...vals), max = Math.max(...vals);
      if (min === max) { min = Math.max(0, min - 5); max = max + 5; }
      const span = max - min;
      const step = niceStep(span / 4);
      const y0 = Math.max(0, Math.floor((min - span * 0.08) / step) * step);
      const y1 = Math.ceil((max + span * 0.08) / step) * step;
      const t0 = parseLocalDate(pts[0].date).getTime();
      const t1 = parseLocalDate(pts[pts.length - 1].date).getTime();
      const x = d => pts.length === 1 ? (L + W - R) / 2 : L + ((parseLocalDate(d).getTime() - t0) / (t1 - t0 || 1)) * (W - L - R);
      const y = v => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
      const ticks = [];
      for (let v = y0; v <= y1 + 1e-9; v += step) ticks.push({ v: round1(v), y: y(v) });
      const points = pts.map(p => ({ ...p, x: x(p.date), y: y(p.value) }));
      return {
        W, H, L, R, T, B, ticks, points,
        path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
        area: points.length > 1
          ? `M${points[0].x.toFixed(1)},${H - B} ` + points.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ` L${points[points.length - 1].x.toFixed(1)},${H - B} Z`
          : ''
      };
    });
    function niceStep(raw) {
      if (raw <= 0) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(raw)));
      const f = raw / p;
      return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    }
    const hoverIndex = ref(null);
    const onChartMove = evt => {
      const c = chart.value;
      if (!c) return;
      const svg = evt.currentTarget;
      const rect = svg.getBoundingClientRect();
      const px = ((evt.clientX - rect.left) / rect.width) * c.W;
      let best = 0, dist = Infinity;
      c.points.forEach((p, i) => { const d = Math.abs(p.x - px); if (d < dist) { dist = d; best = i; } });
      hoverIndex.value = best;
    };
    const hoverPoint = computed(() => (chart.value && hoverIndex.value != null) ? chart.value.points[hoverIndex.value] : null);
    watch([selectedExercise, metric], () => (hoverIndex.value = null));

    const openProgressFor = name => {
      selectedExercise.value = nameKey(name);
      view.value = 'progress';
      window.scrollTo(0, 0);
    };

    // ================== Megjelenítés ==================
    const formatDate = s => parseLocalDate(s).toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' });
    const formatShortDate = s => parseLocalDate(s).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
    const formatDay = s => parseLocalDate(s).getDate();
    const formatMonth = s => parseLocalDate(s).toLocaleDateString('hu-HU', { month: 'short' }).replace('.', '');
    const formatWeekday = s => parseLocalDate(s).toLocaleDateString('hu-HU', { weekday: 'long' });
    const formatNumber = n => Math.round(n).toLocaleString('hu-HU');
    const metricUnit = computed(() => 'kg');

    const goTo = v => { view.value = v; window.scrollTo(0, 0); };

    // ================== Export / Import ==================
    const exportData = () => {
      const payload = {
        app: 'workout-tracker',
        version: 2,
        exportedAt: new Date().toISOString(),
        workouts: workouts.value,
        templates: templates.value,
        tags: settings.tags
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `edzesek_mentes_${todayStr()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      settings.lastBackup = Date.now();
      settings.backupSnoozeUntil = null;
      showToast('Mentés elkészült – tedd biztonságos helyre (pl. OneDrive)!');
    };

    const importData = event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const raw = JSON.parse(e.target.result);
          // régi formátum: sima tömb; új: { workouts, templates, tags }
          const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.workouts) ? raw.workouts : null);
          if (!list) { showToast('Érvénytelen fájlformátum!', 'error'); return; }
          const normalized = normalizeWorkouts(list);
          const tpls = !Array.isArray(raw) && Array.isArray(raw.templates) ? normalizeTemplates(raw.templates) : null;
          const extra = tpls ? ` és ${tpls.length} sablon` : '';
          if (!confirm(`${normalized.length} edzés${extra} található a fájlban. Felülírod vele a jelenlegi adatokat? Ez nem visszavonható.`)) return;
          loaded = true;
          loadFailed.value = false;
          workouts.value = normalized;
          if (tpls) templates.value = tpls;
          if (!Array.isArray(raw) && Array.isArray(raw.tags) && raw.tags.length) {
            settings.tags = [...new Set([...settings.tags, ...raw.tags.filter(t => typeof t === 'string')])];
          }
          showToast('Sikeres importálás!');
        } catch (err) {
          showToast('Hiba történt a fájl beolvasásakor.', 'error');
        }
      };
      reader.readAsText(file);
    };

    // Böngésző "vissza" gomb a szerkesztőben ne zárja be csendben az appot
    window.addEventListener('beforeunload', e => {
      if (view.value === 'edit' && isDirty.value) { e.preventDefault(); e.returnValue = ''; }
    });

    return {
      // állapot
      workouts, templates, settings, theme, isDark, view, editingWorkout, exerciseSearchText,
      showAutocomplete, showTemplatePicker, toast, loadFailed, stats, isDirty, isExisting,
      // lista
      searchText, filterTag, filteredWorkouts, usedTags, showBackupReminder, daysSinceBackup, snoozeBackup,
      isPR, workoutPRCount, duplicateWorkout,
      // szerkesztő
      filteredExerciseNames, hideAutocomplete, editorTags, lastPerformance, isLivePR, copyLastSets,
      startNewWorkout, startFromTemplate, editWorkout, saveWorkout, cancelEdit, deleteWorkout, toggleTag,
      addExercise, selectExercise, deleteExercise, moveExercise, addSet, deleteSet, addPart, deletePart,
      // stopper
      restEnd, restRemaining, restProgress, restPresets, startRest, stopRest, adjustRest, fmtClock,
      // sablonok, címkék
      saveAsTemplate, renameTemplate, deleteTemplate, newTagText, addTag, removeTag, moveTag, resetTags,
      // haladás
      progressSearch, selectedExercise, selectedInfo, filteredExerciseIndex, metric, metricLabels, metricUnit,
      series, chart, hoverIndex, hoverPoint, onChartMove, openProgressFor,
      // segédek
      cycleTheme, goTo, formatDate, formatShortDate, formatDay, formatMonth, formatWeekday, formatNumber, fmtNum,
      workoutVolume, exerciseMaxWeight, exportData, importData
    };
  }
}).mount('#app');
