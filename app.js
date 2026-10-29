const DEFAULT_ESP32_IP = "192.168.4.1";
const WS_PATH = ":81/";

const defaultThresholds = { hrLow: 55, hrHigh: 110, spo2Low: 94, spo2Critical: 90, tempHigh: 38, batteryLow: 25 };
const defaultPatient = { name: "Patient", age: "--", gender: "--", blood: "--", caregiver: "--", ward: "--", condition: "No patient condition added." };

const appState = {
  connected: false,
  esp32Ip: DEFAULT_ESP32_IP,
  websocket: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  manualDisconnect: false,
  movementUnlocked: false,
  activeHoldCommand: null,
  activeSubsystem: "IDLE",
  heartRate: null,
  spo2: null,
  bodyTemperature: null,
  ambientTemperature: null,
  batteryVoltage: null,
  batteryPercent: null,
  batteryStatus: "UNKNOWN",
  conversionState: "IDLE",
  conversionPosition: "UNKNOWN",
  emergency: false,
  lastTelemetryTime: null,
  patient: loadJSON("hm_patient", defaultPatient),
  thresholds: loadJSON("hm_thresholds", defaultThresholds),
  passwords: loadJSON("hm_passwords", { admin: "admin123", movement: "convert123", drive: "move123" }),
  driveUnlocked: false
};

