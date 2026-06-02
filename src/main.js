// ============================================================
// Wazuh Agent Installer — Frontend Logic
// ============================================================
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ---- State ----
let currentStep = 0;
const totalSteps = 5;
let isInstalling = false;

// ---- DOM refs ----
const panels = document.querySelectorAll('.step-panel');
const stepItems = document.querySelectorAll('.step-item');
const connectors = document.querySelectorAll('.step-connector');
const btnNext = document.getElementById('btn-next');
const btnBack = document.getElementById('btn-back');
const footerHint = document.getElementById('footer-hint');

// Config inputs
const elManagerSelect = document.getElementById('wazuh-manager');
const elManagerCustom = document.getElementById('wazuh-manager-custom');
const AGENT_VERSION = '4.14.1-1'; // fixed — not user-editable
const elTrivy = document.getElementById('install-trivy');

// Show/hide custom input when "Other" is selected
elManagerSelect.addEventListener('change', () => {
  if (elManagerSelect.value === 'other') {
    elManagerCustom.style.display = 'block';
    elManagerCustom.focus();
  } else {
    elManagerCustom.style.display = 'none';
    elManagerCustom.value = '';
  }
});

function getManagerValue() {
  if (elManagerSelect.value === 'other') {
    return elManagerCustom.value.trim();
  }
  return elManagerSelect.value.trim();
}

// IDS mode pills
const suricataModeSection = document.getElementById('suricata-mode-section');
const suricataModePills = document.querySelectorAll('#suricata-mode-group .pill');

// Terminal
const terminal = document.getElementById('terminal');
const terminalPlaceholder = document.getElementById('terminal-placeholder');
const statusBanner = document.getElementById('status-banner');

