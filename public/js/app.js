// Global Variables
let localStream = null;
let screenStream = null;
let peerConnection = null;
let dataChannel = null;
let socket = null;

let isAudioMuted = false;
let isVideoMuted = false;
let isScreenSharing = false;

let currentRoomId = null;
let currentPeerId = null;
let currentPeerName = 'Peer';
let currentPeerAvatar = '';
let callStartTime = null;
let callTimerInterval = null;

// Session details
let jwtToken = localStorage.getItem('safelink_token') || null;
let currentUser = null;
let userInterests = [];
let connectionHistory = [];
let googleClientId = '';
let subscriptionStatus = null;

// Web Audio API for Mic Meter
let audioContext = null;
let analyserNode = null;
let micStreamSource = null;
let micAnimationId = null;

// WebRTC ICE Server configuration (Google Public STUN Servers)
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// Initialize App
window.addEventListener('DOMContentLoaded', async () => {
  // Check session token and load views accordingly
  await fetchAuthConfig();
  await loadUserSession();


  // Listen for device changes in dashboard
  document.getElementById('camera-select').addEventListener('change', handleDeviceChange);
  document.getElementById('mic-select').addEventListener('change', handleDeviceChange);
  document.getElementById('toggle-preview-btn').addEventListener('click', togglePreview);
  
  // Setup Chat Form submit
  document.getElementById('chat-form').addEventListener('submit', handleSendChatMessage);

  // Setup Call buttons
  document.getElementById('call-mic-btn').addEventListener('click', toggleCallMicrophone);
  document.getElementById('call-video-btn').addEventListener('click', toggleCallCamera);
  document.getElementById('call-screenshare-btn').addEventListener('click', toggleScreenShare);
  document.getElementById('call-chat-btn').addEventListener('click', () => toggleChatDrawer());
  document.getElementById('call-hangup-btn').addEventListener('click', endCallSession);

  // Setup click outside dropdown menu to close it
  window.addEventListener('click', (e) => {
    const dropdown = document.getElementById('profile-dropdown-menu');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      const profileTrigger = e.target.closest('[onclick="toggleProfileDropdown()"]');
      const dropDownContainer = e.target.closest('#profile-dropdown-menu');
      if (!profileTrigger && !dropDownContainer) {
        dropdown.classList.add('hidden');
      }
    }
  });

  // Setup Add Interest Button on Dashboard
  document.getElementById('add-interest-trigger-btn').addEventListener('click', addNewTagPrompt);
});


// Fetch authentication configuration from the backend
async function fetchAuthConfig() {
  try {
    const res = await fetch('/api/auth/config');
    const data = await res.json();
    googleClientId = data.googleClientId;
    
    if (googleClientId) {
      console.log('[Auth] Google Client ID loaded:', googleClientId);
      initializeGoogleSSO();
    } else {
      console.log('[Auth] Google Client ID not configured. Using Mock fallback.');
    }
  } catch (err) {
    console.error('[Auth] Failed to load server auth config:', err);
  }
}

// Initialize native Google Sign-in buttons
function initializeGoogleSSO() {
  if (typeof google === 'undefined') {
    console.warn('[Google Identity] Google Client Library script not loaded yet.');
    return;
  }
  
  google.accounts.id.initialize({
    client_id: googleClientId,
    callback: handleGoogleCredentialResponse
  });

  // Switch custom button with real native button
  document.getElementById('custom-google-btn').classList.add('hidden');
  const nativeBtn = document.getElementById('google-native-signin-button');
  nativeBtn.classList.remove('hidden');

  google.accounts.id.renderButton(
    nativeBtn,
    { theme: "outline", size: "large", width: 350, text: "continue_with" }
  );
}

// Handle native Google Token validation
async function handleGoogleCredentialResponse(response) {
  try {
    showAuthError(null);
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google Authentication failed.');

    localStorage.setItem('safelink_token', data.token);
    jwtToken = data.token;
    currentUser = data.user;

    await loadUserSession();
  } catch (err) {
    showAuthError(err.message);
  }
}

