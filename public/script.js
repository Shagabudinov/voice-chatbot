// public/script.js

// Оборачиваем весь код в асинхронную функцию
(async function initializeChat() {
  // Инициализация роли из URL параметров
  const urlParams = new URLSearchParams(window.location.search);
  const urlRole = urlParams.get('role');
  if (urlRole) {
    localStorage.setItem('voiceChatRole', urlRole);
  }

  // Получение роли из localStorage или значение по умолчанию
  const role = localStorage.getItem('voiceChatRole') || 'default';

  let sessionId = localStorage.getItem("voiceChatSessionId");
  if (!sessionId) {
    sessionId = "sess_" + Date.now();
    localStorage.setItem("voiceChatSessionId", sessionId);
  }

  const SERVER_URL = ""; 
  // Пустая строка значит "тот же домен/порт", где хостится сервер. 
  // Если ваш сервер на другом домене, пропишите, например: "https://mydomain.com"

  // Получаем конфигурацию роли
  try {
    const roleConfig = await fetch(`${SERVER_URL}/api/roles/${role}`).then(r => r.json());
    
    // Обновляем заголовок после получения конфигурации
    const titleElement = document.querySelector('h1');
    if (titleElement && roleConfig) {
      titleElement.textContent = roleConfig.name;
    }
  } catch (err) {
    console.error("Ошибка при получении конфигурации роли:", err);
  }

  // Общие элементы (основная страница)
  const elements = {
    textInput: document.getElementById("text-input"),
    sendBtn: document.getElementById("send-btn"),
    voiceBtn: document.getElementById("voice-btn"),
    chatBox: document.getElementById("chat-box"),
    recordModal: document.getElementById("record-modal"),
    recordStatus: document.getElementById("record-status"),
    stopRecordBtn: document.getElementById("stop-record-btn"),
    clearBtn: document.getElementById("clear-btn")
  };

  let mediaRecorder;
  let audioChunks = [];

  // Элементы (embed-страница), могут быть не найдены, если мы на index.html
  const textInputEmbed = document.getElementById("text-input-embed");
  const sendBtnEmbed = document.getElementById("send-btn-embed");
  const voiceBtnEmbed = document.getElementById("voice-btn-embed");
  const chatBoxEmbed = document.getElementById("chat-box-embed");
  const recordModalEmbed = document.getElementById("record-modal-embed");
  const recordStatusEmbed = document.getElementById("record-status-embed");
  const stopRecordBtnEmbed = document.getElementById("stop-record-btn-embed");

  // Добавляем в начало функции initializeChat:
  let currentAudio = null;
  let isMuted = false;

  // Находим кнопку мьюта
  const muteBtn = document.getElementById("mute-btn");
  const muteBtnIcon = muteBtn.querySelector("svg");
  const muteBtnText = muteBtn.querySelector("span");

  // Функция для добавления сообщения в чат
  function addMessage(text, sender = "assistant") {
    if (!elements.chatBox) return;
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("p-2", "rounded", "max-w-[80%]", "break-words");
    if (sender === "user") {
      msgDiv.classList.add("bg-blue-100", "self-end", "ml-auto");
    } else {
      msgDiv.classList.add("bg-gray-200");
    }
    msgDiv.innerText = text;
    elements.chatBox.appendChild(msgDiv);
    elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
  }

  // Обновляем функцию отправки текста
  async function sendTextMessage() {
    const message = elements.textInput.value.trim();
    if (!message) return;
    addMessage(message, "user");
    elements.textInput.value = "";

    try {
      const resp = await fetch(`${SERVER_URL}/api/chat/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          sessionId, 
          message,
          role // Добавляем роль
        }),
      });
      const data = await resp.json();
      if (data.error) {
        addMessage("Ошибка: " + data.error);
      } else {
        addMessage(data.responseText, "assistant");
        if (data.audioUrl) {
          playAudio(`${SERVER_URL}${data.audioUrl}`);
        }
      }
    } catch (err) {
      console.error("Ошибка при отправке текстового:", err);
      addMessage("Произошла ошибка при отправке сообщения");
    }
  }

  // Нажатие на кнопку «Отправить»
  if (elements.sendBtn) {
    elements.sendBtn.addEventListener("click", sendTextMessage);
  }
  // Нажатие Enter в поле ввода
  if (elements.textInput) {
    elements.textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendTextMessage();
      }
    });
  }

  // Работа с голосовыми сообщениями
  if (elements.voiceBtn) {
    elements.voiceBtn.addEventListener("click", startRecording);
  }
  if (elements.stopRecordBtn) {
    elements.stopRecordBtn.addEventListener("click", stopRecording);
  }

  // Добавляем функцию визуализации звука
  function createAudioVisualizer(stream, container) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    source.connect(analyser);
    
    const canvas = document.createElement('canvas');
    canvas.width = container.offsetWidth;
    canvas.height = 100;
    container.appendChild(canvas);
    
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function draw() {
      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      
      ctx.fillStyle = 'rgb(249, 250, 251)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;
      
      for(let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#ef4444');
        gradient.addColorStop(1, '#dc2626');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
    }
    
    draw();
    
    return () => {
      source.disconnect();
      audioContext.close();
      canvas.remove();
    };
  }

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
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        bitsPerSecond: 128000
      });

      if (elements.recordModal) {
        elements.recordModal.classList.remove("hidden");
        elements.recordModal.classList.add("flex");
        
        // Создаем контейнер для визуализатора
        const visualizerContainer = document.createElement('div');
        visualizerContainer.className = 'w-full h-24 mb-4';
        
        // Находим правильный элемент для вставки
        const modalContent = elements.recordModal.querySelector('.bg-white');
        const statusElement = elements.recordStatus;
        
        // Вставляем визуализатор перед статусом
        if (modalContent && statusElement) {
          modalContent.insertBefore(visualizerContainer, statusElement);
          const cleanupVisualizer = createAudioVisualizer(stream, visualizerContainer);
          
          mediaRecorder.addEventListener("stop", () => {
            cleanupVisualizer();
            elements.recordModal.classList.add("hidden");
            elements.recordModal.classList.remove("flex");
            stream.getTracks().forEach(track => track.stop()); // Останавливаем поток
          });
        }
      }

      mediaRecorder.addEventListener("dataavailable", (event) => {
        audioChunks.push(event.data);
      });

      mediaRecorder.addEventListener("stop", async () => {
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        await sendVoiceMessage(audioBlob);
      });

      mediaRecorder.start();
    } catch (err) {
      console.error("Ошибка доступа к микрофону:", err);
      alert("Нет доступа к микрофону");
    }
  }

  // Остановка записи
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    if (elements.recordModal) {
      elements.recordModal.classList.add("hidden");
    }
  }

  // Обновляем функцию конвертации аудио
  async function convertToMp3(blob) {
    try {
      // Создаем аудио контекст
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Декодируем входной webm
      const audioData = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(audioData);
      
      // Создаем новый буфер для кодирования
      const mp3encoder = new lamejs.Mp3Encoder(1, 48000, 128); // Фиксированная частота дискретизации
      const samples = new Int16Array(audioBuffer.length);
      
      // Получаем данные из первого канала
      const channel = audioBuffer.getChannelData(0);
      
      // Нормализуем громкость
      let maxValue = 0;
      for (let i = 0; i < channel.length; i++) {
        if (Math.abs(channel[i]) > maxValue) {
          maxValue = Math.abs(channel[i]);
        }
      }
      
      const normalizeCoef = maxValue > 1 ? 1 / maxValue : 1;
      
      for (let i = 0; i < channel.length; i++) {
        // Нормализуем и конвертируем в int16
        const normalized = channel[i] * normalizeCoef;
        samples[i] = normalized < 0 ? normalized * 0x8000 : normalized * 0x7FFF;
      }
      
      // Кодируем в mp3 с более высоким битрейтом
      const mp3Data = mp3encoder.encodeBuffer(samples);
      const mp3End = mp3encoder.flush();
      
      // Собираем финальный mp3 блоб
      return new Blob([mp3Data, mp3End], { 
        type: 'audio/mp3' 
      });
    } catch (err) {
      console.error("Ошибка при конвертации аудио:", err);
      throw err;
    }
  }

  // Обновляем функцию отправки голосового сообщения
  async function sendVoiceMessage(blob) {
    addMessage("(Голосовое сообщение)", "user");
    
    try {
      // Конвертируем webm в mp3 перед отправкой
      const mp3Blob = await convertToMp3(blob);
      const audioFile = new File([mp3Blob], "voice_message.mp3", { 
        type: "audio/mp3",
        lastModified: Date.now()
      });
      
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("audio", audioFile);
      formData.append("role", role); // Добавляем роль

      // Добавляем логирование перед отправкой
      console.log("Отправляем аудиофайл:", {
        имяФайла: audioFile.name,
        размер: audioFile.size,
        тип: audioFile.type
      });

      const resp = await fetch(`${SERVER_URL}/api/chat/voice`, {
        method: "POST",
        body: formData,
      });
      
      const data = await resp.json();
      if (data.error) {
        addMessage("Ошибка: " + data.error, "assistant");
      } else {
        addMessage("(Распознано: " + data.userMessage + ")", "user");
        addMessage(data.responseText, "assistant");
        if (data.audioUrl) {
          playAudio(`${SERVER_URL}${data.audioUrl}`);
        }
      }
    } catch (err) {
      console.error("Ошибка при отправке голосового:", err);
      addMessage("Произошла ошибка при отправке голосового сообщения");
    }
  }

  // Обновляем функцию проигрывания аудио
  function playAudio(url) {
    // Останавливаем текущее воспроизведение, если есть
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    // Если звук выключен, не воспроизводим новое аудио
    if (isMuted) return;

    const audio = new Audio(url);
    currentAudio = audio;
    audio.play().catch((err) => console.error("Ошибка воспроизведения:", err));
  }

  // Обработчик для кнопки мьюта
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      isMuted = !isMuted;
      
      // Останавливаем текущее воспроизведение при включении мьюта
      if (isMuted && currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      
      // Обновляем иконку и текст
      if (isMuted) {
        muteBtnIcon.innerHTML = `
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M23 9l-6 6" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9l6 6" />
        `;
        muteBtnText.textContent = "Включить звук";
        muteBtn.classList.remove("bg-gray-200", "hover:bg-gray-300");
        muteBtn.classList.add("bg-blue-500", "hover:bg-blue-600", "text-white");
      } else {
        muteBtnIcon.innerHTML = `
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
        `;
        muteBtnText.textContent = "Без звука";
        muteBtn.classList.remove("bg-blue-500", "hover:bg-blue-600", "text-white");
        muteBtn.classList.add("bg-gray-200", "hover:bg-gray-300");
      }
    });
  }

  // Обновляем функцию очистки истории
  async function clearHistory() {
    try {
      // Останавливаем текущее воспроизведение
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }

      const resp = await fetch(`${SERVER_URL}/api/chat/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await resp.json();
      if (data.success) {
        if (elements.chatBox) {
          elements.chatBox.innerHTML = '';
        }
      } else {
        console.error("Ошибка при очистке истории:", data.error);
      }
    } catch (err) {
      console.error("Ошибка при очистке истории:", err);
    }
  }

  // Обновляем обработчик очистки истории
  if (elements.clearBtn) {
    elements.clearBtn.addEventListener("click", clearHistory);
  }

})(); // Вызываем функцию сразу
