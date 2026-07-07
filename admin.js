(function() {
    const config = window.FAREWELL_SUPABASE_CONFIG || {};
    const tableName = config.peopleTable || 'people';
    const bucketName = config.imageBucket || 'person-images';
    const client = window.supabase && config.url && config.anonKey
        ? window.supabase.createClient(config.url, config.anonKey)
        : null;

    const form = document.getElementById('personForm');
    const personNumber = document.getElementById('personNumber');
    const personName = document.getElementById('personName');
    const personRole = document.getElementById('personRole');
    const personNote = document.getElementById('personNote');
    const personImage = document.getElementById('personImage');
    const imagePreview = document.getElementById('imagePreview');
    const imageDrop = document.getElementById('imageDrop');
    const peopleGrid = document.getElementById('peopleGrid');
    const peopleCount = document.getElementById('peopleCount');
    const cancelledGrid = document.getElementById('cancelledGrid');
    const cancelledCount = document.getElementById('cancelledCount');
    const savePersonBtn = document.getElementById('savePersonBtn');
    const refreshPeopleBtn = document.getElementById('refreshPeopleBtn');
    const connectionStatus = document.getElementById('connectionStatus');
    const formMode = document.getElementById('formMode');
    const toast = document.getElementById('toast');
    const setupPanel = document.getElementById('setupPanel');
    const copySetupBtn = document.getElementById('copySetupBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    let editingId = null;
    let currentImageUrl = '';
    let isSetupReady = true;
    let isAuthenticated = false;
    let latestPeople = [];
    let latestWheelState = null;

    const autoColors = [
        '#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b',
        '#9b5de5', '#00bbf9', '#f15bb5', '#fee440', '#00f5d4',
        '#ff9f1c', '#2ec4b6', '#e71d36', '#7bdff2', '#b2f7ef',
        '#ff70a6', '#70d6ff', '#ff9770', '#caffbf', '#a0c4ff',
        '#bdb2ff', '#ffc6ff', '#fdffb6', '#8ac926', '#ff595e',
        '#1982c4', '#6a4c93', '#4cc9f0', '#f72585', '#7209b7',
        '#3a86ff', '#ffbe0b', '#fb5607', '#43aa8b', '#577590',
        '#f94144', '#f3722c', '#f8961e', '#90be6d', '#277da1',
        '#c77dff', '#80ffdb', '#ffcad4', '#b8f2e6', '#ffd6a5'
    ];

    function autoColorForNumber(number) {
        const index = Math.abs((Number(number) || 1) - 1) % autoColors.length;
        return autoColors[index];
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

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add('is-visible');
        clearTimeout(showToast.timeoutId);
        showToast.timeoutId = setTimeout(() => toast.classList.remove('is-visible'), 2400);
    }

    function setStatus(kind, text) {
        const icon = kind === 'ready' ? 'fa-circle-check' : kind === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-notch fa-spin';
        connectionStatus.className = `admin-status ${kind}`;
        connectionStatus.innerHTML = `<i class="fas ${icon}"></i>${text}`;
    }

    function publicImageUrl(path) {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        const { data } = client.storage.from(bucketName).getPublicUrl(path);
        return data.publicUrl;
    }

    async function uploadImage(file, number) {
        if (!file) return currentImageUrl;

        const extension = file.name.split('.').pop() || 'jpg';
        const safeName = `${number}-${Date.now()}.${extension.toLowerCase()}`;
        const { error } = await client.storage
            .from(bucketName)
            .upload(safeName, file, { cacheControl: '3600', upsert: true });

        if (error) throw error;
        return publicImageUrl(safeName);
    }

    async function loadPeople() {
        if (!client) {
            setStatus('error', 'not configured');
            isSetupReady = false;
            savePersonBtn.disabled = true;
            return;
        }

        if (!isAuthenticated) {
            savePersonBtn.disabled = true;
            return;
        }

        setStatus('loading', 'loading');
        const { data, error } = await client
            .from(tableName)
            .select('id, number, name, role, note, color, image_url, created_at')
            .order('number', { ascending: true });

        if (error) {
            isSetupReady = false;
            setupPanel.hidden = false;
            savePersonBtn.disabled = true;
            setStatus('error', error.code === 'PGRST205' || error.message.includes('schema cache') ? 'table missing' : 'setup needed');
            peopleGrid.innerHTML = `
                <div class="admin-empty">
                    <i class="fas fa-database"></i>
                    <span>Run supabase-setup.sql in Supabase, then click Refresh.</span>
                </div>
            `;
            showToast(error.message);
            return;
        }

        isSetupReady = true;
        setupPanel.hidden = true;
        savePersonBtn.disabled = false;
        setStatus('ready', 'connected');
        latestPeople = (data || []).map((person) => ({
            ...person,
            color: autoColorForNumber(person.number)
        }));
        renderPeople(latestPeople);
        await loadWheelState();
    }

    function renderPeople(people) {
        peopleCount.textContent = `${people.length} saved`;

        if (!people.length) {
            peopleGrid.innerHTML = `
                <div class="admin-empty">
                    <i class="fas fa-address-book"></i>
                    <span>No people yet</span>
                </div>
            `;
            return;
        }

        peopleGrid.innerHTML = people.map((person) => {
            const image = person.image_url || '';
            const initial = escapeHtml((person.name || '?').charAt(0).toUpperCase());
            return `
                <article class="admin-person-card">
                    <div class="admin-person-media" style="--avatar-color:${escapeHtml(person.color || '#f1c40f')}">
                        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(person.name)}" loading="lazy" data-fallback="${initial}" />` : `<span>${initial}</span>`}
                    </div>
                    <div class="admin-person-info">
                        <div class="admin-person-top">
                            <strong>${escapeHtml(person.name)}</strong>
                            <span>#${escapeHtml(person.number)}</span>
                        </div>
                        <p>${escapeHtml(person.role || person.note || 'No extra detail')}</p>
                    </div>
                    <div class="admin-card-actions">
                        <button type="button" class="icon-admin-btn" data-edit='${escapeHtml(JSON.stringify(person))}' aria-label="Edit ${escapeHtml(person.name)}"><i class="fas fa-pen"></i></button>
                        <button type="button" class="icon-admin-btn danger" data-delete="${escapeHtml(person.id)}" aria-label="Delete ${escapeHtml(person.name)}"><i class="fas fa-trash-can"></i></button>
                    </div>
                </article>
            `;
        }).join('');
    }

    function getStateListNumbers(list) {
        if (!Array.isArray(list)) return [];
        return list
            .map((person) => Number(person && person.number))
            .filter((number) => Number.isInteger(number));
    }

    function getCancelledNumbers(state) {
        const data = state || {};
        const pickedNumbers = Array.isArray(data.pickedNumbers)
            ? data.pickedNumbers.map(Number).filter((number) => Number.isInteger(number))
            : [];
        const visibleNumbers = new Set([
            ...getStateListNumbers(data.pickedList),
            ...getStateListNumbers(data.savedPeople),
            ...getStateListNumbers(data.roundPicks)
        ]);

        return pickedNumbers
            .filter((number) => !visibleNumbers.has(number))
            .sort((a, b) => a - b);
    }

    async function loadWheelState() {
        if (!client || !isAuthenticated || !isSetupReady) return;

        const { data, error } = await client
            .from('wheel_state')
            .select('data')
            .eq('id', 'main')
            .maybeSingle();

        if (error) {
            latestWheelState = null;
            renderCancelledPicks([]);
            showToast(error.message);
            return;
        }

        latestWheelState = data?.data || null;
        renderCancelledPicks(getCancelledNumbers(latestWheelState));
    }

    function renderCancelledPicks(numbers) {
        cancelledCount.textContent = `${numbers.length} waiting`;

        if (!numbers.length) {
            cancelledGrid.innerHTML = `
                <div class="admin-empty compact-empty">
                    <i class="fas fa-circle-check"></i>
                    <span>No cancelled picks waiting</span>
                </div>
            `;
            return;
        }

        cancelledGrid.innerHTML = numbers.map((number) => {
            const person = latestPeople.find((item) => Number(item.number) === number) || { number, name: `Number ${number}` };
            const image = person.image_url || '';
            const initial = escapeHtml((person.name || '?').charAt(0).toUpperCase());
            const color = autoColorForNumber(number);
            return `
                <article class="admin-person-card cancelled-card">
                    <div class="admin-person-media" style="--avatar-color:${escapeHtml(color)}">
                        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(person.name)}" loading="lazy" data-fallback="${initial}" />` : `<span>${initial}</span>`}
                    </div>
                    <div class="admin-person-info">
                        <div class="admin-person-top">
                            <strong>${escapeHtml(person.name)}</strong>
                            <span>#${escapeHtml(number)}</span>
                        </div>
                        <p>Removed from results, still blocked from spinning.</p>
                    </div>
                    <div class="admin-card-actions">
                        <button type="button" class="icon-admin-btn success" data-readd="${escapeHtml(number)}" aria-label="Re-add ${escapeHtml(person.name)} to spin"><i class="fas fa-rotate-left"></i></button>
                    </div>
                </article>
            `;
        }).join('');
    }

    async function savePerson(event) {
        event.preventDefault();
        if (!isAuthenticated) {
            window.location.href = 'login.html';
            return;
        }

        if (!client || !isSetupReady) {
            showToast('Run supabase-setup.sql first, then refresh.');
            return;
        }

        if (!client) {
            showToast('Supabase is not configured.');
            return;
        }

        const number = Number(personNumber.value);
        if (!Number.isInteger(number) || number < 1 || number > 45) {
            showToast('Choose a number from 1 to 45.');
            return;
        }

        savePersonBtn.disabled = true;
        savePersonBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving';

        try {
            const imageUrl = await uploadImage(personImage.files[0], number);
            const payload = {
                number,
                name: personName.value.trim(),
                role: personRole.value.trim(),
                note: personNote.value.trim(),
                color: autoColorForNumber(number),
                image_url: imageUrl || null
            };

            const query = editingId
                ? client.from(tableName).update(payload).eq('id', editingId)
                : client.from(tableName).upsert(payload, { onConflict: 'number' });

            const { error } = await query;
            if (error) throw error;

            showToast(editingId ? 'Person updated.' : 'Person saved.');
            resetForm(true);
            await loadPeople();
        } catch (error) {
            showToast(error.message || 'Save failed.');
        } finally {
            savePersonBtn.disabled = false;
            savePersonBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save';
        }
    }

    function resetForm(shouldResetFields = false) {
        if (shouldResetFields) {
            form.reset();
        }
        editingId = null;
        currentImageUrl = '';
        imagePreview.removeAttribute('src');
        imageDrop.classList.remove('has-image');
        formMode.textContent = 'ready';
    }

    async function deletePerson(id) {
        if (!isAuthenticated) {
            window.location.href = 'login.html';
            return;
        }

        if (!confirm('Delete this person?')) return;
        const { error } = await client.from(tableName).delete().eq('id', id);
        if (error) {
            showToast(error.message);
            return;
        }
        showToast('Person deleted.');
        loadPeople();
    }

    function editPerson(person) {
        editingId = person.id;
        currentImageUrl = person.image_url || '';
        personNumber.value = person.number || '';
        personName.value = person.name || '';
        personRole.value = person.role || '';
        personNote.value = person.note || '';
        formMode.textContent = `editing #${person.number}`;

        if (currentImageUrl) {
            imagePreview.src = currentImageUrl;
            imageDrop.classList.add('has-image');
        } else {
            imagePreview.removeAttribute('src');
            imageDrop.classList.remove('has-image');
        }

        personName.focus();
    }

    async function readdCancelledPick(number) {
        const parsedNumber = Number(number);
        if (!Number.isInteger(parsedNumber)) return;

        const state = latestWheelState || {};
        const withoutNumber = (list) => Array.isArray(list)
            ? list.filter((person) => Number(person && person.number) !== parsedNumber)
            : [];

        const nextState = {
            ...state,
            pickedNumbers: Array.isArray(state.pickedNumbers)
                ? state.pickedNumbers.map(Number).filter((item) => item !== parsedNumber)
                : [],
            pickedList: withoutNumber(state.pickedList),
            savedPeople: withoutNumber(state.savedPeople),
            roundPicks: withoutNumber(state.roundPicks),
            currentPerson: Number(state.currentPerson?.number) === parsedNumber ? null : state.currentPerson,
            lastTargetNumber: Number(state.lastTargetNumber) === parsedNumber ? null : state.lastTargetNumber
        };

        const { error } = await client.from('wheel_state').upsert({
            id: 'main',
            updated_at: new Date().toISOString(),
            data: nextState
        }, { onConflict: 'id' });

        if (error) {
            showToast(error.message);
            return;
        }

        latestWheelState = nextState;
        renderCancelledPicks(getCancelledNumbers(nextState));
        showToast(`#${parsedNumber} can spin again.`);
    }

    personImage.addEventListener('change', () => {
        const file = personImage.files[0];
        if (!file) return;
        imagePreview.src = URL.createObjectURL(file);
        imageDrop.classList.add('has-image');
    });

    form.addEventListener('submit', savePerson);
    form.addEventListener('reset', () => setTimeout(() => resetForm(false), 0));
    refreshPeopleBtn.addEventListener('click', loadPeople);
    copySetupBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('supabase-setup.sql');
            const sql = await response.text();
            await navigator.clipboard.writeText(sql);
            showToast('SQL copied.');
        } catch (error) {
            showToast('Open supabase-setup.sql and copy it manually.');
        }
    });
    function handleAdminCardClick(event) {
        const editButton = event.target.closest('[data-edit]');
        const deleteButton = event.target.closest('[data-delete]');
        const readdButton = event.target.closest('[data-readd]');
        if (editButton) editPerson(JSON.parse(editButton.dataset.edit));
        if (deleteButton) deletePerson(deleteButton.dataset.delete);
        if (readdButton) readdCancelledPick(readdButton.dataset.readd);
    }

    peopleGrid.addEventListener('click', handleAdminCardClick);
    cancelledGrid.addEventListener('click', handleAdminCardClick);

    function handleCardImageError(event) {
        const image = event.target;
        if (!image.matches('.admin-person-media img')) return;
        const fallback = image.dataset.fallback || '?';
        image.replaceWith(Object.assign(document.createElement('span'), { textContent: fallback }));
    }

    peopleGrid.addEventListener('error', handleCardImageError, true);
    cancelledGrid.addEventListener('error', handleCardImageError, true);

    logoutBtn.addEventListener('click', async () => {
        if (client) await client.auth.signOut();
        window.location.href = 'login.html';
    });

    async function requireAdminSession() {
        if (!client) {
            setStatus('error', 'not configured');
            savePersonBtn.disabled = true;
            return;
        }

        const { data, error } = await client.auth.getSession();
        if (error || !data.session) {
            window.location.href = 'login.html';
            return;
        }

        isAuthenticated = true;
        await loadPeople();
    }

    requireAdminSession();
})();