// Trigger Simulator Google Sign-in if credentials not configured
async function handleGoogleSignInTrigger() {
  if (googleClientId) return; // Native button handles this

  // Open mock input window
  const email = prompt('Enter a mock email address to simulate Google login:', 'alex.rivera@gmail.com');
  if (!email) return;
  const name = prompt('Enter a mock display name:', 'Alex (SSO)');
  if (!name) return;

  // Package a mock credential payload
  const mockPayload = {
    email: email.trim(),
    name: name.trim(),
    picture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(name)}`
  };

  // Base64 encode it and append identifier tag
  const base64Payload = btoa(JSON.stringify(mockPayload));
  const mockToken = `mock_google_token_${base64Payload}`;

  try {
    showAuthError(null);
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: mockToken })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google Authentication failed.');

    localStorage.setItem('safelink_token', data.token);
    jwtToken = data.token;
    currentUser = data.user;

    await loadUserSession();
  } catch (err) {
    showAuthError(err.message);
  }
}

// Load active session from JWT
async function loadUserSession() {
  if (!jwtToken) {
    showAuthView(true);
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Session validation failed.');
    }

    currentUser = data.user;
    userInterests = currentUser.interests || [];
    connectionHistory = currentUser.history || [];

    // Populate dashboard settings
    setupDashboardUI();
    
    // Switch views
    showAuthView(false);

    // Initial socket and webcam config
    initSocket();
    await initLocalMedia();

  } catch (err) {
    console.warn('[Session] JWT Session expired or invalid:', err.message);
    handleUserSignOut();
  }
}

// Bind User Login
async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    showAuthError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');

    localStorage.setItem('safelink_token', data.token);
    jwtToken = data.token;
    currentUser = data.user;

    await loadUserSession();
  } catch (err) {
    showAuthError(err.message);
  }
}

// Bind User Signup
async function handleSignupSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('signup-name').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;

  const otpContainer = document.getElementById('signup-otp-container');
  const otpInput = document.getElementById('signup-otp');
  const submitBtn = document.getElementById('signup-submit-btn');

  // Step 1: Send OTP if OTP container is hidden
  if (otpContainer.classList.contains('hidden')) {
    try {
      showAuthError(null);
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending Verification Code...';

      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send verification code.');

      // Show OTP input and update UI
      otpContainer.classList.remove('hidden');
      otpInput.setAttribute('required', 'true');
      submitBtn.textContent = 'Verify & Create Account';

      // Lock input fields while verifying
      document.getElementById('signup-name').disabled = true;
      document.getElementById('signup-email').disabled = true;
      document.getElementById('signup-password').disabled = true;

      if (data.isSimulated && data.simulatedOtp) {
        alert(`[OTP Simulator] Verification code generated!\nSimulated OTP is: ${data.simulatedOtp}\n(It is pre-filled for easy local testing)`);
        otpInput.value = data.simulatedOtp;
      } else {
        alert('Verification OTP sent successfully! Please check your email inbox.');
      }
    } catch (err) {
      showAuthError(err.message);
      submitBtn.textContent = 'Create Account';
    } finally {
      submitBtn.disabled = false;
    }
    return;
  }

  // Step 2: Submit OTP and register user
  const otp = otpInput.value.trim();
  if (!otp) {
    showAuthError('Please enter the 6-digit OTP code sent to your email.');
    return;
  }

  try {
    showAuthError(null);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying Account...';

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, otp })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed.');

    localStorage.setItem('safelink_token', data.token);
    jwtToken = data.token;
    currentUser = data.user;

    // Reset UI state
    document.getElementById('signup-name').disabled = false;
    document.getElementById('signup-email').disabled = false;
    document.getElementById('signup-password').disabled = false;
    otpContainer.classList.add('hidden');
    otpInput.removeAttribute('required');
    otpInput.value = '';
    submitBtn.textContent = 'Create Account';

    await loadUserSession();
  } catch (err) {
    showAuthError(err.message);
    submitBtn.textContent = 'Verify & Create Account';
  } finally {
    submitBtn.disabled = false;
  }
}

// Show/Hide Auth Screen overlay
function showAuthView(visible) {
  const authView = document.getElementById('auth-view');
  const navHeader = document.getElementById('nav-header');
  const dashboardView = document.getElementById('dashboard-view');
  const footerSection = document.getElementById('footer-section');

  if (visible) {
    authView.classList.remove('hidden');
    navHeader.classList.add('hidden');
    dashboardView.classList.add('hidden');
    footerSection.classList.add('hidden');
  } else {
    authView.classList.add('hidden');
    navHeader.classList.remove('hidden');
    dashboardView.classList.remove('hidden');
    footerSection.classList.remove('hidden');
  }
}

// Render Auth Errors
function showAuthError(message) {
  const alertEl = document.getElementById('auth-error-alert');
  const textEl = document.getElementById('auth-error-text');
  
  if (message) {
    textEl.innerText = message;
    alertEl.classList.remove('hidden');
  } else {
    alertEl.classList.add('hidden');
  }
}

// Initialize socket signaling listeners
function initSocket() {
  if (socket) socket.disconnect();
  socket = io();

  socket.on('connect', () => {
    console.log('[Socket] Connected to signaling server');
  });

  socket.on('subscription-required', (data) => {
    console.warn('[Socket] Matchmaking blocked:', data.message);
    cancelMatchmaking();
    alert(data.message);
    openSubscriptionModal();
  });

  socket.on('match-found', (data) => {
    console.log('[Socket] Match found! Room ID:', data.roomId, 'Peer:', data.peerName);
    currentRoomId = data.roomId;
    currentPeerId = data.peerId;
    currentPeerName = data.peerName;
    currentPeerAvatar = data.peerAvatar;
    
    // Transition UI to active call
    enterCallScreen(data.peerInterests, data.initiator);
  });

  // Relay ICE candidate and SDP handshakes
  socket.on('signal', async (data) => {
    if (!peerConnection) return;
    
    const { from, signalData } = data;
    try {
      if (signalData.sdp) {
        console.log('[WebRTC] Received SDP signal type:', signalData.sdp.type);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        
        if (signalData.sdp.type === 'offer') {
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          socket.emit('signal', {
            to: from,
            signalData: { sdp: answer }
          });
        }
      } else if (signalData.candidate) {
        console.log('[WebRTC] Received ICE Candidate');
        await peerConnection.addIceCandidate(new RTCIceCandidate(signalData.candidate));
      }
    } catch (err) {
      console.error('[WebRTC] Error handling signal description:', err);
    }
  });

  // Update history callback
  socket.on('history-logged', (data) => {
    if (data.history) {
      connectionHistory = data.history;
      renderHistory();
    }
  });

  socket.on('peer-left', () => {
    console.log('[Socket] Peer disconnected');
    logConnectionToHistory();
    alert(`${currentPeerName} has disconnected from the call.`);
    cleanUpCallState();
  });
}

// Populate Dashboard details from authenticated user
function setupDashboardUI() {
  if (!currentUser) return;

  document.getElementById('display-name').innerText = currentUser.name;
  document.getElementById('header-username').innerText = currentUser.name;
  
  // Set avatars
  const avatarUrl = currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.name}`;
  document.getElementById('header-avatar').src = avatarUrl;
  document.getElementById('dashboard-avatar').src = avatarUrl;
  document.getElementById('matchmaking-avatar').src = avatarUrl;

  // Dropdown text
  document.getElementById('dropdown-full-name').innerText = currentUser.name;
  document.getElementById('dropdown-email').innerText = currentUser.email;

  // Provider badge
  const providerText = currentUser.provider === 'google' ? 'Google Authenticated' : 'SafeLink Verified';
  document.getElementById('account-provider-badge').innerText = `${providerText} • Member`;

  renderInterests();
  renderHistory();
  renderSubscriptionDetails();
}

