import { getUnsplashWallpaper, clearUnsplashCache } from "./unsplash.js";

document.addEventListener('DOMContentLoaded', () => {

    if (!chrome?.storage?.sync) {
        console.error('Chrome storage API not available');
        return;
    }

    function updateExtensionIcon(isDark) {
    
        chrome.runtime.sendMessage({
            action: "updateIcon",
            isDark: isDark
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Erro ao enviar mensagem:", chrome.runtime.lastError.message);
            }
        });
    }

    function updateTabFavicon(isDark) {
        const iconVariant = isDark ? "-white" : "";
        let link = document.querySelector("link[rel~='icon']");
        
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        
        link.href = `icons/icon${iconVariant}-32.png`; 
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    updateExtensionIcon(mediaQuery.matches);
    updateTabFavicon(mediaQuery.matches);

    mediaQuery.addEventListener('change', (e) => {
        updateTabFavicon(e.matches);
        updateExtensionIcon(e.matches);
    });

    async function init() {
        initClock();
        setGridDefaults();
        await loadPosition();
        loadFullWidth();
        await loadUnsplashSetting();
        await loadUnsplashThemesSetting();
        initUnsplashThemeListeners();
        const result = await chrome.storage.sync.get('defaultBGs');

        if (result.defaultBGs) {
            await resetBack();
            await chrome.storage.sync.set({ defaultBGs: false });
        } else {
            await loadBackground();
        }

        // Migração/Limpeza do cache de favicons antigos para uso do Icon Horse (alta qualidade com CORS)
        const FAVICON_CACHE_KEY = 'icon_horse_v1';
        const { faviconCacheVersion } = await chrome.storage.local.get('faviconCacheVersion');
        if (faviconCacheVersion !== FAVICON_CACHE_KEY) {
            console.log('Migrando cache de favicons para Icon Horse...');
            await chrome.storage.local.remove('icons');
            await chrome.storage.local.set({ faviconCacheVersion: FAVICON_CACHE_KEY });
        }

        await loadLinks();
        initSortable();
    }

    const photoCreditsEl = document.getElementById('photo-credits');
    const photoAuthorLink = document.getElementById('photo-author-link');
    const photoUnsplashLink = document.getElementById('photo-unsplash-link');

    function setPhotoCredits(authorName, authorProfile, unsplashUrl) {
        if (!photoCreditsEl || !photoAuthorLink || !photoUnsplashLink) return;
        if (authorName && authorProfile) {
            photoAuthorLink.textContent = authorName;
            photoAuthorLink.href = authorProfile;
            photoUnsplashLink.href = unsplashUrl || "https://unsplash.com/?utm_source=custom_homepage&utm_medium=referral";
            photoCreditsEl.style.display = 'flex';
        } else {
            photoCreditsEl.style.display = 'none';
        }
    }

    function hidePhotoCredits() {
        if (photoCreditsEl) {
            photoCreditsEl.style.display = 'none';
        }
    }

    async function loadBackground() {
        let idArray = await getIdArray();
        console.log('idArray: ', idArray);

        if (idArray.length > 0) {
            loadImageDisplay(idArray);
        }

        const useUnsplash = await getUseUnsplash();

        if (useUnsplash) {
            const themes = await getActiveThemes();
            const unsplash = await getUnsplashWallpaper(themes);
            if (unsplash) {
                if (unsplash.color) {
                    document.body.style.backgroundColor = unsplash.color;
                }

                const imgLoader = new Image();
                imgLoader.src = unsplash.highResUrl;

                if (imgLoader.complete) {
                    document.body.style.backgroundImage = `url("${unsplash.highResUrl}")`;
                } else {
                    document.body.style.backgroundImage = `url("${unsplash.lowResUrl}")`;
                    imgLoader.onload = () => {
                        document.body.style.backgroundImage = `url("${unsplash.highResUrl}")`;
                    };
                    imgLoader.onerror = async () => {
                        hidePhotoCredits();
                        await applyCustomOrFallbackBackground(idArray, true);
                    };
                }
                setPhotoCredits(unsplash.authorName, unsplash.authorProfile, unsplash.unsplashUrl);
                return;
            } else {
                hidePhotoCredits();
                // Unsplash falhou (servidor indisponível, limite atingido ou offline)
                // Apenas se o Unsplash falhou E a lista estiver vazia, carrega as imagens padrão de fallback!
                await applyCustomOrFallbackBackground(idArray, true);
                return;
            }
        }

        hidePhotoCredits();
        // Caso Unsplash esteja desligado pelo usuário:
        // Usa apenas os backgrounds do usuário. Se a lista estiver vazia, não força recarregar padrões.
        await applyCustomOrFallbackBackground(idArray, false);
    }

    async function applyCustomOrFallbackBackground(idArray, isUnsplashFallback) {
        hidePhotoCredits();
        // Apenas se o Unsplash falhou E a lista está vazia, carrega as imagens padrão de fallback
        if (isUnsplashFallback && idArray.length === 0) {
            console.log('Unsplash falhou e lista vazia. Carregando backgrounds padrão de fallback.');
            await loadDefaultBackgrounds();
            idArray = await getIdArray();
        }

        if (idArray.length > 0) {
            console.log('Loading Customized Background.');

            const index = await getImageIndex(idArray.length);
            const backImg = await getBackground(idArray[index - 1]);

            if (backImg) {
                document.body.style.backgroundImage = `url("${backImg}")`;
            }
        } else {
            document.body.style.backgroundImage = 'none';
        }
    }

    async function loadDefaultBackgrounds() {
        const totalDeImagens = 12;
        for (let i = 0; i < totalDeImagens; i++) {
            await addBackground(`img/${i}.jpg`);
        }
    }

    async function addBackground(imageSource) {
        const result = await chrome.storage.local.get(['idArray']);
        let idArrayB = result.idArray || [];

        const id = 'bg_' + generateId();
        idArrayB.push(id);

        await chrome.storage.local.set({ idArray: idArrayB });
        await chrome.storage.local.set({ [id]: imageSource });

        await addDisplayImage(id);
        initSortableDisplay();
        console.log("New background:", id);
        return id;
    }

    async function getBackground(id) {
        return new Promise(resolve => {
            chrome.storage.local.get([id], (result) => {
                const valor = result[id];
                resolve(valor);
            });
        });
    }

    async function getImageIndex(imagesLength) {
        const { lastImageIndex = 0 } = await chrome.storage.sync.get('lastImageIndex');
        let proximoIndice = lastImageIndex + 1;
        if (proximoIndice > imagesLength) proximoIndice = 1;

        await chrome.storage.sync.set({ lastImageIndex: proximoIndice });
        return proximoIndice;
    }

    // ELEMENTOS
    const closeOverlayBtn = document.getElementById('close-overlay-btn');
    const overlay = document.getElementById('add-link-overlay');
    const form = document.getElementById('add-link-form');
    const addLinkBtn = document.getElementById('add-link-btn');
    const contextMenu = document.getElementById('context-menu');
    const removeBtn = document.getElementById('remove-btn');
    const editBtn = document.getElementById('edit-btn');
    const gridContainer = document.querySelector('.grid-container');

    let GRID_COLS = 8;
    let gridArray = [];

    // Gerenciamento de Ícones Customizados no storage local (evita estourar cota do storage.sync)
    async function saveCustomIcon(linkId, base64) {
        const res = await chrome.storage.local.get({ customIcons: {} });
        const customIcons = res.customIcons || {};
        if (base64) {
            customIcons[linkId] = base64;
        } else {
            delete customIcons[linkId];
        }
        await chrome.storage.local.set({ customIcons });
    }

    async function getCustomIcon(linkId) {
        const res = await chrome.storage.local.get({ customIcons: {} });
        return res.customIcons?.[linkId] || null;
    }

    async function removeCustomIcon(linkId) {
        const res = await chrome.storage.local.get({ customIcons: {} });
        if (res.customIcons && res.customIcons[linkId]) {
            delete res.customIcons[linkId];
            await chrome.storage.local.set({ customIcons: res.customIcons });
        }
    }

    // Grid configuration
    async function gridConfiguration() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['grid', 'links'], (result) => {
                if (result.grid) {
                    GRID_COLS = result.grid.col;
                } else {
                    chrome.storage.sync.set({ grid: { col: 8 } });
                    GRID_COLS = 8;
                }
                gridArray = result.links;
                resolve(gridArray);
            });
        });
    }

    // Creates the grid structure
    async function createGrid() {
        await gridConfiguration();
        const linkSizeVal = await getLinkSize();
        const sizeLink = linkSizeVal * 0.47;

        if (!gridContainer) return;

        const LINK_SIZE = Math.floor(sizeLink * 16);
        gridContainer.style.maxWidth = `${(GRID_COLS * LINK_SIZE + (GRID_COLS * 10))}px`;
        updateSameCornerWidth();
    }

    async function renderLink(name, url, customIcon, icone, id, hasCustomIcon) {
        const fullUrl = url?.startsWith('http') ? url : ('https://' + (url || ''));
        const finalId = id || generateId(); // Ensure ID exists
        let hostname;
        try { hostname = new URL(fullUrl).hostname; } catch (e) { hostname = url || ''; }
        const iconId = `icon_${hostname}`; // Keyed by hostname to update automatically on URL change

        const newLink = document.createElement('a');
        newLink.href = fullUrl;
        newLink.className = 'quick-link';
        newLink.dataset.name = name;
        newLink.dataset.id = finalId;
        
        let effectiveCustomIcon = customIcon;
        if (!effectiveCustomIcon && (hasCustomIcon || icone)) {
            effectiveCustomIcon = await getCustomIcon(finalId);
            if (!effectiveCustomIcon && icone) {
                effectiveCustomIcon = icone;
            }
        }

        if (effectiveCustomIcon) {
            newLink.dataset.hasCustomIcon = 'true';
        }

        // Image Element
        const iconImg = document.createElement('img');
        iconImg.className = 'link-icon';
        iconImg.alt = '';
        
        // Default fallback
        const fallbackIcon = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="20" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif">?</text></svg>';
        iconImg.onerror = () => { iconImg.src = fallbackIcon; };

        // LOGIC: Custom Icon -> Cached Favicon -> Fetch New Favicon
        if (effectiveCustomIcon) {
            iconImg.src = effectiveCustomIcon;
        } else {
            // Check local storage for cached favicon
            iconImg.src = fallbackIcon; // Temporary placeholder
            
            chrome.storage.local.get({ icons: {} }, async (res) => {
                const icons = res.icons || {};
                if (icons[iconId]) {
                    if (icons[iconId] !== 'NOT_FOUND') {
                        iconImg.src = icons[iconId];
                    }
                } else if (hostname) {
                    try {
                        const base64 = await faviconToBase64(hostname);
                        const cur = await chrome.storage.local.get({ icons: {} });
                        const latestIcons = cur.icons || {};
                        if (base64) {
                            iconImg.src = base64;
                            latestIcons[iconId] = base64;
                        } else {
                            latestIcons[iconId] = 'NOT_FOUND';
                        }
                        await chrome.storage.local.set({ icons: latestIcons });
                    } catch (err) {
                        console.log("Error fetching favicon", err);
                    }
                }
            });
        }

        const newLinkSpan = document.createElement('span');
        newLinkSpan.className = 'link-text';
        newLinkSpan.innerText = name;

        newLink.appendChild(iconImg);
        newLink.appendChild(newLinkSpan);

        newLink.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, newLink);
        });
        return newLink;
    }

    // Carrega e renderiza links
    async function loadLinks() {
        gridContainer.innerHTML = ''; // Clear once before loading
        await createGrid();
        setLinkSize();

        const result = await chrome.storage.sync.get('links');
        const links = result.links || [];

        // Migração de ícones customizados legados salvos no sync para o storage local
        let migratedAny = false;
        const resLocal = await chrome.storage.local.get({ customIcons: {} });
        const customIcons = resLocal.customIcons || {};

        for (const link of links) {
            if (link.customIcon && typeof link.customIcon === 'string' && link.customIcon.startsWith('data:')) {
                customIcons[link.id] = link.customIcon;
                link.hasCustomIcon = true;
                delete link.customIcon;
                migratedAny = true;
            }
            if (link.icone && typeof link.icone === 'string' && link.icone.startsWith('data:')) {
                customIcons[link.id] = link.icone;
                link.hasCustomIcon = true;
                delete link.icone;
                migratedAny = true;
            }
            const linkEl = await renderLink(link.name, link.url, null, null, link.id, link.hasCustomIcon);
            gridContainer.appendChild(linkEl);
        }

        if (migratedAny) {
            await chrome.storage.local.set({ customIcons });
            await chrome.storage.sync.set({ links });
            console.log("Migrated custom icons from sync to local storage.");
        }
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // state for editing
    let activeLink = null;
    let isEditing = false;
    let editingLink = null;
    let editingId = null;

    let linksSortableInstance = null;

    function removeLink(linkElement) {
        if (!linkElement) return hideContextMenu();
        const link = linkElement.closest('.quick-link');
        if (!link) return hideContextMenu();

        const name = link.dataset.name || 'this website';
        if (!confirm(`Are you sure you want to remove "${name}"?`)) {
            return hideContextMenu();
        }

        const id = link.dataset.id;
        link.remove();

        if (id) {
            removeCustomIcon(id);
        }

        chrome.storage.sync.set({ links: getLinksFromGrid() }, () => {
            hideContextMenu();
        });
    }

    async function getLinkById(id) {
        const result = await getGridArray();
        gridArray = result.links || [];
        return gridArray.find(link => link.id === id) || null;
    }

    async function getGridArray() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['links'], (result) => {
                const arr = result.links || [];
                gridArray = arr;
                resolve(arr);
            });
        });
    }

    function openEditFor(linkElement) {
        if (!linkElement) return;
        const link = linkElement.closest('.quick-link');
        if (!link) return;
        editingLink = link;
        editingId = link.dataset.id;
        console.log('edit log: ', editingId);

        isEditing = true;
        activeLink = linkElement;

        const titleElem = document.getElementById('overlay-title');
        if (titleElem) titleElem.textContent = 'Edit Website';
        const submitBtn = document.getElementById('btn-submit-link');
        if (submitBtn) submitBtn.textContent = 'Save';

        document.getElementById('site-name').value = linkElement.dataset.name || '';
        document.getElementById('site-url').value = linkElement.href || '';

        const removeCustomGroup = document.getElementById('remove-custom-icon-group');
        const removeCustomCb = document.getElementById('remove-custom-icon-cb');
        if (removeCustomGroup && removeCustomCb) {
            removeCustomCb.checked = false;
            removeCustomGroup.style.display = linkElement.dataset.hasCustomIcon === 'true' ? 'block' : 'none';
        }

        showOverlay();
    }

    function getLinksFromGrid() {
        const items = document.querySelectorAll('.quick-link');
        return Array.from(items).map(item => ({
            id: item.dataset.id,
            name: item.dataset.name,
            url: item.href,
            hasCustomIcon: item.dataset.hasCustomIcon === 'true'
        }));
    }

    // UI helpers
    function showOverlay() {
        closeMenu();
        hideTutorialHighlight();
        if (!overlay) return;
        overlay.style.display = 'flex';
        const nameInput = document.getElementById('site-name');
        if (nameInput) nameInput.focus();
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.style.display = 'none';
        if (form) form.reset();
        const titleElem = document.getElementById('overlay-title');
        if (titleElem) titleElem.textContent = 'Add New Website';
        const submitBtn = document.getElementById('btn-submit-link');
        if (submitBtn) submitBtn.textContent = 'Add';
        const removeCustomGroup = document.getElementById('remove-custom-icon-group');
        if (removeCustomGroup) removeCustomGroup.style.display = 'none';
        isEditing = false;
        activeLink = null;
        editingLink = null;
        editingId = null;
    }

    function hideContextMenu() {
        if (!contextMenu) return;
        contextMenu.style.display = 'none';
        activeLink = null;
    }

    function initSortable() {
        const container = document.getElementById('grid-container');
        if (!container || typeof Sortable === 'undefined') return;

        if (linksSortableInstance) {
            linksSortableInstance.destroy();
            linksSortableInstance = null;
        }

        linksSortableInstance = new Sortable(container, {
            animation: 150,
            ghostClass: 'link-ghost',
            group: {
                name: 'grid',
                pull: false,
                put: false
            },
            onEnd: function () {
                chrome.storage.sync.set({ links: getLinksFromGrid() });
            }
        });
    }

    addLinkBtn.addEventListener('click', showOverlay);
    closeOverlayBtn.addEventListener('click', hideOverlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hideOverlay(); });

    removeBtn.addEventListener('click', () => {
        if (activeLink) removeLink(activeLink);
        hideContextMenu();
    });

    editBtn.addEventListener('click', () => {
        if (activeLink) openEditFor(activeLink);
        hideContextMenu();
    });

    function showContextMenu(event, linkElement) {
        event.preventDefault();
        event.stopPropagation();
        activeLink = linkElement;
        
        contextMenu.style.visibility = 'hidden';
        contextMenu.style.display = 'flex';

        const menuWidth = contextMenu.offsetWidth || 160;
        const menuHeight = contextMenu.offsetHeight || 80;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        let x = event.clientX, y = event.clientY;
        if (x + menuWidth > windowWidth) x = windowWidth - menuWidth - 10;
        if (y + menuHeight > windowHeight) y = windowHeight - menuHeight - 10;
        if (x < 10) x = 10;
        if (y < 10) y = 10;
        contextMenu.style.top = `${y}px`;
        contextMenu.style.left = `${x}px`;
        contextMenu.style.visibility = 'visible';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const siteName = document.getElementById('site-name').value.trim();
        let siteUrl = document.getElementById('site-url').value.trim();
        const fileInput = document.getElementById('custom-icon');
        const file = fileInput?.files[0];

        if (!siteName || !siteUrl) {
            alert('Please fill all required fields.');
            return;
        }
        if (!siteUrl.startsWith('http')) siteUrl = 'https://' + siteUrl;

        let customIcon = null;
        if (file) {
            if (file.size > 1024 * 1024) {
                alert('The selected icon file exceeds the 1MB limit. Please choose a smaller file.');
                return;
            }
            try { customIcon = await convertToBase64(file); } catch (err) { console.error(err); }
        }

        if (isEditing && editingId) {
            // EDIT MODE
            const removeCustomCb = document.getElementById('remove-custom-icon-cb');
            let updatedCustomIcon = null;

            if (removeCustomCb && removeCustomCb.checked) {
                await removeCustomIcon(editingId);
                updatedCustomIcon = null;
            } else {
                const existingCustomIcon = await getCustomIcon(editingId);
                updatedCustomIcon = customIcon || existingCustomIcon || null;
                if (customIcon) {
                    await saveCustomIcon(editingId, customIcon);
                }
            }

            // Remove o ícone em cache para que a alteração de URL ou recarregamento busque o favicon novo
            let editedHostname;
            try { editedHostname = new URL(siteUrl).hostname; } catch (e) { editedHostname = siteUrl || ''; }
            if (editedHostname) {
                const cur = await chrome.storage.local.get({ icons: {} });
                const icons = cur.icons || {};
                delete icons[`icon_${editedHostname}`];
                await chrome.storage.local.set({ icons });
            }

            // Render new element
            const newEl = await renderLink(siteName, siteUrl, updatedCustomIcon, null, editingId, Boolean(updatedCustomIcon));
            
            // Replace in DOM
            if (editingLink && editingLink.parentNode) {
                editingLink.parentNode.replaceChild(newEl, editingLink);
            }

            // Cleanup
            hideOverlay();

        } else {
            // NEW LINK MODE
            const id = generateId();
            if (customIcon) {
                await saveCustomIcon(id, customIcon);
            }
            
            // Create DOM Element
            const linkEl = await renderLink(siteName, siteUrl, customIcon, null, id, Boolean(customIcon));
            gridContainer.appendChild(linkEl);
        }

        // --- FINAL SAVE ---
        chrome.storage.sync.set({ links: getLinksFromGrid() }, () => {
            hideOverlay();
            form.reset();
        });
    });

    window.addEventListener('click', (e) => {
        if (contextMenu.style.display === 'flex' && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    window.addEventListener('contextmenu', (e) => {
        if (contextMenu.style.display === 'flex' && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (overlay && overlay.style.display === 'flex') {
                hideOverlay();
            }
            if (settingsMenu && settingsMenu.style.display === 'flex') {
                closeMenu();
            }
            if (contextMenu && contextMenu.style.display === 'flex') {
                hideContextMenu();
            }
            const tut = document.getElementById('tutorial');
            if (tut && tut.style.display === 'block') {
                hideTutorialHighlight();
            }
        }
    });

    function showTutorialHighlight() {
        const tutorialOverlay = document.getElementById('tutorial');
        const button = document.getElementById('add-link-btn');
        const circle1 = document.getElementById('circle1');
        const circle2 = document.getElementById('circle2');

        if(tutorialOverlay) tutorialOverlay.style.display = 'block';

        if (!button || !circle1 || !circle2) return;

        button.style.boxShadow = '0 0 15px 5px rgba(92, 121, 250, 0.45)';

        const rect = button.getBoundingClientRect();
        const rectCircle1 = circle1.getBoundingClientRect();
        const rectCircle2 = circle2.getBoundingClientRect();

        const buttonCenterX = rect.left + (rect.width / 2);
        const buttonCenterY = rect.top + (rect.height / 2);

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const circle1Bottom = (viewportHeight - buttonCenterY) - (rectCircle1.height / 2);
        const circle1Right = (viewportWidth - buttonCenterX) - (rectCircle1.width / 2);

        const circle2Bottom = (viewportHeight - buttonCenterY) - (rectCircle2.height / 2);
        const circle2Right = (viewportWidth - buttonCenterX) - (rectCircle2.width / 2);

        circle1.style.bottom = `${circle1Bottom}px`;
        circle1.style.right = `${circle1Right}px`;

        circle2.style.bottom = `${circle2Bottom}px`;
        circle2.style.right = `${circle2Right}px`;
    }

    function hideTutorialHighlight() {
        const tutorialOverlay = document.getElementById('tutorial');
        const button = document.getElementById('add-link-btn');
        if(tutorialOverlay) tutorialOverlay.style.display = 'none';
        if(button) button.style.boxShadow = '';

        chrome.storage.sync.set({ showTutorial: false });
    }

    const tutorialElem = document.getElementById('tutorial');
    if (tutorialElem) {
        tutorialElem.addEventListener('click', hideTutorialHighlight);
    }

    window.addEventListener('resize', () => {
        const tut = document.getElementById('tutorial');
        if (tut && tut.style.display === 'block') {
            showTutorialHighlight();
        }
    });

    chrome.storage.sync.get(['showTutorial'], (result) => {
        if (result.showTutorial) {
            showTutorialHighlight();
        }
    });

    function convertToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    // SETTINGS & HELPERS
    const openBtn = document.getElementById('open-settings-btn');
    const closeBtn = document.getElementById('close-settings-btn');
    const backdrop = document.getElementById('settings-backdrop');
    const settingsMenu = document.getElementById('settings-menu');
    const changeBgBtn = document.getElementById('change-bg-btn');
    const exportLinksBtn = document.getElementById('export-links-btn');
    const importLinksBtn = document.getElementById('import-links-btn');
    const fileInput = document.getElementById('selectFiles');
    const changeBgInput = document.getElementById('change-bg-input');
    const resetBgBtn = document.getElementById('reset-bg-settings-btn');
    const closeNotificationBtn = document.getElementById('close-notification-btn');
    const displayContainer = document.getElementById('img-display-container');
    const btnColMaxGrid = document.getElementById('max-col');
    const btnColMinGrid = document.getElementById('min-col');
    const inputColGrid = document.getElementById('col');
    const resetLinksBtn = document.getElementById('reset-links-settings-btn');
    const clearListBtn = document.getElementById('clear-list-btn');
    const linkSizeInput = document.getElementById('link-size-input');
    const widthCheckbox = document.getElementById('width-checkbox');
    const unsplashCheckbox = document.getElementById('unsplash-checkbox');
    const unsplashThemesSection = document.getElementById('unsplash-themes-section');
    const customBgSection = document.getElementById('custom-bg-section');
    const clockCheckbox = document.getElementById('clock-checkbox');
    const clockPositionGrid = document.getElementById('clock-position-grid');

    const openMenu = () => {
        hideOverlay();
        backdrop.style.display = 'block';
        settingsMenu.style.display = 'flex';
        updatePositionButtonsUI();
    };

    const closeMenu = () => {
        backdrop.style.display = 'none';
        settingsMenu.style.display = 'none';
    };

    const resetLinks = () => {
        if (confirm('Are you sure you want to reset all links? This action cannot be undone.')) {
            chrome.storage.sync.set({ links: [] }, async () => {
                await chrome.storage.local.set({ customIcons: {} });
                loadLinks();
                closeMenu();
                showNotification("Success. All links have been reset.");
            });
        }
    }

    const exportLinks = async () => {
        const syncRes = await chrome.storage.sync.get(['links']);
        const links = syncRes.links || [];
        const localRes = await chrome.storage.local.get({ customIcons: {} });
        const customIcons = localRes.customIcons || {};

        const exportData = links.map(link => ({
            ...link,
            customIcon: customIcons[link.id] || null
        }));

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const blobUrl = URL.createObjectURL(blob);
        const dlAnchorElem = document.getElementById('downloadAnchorElem');
        dlAnchorElem.setAttribute("href", blobUrl);
        dlAnchorElem.setAttribute("download", "websiteLinks.json");
        dlAnchorElem.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    };

    const importLinks = () => {
        fileInput.click();
    };

    const importLinksInput = () => {
        const files = fileInput.files;
        if (!files || files.length === 0) return false;

        if (!confirm('Importing websites will replace your current links list. Do you want to proceed?')) {
            fileInput.value = '';
            return false;
        }

        const fr = new FileReader();
        fr.onload = async () => {
            try {
                const linksJson = JSON.parse(fr.result);
                if (!Array.isArray(linksJson)) {
                    throw new Error("Invalid format: expected array of links");
                }

                const localRes = await chrome.storage.local.get({ customIcons: {} });
                const customIcons = localRes.customIcons || {};

                const sanitizedLinks = [];
                for (const item of linksJson) {
                    if (!item || !item.url) continue;
                    const id = item.id || generateId();
                    const hasCustom = Boolean(item.customIcon || item.hasCustomIcon);

                    if (item.customIcon && typeof item.customIcon === 'string' && item.customIcon.startsWith('data:')) {
                        customIcons[id] = item.customIcon;
                    }

                    sanitizedLinks.push({
                        id,
                        name: item.name || item.url,
                        url: item.url,
                        hasCustomIcon: hasCustom
                    });
                }

                await chrome.storage.local.set({ customIcons });
                await chrome.storage.sync.set({ links: sanitizedLinks });

                await loadLinks();
                closeMenu();
                showNotification("Success. Links imported successfully");
            } catch (err) {
                console.error("Invalid JSON file:", err);
                showNotification("Error: Invalid JSON file");
            } finally {
                fileInput.value = '';
            }
        };
        fr.readAsText(files[0]);
    };

    const changeBgButton = () => {
        changeBgInput.click();
    };

    function getIdArray() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['idArray'], (result) => {
                const idArray = result.idArray || [];
                resolve(idArray);
            });
        });
    }

    const changeBg = async () => {
        let imgBg = changeBgInput?.files;
        if (!imgBg || imgBg.length === 0) return false;

        for (let i = 0; i < imgBg.length; i++) {
            const base64 = await convertToBase64(imgBg[i]);
            await addBackground(base64);
        }

        const idArray = await getIdArray();
        showNotification("Success. Background picture changed successfully");

        if (idArray.length === 1) await loadBackground();
        changeBgInput.value = '';
    }

    let displaySortableInstance = null;
    function initSortableDisplay() {
        const container = document.getElementById('img-display-container');
        if(!container || typeof Sortable === 'undefined') return; 

        if (displaySortableInstance) {
            displaySortableInstance.destroy();
            displaySortableInstance = null;
        }

        displaySortableInstance = new Sortable(container, {
            animation: 150,
            ghostClass: 'link-ghost',
            group: {
                name: 'backgrounds-settings',
                pull: false,
                put: false
            },
            onEnd: function () {
                chrome.storage.local.set({ idArray: getLinksFromDisplayArray() });
            }
        });
    }

    function getLinksFromDisplayArray() {
        const items = document.querySelectorAll('#img-display-container .div-display');
        return Array.from(items).map(item => item.id);
    }

    async function loadImageDisplay(idArray) {
        if (displayContainer) {
            displayContainer.innerHTML = '';
            for (let i = 0; i < idArray.length; i++) {
                await addDisplayImage(idArray[i]);
            }
            initSortableDisplay();
        }
    }

    async function addDisplayImage(id) {
        const imgSrc = await getBackground(id);
        if (!imgSrc) return;

        const divElem = document.createElement('div');
        divElem.style.position = 'relative';
        divElem.className = 'div-display';
        divElem.id = id;

        const aElem = document.createElement('div');
        aElem.className = 'img-display-a';

        const btnElem = document.createElement('img');
        btnElem.className = 'img-display-btn';
        btnElem.src = 'icons/svg/trash.svg';
        btnElem.alt = 'Remove background';
        btnElem.title = 'Remove this background';

        const imgElem = document.createElement('img');
        imgElem.src = imgSrc;
        imgElem.className = 'img-display-back';
        imgElem.alt = 'Background thumbnail';

        aElem.appendChild(imgElem);
        aElem.appendChild(btnElem);
        divElem.appendChild(aElem);
        displayContainer.appendChild(divElem);

        btnElem.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Are you sure you want to remove this background image?')) {
                removeBg(divElem.id);
            }
        });
    }

    async function removeDisplayImage(id) {
        const divElem = document.getElementById(id);
        if(divElem) divElem.remove();
    }

    const resetBg = async () => {
        if (confirm('Are you sure you want to reset the backgrounds? This action cannot be undone.')) {
            await resetBack();
            showNotification("Success. Background reset successfully");
        }
    }

    async function resetBack() {
        await clearBgList();
        if(displayContainer) displayContainer.innerHTML = '';
        await loadDefaultBackgrounds();
        initSortableDisplay();
        await chrome.storage.sync.set({
            unsplashThemes: ['nature'],
            unsplashCustomTheme: '',
            unsplashCustomEnabled: false
        });
        await loadUnsplashThemesSetting();
        await loadBackground();
    }

    let notifTimer = null;
    function showNotification(message) {
        const notif = document.getElementById('notification');
        if(!notif) return;
        document.getElementById('notif-message').innerText = message;
        notif.style.opacity = "1";
        notif.style.pointerEvents = "auto";
        if (notifTimer) clearTimeout(notifTimer);
        notifTimer = setTimeout(() => {
            closeNotification();
        }, 3500);
    }

    function closeNotification() {
        const notif = document.getElementById('notification');
        if(notif) {
            notif.style.opacity = "0";
            notif.style.pointerEvents = "none";
        }
        if (notifTimer) {
            clearTimeout(notifTimer);
            notifTimer = null;
        }
    }

    async function removeBg(id) {
        let idArrayB = await getIdArray();
        idArrayB = idArrayB.filter(item => item !== id);

        await chrome.storage.local.set({ idArray: idArrayB });
        chrome.storage.local.remove(id);
        removeDisplayImage(id);
        await loadBackground();
    }

    function setGridDefaults() {
        chrome.storage.sync.get(['grid'], (result) => {
            if (result.grid) {
                inputColGrid.value = result.grid.col || 8;
            } else {
                chrome.storage.sync.set({ grid: { col: 8 } });
                inputColGrid.value = 8;
            }
        });
    }

    function clamp(value, min = 1, max = 15) {
        return Math.min(Math.max(value, min), max);
    }

    function inputGrid(input) {
        const value = clamp(Number(input.value));
        input.value = value;
        saveGrid(value);
    }

    function maxGrid(input) {
        const value = clamp(Number(input.value) + 1);
        input.value = value;
        saveGrid(value);
    }

    function minGrid(input) {
        const value = clamp(Number(input.value) - 1);
        input.value = value;
        saveGrid(value);
    }

    async function saveGrid(value) {
        const stored = await chrome.storage.sync.get('grid');
        const grid = stored.grid || { col: 8 };
        grid.col = value;

        chrome.storage.sync.set({ grid });
        await loadLinks();
        initSortable();
    }

    async function clearBgList() {
        const arrayId = await getIdArray();
        for (let i = 0; i < arrayId.length; i++) {
            chrome.storage.local.remove(arrayId[i]);
        }
        await chrome.storage.local.set({ idArray: [] });
        await chrome.storage.sync.set({ lastImageIndex: 0 });
    }

    const clearBg = async () => {
        if (confirm('Are you sure you want to clear all background images?')) {
            await clearBgList();
            document.body.style.backgroundImage = 'none';
            hidePhotoCredits();
            showNotification('Success. Background list cleared successfully');
            if(displayContainer) displayContainer.innerHTML = '';
            await loadBackground();
        }
    }

    const linkSize = async () => {
        const linkSizeVal = linkSizeInput.value;
        const sizeLink = linkSizeVal * 0.47;
        const sizeText = linkSizeVal * 0.07;

        await chrome.storage.sync.set({ linkSize: linkSizeVal });

        document.documentElement.style.setProperty("--link-size", sizeLink + "rem");
        document.documentElement.style.setProperty("--text-link-size", sizeText + "em");

        const result = await chrome.storage.sync.get('grid');
        GRID_COLS = result.grid ? (result.grid.col || 8) : 8;
        const LINK_SIZE = Math.floor(sizeLink * 16);
        gridContainer.style.maxWidth = `${(GRID_COLS * LINK_SIZE + (GRID_COLS * 10))}px`;
        updateSameCornerWidth();
    }

    async function setLinkSize() {
        const linkSizeVal = await getLinkSize();
        linkSizeInput.value = linkSizeVal;
        const sizeLink = linkSizeVal * 0.47;
        const sizeText = linkSizeVal * 0.07;
        document.documentElement.style.setProperty("--link-size", sizeLink + "rem");
        document.documentElement.style.setProperty("--text-link-size", sizeText + "em");
    }

    async function getLinkSize() {
        const result = await chrome.storage.sync.get('linkSize');
        return result.linkSize !== undefined ? result.linkSize : 15;
    }

    // ==========================================================================
    // CLOCK COMPONENT
    // ==========================================================================
    function initClock() {
        updateClock();
        setInterval(updateClock, 1000);
    }

    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const timeElem = document.getElementById('clock-time');

        if (timeElem) timeElem.textContent = `${hours}:${minutes}`;
    }

    async function getEnableClock() {
        const result = await chrome.storage.sync.get('enableClock');
        return result.enableClock !== undefined ? result.enableClock : true;
    }

    function updateClockUI(isEnabled) {
        if (clockCheckbox) {
            clockCheckbox.checked = isEnabled;
        }
        if (clockPositionGrid) {
            if (isEnabled) {
                clockPositionGrid.classList.remove('disabled-section');
            } else {
                clockPositionGrid.classList.add('disabled-section');
            }
        }
    }

    const toggleClock = async () => {
        const isEnabled = clockCheckbox ? clockCheckbox.checked : true;
        await chrome.storage.sync.set({ enableClock: isEnabled });
        updateClockUI(isEnabled);
        updateLayout(currentLinkPos, currentClockPos);
    };

    function updateSameCornerWidth() {
        const sameCorner = document.getElementById('same-corner-container');
        const grid = document.getElementById('grid-container');
        if (sameCorner && grid && grid.style.maxWidth) {
            sameCorner.style.width = grid.style.maxWidth;
            sameCorner.style.maxWidth = grid.style.maxWidth;
        }
    }

    // ==========================================================================
    // POSITIONING & LAYOUT SYSTEM (Clock & Links)
    // ==========================================================================
    const posFlexMap = {
        'top-left': { ver: 'flex-start', hor: 'flex-start' },
        'top-center': { ver: 'flex-start', hor: 'center' },
        'top-right': { ver: 'flex-start', hor: 'flex-end' },
        'left': { ver: 'center', hor: 'flex-start' },
        'center': { ver: 'center', hor: 'center' },
        'right': { ver: 'center', hor: 'flex-end' },
        'bottom-left': { ver: 'flex-end', hor: 'flex-start' },
        'bottom-center': { ver: 'flex-end', hor: 'center' },
        'bottom-right': { ver: 'flex-end', hor: 'flex-end' }
    };

    function normalizePosition(pos) {
        if (!pos) return null;
        if (typeof pos === 'string') return pos;
        const { ver, hor } = pos;
        if (ver === 'flex-start') {
            if (hor === 'flex-start') return 'top-left';
            if (hor === 'center') return 'top-center';
            if (hor === 'flex-end') return 'top-right';
        } else if (ver === 'center') {
            if (hor === 'flex-start') return 'left';
            if (hor === 'center') return 'center';
            if (hor === 'flex-end') return 'right';
        } else if (ver === 'flex-end') {
            if (hor === 'flex-start') return 'bottom-left';
            if (hor === 'center') return 'bottom-center';
            if (hor === 'flex-end') return 'bottom-right';
        }
        return 'top-left';
    }

    let currentLinkPos = 'top-left';
    let currentClockPos = 'top-right';

    function updateLayout(linkPos, clockPos) {
        currentLinkPos = linkPos || 'top-left';
        currentClockPos = clockPos || 'top-right';

        const boxed = document.querySelector('.boxed');
        const clockContainer = document.getElementById('clock-container');
        const linksContainer = document.getElementById('links-container');
        if (!boxed || !clockContainer || !linksContainer) return;

        // Safely detach components before clearing old containers
        const frag = document.createDocumentFragment();
        frag.appendChild(clockContainer);
        frag.appendChild(linksContainer);

        boxed.querySelectorAll('.corner-container').forEach(c => c.remove());

        const isClockEnabled = clockCheckbox ? clockCheckbox.checked : true;
        const addLinkBtn = document.getElementById('add-link-btn');

        if (!isClockEnabled) {
            // Relógio desativado: esconde relógio e mantém links no seu canto
            clockContainer.style.display = 'none';

            if (currentLinkPos === currentClockPos) {
                const sameCornerDiv = document.createElement('div');
                sameCornerDiv.id = 'same-corner-container';
                sameCornerDiv.className = `corner-container same-corner pos-${currentLinkPos}`;

                const grid = document.getElementById('grid-container');
                if (grid && grid.style.maxWidth) {
                    sameCornerDiv.style.width = grid.style.maxWidth;
                    sameCornerDiv.style.maxWidth = grid.style.maxWidth;
                }

                sameCornerDiv.appendChild(clockContainer);
                sameCornerDiv.appendChild(linksContainer);

                boxed.insertBefore(sameCornerDiv, addLinkBtn || boxed.firstChild);
            } else {
                const clockCornerDiv = document.createElement('div');
                clockCornerDiv.id = 'clock-corner-container';
                clockCornerDiv.className = `corner-container pos-${currentClockPos}`;
                clockCornerDiv.style.display = 'none';
                clockCornerDiv.appendChild(clockContainer);

                const linksCornerDiv = document.createElement('div');
                linksCornerDiv.id = 'links-corner-container';
                linksCornerDiv.className = `corner-container pos-${currentLinkPos}`;
                linksCornerDiv.appendChild(linksContainer);

                boxed.insertBefore(linksCornerDiv, addLinkBtn || boxed.firstChild);
                boxed.insertBefore(clockCornerDiv, addLinkBtn || boxed.firstChild);
            }
        } else {
            // Relógio ativado
            clockContainer.style.display = 'flex';

            if (currentLinkPos === currentClockPos) {
                // Mesmo canto: div compartilhada com a mesma largura calculada da div dos links
                const sameCornerDiv = document.createElement('div');
                sameCornerDiv.id = 'same-corner-container';
                sameCornerDiv.className = `corner-container same-corner pos-${currentLinkPos}`;

                const grid = document.getElementById('grid-container');
                if (grid && grid.style.maxWidth) {
                    sameCornerDiv.style.width = grid.style.maxWidth;
                    sameCornerDiv.style.maxWidth = grid.style.maxWidth;
                }

                sameCornerDiv.appendChild(clockContainer);
                sameCornerDiv.appendChild(linksContainer);

                boxed.insertBefore(sameCornerDiv, addLinkBtn || boxed.firstChild);
            } else {
                // Cantos diferentes
                const clockCornerDiv = document.createElement('div');
                clockCornerDiv.id = 'clock-corner-container';
                clockCornerDiv.className = `corner-container pos-${currentClockPos}`;
                clockCornerDiv.appendChild(clockContainer);

                const linksCornerDiv = document.createElement('div');
                linksCornerDiv.id = 'links-corner-container';
                linksCornerDiv.className = `corner-container pos-${currentLinkPos}`;
                linksCornerDiv.appendChild(linksContainer);

                boxed.insertBefore(linksCornerDiv, addLinkBtn || boxed.firstChild);
                boxed.insertBefore(clockCornerDiv, addLinkBtn || boxed.firstChild);
            }
        }

        updatePositionButtonsUI();
        initSortable();
        updateSameCornerWidth();
    }

    function updatePositionButtonsUI() {
        document.querySelectorAll('#links-position-grid .position-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.position === currentLinkPos);
        });
        document.querySelectorAll('#clock-position-grid .clock-position-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.position === currentClockPos);
        });
    }

    function setLinkPosition(newPos) {
        currentLinkPos = newPos;
        if (posFlexMap[newPos]) {
            document.documentElement.style.setProperty("--link-container-vertical", posFlexMap[newPos].ver);
            document.documentElement.style.setProperty("--link-container-horizontal", posFlexMap[newPos].hor);
        }
        chrome.storage.sync.set({ linkPosition: newPos });
        updateLayout(currentLinkPos, currentClockPos);
    }

    function setClockPosition(newPos) {
        currentClockPos = newPos;
        chrome.storage.sync.set({ clockPosition: newPos });
        updateLayout(currentLinkPos, currentClockPos);
    }

    async function loadPosition() {
        const result = await chrome.storage.sync.get(['linkPosition', 'clockPosition', 'enableClock']);
        currentLinkPos = normalizePosition(result.linkPosition) || 'top-left';
        currentClockPos = normalizePosition(result.clockPosition) || 'top-right';
        const isClockEnabled = result.enableClock !== undefined ? result.enableClock : true;
        updateClockUI(isClockEnabled);

        if (posFlexMap[currentLinkPos]) {
            document.documentElement.style.setProperty("--link-container-vertical", posFlexMap[currentLinkPos].ver);
            document.documentElement.style.setProperty("--link-container-horizontal", posFlexMap[currentLinkPos].hor);
        }

        updateLayout(currentLinkPos, currentClockPos);
    }

    document.querySelectorAll('#links-position-grid .position-btn').forEach(btn => {
        btn.addEventListener("click", () => {
            setLinkPosition(btn.dataset.position);
        });
    });

    document.querySelectorAll('#clock-position-grid .clock-position-btn').forEach(btn => {
        btn.addEventListener("click", () => {
            setClockPosition(btn.dataset.position);
        });
    });

    const fullWidth = () => {
        if (widthCheckbox.checked) {
            document.documentElement.style.setProperty("--box-width", "100%");
        } else {
            document.documentElement.style.setProperty("--box-width", "1920px");
        }
        setFullWidth();
    }

    function setFullWidth() {
        const fullWidth = document.documentElement.style.getPropertyValue("--box-width");
        const isFullWidth = fullWidth === "100%";
        chrome.storage.sync.set({ fullWidth: isFullWidth });
    }

    async function getFullWidth() {
        const result = await chrome.storage.sync.get('fullWidth');
        return result.fullWidth !== undefined ? result.fullWidth : true;
    }

    async function loadFullWidth() {
        const isFullWidth = await getFullWidth();
        const fullWidth = isFullWidth ? "100%" : "1920px";
        widthCheckbox.checked = isFullWidth;
        document.documentElement.style.setProperty("--box-width", fullWidth);
    }

    async function faviconToBase64(hostname, size = 128) {
        return chrome.runtime.sendMessage({
            action: "fetchFavicon",
            hostname,
            size
        });
    }

    async function getUseUnsplash() {
        const result = await chrome.storage.sync.get('useUnsplash');
        return result.useUnsplash !== undefined ? result.useUnsplash : true;
    }

    function updateBgSettingsUI(isUnsplash) {
        if (customBgSection) {
            if (isUnsplash) {
                customBgSection.classList.add('disabled-section');
            } else {
                customBgSection.classList.remove('disabled-section');
            }
        }
        if (unsplashThemesSection) {
            if (isUnsplash) {
                unsplashThemesSection.classList.remove('disabled-section');
            } else {
                unsplashThemesSection.classList.add('disabled-section');
            }
        }
        if (unsplashCheckbox) {
            unsplashCheckbox.checked = isUnsplash;
        }
    }

    async function loadUnsplashSetting() {
        const isUnsplash = await getUseUnsplash();
        updateBgSettingsUI(isUnsplash);
    }

    async function getActiveThemes() {
        const { unsplashThemes, unsplashCustomTheme, unsplashCustomEnabled } =
            await chrome.storage.sync.get(['unsplashThemes', 'unsplashCustomTheme', 'unsplashCustomEnabled']);

        const selectedThemes = Array.isArray(unsplashThemes) && unsplashThemes.length > 0
            ? [...unsplashThemes]
            : ['nature'];

        if (unsplashCustomEnabled && unsplashCustomTheme && unsplashCustomTheme.trim()) {
            selectedThemes.push(unsplashCustomTheme.trim());
        }

        return selectedThemes.length > 0 ? selectedThemes : ['nature'];
    }

    async function loadUnsplashThemesSetting() {
        const { unsplashThemes, unsplashCustomTheme, unsplashCustomEnabled } =
            await chrome.storage.sync.get(['unsplashThemes', 'unsplashCustomTheme', 'unsplashCustomEnabled']);

        const activeThemes = Array.isArray(unsplashThemes) && unsplashThemes.length > 0
            ? unsplashThemes
            : ['nature'];

        const themeCheckboxes = document.querySelectorAll('.theme-checkbox:not(#custom-theme-checkbox)');
        themeCheckboxes.forEach(cb => {
            const isChecked = activeThemes.includes(cb.value);
            cb.checked = isChecked;
            const parent = cb.closest('.theme-item');
            if (parent) parent.classList.toggle('checked', isChecked);
        });

        const customCb = document.getElementById('custom-theme-checkbox');
        const customInput = document.getElementById('custom-theme-input');
        if (customCb) {
            customCb.checked = !!unsplashCustomEnabled;
            const parent = customCb.closest('.theme-item');
            if (parent) parent.classList.toggle('checked', !!unsplashCustomEnabled);
        }
        if (customInput && unsplashCustomTheme !== undefined) {
            customInput.value = unsplashCustomTheme;
        }
    }

    async function saveUnsplashThemes() {
        const themeCheckboxes = document.querySelectorAll('.theme-checkbox:not(#custom-theme-checkbox)');
        const selectedThemes = [];
        themeCheckboxes.forEach(cb => {
            if (cb.checked) {
                selectedThemes.push(cb.value);
            }
        });

        const customCb = document.getElementById('custom-theme-checkbox');
        const customInput = document.getElementById('custom-theme-input');
        const customEnabled = customCb ? customCb.checked : false;
        const customText = customInput ? customInput.value.trim() : '';

        // If nothing is selected and custom is not enabled/empty, default back to 'nature'
        if (selectedThemes.length === 0 && (!customEnabled || !customText)) {
            selectedThemes.push('nature');
            const natureCb = document.querySelector('.theme-checkbox[value="nature"]');
            if (natureCb) {
                natureCb.checked = true;
                natureCb.closest('.theme-item')?.classList.toggle('checked', true);
            }
        }

        await chrome.storage.sync.set({
            unsplashThemes: selectedThemes,
            unsplashCustomEnabled: customEnabled,
            unsplashCustomTheme: customText
        });
    }

    let themeChangeDebounce = null;
    function triggerThemeChange(immediate = false) {
        clearTimeout(themeChangeDebounce);
        const delay = immediate ? 50 : 750;
        themeChangeDebounce = setTimeout(async () => {
            await saveUnsplashThemes();
            const useUnsplash = await getUseUnsplash();
            if (useUnsplash) {
                clearUnsplashCache();
                await loadBackground();
            }
        }, delay);
    }

    function initUnsplashThemeListeners() {
        const themeCheckboxes = document.querySelectorAll('.theme-checkbox:not(#custom-theme-checkbox)');
        const customCb = document.getElementById('custom-theme-checkbox');
        const customInput = document.getElementById('custom-theme-input');

        themeCheckboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                const parent = cb.closest('.theme-item');
                if (parent) parent.classList.toggle('checked', cb.checked);

                const anyBuiltinChecked = Array.from(themeCheckboxes).some(c => c.checked);
                const isCustomValid = customCb?.checked && customInput?.value.trim().length > 0;

                if (!anyBuiltinChecked && !isCustomValid) {
                    cb.checked = true;
                    if (parent) parent.classList.add('checked');
                    showNotification("At least one theme must be selected.");
                    return;
                }

                triggerThemeChange(true);
            });
        });

        if (customCb) {
            customCb.addEventListener('change', () => {
                const parent = customCb.closest('.theme-item');
                if (parent) parent.classList.toggle('checked', customCb.checked);

                if (customCb.checked && customInput && !customInput.value.trim()) {
                    customInput.focus();
                }

                const anyBuiltinChecked = Array.from(themeCheckboxes).some(c => c.checked);
                if (!anyBuiltinChecked && !customCb.checked) {
                    customCb.checked = true;
                    if (parent) parent.classList.add('checked');
                    showNotification("At least one theme must be selected.");
                    return;
                }

                triggerThemeChange(true);
            });
        }

        if (customInput) {
            customInput.addEventListener('input', () => {
                if (customInput.value.trim().length > 0 && customCb && !customCb.checked) {
                    customCb.checked = true;
                    const parent = customCb.closest('.theme-item');
                    if (parent) parent.classList.add('checked');
                }
                triggerThemeChange(false);
            });

            customInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    const toggleUnsplash = async () => {
        const isEnabled = unsplashCheckbox.checked;
        await chrome.storage.sync.set({ useUnsplash: isEnabled });
        updateBgSettingsUI(isEnabled);
        await loadBackground();
    };

    init();

    // Event Listeners
    openBtn.addEventListener('click', openMenu);
    closeBtn.addEventListener('click', closeMenu);
    backdrop.addEventListener('click', closeMenu);
    exportLinksBtn.addEventListener('click', exportLinks);
    changeBgBtn.addEventListener('click', changeBgButton);
    changeBgInput.addEventListener('change', changeBg);
    importLinksBtn.addEventListener('click', importLinks);
    fileInput.addEventListener('change', importLinksInput);
    resetBgBtn.addEventListener('click', resetBg);
    closeNotificationBtn.addEventListener('click', closeNotification);
    btnColMaxGrid.addEventListener('click', () => maxGrid(inputColGrid));
    btnColMinGrid.addEventListener('click', () => minGrid(inputColGrid));
    inputColGrid.addEventListener('change', () => inputGrid(inputColGrid));
    resetLinksBtn.addEventListener('click', resetLinks);
    clearListBtn.addEventListener('click', clearBg);
    linkSizeInput.addEventListener('input', linkSize);
    widthCheckbox.addEventListener('change', fullWidth);
    if (unsplashCheckbox) {
        unsplashCheckbox.addEventListener('change', toggleUnsplash);
    }
    if (clockCheckbox) {
        clockCheckbox.addEventListener('change', toggleClock);
    }

});
