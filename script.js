(function() {
            // ---------- 45 people ----------
            const names = [
                "Emma Watson", "Liam Neeson", "Scarlett Johansson", "Dwayne Johnson", "Taylor Swift",
                "Chris Evans", "Zendaya", "Tom Holland", "Ariana Grande", "Ryan Reynolds",
                "Natalie Portman", "Robert Downey", "Selena Gomez", "Chris Hemsworth", "Margot Robbie",
                "Leonardo DiCaprio", "Jennifer Lawrence", "Timothee Chalamet", "Gal Gadot", "Henry Cavill",
                "Anne Hathaway", "Will Smith", "Angelina Jolie", "Brad Pitt", "Cate Blanchett",
                "Keanu Reeves", "Meryl Streep", "Denzel Washington", "Julia Roberts", "Morgan Freeman",
                "Hugh Jackman", "Nicole Kidman", "Tom Cruise", "Sandra Bullock", "Johnny Depp",
                "Al Pacino", "Robert De Niro", "Jodie Foster", "Matt Damon", "Christian Bale",
                "Amy Adams", "Jake Gyllenhaal", "Reese Witherspoon", "Mark Ruffalo", "Charlize Theron"
            ];
            const avatarColors = [
                "#f1c40f", "#e67e22", "#e74c3c", "#3498db", "#2ecc71",
                "#9b59b6", "#1abc9c", "#f39c12", "#d35400", "#c0392b",
                "#2980b9", "#27ae60", "#8e44ad", "#16a085", "#2c3e50",
                "#7f8c8d", "#f1c40f", "#e67e22", "#e74c3c", "#3498db",
                "#2ecc71", "#9b59b6", "#1abc9c", "#f39c12", "#d35400",
                "#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#16a085",
                "#2c3e50", "#7f8c8d", "#f1c40f", "#e67e22", "#e74c3c",
                "#3498db", "#2ecc71", "#9b59b6", "#1abc9c", "#f39c12",
                "#d35400", "#c0392b", "#2980b9", "#27ae60", "#8e44ad"
            ];

            const people = Array.from({ length: 45 }, (_, i) => ({
                number: i + 1,
                name: names[i] || `Guest ${i+1}`,
                color: avatarColors[i] || "#f1c40f",
                image_url: "",
                role: "",
                note: ""
            }));

            // ---------- state ----------
            const pickedSet = new Set();
            const pickedList = [];
            const savedPeople = [];
            let currentAngle = 0;
            let isSpinning = false;
            let currentPerson = null;
            let lastTargetNumber = null;

            const ROUND_SIZE = 5;
            let roundPicks = [];

            let audioCtx = null;
            let isAudioEnabled = true;
            let supabaseClient = null;
            let supabaseReady = false;
            let wheelStateChannel = null;
            let pendingRemoteState = null;

            const supabaseConfig = window.FAREWELL_SUPABASE_CONFIG || {};
            const SUPABASE_URL = supabaseConfig.url || '';
            const SUPABASE_ANON_KEY = supabaseConfig.anonKey || '';
            const PEOPLE_TABLE = supabaseConfig.peopleTable || 'people';

            function isSupabaseConfigured() {
                return typeof SUPABASE_URL === 'string' &&
                    SUPABASE_URL.includes('supabase.co') &&
                    typeof SUPABASE_ANON_KEY === 'string' &&
                    SUPABASE_ANON_KEY.length > 10 &&
                    !SUPABASE_URL.includes('YOUR_PROJECT_REF');
            }

            function initializeSupabaseClient() {
                if (!isSupabaseConfigured() || !window.supabase) return null;
                if (!supabaseClient) {
                    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                }
                return supabaseClient;
            }

            function escapeHtml(value) {
                return String(value || '').replace(/[&<>"']/g, (char) => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                }[char]));
            }

            function getAvatarMarkup(person, className) {
                if (person.image_url) {
                    return `<img class="${className} person-photo" src="${escapeHtml(person.image_url)}" alt="${escapeHtml(person.name)}" loading="lazy" />`;
                }
                return `<div class="${className}" data-color="${escapeHtml(person.color)}">${escapeHtml(person.name.charAt(0).toUpperCase())}</div>`;
            }

            async function loadPeopleFromSupabase() {
                const client = initializeSupabaseClient();
                if (!client) return 0;

                try {
                    const { data, error } = await client
                        .from(PEOPLE_TABLE)
                        .select('number, name, role, note, color, image_url')
                        .order('number', { ascending: true });

                    if (error) {
                        console.warn('Supabase people load error:', error.message);
                        showToast(`People fetch failed: ${error.message}`);
                        return 0;
                    }

                    if (!Array.isArray(data) || data.length === 0) return 0;

                    let loadedCount = 0;
                    data.forEach((person) => {
                        const index = Number(person.number) - 1;
                        if (index < 0 || index >= people.length) return;
                        people[index] = {
                            ...people[index],
                            number: Number(person.number),
                            name: person.name || people[index].name,
                            role: person.role || "",
                            note: person.note || "",
                            color: person.color || people[index].color,
                            image_url: person.image_url || ""
                        };
                        loadedCount += 1;
                    });

                    return loadedCount;
                } catch (error) {
                    console.warn('Supabase people load failed:', error);
                    showToast(`People fetch failed: ${error.message || 'network error'}`);
                    return 0;
                }
            }

            function applyPersistedState(state) {
                if (!state) return;

                pickedSet.clear();
                pickedList.length = 0;
                savedPeople.length = 0;
                roundPicks = [];
                currentPerson = null;
                lastTargetNumber = null;

                if (Array.isArray(state.pickedNumbers)) {
                    state.pickedNumbers.forEach((number) => pickedSet.add(number));
                }
                if (Array.isArray(state.pickedList)) {
                    state.pickedList.forEach((person) => pickedList.push({ ...person }));
                }
                if (Array.isArray(state.savedPeople)) {
                    state.savedPeople.forEach((person) => savedPeople.push({ ...person }));
                }
                if (Array.isArray(state.roundPicks)) {
                    roundPicks = state.roundPicks.map((person) => ({ ...person }));
                }
                if (state.currentPerson) {
                    currentPerson = { ...state.currentPerson };
                }
                if (typeof state.lastTargetNumber === 'number') {
                    lastTargetNumber = state.lastTargetNumber;
                }
                if (typeof state.currentAngle === 'number') {
                    currentAngle = state.currentAngle;
                }

                drawWheel(currentAngle);
                updateDisplays();
            }

            function resetLocalState() {
                pickedSet.clear();
                pickedList.length = 0;
                savedPeople.length = 0;
                roundPicks = [];
                currentPerson = null;
                lastTargetNumber = null;
                currentAngle = 0;
                drawWheel(0);
                updateDisplays();
                spinBtn.disabled = false;
                isSpinning = false;
                overlay.classList.remove('active');
                overlayImage.hidden = true;
                overlayImage.removeAttribute('src');
                overlayInitial.hidden = false;
                spinDurationEl.textContent = '5s';
                updateSpeedBar(0);
                rotationCountEl.textContent = '5+';
            }

            function applyRemoteState(state) {
                if (isSpinning) {
                    pendingRemoteState = state || {};
                    return;
                }

                if (state) {
                    applyPersistedState(state);
                } else {
                    resetLocalState();
                }

                pendingRemoteState = null;
            }

            function flushPendingRemoteState() {
                if (!pendingRemoteState || isSpinning) return;
                applyRemoteState(Object.keys(pendingRemoteState).length ? pendingRemoteState : null);
            }

            async function loadPersistedState() {
                const client = initializeSupabaseClient();
                if (!client) {
                    return false;
                }

                try {
                    const { data, error } = await client
                        .from('wheel_state')
                        .select('data')
                        .eq('id', 'main')
                        .maybeSingle();

                    if (error) {
                        if (error.code !== 'PGRST116') {
                            console.warn('Supabase load error:', error.message);
                        }
                        return false;
                    }

                    if (data?.data) {
                        applyPersistedState(data.data);
                        showToast('Loaded saved wheel state.');
                    }
                    return true;
                } catch (error) {
                    console.warn('Supabase load failed:', error);
                    return false;
                }
            }

            async function persistState() {
                const client = initializeSupabaseClient();
                if (!client) return;

                try {
                    await client.from('wheel_state').upsert({
                        id: 'main',
                        updated_at: new Date().toISOString(),
                        data: {
                            pickedNumbers: Array.from(pickedSet),
                            pickedList: pickedList.map((person) => ({ ...person })),
                            savedPeople: savedPeople.map((person) => ({ ...person })),
                            roundPicks: roundPicks.map((person) => ({ ...person })),
                            currentAngle,
                            currentPerson: currentPerson ? { ...currentPerson } : null,
                            lastTargetNumber
                        }
                    }, { onConflict: 'id' });
                } catch (error) {
                    console.warn('Supabase save failed:', error);
                }
            }

            function subscribeToWheelState() {
                const client = initializeSupabaseClient();
                if (!client || wheelStateChannel) return;

                wheelStateChannel = client
                    .channel('wheel-state-live')
                    .on(
                        'postgres_changes',
                        {
                            event: '*',
                            schema: 'public',
                            table: 'wheel_state',
                            filter: 'id=eq.main'
                        },
                        (payload) => {
                            if (payload.eventType === 'DELETE') {
                                applyRemoteState(null);
                                return;
                            }

                            applyRemoteState(payload.new?.data || null);
                        }
                    )
                    .subscribe((status) => {
                        if (status === 'SUBSCRIBED') {
                            console.info('Realtime wheel sync connected.');
                        }
                    });
            }

            // DOM refs
            const canvas = document.getElementById('wheelCanvas');
            const ctx = canvas.getContext('2d');
            const spinBtn = document.getElementById('spinBtn');
            const clearBtn = document.getElementById('clearBtn');
            const pickedCountEl = document.getElementById('pickedCount');
            const leftCountEl = document.getElementById('leftCount');
            const roundResults = document.getElementById('roundResults');
            const roundProgress = document.getElementById('roundProgress');
            const roundSelectedCount = document.getElementById('roundSelectedCount');
            const roundBadge = document.getElementById('roundBadge');
            const historyGrid = document.getElementById('historyGrid');
            const nextBtn = document.getElementById('nextBtn');
            const savedGrid = document.getElementById('savedGrid');
            const toast = document.getElementById('toast');
            const spinDurationEl = document.getElementById('spinDuration');
            const speedBar = document.getElementById('speedBar');
            const rotationCountEl = document.getElementById('rotationCount');

            const overlay = document.getElementById('wheelOverlay');
            const bigNumberEl = document.getElementById('bigNumber');
            const overlayAvatar = document.getElementById('overlayAvatar');
            const overlayImage = document.getElementById('overlayImage');
            const overlayInitial = document.getElementById('overlayInitial');
            const overlayName = document.getElementById('overlayName');
            const overlayNumber = document.getElementById('overlayNumber');

            const NUM_SEGMENTS = 45;
            const PI = Math.PI;
            const TAU = 2 * PI;
            const segmentAngle = TAU / NUM_SEGMENTS;
            const MIN_SPIN_ROTATIONS = 5;
            const SPIN_DURATION_MS = 5000;

            // ---------- Audio ----------
            function initAudio() {
                try {
                    audioCtx = new(window.AudioContext || window.webkitAudioContext)();
                } catch (e) {
                    audioCtx = null;
                    isAudioEnabled = false;
                }
            }

            function playWheelSound(speedFactor = 1) {
                if (!audioCtx || !isAudioEnabled) return;
                try {
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);

                    const baseFreq = 120 + speedFactor * 60;
                    osc.frequency.setValueAtTime(baseFreq, audioCtx.currentTime);
                    osc.type = 'sawtooth';

                    const now = audioCtx.currentTime;
                    gain.gain.setValueAtTime(0.08, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

                    osc.start(now);
                    osc.stop(now + 0.15);

                    const osc2 = audioCtx.createOscillator();
                    const gain2 = audioCtx.createGain();
                    osc2.connect(gain2);
                    gain2.connect(audioCtx.destination);
                    osc2.frequency.setValueAtTime(baseFreq * 1.5, now);
                    osc2.type = 'square';
                    gain2.gain.setValueAtTime(0.04, now);
                    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                    osc2.start(now);
                    osc2.stop(now + 0.12);

                    const bufferSize = audioCtx.sampleRate * 0.08;
                    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let i = 0; i < bufferSize; i++) {
                        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
                    }
                    const noise = audioCtx.createBufferSource();
                    const noiseGain = audioCtx.createGain();
                    noise.buffer = buffer;
                    noise.connect(noiseGain);
                    noiseGain.connect(audioCtx.destination);
                    noiseGain.gain.setValueAtTime(0.06 * speedFactor, now);
                    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                    noise.start(now);
                    noise.stop(now + 0.08);
                } catch (e) {}
            }

            // ---------- draw wheel ----------
            function drawWheel(rotation = 0) {
                const w = canvas.width, h = canvas.height;
                const centerX = w / 2, centerY = h / 2;
                const radius = Math.min(w, h) * 0.44;
                ctx.clearRect(0, 0, w, h);

                for (let i = 0; i < NUM_SEGMENTS; i++) {
                    const start = i * segmentAngle + rotation;
                    const end = start + segmentAngle;
                    const isPicked = pickedSet.has(i + 1);

                    let color = people[i].color;
                    if (isPicked) color = '#2d3748';

                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.arc(centerX, centerY, radius, start, end);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = '#0f1422';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    const midAngle = start + segmentAngle / 2;
                    const labelRadius = radius * 0.7;
                    const x = centerX + Math.cos(midAngle) * labelRadius;
                    const y = centerY + Math.sin(midAngle) * labelRadius;
                    ctx.fillStyle = isPicked ? '#5a6a82' : '#0b0d15';
                    ctx.font = 'bold 16px "Inter", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(i + 1, x, y);
                }

                ctx.beginPath();
                ctx.arc(centerX, centerY, radius * 0.12, 0, TAU);
                ctx.fillStyle = '#1e263b';
                ctx.fill();
                ctx.shadowColor = '#f1c40f33';
                ctx.shadowBlur = 20;
                ctx.strokeStyle = '#f1c40f55';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            // ---------- update displays ----------
            function updateDisplays() {
                pickedCountEl.textContent = pickedSet.size;
                leftCountEl.textContent = 45 - pickedSet.size;
                nextBtn.disabled = pickedList.length === 0 && pickedSet.size < 45;
                nextBtn.innerHTML = '<i class="fas fa-arrow-right"></i> next';

                roundProgress.textContent = `${roundPicks.length}/${ROUND_SIZE}`;
                roundSelectedCount.textContent = roundPicks.length;
                roundBadge.textContent = `Round ${roundPicks.length}/${ROUND_SIZE}`;

                if (roundPicks.length === 0) {
                    roundResults.innerHTML = `
                        <div class="empty-state">
                            <i class="fas fa-hand-pointer"></i>
                            <span>spin 5 times to complete round</span>
                        </div>
                    `;
                } else {
                    roundResults.innerHTML = roundPicks.map((p, index) => `
                        <div class="result-item">
                            ${getAvatarMarkup(p, 'r-avatar')}
                            <div class="r-info">
                                <div class="r-name">${escapeHtml(p.name)}</div>
                                <div class="r-number">#${p.number}</div>
                            </div>
                            <div class="r-spin-num">spin ${index + 1}</div>
                            <button class="remove-person-btn" data-number="${p.number}" aria-label="Remove ${escapeHtml(p.name)}">
                                <i class="fas fa-xmark"></i>
                            </button>
                        </div>
                    `).join('');
                }

                if (pickedList.length === 0) {
                    historyGrid.innerHTML = `
                        <div class="empty-history">
                            <i class="fas fa-inbox"></i>
                            <span>no picks yet</span>
                        </div>
                    `;
                } else {
                    historyGrid.innerHTML = pickedList.map(p => `
                        <div class="history-card">
                            ${getAvatarMarkup(p, 'h-avatar')}
                            <div class="h-info">
                                <div class="h-name">${escapeHtml(p.name)}</div>
                                <div class="h-number">#${p.number}</div>
                            </div>
                            <button class="remove-person-btn" data-number="${p.number}" aria-label="Remove ${escapeHtml(p.name)}">
                                <i class="fas fa-xmark"></i>
                            </button>
                        </div>
                    `).join('');
                }

                if (savedPeople.length === 0) {
                    savedGrid.innerHTML = `
                        <div class="empty-history">
                            <i class="fas fa-inbox"></i>
                            <span>no saved details yet</span>
                        </div>
                    `;
                } else {
                    savedGrid.innerHTML = savedPeople.map(p => `
                        <div class="history-card saved-card">
                            ${getAvatarMarkup(p, 'h-avatar')}
                            <div class="h-info">
                                <div class="h-name">${escapeHtml(p.name)}</div>
                                <div class="h-number">#${p.number}</div>
                            </div>
                            <button class="remove-person-btn" data-number="${p.number}" aria-label="Remove ${escapeHtml(p.name)}">
                                <i class="fas fa-xmark"></i>
                            </button>
                        </div>
                    `).join('');
                }

                applyAvatarColors();
            }

            function applyAvatarColors() {
                document.querySelectorAll('[data-color]').forEach((avatar) => {
                    avatar.style.setProperty('--avatar-color', avatar.dataset.color);
                });
            }

            function updateSpeedBar(speed) {
                const bars = speedBar.querySelectorAll('span');
                const activeCount = Math.round(speed * 5);
                bars.forEach((bar, index) => {
                    bar.classList.toggle('active', index < activeCount);
                });
            }

            function showToast(message) {
                toast.textContent = message;
                toast.classList.add('is-visible');
                clearTimeout(showToast.timeoutId);
                showToast.timeoutId = setTimeout(() => {
                    toast.classList.remove('is-visible');
                }, 2200);
            }

            // ---------- SPIN with MORE THAN 5 ROTATIONS and 5 SECONDS ----------
            function spinWheel() {
                if (isSpinning) return;

                if (roundPicks.length >= ROUND_SIZE) {
                    showToast(`${ROUND_SIZE} selected. Click Next to save this round.`);
                    return;
                }

                if (pickedSet.size >= 45) {
                    showToast('Wheel is empty. All numbers are selected.');
                    return;
                }

                if (!audioCtx) {
                    initAudio();
                }

                const available = [];
                for (let i = 1; i <= 45; i++) {
                    if (!pickedSet.has(i)) available.push(i);
                }
                if (available.length === 0) return;

                const targetNumber = available[Math.floor(Math.random() * available.length)];
                const targetIndex = targetNumber - 1;
                
                // Calculate the exact angle to land on the target segment
                // The pointer is at -PI/2 (top of the wheel)
                // We want the pointer to point to the middle of the target segment
                const segMid = targetIndex * segmentAngle + segmentAngle / 2;
                
                // Calculate the rotation needed: pointer at -PI/2 should align with segMid
                // rotation + segMid = -PI/2 + (full rotations)
                // rotation = -PI/2 - segMid + (full rotations)
                let targetRotation = -PI / 2 - segMid;
                
                // Add at least 5 full rotations, plus a little extra variation.
                const extraRotations = Math.floor(Math.random() * 4);
                const plannedRotations = MIN_SPIN_ROTATIONS + extraRotations;
                
                // Add full rotations to the target
                targetRotation += plannedRotations * TAU;
                
                // Ensure every spin moves forward by at least 5 full wheel rotations.
                const minimumEndAngle = currentAngle + MIN_SPIN_ROTATIONS * TAU;
                while (targetRotation < minimumEndAngle) {
                    targetRotation += TAU;
                }

                // Show rotation count
                const actualRotations = Math.floor((targetRotation - currentAngle) / TAU);
                rotationCountEl.textContent = `${actualRotations}+`;

                isSpinning = true;
                spinBtn.disabled = true;

                const startAngle = currentAngle;
                const endAngle = targetRotation;
                // Fixed 5 seconds for every spin.
                const duration = SPIN_DURATION_MS;
                const startTime = performance.now();

                spinDurationEl.textContent = '5s';

                let lastSoundTime = 0;

                function getSpeed(progress) {
                    // Speed profile: slow start -> fast middle -> slow end
                    if (progress < 0.15) {
                        return 0.15 + (progress / 0.15) * 0.85;
                    } else if (progress < 0.7) {
                        return 1.0;
                    } else {
                        return 1.0 - ((progress - 0.7) / 0.3) * 0.85;
                    }
                }

                function playSoundAtSpeed(speed) {
                    if (audioCtx) {
                        playWheelSound(speed);
                    }
                    updateSpeedBar(speed);
                }

                // Initial sound
                playSoundAtSpeed(0.15);

                function animate(now) {
                    const elapsed = now - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    // Cubic ease-out for smooth deceleration
                    const ease = 1 - Math.pow(1 - progress, 3);
                    const current = startAngle + (endAngle - startAngle) * ease;

                    drawWheel(current);
                    // Update currentAngle during animation so it tracks properly
                    currentAngle = current;

                    const speed = getSpeed(progress);
                    const interval = 80 / (speed + 0.2);
                    if (now - lastSoundTime > interval) {
                        playSoundAtSpeed(speed);
                        lastSoundTime = now;
                    }

                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        // Final position - store the exact end angle
                        currentAngle = endAngle;
                        drawWheel(endAngle);

                        playSoundAtSpeed(0.1);

                        const person = people[targetIndex];

                        bigNumberEl.textContent = person.number;
                        const initial = person.name.charAt(0).toUpperCase();
                        overlayAvatar.style.setProperty('--avatar-color', person.color);
                        overlayAvatar.style.backgroundImage = '';
                        overlayInitial.textContent = initial;
                        overlayInitial.hidden = Boolean(person.image_url);
                        overlayImage.hidden = !person.image_url;
                        overlayImage.src = person.image_url || '';
                        overlayImage.alt = person.image_url ? person.name : '';
                        overlayName.textContent = person.name;
                        overlayNumber.textContent = `#${person.number}`;

                        overlay.classList.add('active');

                        updateSpeedBar(0);

                        setTimeout(() => {
                            overlay.classList.remove('active');

                            pickedSet.add(targetNumber);
                            pickedList.push({ ...person });
                            roundPicks.push({ ...person });
                            currentPerson = { ...person };
                            lastTargetNumber = targetNumber;

                            updateDisplays();
                            persistState();

                            isSpinning = false;
                            spinBtn.disabled = false;
                            flushPendingRemoteState();

                            if (pickedSet.size >= 45) {
                                setTimeout(() => {
                                    showToast('Wheel is empty. Click Next to save the final picks.');
                                }, 300);
                            } else if (roundPicks.length >= ROUND_SIZE) {
                                setTimeout(() => {
                                    showToast(`${ROUND_SIZE} selected. Click Next to save this round.`);
                                }, 300);
                            }

                            // Redraw at final position to ensure consistency
                            drawWheel(currentAngle);
                        }, 6000);
                    }
                }
                requestAnimationFrame(animate);
            }

            // ---------- save and remove ----------
            function resetCurrentRound() {
                pickedList.length = 0;
                roundPicks = [];
                currentPerson = null;
                lastTargetNumber = null;
                drawWheel(currentAngle);
                spinBtn.disabled = false;
                isSpinning = false;
                overlay.classList.remove('active');
                overlayImage.hidden = true;
                overlayImage.removeAttribute('src');
                overlayInitial.hidden = false;
                spinDurationEl.textContent = '5s';
                updateSpeedBar(0);
                rotationCountEl.textContent = '5+';
            }

            async function clearAllState() {
                if (!confirm('Clear all picks and reset the wheel?')) return;

                resetLocalState();

                const client = initializeSupabaseClient();
                if (client) {
                    try {
                        await client.from('wheel_state').delete().eq('id', 'main');
                    } catch (error) {
                        console.warn('Supabase clear failed:', error);
                    }
                }

                showToast('Wheel reset.');
            }

            function saveCurrentAndShowSaved() {
                if (pickedList.length === 0) {
                    showToast('Spin first, then click Next to save.');
                    return;
                }

                pickedList.forEach((person) => {
                    if (!savedPeople.some((saved) => saved.number === person.number)) {
                        savedPeople.push({ ...person });
                    }
                });

                resetCurrentRound();
                updateDisplays();
                persistState();
                showToast(pickedSet.size >= 45 ? 'Final picks saved.' : 'Round saved. Continue spinning.');
            }

            function removePerson(number) {
                const parsedNumber = Number(number);
                if (!Number.isInteger(parsedNumber)) return;

                removeFromList(pickedList, parsedNumber);
                removeFromList(roundPicks, parsedNumber);
                removeFromList(savedPeople, parsedNumber);

                if (currentPerson?.number === parsedNumber) currentPerson = null;
                if (lastTargetNumber === parsedNumber) lastTargetNumber = null;

                drawWheel(currentAngle);
                updateDisplays();
                persistState();
            }

            function removeFromList(list, number) {
                const index = list.findIndex((person) => person.number === number);
                if (index !== -1) list.splice(index, 1);
            }

            // ---------- init ----------
            async function init() {
                resetLocalState();
                initAudio();

                const client = initializeSupabaseClient();
                if (client) {
                    supabaseReady = true;
                    const loadedCount = await loadPeopleFromSupabase();
                    drawWheel(currentAngle);
                    if (loadedCount > 0) {
                        showToast(`Loaded ${loadedCount} people from Supabase.`);
                    } else {
                        showToast('No Supabase people found. Using sample names.');
                    }
                    await loadPersistedState();
                    subscribeToWheelState();
                } else {
                    console.warn('Supabase is not configured yet. Replace the URL and anon key in script.js to enable cloud syncing.');
                }
            }

            // ---------- events ----------
            spinBtn.addEventListener('click', spinWheel);
            clearBtn.addEventListener('click', () => clearAllState());
            nextBtn.addEventListener('click', saveCurrentAndShowSaved);

            document.addEventListener('click', (e) => {
                const removeButton = e.target.closest('.remove-person-btn');
                if (!removeButton) return;
                removePerson(removeButton.dataset.number);
            });

            document.addEventListener('keydown', (e) => {
                if (e.code === 'Space' && !e.repeat) {
                    e.preventDefault();
                    spinBtn.click();
                }
            });

            init();
            window.addEventListener('resize', () => drawWheel(currentAngle));
        })();