// Toggle Dropdown Panel
function toggleProfileDropdown() {
  const menu = document.getElementById('profile-dropdown-menu');
  menu.classList.toggle('hidden');
}

// Edit Profile Trigger
function toggleAuthEditDetails() {
  const name = prompt('Change display name:', currentUser.name);
  if (name && name.trim() !== '') {
    // Perform simulated name update on client side
    currentUser.name = name.trim();
    setupDashboardUI();
    
    // Save locally
    localStorage.setItem('safelink_username', name.trim());
  }
}

// Sign out user session
function handleUserSignOut() {
  cleanUpCallState();
  
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  localStorage.removeItem('safelink_token');
  jwtToken = null;
  currentUser = null;
  userInterests = [];
  connectionHistory = [];

  showAuthError(null);

  // Toggle screens
  showAuthView(true);
}

// Save interests array to database
async function saveInterestsToDB() {
  if (!jwtToken) return;
  try {
    await fetch('/api/auth/interests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({ interests: userInterests })
    });
  } catch (err) {
    console.error('[Database] Failed to save interests:', err);
  }
}

// Render Interest tags in UI
function renderInterests() {
  const container = document.getElementById('interests-tags-container');
  container.innerHTML = '';
  
  userInterests.forEach((interest) => {
    const chip = document.createElement('span');
    chip.className = `px-md py-sm bg-secondary/10 border border-secondary/20 text-secondary rounded-xl font-label-md text-label-md flex items-center gap-sm hover:bg-secondary/20 cursor-pointer transition-colors group`;
    chip.innerHTML = `
      ${interest}
      <span class="material-symbols-outlined text-[14px] opacity-50 group-hover:opacity-100 transition-opacity" onclick="removeInterestTag('${interest}')">close</span>
    `;
    container.appendChild(chip);
  });
  
  const addBtn = document.createElement('span');
  addBtn.className = `px-md py-sm bg-primary/10 border border-primary/40 text-primary rounded-xl font-label-md text-label-md flex items-center gap-sm hover:bg-primary/20 cursor-pointer transition-colors active:scale-95`;
  addBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">add</span> Expand Interests`;
  addBtn.onclick = addNewTagPrompt;
  container.appendChild(addBtn);
}

// Add Tag prompt handler
async function addNewTagPrompt() {
  const tag = prompt('Enter a matchmaking interest tag (e.g. Web3, Jazz Music, Cooking):');
  if (tag && tag.trim() !== '') {
    const cleanTag = tag.trim();
    if (!userInterests.includes(cleanTag)) {
      userInterests.push(cleanTag);
      renderInterests();
      await saveInterestsToDB();
    }
  }
}

// Remove tag handler
async function removeInterestTag(tag) {
  userInterests = userInterests.filter(t => t !== tag);
  renderInterests();
  await saveInterestsToDB();
}

// Initialize Video/Audio inputs
async function initLocalMedia() {
  try {
    document.getElementById('preview-loading').classList.remove('hidden');
    document.getElementById('preview-fallback').classList.add('hidden');
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: true
    });
    
    const previewVideo = document.getElementById('local-preview');
    previewVideo.srcObject = localStream;
    previewVideo.muted = true;
    previewVideo.classList.remove('opacity-0');
    
    document.getElementById('preview-loading').classList.add('hidden');
    
    await populateDeviceSelectors();
    startMicVolumeAnalyser(localStream);
    
  } catch (err) {
    console.error('[Media] Error getting media inputs:', err);
    document.getElementById('preview-loading').classList.add('hidden');
    document.getElementById('preview-fallback').classList.remove('hidden');
    
    const previewFallback = document.getElementById('preview-fallback');
    previewFallback.innerHTML = `
      <span class="material-symbols-outlined text-4xl text-error">warning</span>
      <span class="text-label-sm uppercase tracking-widest font-bold text-error">Access Denied</span>
      <p class="text-xs text-on-surface-variant max-w-xs text-center px-lg mt-xs">Enable camera & mic permissions in browser settings.</p>
    `;
  }
}

// Enumerate local devices
async function populateDeviceSelectors() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameraSelect = document.getElementById('camera-select');
    const micSelect = document.getElementById('mic-select');
    
    const currentCamera = cameraSelect.value;
    const currentMic = micSelect.value;

    cameraSelect.innerHTML = '';
    micSelect.innerHTML = '';
    
    let videoCount = 0;
    let audioCount = 0;

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.className = 'bg-surface';
      
      if (device.kind === 'videoinput') {
        option.text = device.label || `Camera ${++videoCount}`;
        cameraSelect.appendChild(option);
      } else if (device.kind === 'audioinput') {
        option.text = device.label || `Microphone ${++audioCount}`;
        micSelect.appendChild(option);
      }
    });
    
    if (Array.from(cameraSelect.options).some(o => o.value === currentCamera)) {
      cameraSelect.value = currentCamera;
    }
    if (Array.from(micSelect.options).some(o => o.value === currentMic)) {
      micSelect.value = currentMic;
    }
  } catch (err) {
    console.error('[Devices] Error enumerating inputs:', err);
  }
}