const ids = [
  "topConnection","topBattery","clockText","connectionChip","esp32Ip","connectBtn","disconnectBtn","clearLogBtn","endpointText",
  "wifiStatus","socketStatus","sensorSummary","motorReady","patientName","wardChip","patientAvatar","patientCondition","patientAge",
  "patientGender","patientBlood","patientCaregiver","patientWard","patientSystem","lastUpdate","heartRate","spo2","bodyTemperature",
  "ambientTemperature","batteryPercent","batteryVoltage","heartRateStatus","spo2Status","bodyTempStatus","ambientTempStatus",
  "batteryPercentStatus","batteryVoltageStatus","heartRateCard","spo2Card","bodyTempCard","ambientTempCard","batteryPercentCard",
  "batteryVoltageCard","movementPassword","unlockMovementBtn","lockMovementBtn","conversionLockChip","conversionPosition",
  "conversionState","activeSubsystem","speedSlider","speedValue","convertWheelchairBtn","returnBedBtn","statusEsp32","statusMax30102",
  "statusMlx90614","statusBatteryMonitor","statusConversionMotor","statusWebSocket","statusEmergency","emergencyChip",
  "drivePassword","unlockDriveBtn","lockDriveBtn","driveLockChip","driveSpeedSlider","driveSpeedValue","drivePanel","emergencyStopBtn","resetEmergencyBtn","eventLog","adminOpen","adminClose","adminDrawer","drawerBackdrop","adminPassword",
  "adminLoginBtn","adminLoginPanel","adminForm","formPatientName","formAge","formGender","formBlood","formCaregiver","formWard",
  "formCondition","formMovementPassword","formAdminPassword","thresholdHrLow","thresholdHrHigh","thresholdSpo2Low",
  "thresholdSpo2Critical","thresholdTempHigh","thresholdBatteryLow","clearPatientBtn","adminLogoutBtn","toast"
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
if (localStorage.getItem("hm_password_profile") !== "drive-v2") {
  appState.passwords.movement = "convert123";
  appState.passwords.drive = "move123";
  saveJSON("hm_passwords", appState.passwords);
  localStorage.setItem("hm_password_profile", "drive-v2");
}

function loadJSON(key, fallback) {
  try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key)) || {}) }; }
  catch { return { ...fallback }; }
}
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function nowTime() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function clean(value, suffix = "") { return value === null || value === undefined || Number.isNaN(value) ? "--" : `${value}${suffix}`; }
function escapeHTML(text) { return String(text).replace(/[&<>"']/g, (m) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[m])); }
function showToast(message) { el.toast.textContent = message; el.toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => el.toast.classList.remove("show"), 2600); }
function logEvent(message) {
  const line = document.createElement("div");
  line.className = "log-line";
  line.innerHTML = `<time>${nowTime()}</time><span>${escapeHTML(message)}</span>`;
  el.eventLog.prepend(line);
  while (el.eventLog.children.length > 80) el.eventLog.lastChild.remove();
}

function connectESP32() {
  const ip = el.esp32Ip.value.trim() || DEFAULT_ESP32_IP;
  if (!/^[a-zA-Z0-9.-]+$/.test(ip)) { showToast("Invalid ESP32 IP address"); return; }
  appState.esp32Ip = ip;
  appState.manualDisconnect = false;
  closeSocket(false);
  const url = `ws://${ip}${WS_PATH}`;
  updateConnectionStatus("CONNECTING");
  logEvent(`Connecting to ${url}`);
  try {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    appState.websocket = ws;
    ws.addEventListener("open", () => {
      appState.connected = true;
      appState.reconnectAttempts = 0;
      updateConnectionStatus("CONNECTED");
      sendCommand("PING", {}, false);
      sendSpeed();
      logEvent("ESP32 WebSocket connected");
    });
    ws.addEventListener("message", (event) => handleSocketMessage(event.data));
    ws.addEventListener("close", () => handleDisconnect("WebSocket disconnected"));
    ws.addEventListener("error", () => { logEvent("WebSocket connection error"); updateConnectionStatus("ERROR"); });
  } catch {
    updateConnectionStatus("ERROR");
    scheduleReconnect();
  }
}
function disconnectESP32() {
  appState.manualDisconnect = true;
  stopHoldCommand("Manual disconnect");
  closeSocket(true);
  resetLiveValues();
  updateConnectionStatus("DISCONNECTED");
  logEvent("Disconnected by user");
}
function closeSocket(reset) {
  if (appState.websocket) { try { appState.websocket.close(); } catch {} }
  appState.websocket = null;
  appState.connected = false;
  if (reset) clearTimeout(appState.reconnectTimer);
}
function handleDisconnect(reason) {
  appState.connected = false;
  stopHoldCommand(reason);
  resetLiveValues();
  updateConnectionStatus("DISCONNECTED");
  logEvent(reason);
  if (!appState.manualDisconnect) scheduleReconnect();
}
function scheduleReconnect() {
  clearTimeout(appState.reconnectTimer);
  const delay = Math.min(10000, 1800 + appState.reconnectAttempts * 1200);
  appState.reconnectAttempts += 1;
  appState.reconnectTimer = setTimeout(connectESP32, delay);
  updateConnectionStatus("RECONNECTING");
}

async function handleSocketMessage(raw) {
  try {
    // Handle WebSocket text data
    if (typeof raw === "string") {
      raw = raw.trim();
    }

    // Handle Blob
    if (raw instanceof Blob) {
      raw = await raw.text();
      raw = raw.trim();
    }

    // Handle ArrayBuffer
    else if (raw instanceof ArrayBuffer) {
      raw = new TextDecoder("utf-8").decode(raw).trim();
    }

    // Handle typed arrays
    else if (ArrayBuffer.isView(raw)) {
      raw = new TextDecoder("utf-8").decode(raw).trim();
    }

    if (!raw) {
      return;
    }

    // Convert JSON string into object
    let data;

    try {
      data = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (jsonError) {
      console.error("Invalid JSON from ESP32:", raw);
      logEvent(`Invalid JSON received: ${String(raw).substring(0, 100)}`);
      return;
    }

    // =====================================================
    // TELEMETRY
    // =====================================================

    if (data.type === "telemetry") {

      // Confirm ESP32 is alive
      appState.connected = true;

      // Update telemetry
      handleTelemetry(data);

      logEvent("Telemetry received from ESP32");

      return;
    }

    // =====================================================
    // COMMAND ACK
    // =====================================================

    if (data.type === "ack") {

      logEvent(
        `ESP32 ACK: ${data.command || "command"}`
      );

      return;
    }

    // =====================================================
    // ESP32 ERROR
    // =====================================================

    if (data.type === "error") {

      logEvent(
        `ESP32 Error: ${data.message || "Unknown error"}`
      );

      return;
    }

    // =====================================================
    // OTHER MESSAGE
    // =====================================================

    console.log("ESP32 message:", data);

  } catch (error) {

    console.error(
      "HealMotion WebSocket message error:",
      error,
      raw
    );

    logEvent(
      "WebSocket message processing error"
    );
  }
}
function handleTelemetry(data) {
  appState.lastTelemetryTime = Date.now();
  appState.heartRate = numberOrNull(data.heartRate);
  appState.spo2 = numberOrNull(data.spo2);
  appState.bodyTemperature = numberOrNull(data.bodyTemperature);
  appState.ambientTemperature = numberOrNull(data.ambientTemperature);
  appState.batteryVoltage = numberOrNull(data.batteryVoltage);
  appState.batteryPercent = numberOrNull(data.batteryPercent);
  appState.batteryStatus = data.batteryStatus || "UNKNOWN";
  appState.conversionState = data.conversionState || appState.conversionState || "IDLE";
  appState.conversionPosition = data.conversionPosition || appState.conversionPosition || "UNKNOWN";
  appState.emergency = Boolean(data.emergency);
  updateAll();
}
function numberOrNull(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function resetLiveValues() {
  Object.assign(appState, { heartRate:null, spo2:null, bodyTemperature:null, ambientTemperature:null, batteryVoltage:null, batteryPercent:null, batteryStatus:"UNKNOWN", lastTelemetryTime:null, conversionState:"DISCONNECTED" });
  updateAll();
}

function sendCommand(command, extra = {}, requireConnection = true) {
  if (requireConnection && !appState.connected) { showToast("ESP32 disconnected"); return false; }
  if (appState.emergency && command !== "RESET_EMERGENCY" && command !== "EMERGENCY_STOP") { showToast("Emergency stop active"); return false; }
  try {
    appState.websocket?.send(JSON.stringify({ type: "command", command, ...extra }));
    logEvent(`Sent: ${command}${extra.value !== undefined ? ` (${extra.value}%)` : ""}`);
    return true;
  } catch {
    logEvent(`Failed to send: ${command}`);
    return false;
  }
}
function sendSpeed() {
  const value = Number(el.speedSlider.value);
  el.speedValue.textContent = `${value}%`;
  if (appState.connected) sendCommand("SPEED", { value }, false);
}
function canRunMotor() { return appState.connected && appState.movementUnlocked && !appState.emergency && appState.activeSubsystem !== "DRIVING"; }
function startHoldCommand(command, button) {
  if (!canRunMotor()) { showToast("Motor controls locked"); return; }
  appState.activeHoldCommand = command;
  appState.activeSubsystem = "CONVERSION";
  button.classList.add("active");
  sendCommand(command);
  updateAll();
}
function stopHoldCommand(reason = "Stop") {
  if (appState.activeHoldCommand || appState.activeSubsystem === "CONVERSION") sendCommand("CONVERT_STOP", {}, appState.connected);
  document.querySelectorAll(".hold").forEach((button) => button.classList.remove("active"));
  appState.activeHoldCommand = null;
  if (appState.activeSubsystem === "CONVERSION") appState.activeSubsystem = "IDLE";
  updateAll();
  if (reason !== "Stop") logEvent(`Safety stop: ${reason}`);
}
function triggerEmergencyStop() {
  stopHoldCommand("Emergency");
  appState.emergency = true;
  sendCommand("EMERGENCY_STOP", {}, appState.connected);
  appState.movementUnlocked = false;
  updateAll();
  showToast("Emergency stop active");
}
function resetEmergency() {
  sendCommand("RESET_EMERGENCY", {}, appState.connected);
  appState.emergency = false;
  appState.activeSubsystem = "IDLE";
  updateAll();
  showToast("Emergency reset sent");
}

function sendDriveSpeed() {
  const value = Number(el.driveSpeedSlider?.value || 50);
  if (el.driveSpeedValue) el.driveSpeedValue.textContent = `${value}%`;
  if (appState.connected) sendCommand("DRIVE_SPEED", { value }, false);
}
function canDrive() { return appState.connected && appState.driveUnlocked && !appState.emergency && appState.activeSubsystem !== "CONVERSION"; }
function sendDriveCommand(command) {
  if (!canDrive()) { showToast("Drive controls locked"); return; }
  appState.activeSubsystem = command === "DRIVE_STOP" ? "IDLE" : "DRIVING";
  sendCommand(command, { speed: Number(el.driveSpeedSlider?.value || 50) });
  updateAll();
}

function updateAll() { updatePatient(); updateConnectionStatus(); updateHealthCards(); updateControls(); updateDriveControls(); updateSystemStatus(); }
function updateConnectionStatus(mode) {
  const connected = appState.connected;
  const text = mode === "RECONNECTING" ? "Reconnecting" : connected ? "Connected" : "Disconnected";
  el.endpointText.textContent = `Endpoint: ws://${appState.esp32Ip}${WS_PATH}`;
  el.topConnection.innerHTML = `<i></i>${text}`;
  el.topConnection.className = `pill ${connected ? "" : "danger"}`;
  el.connectionChip.textContent = text;
  el.connectionChip.className = `chip ${connected ? "ok" : "danger"}`;
  el.wifiStatus.textContent = connected ? "Connected" : mode === "RECONNECTING" ? "Reconnecting" : "--";
  el.socketStatus.textContent = connected ? "Connected" : mode === "RECONNECTING" ? "Reconnecting" : "Disconnected";
}
function updatePatient() {
  const p = appState.patient;
  el.patientName.textContent = p.name || "Patient";
  el.patientAge.textContent = p.age || "--";
  el.patientGender.textContent = p.gender || "--";
  el.patientBlood.textContent = p.blood || "--";
  el.patientCaregiver.textContent = p.caregiver || "--";
  el.patientWard.textContent = p.ward || "--";
  el.patientCondition.textContent = p.condition || "No patient condition added.";
  el.wardChip.textContent = `Ward ${p.ward || "--"}`;
  el.patientAvatar.textContent = (p.name || "P").split(/\s+/).filter(Boolean).slice(0,2).map((x) => x[0]).join("").toUpperCase() || "P";
}
function updateHealthCards() {
  const stale = appState.connected && appState.lastTelemetryTime && Date.now() - appState.lastTelemetryTime > 5000;
  el.lastUpdate.textContent = appState.lastTelemetryTime ? `Last Update: ${new Date(appState.lastTelemetryTime).toLocaleTimeString()}` : "Last Update: --";
  if (stale) el.lastUpdate.textContent = "DATA STALE";
  setVital("heartRate", appState.heartRate, "heartRateStatus", evaluateHR(appState.heartRate), "heartRateCard", stale);
  setVital("spo2", appState.spo2, "spo2Status", evaluateSpo2(appState.spo2), "spo2Card", stale);
  setVital("bodyTemperature", appState.bodyTemperature, "bodyTempStatus", evaluateTemp(appState.bodyTemperature), "bodyTempCard", stale, 1);
  setVital("ambientTemperature", appState.ambientTemperature, "ambientTempStatus", appState.ambientTemperature === null ? ["Waiting for ESP32", ""] : ["Available", "ok"], "ambientTempCard", stale, 1);
  setVital("batteryPercent", appState.batteryPercent, "batteryPercentStatus", evaluateBattery(appState.batteryPercent), "batteryPercentCard", stale);
  setVital("batteryVoltage", appState.batteryVoltage, "batteryVoltageStatus", appState.batteryVoltage === null ? ["Waiting for ESP32", ""] : [appState.batteryStatus || "Estimated", "ok"], "batteryVoltageCard", stale, 2);
  el.topBattery.textContent = `Battery: ${clean(appState.batteryPercent, "%")}`;
  el.sensorSummary.textContent = sensorSummary();
}
function setVital(valueId, value, statusId, evaluation, cardId, stale, decimals = 0) {
  el[valueId].textContent = value === null ? "--" : Number(value).toFixed(decimals);
  el[statusId].textContent = stale ? "Data stale" : evaluation[0];
  el[cardId].classList.remove("ok", "warn", "danger", "stale");
  const statusClass = stale ? "stale" : evaluation[1];
  if (statusClass) el[cardId].classList.add(statusClass);
}
function evaluateHR(v) { if (v === null) return ["Waiting for ESP32", ""]; if (v < appState.thresholds.hrLow) return ["LOW - outside threshold", "warn"]; if (v > appState.thresholds.hrHigh) return ["HIGH - outside threshold", "warn"]; return ["Normal", "ok"]; }
function evaluateSpo2(v) { if (v === null) return ["Waiting for ESP32", ""]; if (v < appState.thresholds.spo2Critical) return ["CRITICAL - outside threshold", "danger"]; if (v < appState.thresholds.spo2Low) return ["LOW - outside threshold", "warn"]; return ["Normal", "ok"]; }
function evaluateTemp(v) { if (v === null) return ["Waiting for ESP32", ""]; if (v > appState.thresholds.tempHigh) return ["HIGH - outside threshold", "warn"]; return ["Normal", "ok"]; }
function evaluateBattery(v) { if (v === null) return ["Waiting for ESP32", ""]; if (v <= 10) return ["CRITICAL", "danger"]; if (v < appState.thresholds.batteryLow) return ["LOW", "warn"]; return [appState.batteryStatus || "GOOD", "ok"]; }
function sensorSummary() {
  if (!appState.connected) return "--";
  const count = [appState.heartRate, appState.spo2, appState.bodyTemperature, appState.ambientTemperature].filter((v) => v !== null).length;
  return count === 4 ? "Online" : count > 0 ? "Partial" : "Sensor Error";
}
function updateControls() {
  const enabled = canRunMotor();
  el.convertWheelchairBtn.disabled = !enabled;
  el.returnBedBtn.disabled = !enabled;
  el.conversionLockChip.textContent = enabled ? "Unlocked" : appState.emergency ? "Emergency Lock" : "Controls Locked";
  el.conversionLockChip.className = `chip ${enabled ? "ok" : "danger"}`;
  if (el.conversionPosition) el.conversionPosition.textContent = appState.connected ? appState.conversionPosition : "--";
  el.conversionState.textContent = appState.connected ? stateLabel(appState.conversionState) : "Disconnected";
  el.activeSubsystem.textContent = appState.activeSubsystem;
  el.motorReady.textContent = enabled ? "Ready" : "Locked";
  el.patientSystem.textContent = appState.emergency ? "Emergency" : appState.connected ? "Online" : "Standby";
  document.body.classList.toggle("emergency-active", appState.emergency);
}
function stateLabel(state) {
  return { IDLE:"Ready", CONVERTING:"Converting...", RETURNING:"Returning to bed...", STOPPED:"Stopped", DISCONNECTED:"Disconnected" }[state] || state || "--";
}
function updateDriveControls() {
  const enabled = canDrive();
  if (el.driveLockChip) {
    el.driveLockChip.textContent = enabled ? "Drive Unlocked" : appState.emergency ? "Emergency Lock" : "Drive Locked";
    el.driveLockChip.className = `chip ${enabled ? "ok" : "danger"}`;
  }
  document.querySelectorAll(".joy-btn").forEach((button) => { button.disabled = !enabled && button.dataset.driveCommand !== "DRIVE_STOP"; });
}

function updateSystemStatus() {
  if (el.statusEsp32) el.statusEsp32.textContent = appState.connected ? "Connected" : "Disconnected";
  if (el.statusMax30102) el.statusMax30102.textContent = appState.connected ? (appState.heartRate !== null || appState.spo2 !== null ? "Online" : "No Data") : "--";
  if (el.statusMlx90614) el.statusMlx90614.textContent = appState.connected ? (appState.bodyTemperature !== null || appState.ambientTemperature !== null ? "Online" : "No Data") : "--";
  if (el.statusBatteryMonitor) el.statusBatteryMonitor.textContent = appState.connected ? (appState.batteryVoltage !== null ? "Online" : "No Data") : "--";
  if (el.statusConversionMotor) el.statusConversionMotor.textContent = canRunMotor() ? "Ready" : "Locked";
  if (el.statusWebSocket) el.statusWebSocket.textContent = appState.connected ? "Connected" : "Disconnected";
  if (el.statusEmergency) el.statusEmergency.textContent = appState.emergency ? "Emergency Stop Active" : "Normal";
  el.emergencyChip.textContent = appState.emergency ? "Emergency Active" : "Normal";
  el.emergencyChip.className = `chip ${appState.emergency ? "danger" : "ok"}`;
}

function openAdmin() { el.adminDrawer.classList.add("open"); el.drawerBackdrop.classList.add("open"); fillAdminForm(); }
function closeAdmin() { el.adminDrawer.classList.remove("open"); el.drawerBackdrop.classList.remove("open"); }
function adminLogin() {
  if (el.adminPassword.value === appState.passwords.admin) {
    el.adminLoginPanel.hidden = true;
    el.adminForm.hidden = false;
    el.adminPassword.value = "";
    fillAdminForm();
  } else showToast("Wrong admin password");
}
function fillAdminForm() {
  const p = appState.patient, t = appState.thresholds;
  el.formPatientName.value = p.name || "";
  el.formAge.value = p.age || "";
  el.formGender.value = p.gender || "";
  el.formBlood.value = p.blood || "";
  el.formCaregiver.value = p.caregiver || "";
  el.formWard.value = p.ward || "";
  el.formCondition.value = p.condition || "";
  el.thresholdHrLow.value = t.hrLow;
  el.thresholdHrHigh.value = t.hrHigh;
  el.thresholdSpo2Low.value = t.spo2Low;
  el.thresholdSpo2Critical.value = t.spo2Critical;
  el.thresholdTempHigh.value = t.tempHigh;
  el.thresholdBatteryLow.value = t.batteryLow;
}
function saveAdmin(event) {
  event.preventDefault();
  appState.patient = {
    name: el.formPatientName.value.trim() || "Patient",
    age: el.formAge.value.trim() || "--",
    gender: el.formGender.value.trim() || "--",
    blood: el.formBlood.value.trim() || "--",
    caregiver: el.formCaregiver.value.trim() || "--",
    ward: el.formWard.value.trim() || "--",
    condition: el.formCondition.value.trim() || "No patient condition added."
  };
  appState.thresholds = {
    hrLow: Number(el.thresholdHrLow.value) || defaultThresholds.hrLow,
    hrHigh: Number(el.thresholdHrHigh.value) || defaultThresholds.hrHigh,
    spo2Low: Number(el.thresholdSpo2Low.value) || defaultThresholds.spo2Low,
    spo2Critical: Number(el.thresholdSpo2Critical.value) || defaultThresholds.spo2Critical,
    tempHigh: Number(el.thresholdTempHigh.value) || defaultThresholds.tempHigh,
    batteryLow: Number(el.thresholdBatteryLow.value) || defaultThresholds.batteryLow
  };
  if (el.formMovementPassword.value.trim()) appState.passwords.movement = el.formMovementPassword.value.trim();
  if (el.formAdminPassword.value.trim()) appState.passwords.admin = el.formAdminPassword.value.trim();
  el.formMovementPassword.value = "";
  el.formAdminPassword.value = "";
  saveJSON("hm_patient", appState.patient);
  saveJSON("hm_thresholds", appState.thresholds);
  saveJSON("hm_passwords", appState.passwords);
  updateAll();
  showToast("Admin settings saved");
}
function clearPatient() { appState.patient = { ...defaultPatient }; saveJSON("hm_patient", appState.patient); fillAdminForm(); updateAll(); }
function logoutAdmin() { el.adminForm.hidden = true; el.adminLoginPanel.hidden = false; }

function attachEvents() {
  el.connectBtn.addEventListener("click", connectESP32);
  el.disconnectBtn.addEventListener("click", disconnectESP32);
  el.clearLogBtn.addEventListener("click", () => el.eventLog.innerHTML = "");
  el.esp32Ip.addEventListener("input", () => { appState.esp32Ip = el.esp32Ip.value.trim() || DEFAULT_ESP32_IP; el.endpointText.textContent = `Endpoint: ws://${appState.esp32Ip}${WS_PATH}`; });
  el.unlockMovementBtn.addEventListener("click", () => {
    if (el.movementPassword.value === appState.passwords.movement) { appState.movementUnlocked = true; el.movementPassword.value = ""; showToast("Movement controls unlocked"); updateAll(); }
    else showToast("Wrong movement password");
  });
  el.lockMovementBtn.addEventListener("click", () => { stopHoldCommand("Manual lock"); appState.movementUnlocked = false; updateAll(); });
  el.unlockDriveBtn?.addEventListener("click", () => {
    if (el.drivePassword.value === appState.passwords.drive) { appState.driveUnlocked = true; el.drivePassword.value = ""; showToast("Drive controls unlocked"); updateAll(); }
    else showToast("Wrong drive password");
  });
  el.lockDriveBtn?.addEventListener("click", () => { sendDriveCommand("DRIVE_STOP"); appState.driveUnlocked = false; appState.activeSubsystem = "IDLE"; updateAll(); });
  el.driveSpeedSlider?.addEventListener("input", sendDriveSpeed);
  document.querySelectorAll(".joy-btn").forEach((button) => button.addEventListener("click", () => sendDriveCommand(button.dataset.driveCommand)));
  el.speedSlider.addEventListener("input", sendSpeed);
  el.emergencyStopBtn.addEventListener("click", triggerEmergencyStop);
  el.resetEmergencyBtn.addEventListener("click", resetEmergency);
  [el.convertWheelchairBtn, el.returnBedBtn].forEach((button) => {
    button.addEventListener("pointerdown", (event) => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); startHoldCommand(button.dataset.command, button); });
    button.addEventListener("pointerup", () => stopHoldCommand());
    button.addEventListener("pointercancel", () => stopHoldCommand("Pointer cancelled"));
    button.addEventListener("lostpointercapture", () => stopHoldCommand("Pointer released"));
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  });
  window.addEventListener("blur", () => stopHoldCommand("Browser lost focus"));
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopHoldCommand("Page hidden"); });
  el.adminOpen.addEventListener("click", openAdmin);
  el.adminClose.addEventListener("click", closeAdmin);
  el.drawerBackdrop.addEventListener("click", closeAdmin);
  el.adminLoginBtn.addEventListener("click", adminLogin);
  el.adminForm.addEventListener("submit", saveAdmin);
  el.clearPatientBtn.addEventListener("click", clearPatient);
  el.adminLogoutBtn.addEventListener("click", logoutAdmin);
}

function init() {
  el.esp32Ip.value = appState.esp32Ip;
  attachEvents();
  setInterval(() => {
    el.clockText.textContent = nowTime();
    if (appState.connected && appState.lastTelemetryTime && Date.now() - appState.lastTelemetryTime > 5000) updateHealthCards();
  }, 1000);
  updateAll();
  logEvent("HealMotion interface ready - waiting for ESP32");
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("service-worker.js").catch(() => {});
}
init();
