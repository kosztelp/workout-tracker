const { createApp, ref, computed, watch, onMounted } = Vue;

const STORAGE_KEY = 'workout-tracker-data';

const AVAILABLE_TAGS = ['Mell', 'Váll', 'Tricepsz', 'Bicepsz', 'Hát', 'Láb', 'Has', 'Kardió'];

const generateId = () => Math.random().toString(36).substring(2, 9);

createApp({
  setup() {
    const workouts = ref([]);
    const currentView = ref('list'); // 'list' | 'edit-workout'
    const editingWorkout = ref(null);
    const exerciseSearchText = ref('');
    const showAutocomplete = ref(false);

    // Load data from local storage
    onMounted(() => {
      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        let parsedData = JSON.parse(savedData);
        // Migration to parts structure for complex sets
        parsedData = parsedData.map(workout => {
          if (workout.exercises) {
            workout.exercises = workout.exercises.map(ex => {
              if (ex.sets) {
                ex.sets = ex.sets.map(set => {
                  if (set.parts === undefined) {
                    return {
                      id: set.id || generateId(),
                      parts: [{ id: generateId(), weight: set.weight, reps: set.reps }]
                    };
                  }
                  return set;
                });
              }
              return ex;
            });
          }
          return workout;
        });
        workouts.value = parsedData;
      }
    });

    // Save data to local storage on change
    watch(workouts, (newVal) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newVal));
    }, { deep: true });

    // Autocomplete list based on previous exercises
    const allExerciseNames = computed(() => {
      const names = new Set();
      workouts.value.forEach(w => {
        if (w.exercises) {
          w.exercises.forEach(e => names.add(e.name));
        }
      });
      return Array.from(names).sort();
    });

    const filteredExerciseNames = computed(() => {
      if (!exerciseSearchText.value) return [];
      const lowerSearch = exerciseSearchText.value.toLowerCase();
      return allExerciseNames.value.filter(name => name.toLowerCase().includes(lowerSearch));
    });

    const startNewWorkout = () => {
      editingWorkout.value = {
        id: generateId(),
        date: new Date().toISOString().split('T')[0],
        tags: [],
        exercises: []
      };
      currentView.value = 'edit-workout';
    };

    const editWorkout = (workout) => {
      // Create a deep copy for editing
      editingWorkout.value = JSON.parse(JSON.stringify(workout));
      currentView.value = 'edit-workout';
    };

    const saveWorkout = () => {
      if (!editingWorkout.value.date) {
        alert('Kérlek adj meg egy dátumot!');
        return;
      }
      
      const index = workouts.value.findIndex(w => w.id === editingWorkout.value.id);
      if (index !== -1) {
        workouts.value[index] = editingWorkout.value;
      } else {
        workouts.value.unshift(editingWorkout.value);
      }
      
      // Sort workouts by date descending
      workouts.value.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      currentView.value = 'list';
      editingWorkout.value = null;
    };

    const cancelEdit = () => {
      if (confirm('Biztosan kilépsz? A nem mentett változtatások elvesznek.')) {
        currentView.value = 'list';
        editingWorkout.value = null;
      }
    };

    const deleteWorkout = (id) => {
      if (confirm('Biztosan törölni szeretnéd ezt az edzést?')) {
        workouts.value = workouts.value.filter(w => w.id !== id);
      }
    };

    const toggleTag = (tag) => {
      const index = editingWorkout.value.tags.indexOf(tag);
      if (index === -1) {
        editingWorkout.value.tags.push(tag);
      } else {
        editingWorkout.value.tags.splice(index, 1);
      }
    };

    const addExercise = () => {
      if (!exerciseSearchText.value.trim()) return;
      
      editingWorkout.value.exercises.push({
        id: generateId(),
        name: exerciseSearchText.value.trim(),
        sets: []
      });
      
      exerciseSearchText.value = '';
      showAutocomplete.value = false;
    };

    const selectExercise = (name) => {
      exerciseSearchText.value = name;
      showAutocomplete.value = false;
      addExercise();
    };

    const deleteExercise = (exerciseId) => {
      editingWorkout.value.exercises = editingWorkout.value.exercises.filter(e => e.id !== exerciseId);
    };

    const addSet = (exercise) => {
      let newWeight = '';
      let newReps = '';
      if (exercise.sets.length > 0) {
        const lastSet = exercise.sets[exercise.sets.length - 1];
        if (lastSet.parts && lastSet.parts.length > 0) {
          const lastPart = lastSet.parts[lastSet.parts.length - 1];
          newWeight = lastPart.weight;
          newReps = lastPart.reps;
        }
      }
      
      exercise.sets.push({
        id: generateId(),
        parts: [{
          id: generateId(),
          weight: newWeight,
          reps: newReps
        }]
      });
    };

    const deleteSet = (exercise, setId) => {
      exercise.sets = exercise.sets.filter(s => s.id !== setId);
    };

    const addPart = (set) => {
      let newWeight = '';
      let newReps = '';
      if (set.parts.length > 0) {
        const lastPart = set.parts[set.parts.length - 1];
        newWeight = lastPart.weight;
        newReps = lastPart.reps;
      }
      set.parts.push({
        id: generateId(),
        weight: newWeight,
        reps: newReps
      });
    };

    const deletePart = (set, partId) => {
      set.parts = set.parts.filter(p => p.id !== partId);
    };

    const formatDate = (dateString) => {
      const options = { year: 'numeric', month: 'short', day: 'numeric' };
      return new Date(dateString).toLocaleDateString('hu-HU', options);
    };

    const exportData = () => {
      const dataStr = JSON.stringify(workouts.value, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `edzesek_mentes_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const importData = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (Array.isArray(imported)) {
            if (confirm('Biztosan felülírod a jelenlegi adatokat az importált fájllal? Ez a művelet nem visszavonható.')) {
              workouts.value = imported;
              alert('Sikeres importálás!');
            }
          } else {
            alert('Érvénytelen fájlformátum!');
          }
        } catch (err) {
          alert('Hiba történt a fájl beolvasásakor.');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    };

    return {
      workouts,
      currentView,
      editingWorkout,
      AVAILABLE_TAGS,
      exerciseSearchText,
      filteredExerciseNames,
      showAutocomplete,
      startNewWorkout,
      editWorkout,
      saveWorkout,
      cancelEdit,
      deleteWorkout,
      toggleTag,
      addExercise,
      selectExercise,
      deleteExercise,
      addSet,
      deleteSet,
      addPart,
      deletePart,
      formatDate,
      exportData,
      importData
    };
  }
}).mount('#app');