// Handle camera/mic changes
async function handleDeviceChange() {
  const videoId = document.getElementById('camera-select').value;
  const audioId = document.getElementById('mic-select').value;
  
  try {
    document.getElementById('preview-loading').classList.remove('hidden');
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: videoId ? { exact: videoId } : undefined, width: 640, height: 480 },
      audio: audioId ? { exact: audioId } : undefined
    });
    
    document.getElementById('local-preview').srcObject = localStream;
    document.getElementById('preview-loading').classList.add('hidden');
    document.getElementById('preview-fallback').classList.add('hidden');
    
    startMicVolumeAnalyser(localStream);
    
  } catch (err) {
    console.error('[Media] Device swap failed:', err);
    document.getElementById('preview-loading').classList.add('hidden');
    document.getElementById('preview-fallback').classList.remove('hidden');
  }
}

// Local stream preview toggler
function togglePreview() {
  const toggleBtn = document.getElementById('toggle-preview-btn');
  const previewVideo = document.getElementById('local-preview');
  const fallback = document.getElementById('preview-fallback');
  
  if (localStream && localStream.getVideoTracks().length > 0) {
    const isEnabled = localStream.getVideoTracks()[0].enabled;
    localStream.getVideoTracks()[0].enabled = !isEnabled;
    
    if (isEnabled) {
      previewVideo.classList.add('opacity-0');
      fallback.classList.remove('hidden');
      toggleBtn.innerHTML = `<span class="material-symbols-outlined text-[14px]">videocam</span> <span>Start Preview</span>`;
    } else {
      previewVideo.classList.remove('opacity-0');
      fallback.classList.add('hidden');
      toggleBtn.innerHTML = `<span class="material-symbols-outlined text-[14px]">videocam_off</span> <span>Stop Preview</span>`;
    }
  }
}

// Connect Audio Graph for Microphone Level indicator
function startMicVolumeAnalyser(stream) {
  try {
    if (audioContext) {
      if (micAnimationId) cancelAnimationFrame(micAnimationId);
      audioContext.close();
    }
    
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      updateMicLevelBar(0);
      return;
    }
    
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    
    micStreamSource = audioContext.createMediaStreamSource(stream);
    micStreamSource.connect(analyserNode);
    
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const analyze = () => {
      if (!analyserNode) return;
      
      analyserNode.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      
      const average = sum / bufferLength;
      const percentage = Math.min(Math.round((average / 140) * 100), 100);
      
      updateMicLevelBar(percentage);
      
      micAnimationId = requestAnimationFrame(analyze);
    };
    
    analyze();
    
  } catch (err) {
    console.warn('[Audio] Failed to bind Web Audio Mic Meter:', err);
  }
}

function updateMicLevelBar(percentage) {
  const bar = document.getElementById('mic-level-bar');
  const dbLabel = document.getElementById('mic-db-indicator');
  if (bar) {
    bar.style.width = `${percentage}%`;
  }
  if (dbLabel) {
    if (percentage > 45) {
      dbLabel.innerText = 'High';
      dbLabel.className = 'text-primary font-bold';
    } else if (percentage > 10) {
      dbLabel.innerText = 'Active';
      dbLabel.className = 'text-primary';
    } else {
      dbLabel.innerText = 'Silent';
      dbLabel.className = 'text-on-surface-variant';
    }
  }
}

// Trigger Peer Matchmaking state
function triggerMatchmaking() {
  if (subscriptionStatus && !subscriptionStatus.active) {
    alert('Your 1-day free trial or subscription has expired. Please renew your subscription to access matchmaking.');
    openSubscriptionModal();
    return;
  }

  const dashboard = document.getElementById('dashboard-view');
  dashboard.classList.add('opacity-0', 'scale-95');
  dashboard.classList.remove('opacity-100', 'scale-100');
  
  const matchmakingTagsList = document.getElementById('matchmaking-tags-list');
  matchmakingTagsList.innerHTML = '';
  userInterests.forEach(tag => {
    const span = document.createElement('span');
    span.className = 'px-sm py-xs bg-primary/20 text-primary border border-primary/30 rounded-lg text-label-sm font-label-sm';
    span.innerText = tag;
    matchmakingTagsList.appendChild(span);
  });
  
  const matchingModal = document.getElementById('matchmaking-view');
  matchingModal.classList.add('view-active');
  matchingModal.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
  
  // Submit search to signaling server along with JWT session
  socket.emit('join-matchmaking', {
    token: jwtToken,
    interests: userInterests
  });
  
  console.log('[Matchmaking] Started matching for interests:', userInterests);
}

// Cancel Matchmaking
function cancelMatchmaking() {
  socket.emit('leave-matchmaking');
  
  const matchingModal = document.getElementById('matchmaking-view');
  matchingModal.classList.remove('view-active');
  matchingModal.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
  
  const dashboard = document.getElementById('dashboard-view');
  dashboard.classList.remove('opacity-0', 'scale-95');
  dashboard.classList.add('opacity-100', 'scale-100');
  
  console.log('[Matchmaking] Cancelled by user');
}