// ---- Helpers ----
function getConfig() {
  const selectedModePill = document.querySelector('#suricata-mode-group .pill.selected');
  return {
    wazuh_manager: getManagerValue(),
    wazuh_agent_name: 'wazuh-agent',
    wazuh_agent_version: AGENT_VERSION,
    log_level: 'INFO',
    ids_engine: 'suricata',
    suricata_mode: selectedModePill ? selectedModePill.dataset.mode : 'ids',
    install_trivy: elTrivy.checked,
  };
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ---- Stepper navigation ----
function goToStep(step) {
  if (step < 0 || step >= totalSteps) return;
  currentStep = step;

  // Update panels
  panels.forEach((p, i) => {
    p.classList.toggle('active', i === step);
  });

  // Update step indicators
  stepItems.forEach((item, i) => {
    item.classList.remove('active', 'done');
    if (i === step) item.classList.add('active');
    else if (i < step) item.classList.add('done');
  });

  connectors.forEach((c, i) => {
    c.classList.toggle('done', i < step);
  });

  // Update buttons
  btnBack.style.visibility = step === 0 ? 'hidden' : 'visible';

  if (step === totalSteps - 1) {
    // Enroll step — hide footer buttons entirely, handled by in-panel buttons
    btnNext.style.display = 'none';
    btnBack.style.display = 'none';
  } else if (step === 3) {
    btnNext.textContent = '⚡ Install';
  } else if (step === 2) {
    btnNext.textContent = 'Start Install →';
    btnNext.style.display = '';
    btnBack.style.display = '';
  } else {
    btnNext.textContent = 'Next →';
    btnNext.style.display = '';
    btnBack.style.display = '';
  }

  if (isInstalling) {
    btnNext.style.display = 'none';
    btnBack.style.display = 'none';
  }

  footerHint.textContent = `Step ${step + 1} of ${totalSteps}`;

  // Populate summary on step 2
  if (step === 2) populateSummary();

  // Set manager label on enroll step
  if (step === 4) {
    const label = document.getElementById('enroll-manager-label');
    if (label) label.textContent = getManagerValue() || 'your Wazuh manager';
  }
}

function populateSummary() {
  const cfg = getConfig();
  const list = document.getElementById('summary-list');
  const items = [
    ['Wazuh Manager', cfg.wazuh_manager],
    ['Agent Version', cfg.wazuh_agent_version],
    ['IDS Engine', `Suricata (${cfg.suricata_mode.toUpperCase()})`],
    ['Install Trivy', cfg.install_trivy ? 'Yes' : 'No'],
    ['Core Components', 'Agent, Cert-OAuth2, Agent Status, Yara, USB DLP'],
  ];
  list.innerHTML = items
    .map(([label, value]) => `<li><span class="label">${label}</span><span class="value">${value}</span></li>`)
    .join('');
}

// ---- IDS Mode Pills ----
function setupRadioCards() {
  suricataModePills.forEach(pill => {
    pill.addEventListener('click', () => {
      suricataModePills.forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
    });
  });
}

// ---- Terminal log ----
function appendLog(line, level) {
  if (terminalPlaceholder) {
    terminalPlaceholder.remove();
  }
  const div = document.createElement('div');
  div.className = `log-line ${level}`;
  div.textContent = stripAnsi(line);
  terminal.appendChild(div);
  terminal.scrollTop = terminal.scrollHeight;
}

function showStatus(type, message) {
  statusBanner.className = `status-banner visible ${type}`;
  const icon = type === 'running' ? '<span class="spinner"></span>'
    : type === 'success' ? '✓'
    : '✕';
  statusBanner.innerHTML = `${icon} ${message}`;
}

// ---- Installation ----
async function startInstall() {
  const cfg = getConfig();
  isInstalling = true;

  // Hide nav buttons during install
  btnNext.style.display = 'none';
  btnBack.style.display = 'none';
  footerHint.textContent = 'Installing…';

  showStatus('running', 'Installation in progress…');
  appendLog('Starting Wazuh Agent installation…', 'info');
  appendLog('A system password prompt will appear — please authenticate to continue.', 'info');

  // Listen for log events from Rust
  const unlistenLog = await listen('install-log', (event) => {
    appendLog(event.payload.line, event.payload.level);
  });

  try {
    const result = await invoke('run_install', {
      config: cfg,
      scriptPath: null,
    });

    if (result.success) {
      showStatus('success', result.message);
      showResult(true, result.message);
    } else {
      showStatus('error', result.message);
      showResult(false, result.message);
    }
  } catch (err) {
    const msg = typeof err === 'string' ? err : err.message || 'Unknown error';
    appendLog(`ERROR: ${msg}`, 'error');
    showStatus('error', `Installation failed: ${msg}`);
    showResult(false, msg);
  }

  unlistenLog();
  isInstalling = false;
}

function showResult(success, message) {
  const resultScreen = document.getElementById('result-screen');
  const resultIcon = document.getElementById('result-icon');
  const resultTitle = document.getElementById('result-title');
  const resultDesc = document.getElementById('result-desc');
  const btnEnroll = document.getElementById('btn-enroll');

  resultScreen.style.display = 'block';
  resultIcon.className = `result-icon ${success ? 'success' : 'error'}`;
  resultIcon.textContent = success ? '✓' : '✕';
  resultTitle.textContent = success ? 'Installation Complete' : 'Installation Failed';
  resultDesc.textContent = success
    ? 'The Wazuh Agent stack was installed successfully. Click below to enroll the agent.'
    : message;

  // Show/hide Enroll button based on success
  if (btnEnroll) btnEnroll.style.display = success ? 'inline-flex' : 'none';

  footerHint.textContent = success ? 'Done' : 'Failed';
}

// ---- Validation ----
function validateStep(step) {
  if (step === 0) {
    const manager = getManagerValue();
    if (!manager) {
      elManagerSelect.focus();
      elManagerSelect.style.borderColor = 'var(--status-error)';
      return false;
    }
    elManagerSelect.style.borderColor = '';
    if (elManagerSelect.value === 'other' && !elManagerCustom.value.trim()) {
      elManagerCustom.focus();
      elManagerCustom.style.borderColor = 'var(--status-error)';
      return false;
    }
    elManagerCustom.style.borderColor = '';
  }
  return true;
}

// ---- Event bindings ----
btnNext.addEventListener('click', () => {
  if (isInstalling) return;

  if (currentStep < 2) {
    if (!validateStep(currentStep)) return;
    goToStep(currentStep + 1);
  } else if (currentStep === 2) {
    goToStep(3);
    startInstall();
  }
});

// Enroll button on Install result screen
document.getElementById('btn-enroll')?.addEventListener('click', () => {
  goToStep(4);
});

// Start Enrollment button on Enroll step
async function runEnrollment() {
  const startArea = document.getElementById('enroll-start-area');
  const terminalArea = document.getElementById('enroll-terminal-area');
  const enrollTerminal = document.getElementById('enroll-terminal');
  const enrollStatusBanner = document.getElementById('enroll-status-banner');
  const retryBtn = document.getElementById('btn-retry-enroll');

  // Reset terminal for re-runs
  enrollTerminal.innerHTML = '<div class="terminal-placeholder" id="enroll-terminal-placeholder"><span class="spinner"></span> Running enrollment…</div>';
  const enrollPlaceholder = document.getElementById('enroll-terminal-placeholder');

  // Switch to terminal view
  startArea.style.display = 'none';
  terminalArea.style.display = 'block';
  if (retryBtn) retryBtn.style.display = 'none';

  // Hide previous result
  const enrollResultScreen = document.getElementById('enroll-result-screen');
  enrollResultScreen.style.display = 'none';

  // Status
  enrollStatusBanner.className = 'status-banner visible running';
  enrollStatusBanner.innerHTML = '<span class="spinner"></span> Enrollment in progress…';

  // Listen for log lines
  const unlistenEnroll = await listen('enroll-log', (event) => {
    if (enrollPlaceholder && enrollPlaceholder.parentNode) enrollPlaceholder.remove();
    const div = document.createElement('div');
    div.className = `log-line ${event.payload.level}`;
    div.textContent = stripAnsi(event.payload.line);
    enrollTerminal.appendChild(div);
    enrollTerminal.scrollTop = enrollTerminal.scrollHeight;
  });

  // Show code input when the client is waiting for the OAuth2 code
  const unlistenNeedsCode = await listen('enroll-needs-code', () => {
    const codeArea = document.getElementById('enroll-code-input-area');
    if (codeArea) codeArea.style.display = 'block';
    const codeInput = document.getElementById('enroll-code-input');
    if (codeInput) codeInput.focus();
  });

  try {
    const result = await invoke('run_enroll');

    enrollStatusBanner.className = `status-banner visible ${result.success ? 'success' : 'error'}`;
    enrollStatusBanner.innerHTML = `${result.success ? '✓' : '✕'} ${result.message}`;

    if (!result.success && retryBtn) retryBtn.style.display = 'flex';

    const enrollResultIcon = document.getElementById('enroll-result-icon');
    const enrollResultTitle = document.getElementById('enroll-result-title');
    const enrollResultDesc = document.getElementById('enroll-result-desc');

    enrollResultScreen.style.display = 'block';
    enrollResultIcon.className = `result-icon ${result.success ? 'success' : 'error'}`;
    enrollResultIcon.textContent = result.success ? '✓' : '✕';
    enrollResultTitle.textContent = result.success ? 'Enrollment Complete' : 'Enrollment Failed';
    enrollResultDesc.textContent = result.success
      ? 'The agent has been enrolled with the Wazuh manager.'
      : result.message;

    footerHint.textContent = result.success ? 'Enrolled' : 'Enrollment failed';
  } catch (err) {
    const msg = typeof err === 'string' ? err : (err.message || 'Unknown error');
    enrollStatusBanner.className = 'status-banner visible error';
    enrollStatusBanner.innerHTML = `✕ Enrollment failed: ${msg}`;
    if (retryBtn) retryBtn.style.display = 'flex';
    footerHint.textContent = 'Failed';
  }

  unlistenEnroll();
  unlistenNeedsCode();
}

document.getElementById('btn-start-enroll')?.addEventListener('click', runEnrollment);
document.getElementById('btn-retry-enroll')?.addEventListener('click', runEnrollment);

// Submit the OAuth2 code to the waiting enrollment process
document.getElementById('btn-submit-code')?.addEventListener('click', async () => {
  const codeInput = document.getElementById('enroll-code-input');
  const code = codeInput?.value?.trim();
  if (!code) return;
  try {
    await invoke('send_enroll_input', { code });
    // Hide the input after submitting
    const codeArea = document.getElementById('enroll-code-input-area');
    if (codeArea) codeArea.style.display = 'none';
    const enrollTerminal = document.getElementById('enroll-terminal');
    const div = document.createElement('div');
    div.className = 'log-line info';
    div.textContent = `> Code submitted`;
    enrollTerminal.appendChild(div);
    enrollTerminal.scrollTop = enrollTerminal.scrollHeight;
  } catch (err) {
    const msg = typeof err === 'string' ? err : (err.message || 'Unknown error');
    const enrollTerminal = document.getElementById('enroll-terminal');
    const div = document.createElement('div');
    div.className = 'log-line error';
    div.textContent = `Failed to submit code: ${msg}`;
    enrollTerminal.appendChild(div);
  }
});

// Allow pressing Enter to submit the code
document.getElementById('enroll-code-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-submit-code')?.click();
});

btnBack.addEventListener('click', () => {
  if (isInstalling) return;
  if (currentStep > 0) goToStep(currentStep - 1);
});

document.getElementById('btn-close')?.addEventListener('click', async () => {
  try {
    await invoke('hide_window');
  } catch {
    try {
      const { getCurrentWindow } = window.__TAURI__.window;
      await getCurrentWindow().hide();
    } catch {
      window.close();
    }
  }
});

// ---- Init ----
setupRadioCards();
goToStep(0);
