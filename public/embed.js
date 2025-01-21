(async function initializeEmbedChat() {
  // Константы
  const SILENCE_DURATION = 2000; // 2 секунды тишины для остановки
  const SPEECH_THRESHOLD_DURATION = 300; // 300мс выше порога чтобы определить речь
  const MIN_RECORDING_DURATION = 500; // Минимальная длительность записи
  const CALIBRATION_DURATION = 1000; // 1 секунда на калибровку фона

  // Элементы интерфейса
  const elements = {
    chatTrigger: document.getElementById('chat-trigger'),
    chatInterface: document.getElementById('chat-interface'),
    recordingIndicator: document.getElementById('recording-indicator'),
    startIndicator: document.getElementById('start-indicator'),
    statusText: document.getElementById('status-text'),
    closeBtn: document.getElementById('close-btn'),
    recordButton: document.getElementById('record-button')
  };

  // Состояние приложения
  let mediaRecorder;
  let audioChunks = [];
  let recordingStartTime;
  let silenceTimeout;
  let isRecording = false;
  let sessionId = localStorage.getItem("voiceChatSessionId");
  
  if (!sessionId) {
    sessionId = "sess_" + Date.now();
    localStorage.setItem("voiceChatSessionId", sessionId);
  }

  // Инициализация роли из URL параметров
  const urlParams = new URLSearchParams(window.location.search);
  const role = urlParams.get('role') || 'friendly'; // По умолчанию используем дружелюбную роль

  // Добавляем новые переменные для определения речи
  let noiseFloor = -70; // Начальный уровень шума
  let isSpeaking = false;
  let speechStartTime = null;
  let lastAudioLevel = -100;

  // Добавляем переменную для текущего аудио
  let currentAudio = null;

  // Обработчики событий
  elements.chatTrigger.addEventListener('click', () => {
    elements.chatTrigger.classList.add('opacity-0');
    elements.chatInterface.classList.remove('hidden');
    elements.chatInterface.classList.add('animate-slideUp');
    // Не начинаем запись автоматически
  });

  elements.recordButton.addEventListener('click', () => {
    if (isRecording || currentAudio) {
      stopEverything();
    } else {
      startRecording();
    }
  });

  elements.closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stopEverything();
    closeInterface();
  });

  // Обновляем функцию начала записи
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });

      audioChunks = [];
      recordingStartTime = Date.now();
      isRecording = true;
      isSpeaking = false;
      speechStartTime = null;

      await calibrateNoiseFloor(stream);

      try {
        // Сначала пробуем MP3
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/mp3',
          audioBitsPerSecond: 128000
        });
      } catch (formatErr) {
        // Если MP3 не поддерживается, используем WebM
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 128000
        });
      }

      // Настройка индикаторов
      elements.recordingIndicator.classList.remove('hidden');
      elements.startIndicator.classList.add('hidden');
      elements.statusText.textContent = 'Говорите...';

      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      });

      setupSilenceDetection(stream);
      mediaRecorder.start(100); // Запрашиваем чанки каждые 100мс

    } catch (err) {
      console.error("Ошибка доступа к микрофону:", err);
      elements.statusText.textContent = 'Ошибка доступа к микрофону';
    }
  }

  // Обновляем функцию калибровки
  async function calibrateNoiseFloor(stream) {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const samples = [];
    const dataArray = new Float32Array(analyser.frequencyBinCount);
    
    return new Promise(resolve => {
      const calibrationStartTime = Date.now();
      const sampleInterval = setInterval(() => {
        analyser.getFloatFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        samples.push(average);
        
        if (Date.now() - calibrationStartTime >= CALIBRATION_DURATION) {
          clearInterval(sampleInterval);
          // Устанавливаем уровень фонового шума как среднее + 10дБ
          noiseFloor = (samples.reduce((a, b) => a + b) / samples.length) + 10;
          resolve();
        }
      }, 100);
    });
  }

  // Обновляем функцию остановки всего
  function stopEverything() {
    // Останавливаем запись
    if (isRecording) {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
      isRecording = false;
      audioChunks = [];
    }

    // Останавливаем воспроизведение
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }

    // Сбрасываем интерфейс
    elements.recordingIndicator.classList.add('hidden');
    elements.startIndicator.classList.remove('hidden');
    elements.statusText.textContent = 'Нажмите чтобы начать разговор';
  }

  // Обновляем функцию определения тишины
  function setupSilenceDetection(stream) {
    const audioContext = new AudioContext();
    const audioSource = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    
    audioSource.connect(analyser);
    
    const dataArray = new Float32Array(analyser.frequencyBinCount);
    let silenceStart = null;
    
    const audioLevelIndicator = document.getElementById('audio-level');
    
    function checkAudioLevel() {
      if (!isRecording) return;
      
      analyser.getFloatFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      lastAudioLevel = average;

      // Определение начала речи
      if (average > noiseFloor) {
        if (!isSpeaking) {
          if (!speechStartTime) {
            speechStartTime = Date.now();
          } else if (Date.now() - speechStartTime > SPEECH_THRESHOLD_DURATION) {
            isSpeaking = true;
            elements.statusText.textContent = 'Говорите...';
          }
        }
        silenceStart = null;
      } else {
        speechStartTime = null;
        
        if (isSpeaking) {
          if (!silenceStart) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart > SILENCE_DURATION) {
            stopRecording();
            return;
          }
        }
      }
      
      // Улучшенная визуализация уровня звука
      const normalizedLevel = Math.max(0, Math.min(100, (average - noiseFloor) * 2));
      const scale = 1 + (normalizedLevel / 100) * 0.5; // Масштаб от 1 до 1.5
      
      if (audioLevelIndicator) {
        audioLevelIndicator.style.transform = `scale(${scale})`;
        // Добавляем плавное изменение прозрачности
        audioLevelIndicator.style.opacity = normalizedLevel / 200 + 0.3;
      }
      
      requestAnimationFrame(checkAudioLevel);
    }
    
    checkAudioLevel();
  }

  // Обновляем функцию остановки записи
  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    clearTimeout(silenceTimeout);
    isRecording = false;
    
    const recordingDuration = Date.now() - recordingStartTime;
    if (recordingDuration < MIN_RECORDING_DURATION) {
      resetRecording();
      return;
    }

    // Создаем промис для ожидания данных
    const dataPromise = new Promise(resolve => {
      mediaRecorder.addEventListener("stop", () => {
        if (audioChunks.length > 0) {
          const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
          resolve(audioBlob);
        } else {
          resolve(null);
        }
      });
    });

    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(track => track.stop());

    elements.recordingIndicator.classList.add('hidden');
    elements.startIndicator.classList.remove('hidden');
    elements.statusText.textContent = 'Обработка...';

    // Ждем данные и отправляем
    dataPromise.then(audioBlob => {
      if (audioBlob && audioBlob.size > 0) {
        sendVoiceMessage(audioBlob);
      } else {
        console.error("Не удалось получить аудио данные");
        elements.statusText.textContent = 'Ошибка записи';
        resetRecording();
      }
    });
  }

  // Функция сброса записи
  function resetRecording() {
    if (mediaRecorder && mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    audioChunks = [];
    elements.recordingIndicator.classList.add('hidden');
    elements.startIndicator.classList.remove('hidden');
    elements.statusText.textContent = 'Нажмите чтобы начать разговор';
  }

  // Обновляем функцию отправки голосового сообщения
  async function sendVoiceMessage(blob) {
    try {
      elements.statusText.textContent = 'Отправка...';
      
      // Определяем расширение файла на основе MIME-типа
      const fileExtension = mediaRecorder.mimeType.includes('mp3') ? '.mp3' : '.webm';
      
      // Создаем файл с правильным типом и расширением
      const audioFile = new File([blob], `voice_message${fileExtension}`, { 
        type: mediaRecorder.mimeType,
        lastModified: Date.now()
      });
      
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("audio", audioFile);
      formData.append("role", role);

      const response = await fetch('/api/chat/voice', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        elements.statusText.textContent = 'Ошибка: ' + data.error;
      } else {
        elements.statusText.textContent = 'Нажмите на микрофон, чтобы начать';
        if (data.audioUrl) {
          try {
            currentAudio = new Audio(data.audioUrl);
            currentAudio.addEventListener('play', () => {
              elements.statusText.textContent = 'Воспроизведение ответа...';
            });
            currentAudio.addEventListener('ended', () => {
              currentAudio = null;
              elements.statusText.textContent = 'Говорите...';
              setTimeout(() => {
                if (!isRecording) {
                  startRecording();
                }
              }, 100);
            });
            await currentAudio.play();
          } catch (err) {
            console.error("Ошибка воспроизведения:", err);
            elements.statusText.textContent = 'Ошибка воспроизведения';
            currentAudio = null;
          }
        }
      }
    } catch (err) {
      console.error("Ошибка отправки:", err);
      elements.statusText.textContent = 'Ошибка отправки';
    }
  }

  // Добавляем анимации для плавного появления/исчезновения
  function closeInterface() {
    elements.chatInterface.classList.add('animate-slideDown');
    elements.chatTrigger.classList.remove('opacity-0');
    
    setTimeout(() => {
      elements.chatInterface.classList.remove('animate-slideDown');
      elements.chatInterface.classList.add('hidden');
    }, 300);
  }
})(); 