// Switch UI view to Call Screen
function enterCallScreen(peerInterests, isInitiator) {
  const matchingModal = document.getElementById('matchmaking-view');
  matchingModal.classList.remove('view-active');
  matchingModal.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
  
  document.getElementById('nav-header').classList.add('hidden');
  document.getElementById('footer-section').classList.add('hidden');
  
  const callView = document.getElementById('call-view');
  callView.classList.add('view-active');
  callView.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-8');
  
  const peerTagsContainer = document.getElementById('call-peer-tags');
  peerTagsContainer.innerHTML = '';
  peerInterests.forEach(tag => {
    const span = document.createElement('span');
    span.className = 'px-sm py-xs bg-secondary/20 text-secondary border border-secondary/30 rounded-lg text-label-sm font-label-sm';
    span.innerText = tag;
    peerTagsContainer.appendChild(span);
  });
  
  const shortPeerHash = `User_${currentPeerId.slice(0, 5)}...${currentPeerId.slice(-3)}`;
  document.getElementById('peer-hash-label').innerText = `Peer ID: ${shortPeerHash}`;

  // Populate peer metadata on waiting overlay
  document.getElementById('call-peer-name').innerText = currentPeerName;
  const peerAvatarUrl = currentPeerAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentPeerId}`;
  document.getElementById('call-peer-avatar').src = peerAvatarUrl;
  
  const callLocalVideo = document.getElementById('local-video');
  if (localStream) {
    callLocalVideo.srcObject = localStream;
    document.getElementById('local-video-fallback').classList.add('hidden');
  } else {
    document.getElementById('local-video-fallback').classList.remove('hidden');
  }

  startWebRTCPipeline(isInitiator);
}

// Setup RTCPeerConnection pipeline
async function startWebRTCPipeline(isInitiator) {
  try {
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Received remote track');
      const remoteVideo = document.getElementById('remote-video');
      
      if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.classList.remove('opacity-0');
        document.getElementById('call-waiting-overlay').classList.add('hidden');
        startCallTimer();
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', {
          to: currentPeerId,
          signalData: { candidate: event.candidate }
        });
      }
    };

    if (isInitiator) {
      dataChannel = peerConnection.createDataChannel('safelink-chat-tunnel');
      bindDataChannelEvents();
    } else {
      peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        bindDataChannelEvents();
      };
    }

    if (isInitiator) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      socket.emit('signal', {
        to: currentPeerId,
        signalData: { sdp: offer }
      });
    }

  } catch (err) {
    console.error('[WebRTC] Initialization error:', err);
    alert('WebRTC initialization failed.');
    cleanUpCallState();
  }
}

// Bind Data Channel triggers
function bindDataChannelEvents() {
  if (!dataChannel) return;
  
  dataChannel.onopen = () => {
    document.getElementById('chat-input').disabled = false;
    document.getElementById('chat-input').placeholder = 'Type encrypted message...';
    appendSystemMessage('Secure end-to-end P2P chat established.');
  };
  
  dataChannel.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'text') {
        appendChatMessage(currentPeerName, message.payload);
        
        const chatSidebar = document.getElementById('chat-sidebar');
        if (chatSidebar.classList.contains('translate-x-full')) {
          document.getElementById('chat-unread-badge').classList.remove('hidden');
        }
      } else if (message.type === 'video-state') {
        const fallback = document.getElementById('remote-video-fallback');
        if (message.payload === 'off') {
          fallback.classList.remove('hidden');
        } else {
          fallback.classList.add('hidden');
        }
      }
    } catch (err) {
      console.error('[DataChannel] Error parsing message object:', err);
    }
  };
  
  dataChannel.onclose = () => {
    document.getElementById('chat-input').disabled = true;
    document.getElementById('chat-input').placeholder = 'Chat unavailable (tunnel closed)';
  };
}

// Start active call duration counter
function startCallTimer() {
  if (callTimerInterval) clearInterval(callTimerInterval);
  
  callStartTime = Date.now();
  const timerLabel = document.getElementById('call-duration-timer');
  
  callTimerInterval = setInterval(() => {
    const delta = Date.now() - callStartTime;
    const totalSeconds = Math.floor(delta / 1000);
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    timerLabel.innerText = `${mins}:${secs}`;
  }, 1000);
}

// Append connection info to Server Database History
function logConnectionToHistory() {
  if (!callStartTime) return;
  
  const delta = Date.now() - callStartTime;
  const totalSeconds = Math.floor(delta / 1000);
  const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const secs = (totalSeconds % 60).toString().padStart(2, '0');
  
  const durationStr = `${mins}:${secs}`;
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayStr = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  
  const newRecord = {
    hash: `User_${currentPeerId.slice(0, 5)}${currentPeerId.slice(-2)}`,
    duration: durationStr,
    timestamp: `${dayStr}, ${timeStr}`,
    tags: userInterests.slice(0, 2).join(' • ') || 'General Match'
  };
  
  // Submit record to server to update user history in DB
  if (socket && jwtToken) {
    socket.emit('log-call-history', {
      token: jwtToken,
      record: newRecord
    });
  }
}

// Render Local Connection History Logs
function renderHistory() {
  const container = document.getElementById('history-log-container');
  const summaryText = document.getElementById('history-summary-text');
  container.innerHTML = '';
  
  if (connectionHistory.length === 0) {
    summaryText.innerText = 'No cryptographic history found.';
    return;
  }
  
  connectionHistory.forEach(record => {
    const row = document.createElement('div');
    row.className = 'grid grid-cols-12 px-lg py-md items-center hover:bg-surface-container-high/40 transition-colors border-b border-outline-variant/5';
    
    const isPeerOdd = record.hash.charCodeAt(record.hash.length - 1) % 2 === 0;
    const gradientClasses = isPeerOdd 
      ? 'from-primary/20 to-secondary/20 text-primary' 
      : 'from-secondary/20 to-tertiary/20 text-secondary';
      
    row.innerHTML = `
      <div class="col-span-5 flex items-center gap-md">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br ${gradientClasses} flex items-center justify-center border border-outline-variant/20">
          <span class="material-symbols-outlined">person</span>
        </div>
        <div>
          <div class="font-label-md text-label-md text-on-surface font-mono">${record.hash}</div>
          <div class="text-label-sm text-on-surface-variant">Tags: ${record.tags}</div>
        </div>
      </div>
      <div class="col-span-3 text-center font-body-md text-body-md text-on-surface-variant">
        ${record.duration}
      </div>
      <div class="col-span-4 text-right">
        <div class="font-label-md text-label-md text-on-surface">${record.timestamp.split(',')[0]}</div>
        <div class="text-label-sm text-on-surface-variant">${record.timestamp.split(',')[1] || ''}</div>
      </div>
    `;
    container.appendChild(row);
  });
  
  summaryText.innerText = `Showing last ${connectionHistory.length} cryptographic records.`;
}

// Clear local history log (clears client display, server history remains)
function clearHistory() {
  if (confirm('Are you sure you want to clear your local screen logs? (Historical records in DB will remain).')) {
    connectionHistory = [];
    renderHistory();
  }
}

// Send Text Message over RTCDataChannel
function handleSendChatMessage(event) {
  event.preventDefault();
  
  const chatInput = document.getElementById('chat-input');
  const messageText = chatInput.value.trim();
  
  if (!messageText) return;
  if (!dataChannel || dataChannel.readyState !== 'open') {
    alert('Secure tunnel data connection is currently inactive.');
    return;
  }
  
  const payload = {
    type: 'text',
    payload: messageText
  };
  
  dataChannel.send(JSON.stringify(payload));
  appendChatMessage('You', messageText);
  chatInput.value = '';
}

// Render chats in list box
function appendChatMessage(sender, text) {
  const container = document.getElementById('chat-log-list');
  const div = document.createElement('div');
  
  const isSelf = sender === 'You';
  const flexAlignment = isSelf ? 'justify-end' : 'justify-start';
  const bubbleClass = isSelf ? 'chat-self' : 'chat-peer';
  const labelColor = isSelf ? 'text-primary' : 'text-secondary';
  
  div.className = `flex ${flexAlignment} w-full`;
  div.innerHTML = `
    <div class="chat-bubble ${bubbleClass} p-md shadow-sm">
      <span class="text-[10px] ${labelColor} font-bold block mb-1 uppercase tracking-wider">${sender}</span>
      <p class="text-body-md text-on-surface leading-tight">${escapeHTML(text)}</p>
    </div>
  `;
  
  container.appendChild(div);
  
  const scrollBox = document.getElementById('chat-messages-container');
  scrollBox.scrollTop = scrollBox.scrollHeight;
}

function appendSystemMessage(text) {
  const container = document.getElementById('chat-log-list');
  const div = document.createElement('div');
  div.className = 'flex justify-center my-xs';
  div.innerHTML = `
    <span class="text-[9px] text-on-surface-variant bg-surface-container-highest px-md py-0.5 rounded-full font-mono uppercase">
      ⚙️ ${text}
    </span>
  `;
  container.appendChild(div);
}

// Escape HTML characters
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Slide in/out Chat Panel
function toggleChatDrawer(forceState) {
  const chatSidebar = document.getElementById('chat-sidebar');
  const isClosed = chatSidebar.classList.contains('translate-x-full');
  
  const shouldOpen = (forceState !== undefined) ? forceState : isClosed;
  
  if (shouldOpen) {
    chatSidebar.classList.remove('translate-x-full');
    document.getElementById('chat-unread-badge').classList.add('hidden');
    
    setTimeout(() => {
      document.getElementById('chat-input').focus();
    }, 300);
  } else {
    chatSidebar.classList.add('translate-x-full');
  }
}

// In-call Microphone toggler
function toggleCallMicrophone() {
  const btn = document.getElementById('call-mic-btn');
  
  if (localStream && localStream.getAudioTracks().length > 0) {
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks()[0].enabled = !isAudioMuted;
    
    if (isAudioMuted) {
      btn.classList.add('btn-disabled');
      btn.innerHTML = `<span class="material-symbols-outlined">mic_off</span><span class="tooltip hidden group-hover:block absolute bottom-14 bg-surface text-on-surface border border-outline-variant/20 rounded px-2 py-1 text-xs whitespace-nowrap">Unmute Mic</span>`;
    } else {
      btn.classList.remove('btn-disabled');
      btn.innerHTML = `<span class="material-symbols-outlined">mic</span><span class="tooltip hidden group-hover:block absolute bottom-14 bg-surface text-on-surface border border-outline-variant/20 rounded px-2 py-1 text-xs whitespace-nowrap">Mute Mic</span>`;
    }
  }
}

// In-call Camera toggler
function toggleCallCamera() {
  const btn = document.getElementById('call-video-btn');
  
  if (localStream && localStream.getVideoTracks().length > 0) {
    isVideoMuted = !isVideoMuted;
    localStream.getVideoTracks()[0].enabled = !isVideoMuted;
    
    const localVideoFallback = document.getElementById('local-video-fallback');
    const localVideoEl = document.getElementById('local-video');
    
    if (isVideoMuted) {
      btn.classList.add('btn-disabled');
      btn.innerHTML = `<span class="material-symbols-outlined">videocam_off</span><span class="tooltip hidden group-hover:block absolute bottom-14 bg-surface text-on-surface border border-outline-variant/20 rounded px-2 py-1 text-xs whitespace-nowrap">Enable Video</span>`;
      localVideoFallback.classList.remove('hidden');
      localVideoEl.classList.add('opacity-0');
      
      sendDataChannelState('video-state', 'off');
    } else {
      btn.classList.remove('btn-disabled');
      btn.innerHTML = `<span class="material-symbols-outlined">videocam</span><span class="tooltip hidden group-hover:block absolute bottom-14 bg-surface text-on-surface border border-outline-variant/20 rounded px-2 py-1 text-xs whitespace-nowrap">Disable Video</span>`;
      localVideoFallback.classList.add('hidden');
      localVideoEl.classList.remove('opacity-0');
      
      sendDataChannelState('video-state', 'on');
    }
  }
}

function sendDataChannelState(type, payload) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type, payload }));
  }
}

// Screen Sharing toggler
async function toggleScreenShare() {
  const btn = document.getElementById('call-screenshare-btn');
  
  try {
    if (!isScreenSharing) {
      console.log('[ScreenShare] Requesting browser display media');
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });
      
      const screenVideoTrack = screenStream.getVideoTracks()[0];
      
      if (peerConnection) {
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(screenVideoTrack);
        }
      }
      
      document.getElementById('local-video').srcObject = screenStream;
      btn.classList.add('text-primary');
      btn.classList.remove('text-on-surface');
      isScreenSharing = true;
      
      screenVideoTrack.onended = () => {
        stopScreenSharingSession();
      };
      
    } else {
      stopScreenSharingSession();
    }
  } catch (err) {
    console.warn('[ScreenShare] Screen share selection aborted:', err);
  }
}

// Restore webcam feed in place of screen share
function stopScreenSharingSession() {
  const btn = document.getElementById('call-screenshare-btn');
  if (!isScreenSharing) return;
  
  console.log('[ScreenShare] Restoring default webcam track');
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
  }
  
  if (localStream && localStream.getVideoTracks().length > 0) {
    const defaultVideoTrack = localStream.getVideoTracks()[0];
    
    if (peerConnection) {
      const senders = peerConnection.getSenders();
      const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(defaultVideoTrack);
      }
    }
    
    document.getElementById('local-video').srcObject = localStream;
  }
  
  btn.classList.remove('text-primary');
  btn.classList.add('text-on-surface');
  isScreenSharing = false;
}

// User-triggered call disconnect
function endCallSession() {
  if (confirm('Disconnect call securely?')) {
    socket.emit('end-call');
    logConnectionToHistory();
    cleanUpCallState();
  }
}

// Graceful Call teardown & cleanup
function cleanUpCallState() {
  console.log('[Teardown] Performing peer connection cleanup');
  
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  callStartTime = null;
  document.getElementById('call-duration-timer').innerText = '00:00';
  
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (isScreenSharing) {
    stopScreenSharingSession();
  }
  
  document.getElementById('remote-video').srcObject = null;
  document.getElementById('remote-video').classList.add('opacity-0');
  document.getElementById('local-video').srcObject = null;
  
  document.getElementById('remote-video-fallback').classList.add('hidden');
  document.getElementById('local-video-fallback').classList.add('hidden');
  
  isAudioMuted = false;
  isVideoMuted = false;
  
  const micBtn = document.getElementById('call-mic-btn');
  micBtn.classList.remove('btn-disabled');
  micBtn.innerHTML = `<span class="material-symbols-outlined">mic</span><span class="tooltip hidden group-hover:block absolute bottom-14 bg-surface text-on-surface border border-outline-variant/20 rounded px-2 py-1 text-xs whitespace-nowrap">Mute Mic</span>`;
  
  const vidBtn = document.getElementById('call-video-btn');
  vidBtn.classList.remove('btn-disabled');
  vidBtn.innerHTML = `<span class="material-symbols-outlined">videocam</span><span class="tooltip hidden group-hover:block absolute bottom-14 bg-surface text-on-surface border border-outline-variant/20 rounded px-2 py-1 text-xs whitespace-nowrap">Disable Video</span>`;
  
  document.getElementById('chat-log-list').innerHTML = `
    <div class="flex justify-center my-md">
      <span class="text-[10px] text-primary/80 bg-primary/10 border border-primary/20 rounded-full px-md py-1 font-mono uppercase tracking-wider">
        🔒 End-to-End Encrypted Tunnel
      </span>
    </div>
  `;
  document.getElementById('chat-unread-badge').classList.add('hidden');
  toggleChatDrawer(false);
  
  // Show header and footer
  document.getElementById('nav-header').classList.remove('hidden');
  document.getElementById('footer-section').classList.remove('hidden');
  
  // Transition Call screen out, show Dashboard
  const callView = document.getElementById('call-view');
  callView.classList.remove('view-active');
  callView.classList.add('opacity-0', 'pointer-events-none', 'translate-y-8');
  
  const dashboard = document.getElementById('dashboard-view');
  dashboard.classList.remove('opacity-0', 'scale-95');
  dashboard.classList.add('opacity-100', 'scale-100');
  
  initLocalMedia();
  
  currentRoomId = null;
  currentPeerId = null;
  currentPeerName = 'Peer';
  currentPeerAvatar = '';
}

// ==================== SUBSCRIPTION & PAYMENT MANAGEMENT ====================

// Navigate user to card view and animate
function openSubscriptionModal() {
  const subCard = document.getElementById('subscription-status-card');
  if (subCard) {
    subCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Pulse animation styling trigger
    subCard.classList.add('ring-4', 'ring-primary/50', 'scale-102', 'transition-all', 'duration-300');
    setTimeout(() => {
      subCard.classList.remove('ring-4', 'ring-primary/50', 'scale-102');
    }, 2000);
  }
}

let currentOrderId = null;
let isSimulatedPayment = false;

// Render active subscription values
function renderSubscriptionDetails() {
  if (!currentUser || !currentUser.subscription) return;
  
  const sub = currentUser.subscription;
  subscriptionStatus = sub;
  
  const badge = document.getElementById('subscription-status-badge');
  const timeLeft = document.getElementById('subscription-time-left');
  const desc = document.getElementById('subscription-status-desc');
  const actionBtn = document.getElementById('subscription-action-btn');
  const btnText = document.getElementById('subscription-btn-text');
  const upgradeNav = document.getElementById('upgrade-nav-link');

  // Hide nav link highlight if already premium subscribed
  if (upgradeNav) {
    if (sub.status === 'subscribed') {
      upgradeNav.classList.add('hidden');
    } else {
      upgradeNav.classList.remove('hidden');
    }
  }

  if (sub.status === 'subscribed') {
    badge.className = 'inline-flex items-center gap-xs px-md py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    badge.innerText = 'Premium';
    timeLeft.innerText = sub.timeLeftStr;
    desc.innerText = 'Thank you for supporting SafeLink! Your premium subscription is active.';
    btnText.innerText = 'Extend Premium (₹40)';
    actionBtn.className = 'w-full flex items-center justify-center gap-sm py-md px-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold rounded-xl hover:shadow-[0_0_15px_rgba(16,185,129,0.4)] transition-all duration-300 active:scale-95 shadow-md';
  } else if (sub.status === 'trial') {
    badge.className = 'inline-flex items-center gap-xs px-md py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/30';
    badge.innerText = 'Free Trial';
    timeLeft.innerText = sub.timeLeftStr;
    desc.innerText = 'Your 1-day free trial is active. Upgrade to premium for uninterrupted secure matchmaking.';
    btnText.innerText = 'Upgrade to Premium (₹40)';
    actionBtn.className = 'w-full flex items-center justify-center gap-sm py-md px-xl bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-xl hover:shadow-[0_0_15px_rgba(20,184,166,0.4)] transition-all duration-300 active:scale-95 shadow-md';
  } else {
    badge.className = 'inline-flex items-center gap-xs px-md py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-error/20 text-error border border-error/30';
    badge.innerText = 'Expired';
    timeLeft.innerText = 'Access Expired';
    desc.innerText = 'Your free trial or premium access has expired. Pay ₹40 to reactivate 1 month of premium calling.';
    btnText.innerText = 'Reactivate Access (₹40)';
    actionBtn.className = 'w-full flex items-center justify-center gap-sm py-md px-xl bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-xl hover:shadow-[0_0_15px_rgba(20,184,166,0.4)] transition-all duration-300 active:scale-95 shadow-md animate-pulse';
  }
}

// Trigger subscription payment flows
async function startRazorpayPayment() {
  if (!jwtToken) {
    alert('Please sign in to upgrade your subscription.');
    return;
  }

  try {
    const res = await fetch('/api/payment/create-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create payment order.');

    currentOrderId = data.id;
    isSimulatedPayment = data.isMock;

    if (isSimulatedPayment) {
      openPaymentSimulator();
    } else {
      const options = {
        "key": data.key,
        "amount": data.amount,
        "currency": data.currency,
        "name": "SafeLink Secure Video",
        "description": "1 Month Subscription Access",
        "image": document.getElementById('header-avatar').src || "https://api.dicebear.com/7.x/bottts/svg?seed=SafeLink",
        "order_id": data.id,
        "handler": async function (response) {
          await verifyPaymentOnServer(response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature);
        },
        "prefill": {
          "name": currentUser.name,
          "email": currentUser.email
        },
        "theme": {
          "color": "#14b8a6"
        }
      };
      const rzp = new Razorpay(options);
      rzp.on('payment.failed', function (response) {
        alert('Transaction Failed: ' + response.error.description);
      });
      rzp.open();
    }

  } catch (err) {
    console.error('[Payment Flow]:', err);
    alert(err.message);
    if (err.message.toLowerCase().includes('not found') || err.message.toLowerCase().includes('expired') || err.message.toLowerCase().includes('invalid') || err.message.toLowerCase().includes('access denied')) {
      handleUserSignOut();
    }
  }
}

// Verify payment details with backend
async function verifyPaymentOnServer(orderId, paymentId, signature) {
  try {
    const res = await fetch('/api/payment/verify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to verify transaction.');

    alert('Success! Subscription successfully activated for 1 month.');
    closePaymentSimulator();

    // Refresh UI session details
    await loadUserSession();

  } catch (err) {
    console.error('[Verification]:', err);
    alert('Verification Error: ' + err.message);
  }
}

// Sandbox Simulator modal controllers
function openPaymentSimulator() {
  const modal = document.getElementById('payment-simulator-modal');
  modal.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
  modal.classList.add('opacity-100', 'scale-100');

  document.getElementById('simulator-success-btn').onclick = async () => {
    const mockPaymentId = `pay_mock_${Date.now()}`;
    const mockSignature = `signature_mock_${Date.now()}`;
    await verifyPaymentOnServer(currentOrderId, mockPaymentId, mockSignature);
  };

  document.getElementById('simulator-fail-btn').onclick = () => {
    alert('Transaction Declined (Simulated).');
    closePaymentSimulator();
  };
}

function closePaymentSimulator() {
  const modal = document.getElementById('payment-simulator-modal');
  modal.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
  modal.classList.remove('opacity-100', 'scale-100');
  currentOrderId = null;
}
